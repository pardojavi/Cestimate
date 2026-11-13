import type { StoreProduct } from "@cestimate/shared";

/**
 * Comparación por peso (pestaña Buscar): poner un peso en kg y comparar
 * todos los productos que cotizan por kilo al **mismo kilaje**.
 *
 * El cálculo es aritmética sobre el precio real de la tienda
 * (`unitPrice.value` €/kg, con su URL y fecha de consulta): no se inventa
 * ningún dato (§4.3 de AGENT.md). El precio original del formato sigue
 * visible en la línea mono de la fila. Solo se recalculan los productos en
 * €/kg: los de €/L o €/ud no son comparables en kilos y se quedan a su
 * precio real.
 */

/** ¿Cotiza por kilo y admite cálculo para un peso? */
export function cotizaPorKilo(producto: StoreProduct): boolean {
  const unit = producto.unitPrice;
  return !!unit && unit.unit === "kg" && unit.value > 0;
}

/**
 * Interpreta el texto del campo de peso: acepta coma («1,5») o punto
 * («1.5»). Devuelve el peso en kg (> 0) o `null` si no es un número
 * válido (vacío, negativo, letras…): `null` desactiva el modo peso.
 */
export function parsearPesoKg(texto: string): number | null {
  const limpio = texto.trim().replace(/\s/g, "").replace(",", ".");
  if (!/^\d*\.?\d+$/.test(limpio)) return null;
  const valor = Number(limpio);
  return Number.isFinite(valor) && valor > 0 ? valor : null;
}

/**
 * Precio para `pesoKg` a partir del €/kg de la tienda, redondeado a
 * céntimos. `null` si el producto no cotiza por kg o el peso no es válido
 * (en ese caso se muestra el precio real tal cual).
 */
export function precioPorPeso(
  producto: StoreProduct,
  pesoKg: number,
): number | null {
  const unit = producto.unitPrice;
  if (!(pesoKg > 0) || !unit || unit.unit !== "kg" || !(unit.value > 0)) {
    return null;
  }
  return Math.round(unit.value * pesoKg * 100) / 100;
}

/** Peso con coma decimal («1,5», «2») para mostrarlo en la interfaz. */
export function formatoPeso(kg: number): string {
  return kg.toLocaleString("es-ES");
}

/** Pesos rápidos de los chips «Comparar por peso» (kg). */
export const PESOS_RAPIDOS = [0.5, 1, 1.5, 2] as const;
