import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { aISO } from "@cestimate/shared";
import { abrirDB, type DB } from "../lib/db.js";

/**
 * Cestas guardadas (§3.6): fecha, descripción y foto de precios del momento.
 * Los precios guardados no cambian aunque cambien después.
 */

const zNueva = z.object({
  date: z.string().min(4).max(40),
  description: z.string().min(1).max(300),
});

interface LineaConActual {
  id: number;
  generic_name: string;
  qty: number;
  store_id: string;
  store_name: string;
  product_name: string | null;
  price_at_save: number | null;
  unit_price_at_save: number | null;
  unit: string | null;
  url: string | null;
  product_id: number | null;
  price_now: number | null;
  fetched_now: string | null;
}

function leerLineas(base: DB, basketId: number): LineaConActual[] {
  return base
    .prepare(
      `SELECT l.*, (
         SELECT price FROM price_snapshot ps
         WHERE ps.product_id = l.product_id
         ORDER BY ps.fetched_at DESC LIMIT 1
       ) AS price_now,
       (
         SELECT fetched_at FROM price_snapshot ps
         WHERE ps.product_id = l.product_id
         ORDER BY ps.fetched_at DESC LIMIT 1
       ) AS fetched_now
       FROM saved_basket_line l
       WHERE l.saved_basket_id = ?
       ORDER BY l.store_name, l.generic_name`,
    )
    .all(basketId) as LineaConActual[];
}

function totalesPorTienda(lineas: LineaConActual[]) {
  const mapa = new Map<string, { name: string; total: number }>();
  for (const l of lineas) {
    if (l.price_at_save === null) continue;
    const actual = mapa.get(l.store_id) ?? { name: l.store_name, total: 0 };
    actual.total += l.price_at_save * l.qty;
    mapa.set(l.store_id, actual);
  }
  return [...mapa.entries()].map(([storeId, v]) => ({
    storeId,
    storeName: v.name,
    total: v.total,
  }));
}

export function registrarGuardadas(app: FastifyInstance): void {
  app.get("/api/saved-baskets", async () => {
    const base = abrirDB();
    const cestas = base
      .prepare(
        "SELECT id, date, description, created_at FROM saved_basket ORDER BY created_at DESC",
      )
      .all() as {
      id: number;
      date: string;
      description: string;
      created_at: string;
    }[];
    return cestas.map((c) => ({
      ...c,
      totals: totalesPorTienda(leerLineas(base, c.id)),
    }));
  });

  /** Guarda una foto de los precios actuales de la cesta activa. */
  app.post("/api/saved-baskets", async (request, reply) => {
    const parseado = zNueva.safeParse(request.body);
    if (!parseado.success) {
      return reply
        .code(400)
        .send({ error: "Falta la fecha o la descripción." });
    }
    const base = abrirDB();
    const items = base
      .prepare(
        `SELECT bi.generic_name, bi.qty, m.store_id, m.product_id,
                p.name AS product_name, p.url,
                (SELECT price FROM price_snapshot ps WHERE ps.product_id = m.product_id
                 ORDER BY ps.fetched_at DESC LIMIT 1) AS price,
                (SELECT unit_price FROM price_snapshot ps WHERE ps.product_id = m.product_id
                 ORDER BY ps.fetched_at DESC LIMIT 1) AS unit_price,
                (SELECT unit FROM price_snapshot ps WHERE ps.product_id = m.product_id
                 ORDER BY ps.fetched_at DESC LIMIT 1) AS unit
         FROM basket_item bi
         JOIN basket_item_match m ON m.basket_item_id = bi.id
         JOIN product p ON p.id = m.product_id
         ORDER BY bi.id`,
      )
      .all() as {
      generic_name: string;
      qty: number;
      store_id: string;
      product_id: number;
      product_name: string;
      url: string;
      price: number | null;
      unit_price: number | null;
      unit: string | null;
    }[];

    if (items.length === 0) {
      return reply
        .code(400)
        .send({
          error: "La cesta está vacía o no tiene productos emparejados.",
        });
    }

    const guardar = base.transaction(() => {
      const resultado = base
        .prepare("INSERT INTO saved_basket (date, description) VALUES (?, ?)")
        .run(parseado.data.date, parseado.data.description);
      const id = Number(resultado.lastInsertRowid);
      const stmt = base.prepare(
        `INSERT INTO saved_basket_line
           (saved_basket_id, generic_name, qty, store_id, store_name, product_name,
            price_at_save, unit_price_at_save, unit, url, product_id)
         VALUES (?, ?, ?, ?, (SELECT name FROM store WHERE id = ?), ?, ?, ?, ?, ?, ?)`,
      );
      for (const l of items) {
        stmt.run(
          id,
          l.generic_name,
          l.qty,
          l.store_id,
          l.store_id,
          l.product_name,
          l.price,
          l.unit_price,
          l.unit,
          l.url,
          l.product_id,
        );
      }
      return id;
    });

    return reply.code(201).send({ id: guardar() });
  });

  app.get<{ Params: { id: string } }>(
    "/api/saved-baskets/:id",
    async (request, reply) => {
      const base = abrirDB();
      const cesta = base
        .prepare(
          "SELECT id, date, description, created_at FROM saved_basket WHERE id = ?",
        )
        .get(request.params.id) as
        | { id: number; date: string; description: string; created_at: string }
        | undefined;
      if (!cesta)
        return reply.code(404).send({ error: "Cesta no encontrada." });
      const lineas = leerLineas(base, cesta.id);
      return {
        ...cesta,
        lines: lineas.map((l) => ({
          id: l.id,
          genericName: l.generic_name,
          qty: l.qty,
          storeId: l.store_id,
          storeName: l.store_name,
          productName: l.product_name,
          priceAtSave: l.price_at_save,
          unitPriceAtSave: l.unit_price_at_save,
          unit: l.unit,
          url: l.url,
          priceNow: l.price_now,
          fetchedNow: l.fetched_now ? aISO(l.fetched_now) : null,
        })),
        totals: totalesPorTienda(lineas),
      };
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/saved-baskets/:id",
    async (request, reply) => {
      const base = abrirDB();
      const resultado = base
        .prepare("DELETE FROM saved_basket WHERE id = ?")
        .run(request.params.id);
      if (resultado.changes === 0)
        return reply.code(404).send({ error: "Cesta no encontrada." });
      return { ok: true };
    },
  );

  /** Carga una cesta guardada como cesta activa (§3.6). */
  app.post<{ Params: { id: string } }>(
    "/api/saved-baskets/:id/load",
    async (request, reply) => {
      const base = abrirDB();
      const lineas = leerLineas(base, Number(request.params.id));
      if (lineas.length === 0)
        return reply.code(404).send({ error: "Cesta no encontrada." });

      const cargar = base.transaction(() => {
        base.prepare("DELETE FROM basket_item").run();
        const nuevoItem = base.prepare(
          "INSERT INTO basket_item (generic_name, qty) VALUES (?, ?)",
        );
        const nuevoMatch = base.prepare(
          `INSERT INTO basket_item_match (basket_item_id, store_id, product_id)
         VALUES (?, ?, ?)
         ON CONFLICT (basket_item_id, store_id) DO UPDATE SET product_id = excluded.product_id`,
        );
        const porNombre = new Map<string, number>();
        for (const l of lineas) {
          let itemId = porNombre.get(l.generic_name);
          if (!itemId) {
            itemId = Number(
              nuevoItem.run(l.generic_name, l.qty).lastInsertRowid,
            );
            porNombre.set(l.generic_name, itemId);
          }
          // El producto puede haberse dado de baja: solo emparejamos si existe.
          if (
            l.product_id &&
            base.prepare("SELECT 1 FROM product WHERE id = ?").get(l.product_id)
          ) {
            nuevoMatch.run(itemId, l.store_id, l.product_id);
          }
        }
      });
      cargar();
      return { ok: true };
    },
  );
}
