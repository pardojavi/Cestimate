import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "../config.js";
import { COLORES_TIENDA, aISO, normalizar } from "@cestimate/shared";

/**
 * SQLite (§5) con esquema según AGENT.md. Migración idempotente al arrancar.
 */

export type DB = Database.Database;

let db: DB | null = null;

const ESQUEMA = `
CREATE TABLE IF NOT EXISTS store (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT NOT NULL,
  website TEXT,
  adapter TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS product (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  store_id TEXT NOT NULL REFERENCES store(id) ON DELETE CASCADE,
  external_id TEXT NOT NULL,
  name TEXT NOT NULL,
  name_norm TEXT NOT NULL DEFAULT '',
  format TEXT,
  image_url TEXT,
  url TEXT NOT NULL,
  UNIQUE (store_id, external_id)
);
CREATE INDEX IF NOT EXISTS idx_product_store_norm ON product (store_id, name_norm);

CREATE TABLE IF NOT EXISTS price_snapshot (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  price REAL NOT NULL,
  unit_price REAL,
  unit TEXT,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  postal_code TEXT
);
CREATE INDEX IF NOT EXISTS idx_snapshot_product ON price_snapshot (product_id, fetched_at);

CREATE TABLE IF NOT EXISTS basket_item (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  generic_name TEXT NOT NULL,
  qty REAL NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS basket_item_match (
  basket_item_id INTEGER NOT NULL REFERENCES basket_item(id) ON DELETE CASCADE,
  store_id TEXT NOT NULL REFERENCES store(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES product(id) ON DELETE CASCADE,
  PRIMARY KEY (basket_item_id, store_id)
);

CREATE TABLE IF NOT EXISTS saved_basket (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_basket_line (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  saved_basket_id INTEGER NOT NULL REFERENCES saved_basket(id) ON DELETE CASCADE,
  generic_name TEXT NOT NULL,
  qty REAL NOT NULL,
  store_id TEXT NOT NULL,
  store_name TEXT NOT NULL,
  product_name TEXT,
  price_at_save REAL,
  unit_price_at_save REAL,
  unit TEXT,
  url TEXT,
  product_id INTEGER
);
CREATE INDEX IF NOT EXISTS idx_line_basket ON saved_basket_line (saved_basket_id);

CREATE TABLE IF NOT EXISTS setting (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS search_cache (
  query_hash TEXT NOT NULL,
  store_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  fetched_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (query_hash, store_id)
);

-- Índice local para búsqueda de texto sin dependencias externas.
CREATE VIRTUAL TABLE IF NOT EXISTS product_fts USING fts5(
  name_norm,
  content='product',
  content_rowid='id'
);

CREATE TABLE IF NOT EXISTS catalog_meta (
  store_id TEXT PRIMARY KEY,
  refreshed_at TEXT
);
`;

const TIENDAS_PREDEFINIDAS = [
  {
    id: "mercadona",
    name: "Mercadona",
    adapter: "mercadona",
    website: "https://tienda.mercadona.es",
  },
  {
    id: "consum",
    name: "Consum",
    adapter: "consum",
    website: "https://tienda.consum.es",
  },
  { id: "aldi", name: "Aldi", adapter: "aldi", website: "https://www.aldi.es" },
  { id: "lidl", name: "Lidl", adapter: "lidl", website: "https://www.lidl.es" },
] as const;

export function abrirDB(ruta = config.databasePath): DB {
  if (db) return db;
  mkdirSync(dirname(ruta), { recursive: true });
  db = new Database(ruta);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.exec(ESQUEMA);
  sembrarTiendas(db);
  return db;
}

function sembrarTiendas(base: DB): void {
  const insert = base.prepare(
    `INSERT OR IGNORE INTO store (id, name, color, website, adapter, active)
     VALUES (?, ?, ?, ?, ?, 1)`,
  );
  for (const t of TIENDAS_PREDEFINIDAS) {
    insert.run(
      t.id,
      t.name,
      COLORES_TIENDA[t.id] ?? "#2F6F4E",
      t.website,
      t.adapter,
    );
  }
}

/** Inserta o actualiza un producto y su último snapshot de precio. */
export function guardarProducto(
  base: DB,
  datos: {
    storeId: string;
    externalId: string;
    name: string;
    format?: string | null;
    imageUrl?: string | null;
    url: string;
    price: number;
    unitPrice?: number | null;
    unit?: string | null;
    postalCode?: string | null;
    fetchedAt?: string;
  },
): number {
  const fetchedAt = datos.fetchedAt ?? new Date().toISOString();
  const norm = normalizar(datos.name);
  const result = base
    .prepare(
      `INSERT INTO product (store_id, external_id, name, name_norm, format, image_url, url)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (store_id, external_id) DO UPDATE SET
         name = excluded.name,
         name_norm = excluded.name_norm,
         format = excluded.format,
         image_url = excluded.image_url,
         url = excluded.url`,
    )
    .run(
      datos.storeId,
      datos.externalId,
      datos.name,
      norm,
      datos.format ?? null,
      datos.imageUrl ?? null,
      datos.url,
    );
  void result;
  // No usamos lastInsertRowid: con un UPSERT que actualiza no se conserva
  // (y además es global entre tablas). Recuperamos el id de forma explícita.
  const fila = base
    .prepare("SELECT id FROM product WHERE store_id = ? AND external_id = ?")
    .get(datos.storeId, datos.externalId) as { id: number } | undefined;
  if (!fila) {
    throw new Error(
      `No se pudo guardar el producto ${datos.externalId} de ${datos.storeId}`,
    );
  }
  const productoId = fila.id;

  // Solo guardamos snapshot si hay precio real (> 0).
  if (datos.price > 0) {
    base
      .prepare(
        `INSERT INTO price_snapshot (product_id, price, unit_price, unit, fetched_at, postal_code)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        productoId,
        datos.price,
        datos.unitPrice ?? null,
        datos.unit ?? null,
        fetchedAt,
        datos.postalCode ?? null,
      );
  }
  return productoId;
}

/** Último precio conocido de un producto. */
export function ultimoPrecio(
  base: DB,
  productId: number,
): {
  price: number;
  unitPrice: number | null;
  unit: string | null;
  fetchedAt: string;
} | null {
  const fila = base
    .prepare(
      `SELECT price, unit_price, unit, fetched_at
       FROM price_snapshot WHERE product_id = ?
       ORDER BY fetched_at DESC LIMIT 1`,
    )
    .get(productId) as
    | {
        price: number;
        unit_price: number | null;
        unit: string | null;
        fetched_at: string;
      }
    | undefined;
  if (!fila) return null;
  return {
    price: fila.price,
    unitPrice: fila.unit_price,
    unit: fila.unit,
    fetchedAt: aISO(fila.fetched_at),
  };
}

/** Marca el inicio de un refresh de catálogo para una tienda. */
export function marcarCatalogo(
  base: DB,
  storeId: string,
  iso: string | null,
): void {
  base
    .prepare(
      `INSERT INTO catalog_meta (store_id, refreshed_at) VALUES (?, ?)
       ON CONFLICT (store_id) DO UPDATE SET refreshed_at = excluded.refreshed_at`,
    )
    .run(storeId, iso);
}

export function catalogoActualizado(base: DB, storeId: string): string | null {
  const fila = base
    .prepare("SELECT refreshed_at FROM catalog_meta WHERE store_id = ?")
    .get(storeId) as { refreshed_at: string | null } | undefined;
  return fila?.refreshed_at ?? null;
}

export function obtenerAjustes(base: DB): {
  postalCode: string;
  ttlHours: number;
} {
  const filas = base.prepare("SELECT key, value FROM setting").all() as {
    key: string;
    value: string;
  }[];
  const mapa = Object.fromEntries(filas.map((f) => [f.key, f.value]));
  const ttl = Number(mapa.ttl_hours ?? config.ttlHours);
  return {
    postalCode: mapa.postal_code ?? config.defaultPostalCode,
    ttlHours: Number.isFinite(ttl) && ttl > 0 ? ttl : config.ttlHours,
  };
}
