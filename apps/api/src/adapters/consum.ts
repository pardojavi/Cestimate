import {
  zConsumResponse,
  type ConsumProduct,
  type ConsumResponse,
  type StoreProduct,
} from "@cestimate/shared";
import { ErrorTienda, pedirJSON } from "../lib/http.js";
import { guardarProducto, type DB } from "../lib/db.js";
import { extraerFormato, type Contexto, type StoreAdapter } from "./types.js";

/**
 * Adaptador Consum.
 *
 * Vía verificada en vivo (2026-11-11):
 *   GET https://tienda.consum.es/api/rest/V1.0/catalog/product?q={texto}&offset={n}
 * Devuelve paginación de 20 en 20 (`offset`; `page` no funciona).
 * El precio está en priceData.prices[0].value.centAmount (en euros pese al nombre),
 * la unidad en unitPriceUnitType y la URL verificable en productData.url.
 * Aviso: robots.txt de Consum marca `Disallow: /api/` — decisión documentada
 * en el README (ver «Obtención de precios»).
 */

const BASE = "https://tienda.consum.es/api/rest/V1.0/catalog/product";
const POR_PAGINA = 20;
const MAX_PAGINAS = 3; // hasta 60 candidatos, se filtran en local

export function aStoreProduct(p: ConsumProduct): StoreProduct | null {
  const euros = p.priceData?.prices?.[0]?.value?.centAmount;
  if (typeof euros !== "number" || euros <= 0) return null;
  const nombre = p.productData?.name?.trim();
  if (!nombre) return null;

  // Tamaño en la descripción ("Leche Entera Brik 1 L") o en unitPriceUnitType.
  const descripcion = p.productData.description ?? "";
  const extraido =
    extraerFormato(descripcion) ??
    extraerFormato(p.priceData.unitPriceUnitType ?? "") ??
    extraerFormato(nombre);

  const unit =
    p.priceData.unitPriceUnitType && /kg/i.test(p.priceData.unitPriceUnitType)
      ? "kg"
      : p.priceData.unitPriceUnitType &&
          /l\b/i.test(p.priceData.unitPriceUnitType)
        ? "L"
        : (extraido?.unitPriceUnit ?? null);

  return {
    storeId: "consum",
    externalId: String(p.code ?? p.id),
    name: nombre,
    format: extraido?.format ?? p.priceData.unitPriceUnitType ?? null,
    price: euros,
    unitPrice:
      extraido && extraido.cantidad > 0 && unit
        ? { value: euros / extraido.cantidad, unit }
        : null,
    imageUrl: p.productData.imageURL ?? null,
    url: p.productData.url,
    fetchedAt: new Date().toISOString(),
  };
}

export function crearConsum(base: DB): StoreAdapter {
  async function pagina(
    query: string,
    offset: number,
  ): Promise<ConsumResponse> {
    const url = `${BASE}?q=${encodeURIComponent(query)}&offset=${offset}`;
    const datos = await pedirJSON<unknown>("consum", url);
    const parseado = zConsumResponse.safeParse(datos);
    if (!parseado.success) {
      throw new ErrorTienda(
        "consum",
        "formato",
        `Respuesta inesperada de Consum en offset=${offset} (¿han cambiado el esquema?)`,
      );
    }
    return parseado.data;
  }

  return {
    id: "consum",

    async search(query: string, ctx: Contexto): Promise<StoreProduct[]> {
      const terminos = query
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .split(/\s+/)
        .filter(Boolean);
      if (terminos.length === 0) return [];

      const resultados: StoreProduct[] = [];
      for (let paginaIdx = 0; paginaIdx < MAX_PAGINAS; paginaIdx++) {
        const datos = await pagina(query, paginaIdx * POR_PAGINA);
        for (const p of datos.products) {
          const sp = aStoreProduct(p);
          if (!sp) continue;
          const norm = sp.name
            .normalize("NFD")
            .replace(/[\u0300-\u036f]/g, "")
            .toLowerCase();
          // Consum hace coincidencias laxas: filtramos AND en local.
          if (terminos.every((t) => norm.includes(t))) {
            resultados.push(sp);
          }
        }
        if (paginaIdx * POR_PAGINA + POR_PAGINA >= datos.totalCount) break;
        if (datos.products.length < POR_PAGINA) break;
      }

      // Guardamos los precios reales en SQLite para el resumen y las gráficas.
      for (const sp of resultados) {
        guardarProducto(base, {
          storeId: "consum",
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
      return resultados.slice(0, 25);
    },

    async getProduct(
      externalId: string,
      ctx: Contexto,
    ): Promise<StoreProduct | null> {
      const url = `${BASE}?q=${encodeURIComponent(externalId)}`;
      const datos = await pedirJSON<unknown>("consum", url);
      const parseado = zConsumResponse.safeParse(datos);
      if (!parseado.success) return null;
      const encontrado = parseado.data.products.find(
        (p) => String(p.code ?? p.id) === externalId,
      );
      if (!encontrado) return null;
      const sp = aStoreProduct(encontrado);
      if (!sp) return null;
      guardarProducto(base, {
        storeId: "consum",
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
