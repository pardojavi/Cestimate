import { describe, expect, it } from "vitest";
import type { StoreProduct } from "@cestimate/shared";
import {
  cotizaPorKilo,
  formatoPeso,
  parsearPesoKg,
  precioPorPeso,
} from "./peso";

/**
 * Comparación por peso: el campo «kg» de la pestaña Buscar recalcula el
 * precio de lo que cotiza por kilo (€/kg × peso) y deja intactos los
 * productos en €/L o €/ud (nunca se inventa precio, §4.3).
 */

function producto(parcial: Partial<StoreProduct> = {}): StoreProduct {
  return {
    storeId: "mercadona",
    externalId: "1",
    name: "Tomate rama",
    price: 2,
    unitPrice: { value: 2, unit: "kg" },
    url: "https://tienda.mercadona.es/product/1",
    fetchedAt: "2026-11-13T10:00:00.000Z",
    ...parcial,
  };
}

describe("parsearPesoKg", () => {
  it("acepta coma y punto decimal", () => {
    expect(parsearPesoKg("1,5")).toBe(1.5);
    expect(parsearPesoKg("1.5")).toBe(1.5);
    expect(parsearPesoKg("0,25")).toBe(0.25);
    expect(parsearPesoKg("  2  ")).toBe(2);
  });

  it("devuelve null cuando no hay peso utilizable", () => {
    expect(parsearPesoKg("")).toBeNull();
    expect(parsearPesoKg("   ")).toBeNull();
    expect(parsearPesoKg("0")).toBeNull();
    expect(parsearPesoKg("-1")).toBeNull();
    expect(parsearPesoKg("1,5,2")).toBeNull();
    expect(parsearPesoKg("1.5.2")).toBeNull();
    expect(parsearPesoKg("kg")).toBeNull();
    expect(parsearPesoKg("1e3")).toBeNull();
  });
});

describe("cotizaPorKilo", () => {
  it("solo los productos en €/kg admiten cálculo", () => {
    expect(cotizaPorKilo(producto())).toBe(true);
    expect(
      cotizaPorKilo(producto({ unitPrice: { value: 1.2, unit: "L" } })),
    ).toBe(false);
    expect(
      cotizaPorKilo(producto({ unitPrice: { value: 3, unit: "ud" } })),
    ).toBe(false);
    expect(cotizaPorKilo(producto({ unitPrice: null }))).toBe(false);
    expect(cotizaPorKilo(producto({ unitPrice: undefined }))).toBe(false);
    expect(
      cotizaPorKilo(producto({ unitPrice: { value: 0, unit: "kg" } })),
    ).toBe(false);
  });
});

describe("precioPorPeso", () => {
  it("multiplica el €/kg por el peso elegido", () => {
    expect(precioPorPeso(producto(), 1.5)).toBe(3);
    expect(
      precioPorPeso(producto({ unitPrice: { value: 4.4, unit: "kg" } }), 1.5),
    ).toBe(6.6);
  });

  it("redondea a céntimos", () => {
    // 2,55 €/kg × 1,5 kg = 3,825 → 3,83 €
    expect(
      precioPorPeso(producto({ unitPrice: { value: 2.55, unit: "kg" } }), 1.5),
    ).toBe(3.83);
    // 1,99 €/kg × 3 kg = 5,97
    expect(
      precioPorPeso(producto({ unitPrice: { value: 1.99, unit: "kg" } }), 3),
    ).toBe(5.97);
  });

  it("no calcula nada fuera de kg o con peso inválido", () => {
    expect(precioPorPeso(producto(), 0)).toBeNull();
    expect(precioPorPeso(producto(), -2)).toBeNull();
    expect(
      precioPorPeso(producto({ unitPrice: { value: 1.2, unit: "L" } }), 1.5),
    ).toBeNull();
    expect(precioPorPeso(producto({ unitPrice: null }), 1.5)).toBeNull();
  });
});

describe("formatoPeso", () => {
  it("escribe el peso con coma decimal", () => {
    expect(formatoPeso(1.5)).toBe("1,5");
    expect(formatoPeso(2)).toBe("2");
    expect(formatoPeso(0.75)).toBe("0,75");
  });
});
