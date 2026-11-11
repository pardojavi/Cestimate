import {
  aISO,
  zLidlJsonLd,
  type LidlJsonLd,
  type StoreProduct,
  normalizar,
} from "@cestimate/shared";
import { ErrorTienda, esperar, pedir, pedirJSON } from "../lib/http.js";
import { guardarProducto, type DB } from "../lib/db.js";
import { type Contexto, type StoreAdapter } from "./types.js";

/**
 * Adaptador Lidl (www.lidl.es).
 *
 * Vía verificada en vivo (2026-11-11): su buscador está bloqueado, pero
 *   1) el sitemap https://www.lidl.es/p/export/ES/es/product_sitemap.xml.gz
 *      lista 7.672 URLs de producto, y
 *   2) cada página /p/... sirve JSON-LD `Product` con offers.price real.
 * Estrategia: filtrar URLs del sitemap por los términos de búsqueda y leer
 * solo las páginas candidatas (máx. 5), con caché en SQLite.
 * Cobertura: la tienda online de Lidl es sobre todo no alimentación; se
 * documenta en el README (§4.2 del AGENT.md pide documentar la cobertura).
 */

const SITEMAP = "https://www.lidl.es/p/export/ES/es/product_sitemap.xml.gz";
const BASE = "https://www.lidl.es";
const MAX_FETCH = 5;
const VIDA_SITEMAP_H = 24;

interface EntradaSitemap {
  sku: string;
  slug: string;
  url: string;
}

let cacheSitemap: { entradas: EntradaSitemap[]; cargado: number } | null = null;

/** Descarga y descomprime el sitemap de productos. */
async function cargarSitemap(): Promise<EntradaSitemap[]> {
  if (
    cacheSitemap &&
    Date.now() - cacheSitemap.cargado < VIDA_SITEMAP_H * 3_600_000
  ) {
    return cacheSitemap.entradas;
  }
  const respuesta = await pedir("lidl", SITEMAP, {
    reintentos: 1,
    timeoutMs: 20_000,
  });
  const buffer = Buffer.from(await respuesta.arrayBuffer());
  let xml: string;
  if (buffer[0] === 0x1f && buffer[1] === 0x8b) {
    const { gunzipSync } = await import("node:zlib");
    xml = gunzipSync(buffer).toString("utf8");
  } else {
    xml = buffer.toString("utf8");
  }

  const entradas: EntradaSitemap[] = [];
  const re = /<loc>([^<]+)<\/loc>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const url = m[1]!.trim();
    const partes = url.split("/").filter(Boolean);
    const identificador = partes[partes.length - 1] ?? "";
    const slug = partes[partes.length - 2] ?? "";
    if (/^p\d+$/.test(identificador) && slug) {
      entradas.push({ sku: identificador, slug, url });
    }
  }
  if (entradas.length === 0) {
    throw new ErrorTienda(
      "lidl",
      "formato",
      "El sitemap de Lidl no contiene URLs de producto",
    );
  }
  cacheSitemap = { entradas, cargado: Date.now() };
  return entradas;
}

/** Extrae el JSON-LD Product de una página de producto. */
export function extraerJsonLd(html: string): LidlJsonLd | null {
  const re = /<script type="application\/ld\+json">([\s\S]*?)<\/script>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html))) {
    try {
      const datos = JSON.parse(m[1]!) as unknown;
      const candidatos = Array.isArray(datos) ? datos : [datos];
      for (const c of candidatos) {
        const parseado = zLidlJsonLd.safeParse(c);
        if (parseado.success) return parseado.data;
      }
    } catch {
      // JSON malformado: seguimos con el siguiente bloque.
    }
  }
  return null;
}

export function aStoreProduct(
  ld: LidlJsonLd,
  url: string,
  sku: string,
): StoreProduct | null {
  const ofertas = Array.isArray(ld.offers) ? ld.offers[0] : ld.offers;
  if (!ofertas) return null;
  const disponibilidad = ofertas.availability ?? "";
  if (/OutOfStock|Discontinued|PreOrder/i.test(disponibilidad)) return null;
  const precio = Number(ofertas.price);
  if (!Number.isFinite(precio) || precio <= 0) return null;

  const imagen = Array.isArray(ld.image) ? ld.image[0] : ld.image;
  const marca =
    typeof ld.brand === "string"
      ? ld.brand
      : ld.brand?.name
        ? `${ld.brand.name} `
        : "";
  const nombre = `${marca}${ld.name}`.trim();

  return {
    storeId: "lidl",
    externalId: sku,
    name: nombre,
    format: null,
    price: precio,
    unitPrice: null,
    imageUrl: imagen ?? null,
    url: ofertas.url ?? url,
    fetchedAt: new Date().toISOString(),
  };
}

async function leerProducto(
  entrada: EntradaSitemap,
): Promise<StoreProduct | null> {
  const respuesta = await pedir("lidl", entrada.url, {
    reintentos: 1,
    headers: { Accept: "text/html" },
  });
  const html = await respuesta.text();
  const ld = extraerJsonLd(html);
  if (!ld) return null;
  return aStoreProduct(ld, entrada.url, entrada.sku);
}

export function crearLidl(base: DB): StoreAdapter {
  /** Devuelve productos ya cacheados en SQLite para un conjunto de skus. */
  function cacheados(skus: string[]): Map<string, StoreProduct> {
    if (skus.length === 0) return new Map();
    const placeholders = skus.map(() => "?").join(",");
    const filas = base
      .prepare(
        `SELECT p.external_id, p.name, p.format, p.image_url, p.url,
                s.price, s.fetched_at
         FROM product p
         JOIN (
           SELECT product_id, price, fetched_at,
                  ROW_NUMBER() OVER (PARTITION BY product_id ORDER BY fetched_at DESC) rn
           FROM price_snapshot
         ) s ON s.product_id = p.id AND s.rn = 1
         WHERE p.store_id = 'lidl' AND p.external_id IN (${placeholders})`,
      )
      .all(...skus) as {
      external_id: string;
      name: string;
      format: string | null;
      image_url: string | null;
      url: string;
      price: number;
      fetched_at: string;
    }[];
    return new Map(
      filas.map((f) => [
        f.external_id,
        {
          storeId: "lidl",
          externalId: f.external_id,
          name: f.name,
          format: f.format,
          price: f.price,
          unitPrice: null,
          imageUrl: f.image_url,
          url: f.url,
          fetchedAt: aISO(f.fetched_at),
        } satisfies StoreProduct,
      ]),
    );
  }

  return {
    id: "lidl",

    async search(query: string, ctx: Contexto): Promise<StoreProduct[]> {
      const terminos = normalizar(query).split(/\s+/).filter(Boolean);
      if (terminos.length === 0) return [];

      const entradas = await cargarSitemap();
      // Candidatos: el slug de la URL contiene todos los términos.
      const candidatas = entradas.filter((e) => {
        const slug = normalizar(e.slug);
        return terminos.every((t) => slug.includes(t));
      });
      if (candidatas.length === 0) return [];

      // Primero los que ya tenemos cacheados; luego leemos un máximo de páginas.
      const yaCacheados = cacheados(candidatas.map((c) => c.sku));
      const resultados: StoreProduct[] = [...yaCacheados.values()];
      const pendientes = candidatas
        .filter((c) => !yaCacheados.has(c.sku))
        .slice(0, MAX_FETCH);

      for (const entrada of pendientes) {
        try {
          const sp = await leerProducto(entrada);
          if (sp) {
            guardarProducto(base, {
              storeId: "lidl",
              externalId: sp.externalId,
              name: sp.name,
              format: sp.format,
              imageUrl: sp.imageUrl,
              url: sp.url,
              price: sp.price,
              postalCode: ctx.postalCode,
            });
            resultados.push(sp);
          }
        } catch (error) {
          console.warn(
            `[lidl] página ${entrada.url} omitida:`,
            error instanceof Error ? error.message : error,
          );
        }
        await esperar(250);
        if (resultados.length >= MAX_FETCH) break;
      }
      return resultados.slice(0, MAX_FETCH);
    },

    async getProduct(
      externalId: string,
      ctx: Contexto,
    ): Promise<StoreProduct | null> {
      const entradas = await cargarSitemap();
      const entrada = entradas.find((e) => e.sku === externalId);
      if (!entrada) return null;
      const sp = await leerProducto(entrada);
      if (!sp) return null;
      guardarProducto(base, {
        storeId: "lidl",
        externalId: sp.externalId,
        name: sp.name,
        format: sp.format,
        imageUrl: sp.imageUrl,
        url: sp.url,
        price: sp.price,
        postalCode: ctx.postalCode,
      });
      return sp;
    },
  };
}
