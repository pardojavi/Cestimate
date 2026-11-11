import {
  aISO,
  tokenizar,
  terminosExigidos,
  zMercadonaCategory,
  type StoreProduct,
} from "@cestimate/shared";
import { config } from "../config.js";
import { ErrorTienda, esperar, pedirJSON } from "../lib/http.js";
import {
  catalogoActualizado,
  guardarProducto,
  marcarCatalogo,
  type DB,
} from "../lib/db.js";
import {
  aNumero,
  normalizarUnidad,
  type Contexto,
  type StoreAdapter,
} from "./types.js";

/**
 * Adaptador Mercadona.
 *
 * Vía verificada en vivo (2026-11-11): la API JSON de tienda.mercadona.es
 *   GET /api/categories/            → 26 categorías raíz
 *   GET /api/categories/{id}/       → subcategorías con productos y precio
 *   GET /products/{id}/ (detalle)   → price_instructions
 * Requiere la cabecera `x-version: v10137` (la que usa su frontend).
 *
 * No existe buscador de texto público (su buscador real está tras Akamai):
 * por eso este adaptador **indexa el catálogo en SQLite** y busca en local.
 * Aviso: robots.txt de Mercadona marca `Disallow: /api` — decisión documentada
 * en el README (ver «Obtención de precios»).
 */

const BASE = "https://tienda.mercadona.es/api";
const TIEMPO_VIDA_CATALOGO_H = 6;

interface ProductoMercadona {
  id: string | number;
  display_name?: string;
  slug?: string;
  thumbnail?: string | null;
  price_instructions?: {
    bulk_price?: string | null;
    unit_price?: string | null;
    size_format?: string | null;
    unit_size?: number | null;
  };
}

/** Recorre recursivamente la jerarquía de categorías extrayendo productos. */
function extraerProductos(
  nodo: unknown,
  salida: ProductoMercadona[] = [],
): ProductoMercadona[] {
  if (!nodo || typeof nodo !== "object") return salida;
  const obj = nodo as Record<string, unknown>;
  const productos = obj.products;
  if (Array.isArray(productos)) {
    for (const p of productos) {
      if (p && typeof p === "object") salida.push(p as ProductoMercadona);
    }
  }
  for (const valor of Object.values(obj)) {
    if (Array.isArray(valor)) {
      for (const item of valor) extraerProductos(item, salida);
    } else if (valor && typeof valor === "object") {
      extraerProductos(valor, salida);
    }
  }
  return salida;
}

export function aStoreProduct(p: ProductoMercadona): StoreProduct | null {
  const precio = aNumero(p.price_instructions?.bulk_price);
  if (precio === null || precio <= 0) return null;
  const nombre = p.display_name?.trim();
  if (!nombre) return null;

  const sizeFormat = p.price_instructions?.size_format ?? null;
  const unitSize = p.price_instructions?.unit_size ?? null;
  const unitPrice = aNumero(p.price_instructions?.unit_price);
  const unidad = normalizarUnidad(sizeFormat);
  const formato =
    unitSize && unitSize > 0 && sizeFormat
      ? `${unitSize} ${sizeFormat === "l" ? "L" : sizeFormat}`.replace(".", ",")
      : null;

  return {
    storeId: "mercadona",
    externalId: String(p.id),
    name: nombre,
    format: formato,
    price: precio,
    unitPrice:
      unitPrice && unidad && unitPrice > 0
        ? { value: unitPrice, unit: unidad }
        : null,
    imageUrl: p.thumbnail ?? null,
    url: `https://tienda.mercadona.es/product/${p.id}/${p.slug ?? ""}`.replace(
      /\/$/,
      "",
    ),
    fetchedAt: new Date().toISOString(),
  };
}

const CABECERAS: Record<string, string> = {
  "x-version": "v10137",
  Accept: "application/json",
  Origin: "https://tienda.mercadona.es",
  Referer: "https://tienda.mercadona.es/",
};

export function crearMercadona(base: DB): StoreAdapter {
  let promesaRefresh: Promise<void> | null = null;

  async function refrescarCatalogo(ctx: Contexto): Promise<void> {
    const inicio = Date.now();
    marcarCatalogo(base, "mercadona", null); // null = indexando
    try {
      const raices = await pedirJSON<{ results: unknown[] }>(
        "mercadona",
        `${BASE}/categories/`,
        { headers: CABECERAS },
      );
      const raicesParseadas = zMercadonaCategory
        .array()
        .safeParse((raices as { results: unknown[] }).results);
      if (!raicesParseadas.success) {
        throw new ErrorTienda(
          "mercadona",
          "formato",
          "Formato inesperado en /api/categories/ (¿han cambiado el esquema?)",
        );
      }

      // Subcategorías de primer nivel (152 en la prueba de aceptación).
      const subcategorias: number[] = [];
      for (const raiz of raicesParseadas.data) {
        for (const sub of (raiz.categories ?? []) as { id?: number }[]) {
          if (typeof sub?.id === "number") subcategorias.push(sub.id);
        }
      }

      // Concurrencia baja (3) y delay entre peticiones (§4.3).
      const COLA = 3;
      let indice = 0;
      let guardados = 0;
      const trabajador = async (): Promise<void> => {
        while (indice < subcategorias.length) {
          const id = subcategorias[indice++]!;
          try {
            const datos = await pedirJSON<unknown>(
              "mercadona",
              `${BASE}/categories/${id}/`,
              { headers: CABECERAS },
            );
            const parseado = zMercadonaCategory.safeParse(datos);
            if (parseado.success) {
              const productos = extraerProductos(parseado.data);
              for (const p of productos) {
                const sp = aStoreProduct(p);
                if (sp) {
                  guardarProducto(base, {
                    storeId: "mercadona",
                    externalId: sp.externalId,
                    name: sp.name,
                    format: sp.format,
                    imageUrl: sp.imageUrl,
                    url: sp.url,
                    price: sp.price,
                    unitPrice: sp.unitPrice?.value ?? null,
                    unit: sp.unitPrice?.unit ?? null,
                    postalCode: ctx.postalCode,
                  });
                  guardados++;
                }
              }
            }
          } catch (error) {
            // Un fallo de una subcategoría no detiene el resto (§4.3).
            console.warn(
              `[mercadona] subcategoría ${id} omitida:`,
              error instanceof Error ? error.message : error,
            );
          }
          await esperar(120);
        }
      };
      await Promise.all(Array.from({ length: COLA }, () => trabajador()));

      marcarCatalogo(base, "mercadona", new Date().toISOString());
      console.log(
        `[mercadona] catálogo indexado: ${guardados} productos con precio en ${((Date.now() - inicio) / 1000).toFixed(1)} s`,
      );
    } catch (error) {
      marcarCatalogo(base, "mercadona", null);
      throw error;
    }
  }

  return {
    id: "mercadona",

    async ensureCatalog(ctx: Contexto): Promise<void> {
      const actualizado = catalogoActualizado(base, "mercadona");
      if (actualizado) {
        const edadH =
          (Date.now() - new Date(actualizado).getTime()) / 3_600_000;
        if (edadH < TIEMPO_VIDA_CATALOGO_H) return;
      }
      if (!promesaRefresh) {
        promesaRefresh = refrescarCatalogo(ctx).finally(() => {
          promesaRefresh = null;
        });
      }
      await promesaRefresh;
    },

    async search(query: string, ctx: Contexto): Promise<StoreProduct[]> {
      const terminos = tokenizar(query);
      if (terminos.length === 0) return [];

      // Solo se exigen los términos relevantes (2+ caracteres): los números
      // y unidades («1 l») no deben aparecer literalmente en el nombre.
      const exigidos = terminosExigidos(terminos);
      const condiciones = exigidos
        .map(() => "p.name_norm LIKE ?")
        .join(" AND ");
      const parametros = exigidos.map((t) => `%${t}%`);
      const filas = base
        .prepare(
          `SELECT p.id, p.store_id, p.external_id, p.name, p.format, p.image_url, p.url,
                  s.price, s.unit_price, s.unit, s.fetched_at
           FROM product p
           JOIN (
             SELECT product_id, price, unit_price, unit, fetched_at,
                    ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY fetched_at DESC) AS rn
             FROM price_snapshot
           ) s ON s.product_id = p.id AND s.rn = 1
           WHERE p.store_id = 'mercadona' AND ${condiciones}
           ORDER BY s.price ASC
           LIMIT 40`,
        )
        .all(...parametros) as {
        id: number;
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
        storeId: "mercadona",
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
    },

    async getProduct(
      externalId: string,
      ctx: Contexto,
    ): Promise<StoreProduct | null> {
      try {
        const datos = await pedirJSON<ProductoMercadona>(
          "mercadona",
          `${BASE}/products/${externalId}/`,
          { headers: CABECERAS },
        );
        const sp = aStoreProduct(datos);
        if (!sp) return null;
        guardarProducto(base, {
          storeId: "mercadona",
          externalId: sp.externalId,
          name: sp.name,
          format: sp.format,
          imageUrl: sp.imageUrl,
          url: sp.url,
          price: sp.price,
          unitPrice: sp.unitPrice?.value ?? null,
          unit: sp.unitPrice?.unit ?? null,
          postalCode: ctx.postalCode,
        });
        return sp;
      } catch (error) {
        if (
          error instanceof ErrorTienda &&
          error.code === "http" &&
          error.message.includes("404")
        ) {
          return null;
        }
        throw error;
      }
    },
  };
}
