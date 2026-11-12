import {
  coincideFlex,
  tokenizar,
  terminosExigidos,
  zAldiResponse,
  type AldiHit,
  type StoreProduct,
} from "@cestimate/shared";
import { ErrorTienda, pedirJSON } from "../lib/http.js";
import { guardarProducto, type DB } from "../lib/db.js";
import {
  extraerFormato,
  normalizarUnidad,
  type Contexto,
  type StoreAdapter,
} from "./types.js";

/**
 * Adaptador Aldi (www.aldi.es).
 *
 * Vía verificada en vivo (2026-11-11): su web usa Algolia InstantSearch con
 * una clave de solo búsqueda pública embebida en el bundle de Next.js:
 *   POST https://{appId}-dsn.algolia.net/1/indexes/{indexName}/query
 * Índice: an_prd_es_es_pen_products2 (2.776 productos en su sitemap).
 * Cada hit trae currentPrice.priceValue, salesUnit, productSlug e imagen.
 * robots.txt no prohíbe /producto/ ni el índice de búsqueda.
 * Cobertura: catálogo online de Aldi (surtido parcial frente a la tienda física).
 */

const APP_ID = "L9KNU74IO7";
const API_KEY = "83df5acd172c42ab174afa4583232b5d";
const INDEX = "an_prd_es_es_pen_products2";
const URL = `https://${APP_ID}-dsn.algolia.net/1/indexes/${INDEX}/query`;
const POR_PAGINA = 30;

export function aStoreProduct(h: AldiHit): StoreProduct | null {
  const precio = h.currentPrice?.priceValue;
  if (typeof precio !== "number" || precio <= 0) return null;
  if (h.isComingSoon || h.isRecall) return null;

  const extraido = extraerFormato(h.salesUnit ?? "") ?? extraerFormato(h.name);
  // Precio unitario: manda el oficial de Aldi (`basePrice`, p. ej. 15,27 €/kg
  // del turrón). Ojo con normalizarUnidad(salesUnit): «150 g unidad»
  // contendría «unidad» y devolvería «ud» (bug: 15,27 €/ud en vez de €/kg).
  const base = h.currentPrice?.basePrice?.[0] ?? null;
  const escala = normalizarUnidad(base?.basePriceScale ?? null);
  const unitPrice =
    base &&
    typeof base.basePriceValue === "number" &&
    base.basePriceValue > 0 &&
    escala
      ? { value: base.basePriceValue, unit: escala }
      : extraido && extraido.cantidad > 0 && extraido.unitPriceUnit
        ? { value: precio / extraido.cantidad, unit: extraido.unitPriceUnit }
        : null;

  const imagen = h.assets?.find((a) => a.type === "primary")?.url ?? null;

  return {
    storeId: "aldi",
    externalId: h.objectID,
    name: h.name,
    format: extraido?.format ?? h.salesUnit ?? null,
    price: precio,
    unitPrice,
    // scene7 sirve la imagen sin extensión; pedimos un tamaño razonable.
    imageUrl: imagen ? `${imagen}?wid=300` : null,
    url: h.productSlug
      ? `https://www.aldi.es/producto/${h.productSlug}.html`
      : "https://www.aldi.es",
    fetchedAt: new Date().toISOString(),
  };
}

export function crearAldi(base: DB): StoreAdapter {
  return {
    id: "aldi",

    async search(query: string, ctx: Contexto): Promise<StoreProduct[]> {
      const terminos = tokenizar(query);
      if (terminos.length === 0) return [];
      // A Algolia solo mandamos los términos relevantes: si mandamos la
      // consulta cruda («leche entera 1 l») no devuelve hits.
      const consultaLimpia = terminosExigidos(terminos).join(" ");

      const respuesta = await fetch(URL, {
        method: "POST",
        headers: {
          "X-Algolia-Application-Id": APP_ID,
          "X-Algolia-API-Key": API_KEY,
          "Content-Type": "application/json",
          "User-Agent": `Cestimate/1.0`,
        },
        body: JSON.stringify({
          query: consultaLimpia,
          hitsPerPage: POR_PAGINA,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!respuesta.ok) {
        throw new ErrorTienda(
          "aldi",
          "http",
          `Algolia respondió HTTP ${respuesta.status}`,
        );
      }
      let datos: unknown;
      try {
        datos = await respuesta.json();
      } catch {
        throw new ErrorTienda(
          "aldi",
          "formato",
          "Respuesta de Algolia no es JSON válido",
        );
      }
      const parseado = zAldiResponse.safeParse(datos);
      if (!parseado.success) {
        throw new ErrorTienda(
          "aldi",
          "formato",
          "Esquema inesperado en la respuesta de Aldi (¿han cambiado los campos?)",
        );
      }

      const productos: StoreProduct[] = [];
      for (const hit of parseado.data.hits) {
        const sp = aStoreProduct(hit);
        if (!sp) continue;
        // Filtro flexible sobre nombre y marca (sin exigir números ni
        // unidades: «leche entera 1 l» ha de encontrar «Leche Entera Brik»).
        const texto = `${sp.name} ${hit.brandName ?? ""}`;
        if (coincideFlex(texto, terminos)) {
          productos.push(sp);
        }
      }

      for (const sp of productos) {
        guardarProducto(base, {
          storeId: "aldi",
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
      }
      return productos;
    },

    async getProduct(
      externalId: string,
      ctx: Contexto,
    ): Promise<StoreProduct | null> {
      const respuesta = await fetch(URL, {
        method: "POST",
        headers: {
          "X-Algolia-Application-Id": APP_ID,
          "X-Algolia-API-Key": API_KEY,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          query: "",
          filters: `objectID:${externalId}`,
          hitsPerPage: 1,
        }),
        signal: AbortSignal.timeout(10_000),
      });
      if (!respuesta.ok) return null;
      const datos = (await respuesta.json()) as unknown;
      const parseado = zAldiResponse.safeParse(datos);
      if (!parseado.success || parseado.data.hits.length === 0) return null;
      const sp = aStoreProduct(parseado.data.hits[0]!);
      if (!sp) return null;
      guardarProducto(base, {
        storeId: "aldi",
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
    },
  };
}
