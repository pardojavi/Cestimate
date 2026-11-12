import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { aISO, type BasketSummary } from "@cestimate/shared";
import { registrarAdaptadores } from "../adapters/index.js";
import { abrirDB, obtenerAjustes, type DB } from "../lib/db.js";

/**
 * Cesta, emparejamiento y resumen (§3.2, §3.3 y §6).
 */

const adaptadores = registrarAdaptadores(abrirDB());

const zItem = z.object({
  genericName: z.string().min(1).max(200),
  qty: z.number().positive().max(999).default(1),
  // Emparejamientos iniciales: permite crear un artículo ya comparado
  // desde la pestaña Buscar (un producto por tienda).
  matches: z
    .array(
      z.object({
        storeId: z.string().min(1).max(64),
        productId: z.number().int().positive(),
      }),
    )
    .max(30)
    .optional(),
});

/**
 * Crea un artículo con sus emparejamientos en una sola transacción.
 * Si algún emparejamiento no es válido (producto inexistente o de otra
 * tienda), no se escribe nada y se lanza un Error con statusCode 400.
 */
export function crearArticulo(
  base: DB,
  datos: {
    genericName: string;
    qty: number;
    matches?: { storeId: string; productId: number }[];
  },
): number {
  const matches = datos.matches ?? [];
  for (const m of matches) {
    const producto = base
      .prepare("SELECT id, store_id FROM product WHERE id = ?")
      .get(m.productId) as { id: number; store_id: string } | undefined;
    if (!producto)
      throw Object.assign(new Error("Producto no encontrado."), {
        statusCode: 400,
      });
    if (producto.store_id !== m.storeId)
      throw Object.assign(new Error("El producto no pertenece a esa tienda."), {
        statusCode: 400,
      });
  }
  return base.transaction(() => {
    const resultado = base
      .prepare("INSERT INTO basket_item (generic_name, qty) VALUES (?, ?)")
      .run(datos.genericName, datos.qty);
    const itemId = Number(resultado.lastInsertRowid);
    const emparejar = base.prepare(
      `INSERT INTO basket_item_match (basket_item_id, store_id, product_id) VALUES (?, ?, ?)
       ON CONFLICT (basket_item_id, store_id) DO UPDATE SET product_id = excluded.product_id`,
    );
    for (const m of matches) emparejar.run(itemId, m.storeId, m.productId);
    return itemId;
  })();
}

const zEdicionItem = z.object({
  genericName: z.string().min(1).max(200).optional(),
  qty: z.number().positive().max(999).optional(),
});

interface ItemConMatch {
  id: number;
  generic_name: string;
  qty: number;
  store_id: string | null;
  product_id: number | null;
  product_name: string | null;
  format: string | null;
  price: number | null;
  unit_price: number | null;
  unit: string | null;
  url: string | null;
  image_url: string | null;
  fetched_at: string | null;
}

function leerItems(base: DB): ItemConMatch[] {
  return base
    .prepare(
      `SELECT bi.id, bi.generic_name, bi.qty,
              m.store_id, m.product_id,
              p.name AS product_name, p.format, p.url, p.image_url,
              s.price, s.unit_price, s.unit, s.fetched_at
       FROM basket_item bi
       LEFT JOIN basket_item_match m ON m.basket_item_id = bi.id
       LEFT JOIN product p ON p.id = m.product_id
       LEFT JOIN (
         SELECT product_id, price, unit_price, unit, fetched_at,
                ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY fetched_at DESC) rn
         FROM price_snapshot
       ) s ON s.product_id = m.product_id AND s.rn = 1
       ORDER BY bi.id`,
    )
    .all() as ItemConMatch[];
}

function construirBasket(base: DB) {
  const filas = leerItems(base);
  const porId = new Map<
    number,
    {
      id: number;
      genericName: string;
      qty: number;
      matches: Record<
        string,
        {
          storeId: string;
          productId: number;
          product: {
            name: string;
            format: string | null;
            price: number;
            unitPrice: number | null;
            unit: string | null;
            url: string;
            imageUrl: string | null;
            fetchedAt: string;
          };
        }
      >;
    }
  >();

  for (const f of filas) {
    let item = porId.get(f.id);
    if (!item) {
      item = { id: f.id, genericName: f.generic_name, qty: f.qty, matches: {} };
      porId.set(f.id, item);
    }
    if (f.store_id && f.product_id && f.price !== null) {
      item.matches[f.store_id] = {
        storeId: f.store_id,
        productId: f.product_id,
        product: {
          name: f.product_name ?? "",
          format: f.format,
          price: f.price,
          unitPrice: f.unit_price,
          unit: f.unit,
          url: f.url ?? "",
          imageUrl: f.image_url,
          fetchedAt: f.fetched_at
            ? aISO(f.fetched_at)
            : new Date().toISOString(),
        },
      };
    }
  }
  return [...porId.values()];
}

/** Totales, mínimo por fila, faltantes y ahorro (§3.3). */
export function calcularResumen(base: DB, soloComunes: boolean): BasketSummary {
  const tiendas = (
    base
      .prepare(
        "SELECT id, name, color FROM store WHERE active = 1 ORDER BY name",
      )
      .all() as { id: string; name: string; color: string }[]
  ).filter((t) =>
    base
      .prepare("SELECT 1 FROM basket_item_match WHERE store_id = ?")
      .get(t.id),
  );

  const items = construirBasket(base);

  // Con «solo comunes», solo se comparan los artículos presentes en todas
  // las tiendas con emparejamiento (§3.3).
  let itemsComparables = items;
  if (soloComunes && tiendas.length > 0) {
    itemsComparables = items.filter((i) =>
      tiendas.every((t) => i.matches[t.id]),
    );
  }

  const totales = new Map<string, { total: number; missing: number }>();
  for (const t of tiendas) {
    let total = 0;
    let missing = 0;
    for (const item of items) {
      const match = item.matches[t.id];
      if (match) {
        const incluido = soloComunes
          ? itemsComparables.some((i) => i.id === item.id)
          : true;
        if (incluido) total += match.product.price * item.qty;
      } else {
        if (!soloComunes) missing++;
        else if (itemsComparables.some((i) => i.id === item.id)) missing++;
      }
    }
    totales.set(t.id, { total, missing });
  }

  const completas = tiendas.filter(
    (t) => (totales.get(t.id)?.missing ?? 0) === 0,
  );
  const conTotal = completas
    .map((t) => ({ id: t.id, total: totales.get(t.id)!.total }))
    .filter((t) => itemsComparables.length > 0);

  let cheapest: string | null = null;
  let saving: number | null = null;
  if (conTotal.length > 0) {
    const ordenados = [...conTotal].sort((a, b) => a.total - b.total);
    cheapest = ordenados[0]!.id;
    if (ordenados.length > 1) {
      saving = ordenados[ordenados.length - 1]!.total - ordenados[0]!.total;
    }
  }

  const rows = items.map((item) => ({
    basketItemId: item.id,
    genericName: item.genericName,
    qty: item.qty,
    cells: tiendas.map((t) => {
      const match = item.matches[t.id];
      const precio = match ? match.product.price * item.qty : null;
      return { storeId: t.id, price: precio, cheapest: false };
    }),
  }));

  // Mejor precio por fila (solo entre celdas con precio).
  for (const fila of rows) {
    const precios = fila.cells.filter((c) => c.price !== null);
    if (precios.length === 0) continue;
    const minimo = Math.min(...precios.map((c) => c.price!));
    for (const c of fila.cells) if (c.price === minimo) c.cheapest = true;
  }

  return {
    stores: tiendas.map((t) => ({
      storeId: t.id,
      storeName: t.name,
      color: t.color,
      total:
        (totales.get(t.id)?.total ?? 0) > 0 ? totales.get(t.id)!.total : null,
      missing: totales.get(t.id)?.missing ?? 0,
      complete:
        (totales.get(t.id)?.missing ?? 0) === 0 &&
        completas.some((c) => c.id === t.id),
    })),
    cheapest,
    saving,
    rows,
  };
}

export function registrarCesta(app: FastifyInstance): void {
  app.get("/api/basket", async () => ({ items: construirBasket(abrirDB()) }));

  app.post("/api/basket/items", async (request, reply) => {
    const parseado = zItem.safeParse(request.body);
    if (!parseado.success) {
      return reply.code(400).send({ error: "Datos del artículo no válidos." });
    }
    // Si un emparejamiento no es válido, crearArticulo lanza un Error con
    // statusCode 400 y no se escribe nada; setErrorHandler lo devuelve tal cual.
    const id = crearArticulo(abrirDB(), parseado.data);
    return reply.code(201).send({ id });
  });

  app.patch<{ Params: { id: string } }>(
    "/api/basket/items/:id",
    async (request, reply) => {
      const parseado = zEdicionItem.safeParse(request.body);
      if (!parseado.success)
        return reply.code(400).send({ error: "Datos no válidos." });
      const base = abrirDB();
      const d = parseado.data;
      const resultado = base
        .prepare(
          "UPDATE basket_item SET generic_name = COALESCE(?, generic_name), qty = COALESCE(?, qty) WHERE id = ?",
        )
        .run(d.genericName ?? null, d.qty ?? null, request.params.id);
      if (resultado.changes === 0)
        return reply.code(404).send({ error: "Artículo no encontrado." });
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/basket/items/:id",
    async (request, reply) => {
      const base = abrirDB();
      const resultado = base
        .prepare("DELETE FROM basket_item WHERE id = ?")
        .run(request.params.id);
      if (resultado.changes === 0)
        return reply.code(404).send({ error: "Artículo no encontrado." });
      return { ok: true };
    },
  );

  /** Elige qué producto de una tienda representa al artículo (§3.2). */
  app.put<{ Params: { id: string; storeId: string } }>(
    "/api/basket/items/:id/match/:storeId",
    async (request, reply) => {
      const parseado = z
        .object({ productId: z.number().int().positive() })
        .safeParse(request.body);
      if (!parseado.success)
        return reply.code(400).send({ error: "Falta productId." });
      const base = abrirDB();
      const item = base
        .prepare("SELECT id FROM basket_item WHERE id = ?")
        .get(request.params.id);
      if (!item)
        return reply.code(404).send({ error: "Artículo no encontrado." });
      const producto = base
        .prepare("SELECT id, store_id FROM product WHERE id = ?")
        .get(parseado.data.productId) as
        { id: number; store_id: string } | undefined;
      if (!producto)
        return reply.code(404).send({ error: "Producto no encontrado." });
      if (producto.store_id !== request.params.storeId) {
        return reply
          .code(400)
          .send({ error: "El producto no pertenece a esa tienda." });
      }
      base
        .prepare(
          `INSERT INTO basket_item_match (basket_item_id, store_id, product_id) VALUES (?, ?, ?)
           ON CONFLICT (basket_item_id, store_id) DO UPDATE SET product_id = excluded.product_id`,
        )
        .run(
          request.params.id,
          request.params.storeId,
          parseado.data.productId,
        );
      return { ok: true };
    },
  );

  app.delete<{ Params: { id: string; storeId: string } }>(
    "/api/basket/items/:id/match/:storeId",
    async (request) => {
      const base = abrirDB();
      base
        .prepare(
          "DELETE FROM basket_item_match WHERE basket_item_id = ? AND store_id = ?",
        )
        .run(request.params.id, request.params.storeId);
      return { ok: true };
    },
  );

  app.get<{ Querystring: { comunes?: string } }>(
    "/api/basket/summary",
    async (request) => {
      const base = abrirDB();
      return calcularResumen(base, request.query.comunes === "1");
    },
  );

  /** Vuelve a consultar precios de lo emparejado (§6). */
  app.post("/api/basket/refresh", async () => {
    const base = abrirDB();
    const ajustes = obtenerAjustes(base);
    const matches = base
      .prepare(
        `SELECT DISTINCT p.store_id, p.external_id, s.adapter
         FROM basket_item_match m
         JOIN product p ON p.id = m.product_id
         JOIN store s ON s.id = p.store_id`,
      )
      .all() as { store_id: string; external_id: string; adapter: string }[];

    const resultados = await Promise.all(
      matches.map(async (m) => {
        const adaptador = adaptadores.get(m.adapter);
        if (!adaptador?.getProduct)
          return { store: m.store_id, ok: false, motivo: "sin adaptador" };
        try {
          const sp = await adaptador.getProduct(m.external_id, {
            postalCode: ajustes.postalCode,
          });
          if (!sp)
            return {
              store: m.store_id,
              ok: false,
              motivo: "producto no disponible",
            };
          // guardarProducto ya se encarga del snapshot en cada adaptador.
          return { store: m.store_id, ok: true };
        } catch (error) {
          return {
            store: m.store_id,
            ok: false,
            motivo: error instanceof Error ? error.message : String(error),
          };
        }
      }),
    );

    return { resultados, summary: calcularResumen(base, false) };
  });
}
