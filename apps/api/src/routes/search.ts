import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import {
  aISO,
  type StoreProduct,
  type StoreSearchResult,
} from "@cestimate/shared";
import { registrarAdaptadores } from "../adapters/index.js";
import { ErrorTienda } from "../lib/http.js";
import { abrirDB, obtenerAjustes, type DB } from "../lib/db.js";

/**
 * GET /api/search?q=...&stores=a,b
 * Consulta todas las tiendas activas en paralelo (§3.1). Un fallo en una
 * tienda nunca bloquea las demás: cada resultado lleva su estado.
 */

const adaptadores = registrarAdaptadores(abrirDB());

export function hashCache(...partes: string[]): string {
  return createHash("sha1").update(partes.join("|")).digest("hex");
}

export function registrarBusqueda(app: FastifyInstance): void {
  app.get<{ Querystring: { q?: string; stores?: string; comunes?: string } }>(
    "/api/search",
    async (request, reply) => {
      const { q, stores } = request.query;
      const consulta = (q ?? "").trim();
      if (consulta.length < 2) {
        return reply
          .code(400)
          .send({ error: "Escribe al menos 2 caracteres para buscar." });
      }
      const base = abrirDB();
      const ajustes = obtenerAjustes(base);
      const filtroTiendas = stores
        ? new Set(
            stores
              .split(",")
              .map((s) => s.trim())
              .filter(Boolean),
          )
        : null;

      const tiendas = (
        base
          .prepare(
            "SELECT id, name, adapter FROM store WHERE active = 1 ORDER BY name",
          )
          .all() as { id: string; name: string; adapter: string }[]
      ).filter((t) => !filtroTiendas || filtroTiendas.has(t.id));

      const resultados = await Promise.all(
        tiendas.map((tienda) =>
          buscarEnTienda(
            base,
            tienda,
            consulta,
            ajustes.postalCode,
            ajustes.ttlHours,
          ),
        ),
      );

      return { query: consulta, results: resultados };
    },
  );
}

async function buscarEnTienda(
  base: DB,
  tienda: { id: string; name: string; adapter: string },
  consulta: string,
  postalCode: string,
  ttlHours: number,
): Promise<StoreSearchResult> {
  const inicio = Date.now();
  const ctx = { postalCode };

  try {
    const adaptador = adaptadores.get(tienda.adapter);
    if (!adaptador) {
      // Tienda manual: sus precios viven en price_snapshot (los introduce el usuario).
      const resultados = buscarManual(base, tienda.id, consulta);
      const conId = asociarIds(base, tienda.id, resultados);
      return {
        storeId: tienda.id,
        storeName: tienda.name,
        status: conId.length > 0 ? "ok" : "sin-resultados",
        products: conId,
        fetchedAt: new Date().toISOString(),
        ...(conId.length > 0
          ? {}
          : { message: "Sin precios manuales que coincidan con la búsqueda." }),
      };
    }

    // Caché de búsqueda para tiendas con buscador remoto (§4.3).
    const clave = hashCache("search", tienda.id, consulta, postalCode);
    const cache = leerCache(base, clave, ttlHours);
    if (cache) {
      const conId = asociarIds(base, tienda.id, cache.productos);
      return {
        storeId: tienda.id,
        storeName: tienda.name,
        status: conId.length > 0 ? "ok" : "sin-resultados",
        products: conId,
        fetchedAt: cache.fetchedAt,
        ...(conId.length > 0
          ? {}
          : { message: "Sin resultados para esta búsqueda." }),
      };
    }

    // Mercadona necesita su catálogo indexado antes de poder buscar.
    if (adaptador.ensureCatalog) {
      try {
        await Promise.race([
          adaptador.ensureCatalog(ctx),
          new Promise((_, rechazar) =>
            setTimeout(
              () =>
                rechazar(new ErrorTienda(tienda.id, "timeout", "Indexando")),
              45_000,
            ),
          ),
        ]);
      } catch (error) {
        const esTimeout =
          error instanceof ErrorTienda && error.code === "timeout";
        if (esTimeout || catalogoEnCurso(base, tienda.id)) {
          return {
            storeId: tienda.id,
            storeName: tienda.name,
            status: "indexando",
            products: [],
            fetchedAt: null,
            message:
              "Primera búsqueda: indexando el catálogo de Mercadona (tarda ~20 s). Vuelve a buscar en unos segundos.",
          };
        }
        throw error;
      }
    }

    const productos = await adaptador.search(consulta, ctx);
    const conId = asociarIds(base, tienda.id, productos);
    guardarCache(base, clave, conId);

    return {
      storeId: tienda.id,
      storeName: tienda.name,
      status: conId.length > 0 ? "ok" : "sin-resultados",
      products: conId,
      fetchedAt: new Date().toISOString(),
      ...(conId.length > 0
        ? {}
        : { message: "Sin resultados para esta búsqueda." }),
    };
  } catch (error) {
    // Aislamiento por tienda (§4.3): log claro y estado de error tipado.
    const motivo =
      error instanceof ErrorTienda
        ? error.message
        : error instanceof Error
          ? error.message
          : String(error);
    console.warn(`[${tienda.id}] búsqueda fallida:`, motivo);
    return {
      storeId: tienda.id,
      storeName: tienda.name,
      status: "error",
      products: [],
      fetchedAt: null,
      message: traducirError(error),
    };
  } finally {
    const ms = Date.now() - inicio;
    if (ms > 3000) console.log(`[${tienda.id}] búsqueda en ${ms} ms`);
  }
}

function traducirError(error: unknown): string {
  if (error instanceof ErrorTienda) {
    switch (error.code) {
      case "timeout":
        return "La tienda no respondió a tiempo (timeout).";
      case "http":
        return `La tienda devolvió un error HTTP. Puede estar bloqueando peticiones automatizadas.`;
      case "formato":
        return "La respuesta de la tienda cambió de formato; no se muestran datos para evitar precios incorrectos.";
      case "red":
        return "Sin conexión con la tienda.";
      case "sin-datos":
        return "La tienda no tiene datos disponibles.";
    }
  }
  return error instanceof Error ? error.message : "Error desconocido.";
}

function leerCache(
  base: DB,
  clave: string,
  ttlHours: number,
): { productos: StoreProduct[]; fetchedAt: string } | null {
  const fila = base
    .prepare(
      "SELECT payload, fetched_at FROM search_cache WHERE query_hash = ?",
    )
    .get(clave) as { payload: string; fetched_at: string } | undefined;
  if (!fila) return null;
  const edadH =
    (Date.now() - new Date(aISO(fila.fetched_at)).getTime()) / 3_600_000;
  if (edadH > ttlHours) return null;
  try {
    const productos = JSON.parse(fila.payload) as StoreProduct[];
    if (!Array.isArray(productos)) return null;
    return {
      productos,
      fetchedAt: aISO(fila.fetched_at),
    };
  } catch {
    return null;
  }
}

function guardarCache(
  base: DB,
  clave: string,
  productos: StoreProduct[],
): void {
  base
    .prepare(
      `INSERT INTO search_cache (query_hash, store_id, payload, fetched_at)
       VALUES (?, 'global', ?, datetime('now'))
       ON CONFLICT (query_hash, store_id) DO UPDATE SET
         payload = excluded.payload, fetched_at = excluded.fetched_at`,
    )
    .run(clave, JSON.stringify(productos));
}

function catalogoEnCurso(base: DB, storeId: string): boolean {
  const fila = base
    .prepare("SELECT refreshed_at FROM catalog_meta WHERE store_id = ?")
    .get(storeId) as { refreshed_at: string | null } | undefined;
  return fila !== undefined && fila.refreshed_at === null;
}

/** Asocia el id local de SQLite a cada producto (para elegirlo en la cesta). */
function asociarIds(
  base: DB,
  storeId: string,
  productos: StoreProduct[],
): StoreProduct[] {
  const externos = [...new Set(productos.map((p) => p.externalId))];
  if (externos.length === 0) return productos;
  const ids = new Map<string, number>();
  const TROZO = 100;
  for (let i = 0; i < externos.length; i += TROZO) {
    const trozo = externos.slice(i, i + TROZO);
    const filas = base
      .prepare(
        `SELECT id, external_id FROM product
         WHERE store_id = ? AND external_id IN (${trozo.map(() => "?").join(",")})`,
      )
      .all(storeId, ...trozo) as { id: number; external_id: string }[];
    for (const f of filas) ids.set(f.external_id, f.id);
  }
  return productos.map((p) => ({ ...p, localId: ids.get(p.externalId) }));
}

/** Búsqueda local entre productos manuales (tiendas sin adaptador). */
function buscarManual(
  base: DB,
  storeId: string,
  consulta: string,
): StoreProduct[] {
  const terminos = consulta
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean);
  const condiciones = terminos.map(() => "p.name_norm LIKE ?").join(" AND ");
  const filas = base
    .prepare(
      `SELECT p.external_id, p.name, p.format, p.image_url, p.url,
              s.price, s.unit_price, s.unit, s.fetched_at
       FROM product p
       JOIN (
         SELECT product_id, price, unit_price, unit, fetched_at,
                ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY fetched_at DESC) rn
         FROM price_snapshot
       ) s ON s.product_id = p.id AND s.rn = 1
       WHERE p.store_id = ? AND ${condiciones}
       ORDER BY s.price ASC LIMIT 30`,
    )
    .all(storeId, ...terminos.map((t) => `%${t}%`)) as {
    external_id: string;
    name: string;
    format: string | null;
    image_url: string | null;
    url: string;
    price: number;
    unit_price: number | null;
    unit: string | null;
    fetched_at: string;
  }[];
  return filas.map((f) => ({
    storeId,
    externalId: f.external_id,
    name: f.name,
    format: f.format,
    price: f.price,
    unitPrice:
      f.unit_price && f.unit
        ? { value: f.unit_price, unit: f.unit as "kg" | "L" | "ud" }
        : null,
    imageUrl: f.image_url,
    url: f.url,
    fetchedAt: aISO(f.fetched_at),
  }));
}
