import { z } from "zod";
import { aISO } from "@cestimate/shared";
import { pedir } from "./http.js";
import type { DB } from "./db.js";

/**
 * Identificación de códigos de barras con Open Food Facts (solo nombre y
 * marca). Los precios siguen saliendo exclusivamente de las tiendas: OFF
 * aporta únicamente la identidad del producto para poder lanzar la
 * búsqueda normal de la pestaña Buscar.
 */

/* ------------------------------------------------------------------ */
/* Esquema de la respuesta de Open Food Facts                          */
/* ------------------------------------------------------------------ */

export const zOpenFoodFacts = z.object({
  status: z.number(),
  status_verbose: z.string().optional(),
  code: z.string().optional(),
  product: z
    .object({
      code: z.string().optional(),
      product_name: z.string().optional(),
      product_name_es: z.string().optional(),
      brands: z.string().nullable().optional(),
      quantity: z.string().nullable().optional(),
      image_front_small_url: z.string().nullable().optional(),
    })
    .optional(),
});

export type OpenFoodFacts = z.infer<typeof zOpenFoodFacts>;

/* ------------------------------------------------------------------ */
/* Identificación                                                      */
/* ------------------------------------------------------------------ */

export interface Identificacion {
  code: string;
  encontrado: boolean;
  /** Nombre legible del producto (o null si OFF no lo conoce). */
  nombre: string | null;
  /** Marca (o null). */
  marca: string | null;
  /** Consulta lista para la pestaña Buscar (nombre + marca), o null. */
  consulta: string | null;
  /** Siempre «Open Food Facts» (fuente de identidad, no de precios). */
  fuente: string;
  /** URL de la ficha en OFF (transparencia). */
  fuenteUrl: string;
  /** ISO-8601 de la consulta. */
  fechaConsulta: string;
}

/**
 * Convierte la respuesta cruda de OFF en una `Identificacion`. Es
 * independiente de la red para poder testearla con fixtures reales.
 */
export function aIdentificacion(
  codigo: string,
  datos: unknown,
): Identificacion {
  const base = {
    code: codigo,
    fuente: "Open Food Facts",
    fuenteUrl: `https://world.openfoodfacts.org/product/${codigo}`,
    fechaConsulta: new Date().toISOString(),
  };

  const parseado = zOpenFoodFacts.safeParse(datos);
  if (
    !parseado.success ||
    parseado.data.status !== 1 ||
    !parseado.data.product
  ) {
    return {
      ...base,
      encontrado: false,
      nombre: null,
      marca: null,
      consulta: null,
    };
  }

  const p = parseado.data.product;
  const nombre = (p.product_name_es ?? p.product_name ?? "").trim() || null;
  const marca = (p.brands ?? "").split(",")[0]?.trim() || null;
  const consulta = [nombre, marca].filter(Boolean).join(" ").trim() || null;

  return {
    ...base,
    encontrado: consulta !== null,
    nombre,
    marca,
    consulta,
  };
}

/* ------------------------------------------------------------------ */
/* Red: consultar OFF                                                  */
/* ------------------------------------------------------------------ */

/**
 * Consulta OFF por el código. Un 404 significa «producto no encontrado»
 * (no es un error de red): se devuelve `encontrado: false`.
 */
export async function consultarOpenFoodFacts(
  codigo: string,
): Promise<Identificacion> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${codigo}.json?fields=code,product_name,product_name_es,brands,quantity,image_front_small_url`;
  try {
    const respuesta = await pedir("openfoodfacts", url, { reintentos: 1 });
    const datos = (await respuesta.json()) as unknown;
    return aIdentificacion(codigo, datos);
  } catch (error) {
    // ErrorTienda con código «http» y 404: producto no en la base.
    const mensaje = error instanceof Error ? error.message : String(error);
    if (mensaje.includes("HTTP 404")) {
      return aIdentificacion(codigo, { status: 0 });
    }
    throw error;
  }
}

/* ------------------------------------------------------------------ */
/* Caché SQLite (~30 días)                                             */
/* ------------------------------------------------------------------ */

const TTL_DIAS = 30;

export function leerCacheBarcode(
  base: DB,
  codigo: string,
): Identificacion | null {
  const fila = base
    .prepare("SELECT payload, fetched_at FROM barcode_cache WHERE code = ?")
    .get(codigo) as { payload: string; fetched_at: string } | undefined;
  if (!fila) return null;
  const edadD =
    (Date.now() - new Date(aISO(fila.fetched_at)).getTime()) / 86_400_000;
  if (edadD > TTL_DIAS) return null;
  try {
    const datos = JSON.parse(fila.payload) as Identificacion;
    // Devolvemos la fecha de consulta original (la del primer hit).
    return { ...datos, fechaConsulta: aISO(fila.fetched_at) };
  } catch {
    return null;
  }
}

export function guardarCacheBarcode(
  base: DB,
  codigo: string,
  ident: Identificacion,
): void {
  base
    .prepare(
      `INSERT INTO barcode_cache (code, payload, fetched_at)
       VALUES (?, ?, datetime('now'))
       ON CONFLICT (code) DO UPDATE SET
         payload = excluded.payload, fetched_at = excluded.fetched_at`,
    )
    .run(codigo, JSON.stringify(ident));
}
