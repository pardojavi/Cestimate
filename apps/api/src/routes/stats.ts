import type { FastifyInstance } from "fastify";
import { aISO } from "@cestimate/shared";
import { abrirDB, type DB } from "../lib/db.js";

/**
 * Series para las gráficas (§3.5): evolución del total por tienda,
 * evolución del precio de productos y estadísticas de ahorro.
 */

function seriesTotales(base: DB) {
  // Total de cada cesta guardada, por tienda (a partir de los precios guardados).
  const filas = base
    .prepare(
      `SELECT l.saved_basket_id, b.date, l.store_id, l.store_name,
              SUM(l.price_at_save * l.qty) AS total
       FROM saved_basket_line l
       JOIN saved_basket b ON b.id = l.saved_basket_id
       WHERE l.price_at_save IS NOT NULL
       GROUP BY l.saved_basket_id, l.store_id
       ORDER BY b.created_at`,
    )
    .all() as {
    saved_basket_id: number;
    date: string;
    store_id: string;
    store_name: string;
    total: number;
  }[];

  const porCesta = new Map<
    number,
    {
      date: string;
      values: { storeId: string; storeName: string; total: number }[];
    }
  >();
  for (const f of filas) {
    let entrada = porCesta.get(f.saved_basket_id);
    if (!entrada) {
      entrada = { date: f.date, values: [] };
      porCesta.set(f.saved_basket_id, entrada);
    }
    entrada.values.push({
      storeId: f.store_id,
      storeName: f.store_name,
      total: f.total,
    });
  }
  return [...porCesta.entries()].map(([id, v]) => ({ basketId: id, ...v }));
}

function seriesPrecios(base: DB, limit = 40) {
  // Evolución del precio de los productos ahora emparejados en la cesta.
  const emparejados = base
    .prepare(
      `SELECT DISTINCT p.id, p.name, p.store_id, s.name AS store_name
       FROM basket_item_match m
       JOIN product p ON p.id = m.product_id
       JOIN store s ON s.id = p.store_id`,
    )
    .all() as {
    id: number;
    name: string;
    store_id: string;
    store_name: string;
  }[];

  return emparejados.map((p) => {
    const puntos = base
      .prepare(
        `SELECT price, fetched_at FROM price_snapshot
         WHERE product_id = ? ORDER BY fetched_at ASC LIMIT ${limit}`,
      )
      .all(p.id) as { price: number; fetched_at: string }[];
    return {
      productId: p.id,
      name: p.name,
      storeId: p.store_id,
      storeName: p.store_name,
      points: puntos.map((pt) => ({
        date: aISO(pt.fetched_at),
        price: pt.price,
      })),
    };
  });
}

function resumen(base: DB) {
  const cestas = base
    .prepare("SELECT id, date FROM saved_basket ORDER BY created_at")
    .all() as { id: number; date: string }[];

  let masBarataVeces = new Map<string, number>();
  let ahorroAcumulado = 0;
  let conComparacion = 0;

  for (const c of cestas) {
    const totales = base
      .prepare(
        `SELECT store_id, store_name, SUM(price_at_save * qty) AS total
         FROM saved_basket_line
         WHERE saved_basket_id = ? AND price_at_save IS NOT NULL
         GROUP BY store_id`,
      )
      .all(c.id) as { store_id: string; store_name: string; total: number }[];
    if (totales.length < 2) continue;
    const orden = [...totales].sort((a, b) => a.total - b.total);
    const ganadora = orden[0]!;
    masBarataVeces.set(
      ganadora.store_name,
      (masBarataVeces.get(ganadora.store_name) ?? 0) + 1,
    );
    ahorroAcumulado += orden[orden.length - 1]!.total - ganadora.total;
    conComparacion++;
  }

  // Artículos con mayor diferencia de precio entre tiendas (de lo guardado).
  const diferencias = base
    .prepare(
      `SELECT generic_name,
              MIN(price_at_save) AS min_p,
              MAX(price_at_save) AS max_p,
              COUNT(DISTINCT store_id) AS n_tendas
       FROM saved_basket_line
       WHERE price_at_save IS NOT NULL
       GROUP BY generic_name, qty
       HAVING n_tendas > 1
       ORDER BY (max_p - min_p) * qty DESC
       LIMIT 10`,
    )
    .all() as {
    generic_name: string;
    min_p: number;
    max_p: number;
    n_tendas: number;
    qty?: number;
  }[];

  return {
    savedBaskets: cestas.length,
    cheapestWins: [...masBarataVeces.entries()].map(([store, count]) => ({
      store,
      count,
    })),
    totalSaving: ahorroAcumulado,
    comparisons: conComparacion,
    biggestDiffs: diferencias.map((d) => ({
      name: d.generic_name,
      min: d.min_p,
      max: d.max_p,
      diff: d.max_p - d.min_p,
      stores: d.n_tendas,
    })),
  };
}

export function registrarEstadisticas(app: FastifyInstance): void {
  app.get("/api/stats/series", async () => {
    const base = abrirDB();
    return { baskets: seriesTotales(base), products: seriesPrecios(base) };
  });

  app.get("/api/stats/summary", async () => {
    const base = abrirDB();
    return resumen(base);
  });
}
