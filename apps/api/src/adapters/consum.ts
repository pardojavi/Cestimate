import {
  coincideFlex,
  tokenizar,
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

/**
 * Precio unitario que reporta Consum: `centUnitAmount` está cotizado sobre la
 * base de `unitPriceUnitType` («1 Kg», «1 L», «1 U», «100 ml», «100 Gr»…),
 * p. ej. tomate 0,51 € la pieza → 2,55 €/kg. Se normaliza a nuestras unidades.
 * Verificado en vivo (2026-11-12): el cálculo total/cantidad se equivocaba en
 * productos sin peso declarado y en packs.
 */
function precioUnitarioConsum(
  centUnitAmount: number | null | undefined,
  uType: string | null | undefined,
): { value: number; unit: "kg" | "L" | "ud" } | null {
  if (
    typeof centUnitAmount !== "number" ||
    !Number.isFinite(centUnitAmount) ||
    centUnitAmount <= 0 ||
    !uType
  ) {
    return null;
  }
  const m = uType
    .trim()
    .match(/^(\d+(?:[.,]\d+)?)\s*(kgs?|g|grs?|l|lts?|ml|uds?|unidades?|u)\b/i);
  if (!m) return null;
  const base = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(base) || base <= 0) return null;
  const u = m[2]!.toLowerCase();
  if (u.startsWith("k")) return { value: centUnitAmount / base, unit: "kg" };
  if (u === "g" || u.startsWith("gr"))
    return { value: centUnitAmount / (base / 1000), unit: "kg" };
  if (u === "ml") return { value: centUnitAmount / (base / 1000), unit: "L" };
  if (u.startsWith("l")) return { value: centUnitAmount / base, unit: "L" };
  return { value: centUnitAmount / base, unit: "ud" };
}

export function aStoreProduct(p: ConsumProduct): StoreProduct | null {
  // `centAmount` es el precio TOTAL en euros (pese al nombre del campo): el
  // pack de 3 minibriks cuesta 1,45 €, no 2,42 (que es el €/L).
  const euros = p.priceData?.prices?.[0]?.value?.centAmount;
  if (typeof euros !== "number" || euros <= 0) return null;
  const nombre = p.productData?.name?.trim();
  if (!nombre) return null;

  const valor = p.priceData?.prices?.[0]?.value;
  const uType = p.priceData?.unitPriceUnitType ?? null;

  // Tamaño en la descripción ("Leche Entera Brik 1 L", pack «3 x 200 ml»).
  // Ojo: no usamos unitPriceUnitType como formato: es la BASE del precio
  // unitario («1 Kg») y un tomate sin peso acabaría con «1 kg» de formato.
  const descripcion = p.productData.description ?? "";
  const extraido = extraerFormato(descripcion) ?? extraerFormato(nombre);
  const unitarioApi = precioUnitarioConsum(valor?.centUnitAmount, uType);

  // Imagen: `productData.imageURL` está caducada (404); la válida es la
  // primera de `media` (tipo «P» = producto). Fallback por si lo cambian.
  const imagen =
    p.media?.find((m) => m.type === "P")?.url ??
    p.media?.[0]?.url ??
    p.productData.imageURL ??
    null;

  return {
    storeId: "consum",
    externalId: String(p.code ?? p.id),
    name: nombre,
    format: extraido?.format ?? null,
    price: euros,
    // Si Consum da su precio unitario, manda; si no, se deduce del tamaño.
    unitPrice:
      unitarioApi ??
      (extraido && extraido.cantidad > 0 && extraido.unitPriceUnit
        ? { value: euros / extraido.cantidad, unit: extraido.unitPriceUnit }
        : null),
    imageUrl: imagen,
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
      const terminos = tokenizar(query);
      if (terminos.length === 0) return [];

      const resultados: StoreProduct[] = [];
      for (let paginaIdx = 0; paginaIdx < MAX_PAGINAS; paginaIdx++) {
        const datos = await pagina(query, paginaIdx * POR_PAGINA);
        for (const p of datos.products) {
          const sp = aStoreProduct(p);
          if (!sp) continue;
          // Consum hace coincidencias laxas: filtramos en local de forma
          // flexible (nombre + descripción, sin exigir números ni unidades).
          const texto = `${sp.name} ${p.productData.description ?? ""}`;
          if (coincideFlex(texto, terminos)) {
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
