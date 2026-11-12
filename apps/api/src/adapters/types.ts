import type { StoreProduct } from "@cestimate/shared";

/**
 * Interfaz común por tienda (§4.1 del AGENT.md).
 */
export interface StoreAdapter {
  id: string;
  search(query: string, ctx: Contexto): Promise<StoreProduct[]>;
  getProduct?(externalId: string, ctx: Contexto): Promise<StoreProduct | null>;
  /**
   * Algunas tiendas necesitan indexar su catálogo antes de poder buscar
   * (Mercadona no tiene buscador de texto público). Las demás no lo usan.
   */
  ensureCatalog?(ctx: Contexto): Promise<void>;
}

export interface Contexto {
  postalCode: string;
}

/** Convierte precio a número tolerando coma decimal. */
export function aNumero(
  valor: string | number | null | undefined,
): number | null {
  if (valor === null || valor === undefined) return null;
  const n =
    typeof valor === "number" ? valor : Number(String(valor).replace(",", "."));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** Unidades canónicas del modelo. */
export function normalizarUnidad(
  formato: string | null | undefined,
): "kg" | "L" | "ud" | null {
  if (!formato) return null;
  const f = formato.toLowerCase();
  if (f.includes("kg")) return "kg";
  if (f === "l" || f.includes("litro") || f === "1 l") return "L";
  if (f.includes("ud") || f.includes("unidad")) return "ud";
  return null;
}

/** Convierte una cantidad con unidad cruda al par (formato, unidad canónica). */
function aFormatoPar(
  cantidad: number,
  unidadCruda: string,
): {
  format: string;
  unitPriceUnit: "kg" | "L" | "ud" | null;
  cantidad: number;
} {
  let cantidadFinal = cantidad;
  let unit: "kg" | "L" | "ud" | null = null;
  const u = unidadCruda.toLowerCase();
  if (u === "ml") {
    cantidadFinal = cantidad / 1000;
    unit = "L";
  } else if (u === "g" || u.startsWith("gr")) {
    cantidadFinal = cantidad / 1000;
    unit = "kg";
  } else if (u === "l" || u.startsWith("lt")) unit = "L";
  else if (u.startsWith("k")) unit = "kg";
  else unit = "ud";
  const sufijo = unit === "L" ? "L" : unit === "kg" ? "kg" : "ud";
  return {
    format: `${cantidadFinal} ${sufijo}`.replace(".", ","),
    unitPriceUnit: unit,
    cantidad: cantidadFinal,
  };
}

/**
 * Extrae tamaño y unidad de un texto tipo "1 L", "500 g", "12 ud" o un pack
 * "3 x 200 ml" (devuelve el total: 0,6 L).
 */
export function extraerFormato(texto: string | null | undefined): {
  format: string;
  unitPriceUnit: "kg" | "L" | "ud" | null;
  cantidad: number;
} | null {
  if (!texto) return null;

  // Packs «4 x 125 Gr» / «2 x 1,5 L»: manda el total, no el tamaño unitario.
  const mPack = texto.match(
    /(\d+)\s*[x×]\s*(\d+(?:[.,]\d+)?)\s*(l|ml|kg|g|gr|ud|unidades?|u)\b/i,
  );
  if (mPack) {
    const unidades = Number(mPack[1]);
    const unitario = Number(mPack[2]!.replace(",", "."));
    if (
      Number.isFinite(unidades) &&
      unidades > 0 &&
      Number.isFinite(unitario) &&
      unitario > 0
    ) {
      return aFormatoPar(unidades * unitario, mPack[3]!);
    }
  }

  const m = texto.match(/(\d+(?:[.,]\d+)?)\s*(l|ml|kg|gr|g|ud|unidades?|u)\b/i);
  if (!m) return null;
  const cantidad = Number(m[1]!.replace(",", "."));
  if (!Number.isFinite(cantidad) || cantidad <= 0) return null;
  return aFormatoPar(cantidad, m[2]!);
}
