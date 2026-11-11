import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  zAldiResponse,
  zConsumResponse,
  zLidlJsonLd,
  zMercadonaCategory,
  zMercadonaProduct,
} from "@cestimate/shared";
import { aStoreProduct as mercadonaProducto } from "../src/adapters/mercadona.js";
import { aStoreProduct as consumProducto } from "../src/adapters/consum.js";
import { aStoreProduct as aldiProducto } from "../src/adapters/aldi.js";
import {
  aStoreProduct as lidlProducto,
  extraerJsonLd,
} from "../src/adapters/lidl.js";
import { extraerFormato, normalizarUnidad } from "../src/adapters/types.js";

/**
 * Tests de contrato por adaptador con respuestas grabadas (§2, §9).
 * Las fixtures son respuestas reales capturadas en vivo el 2026-11-11.
 */

const FIXTURES = join(__dirname, "fixtures");

function leer<T>(nombre: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, nombre), "utf8")) as T;
}

describe("Mercadona", () => {
  it("valida la estructura de una categoría con precios", () => {
    const datos = leer<unknown>("mercadona-category.json");
    const parseado = zMercadonaCategory.safeParse(datos);
    expect(parseado.success).toBe(true);
    if (!parseado.success) return;

    const productos = (parseado.data.categories ?? []).flatMap(
      (c) => (c as { products?: unknown[] }).products ?? [],
    );
    expect(productos.length).toBeGreaterThan(0);
  });

  it("convierte un producto real con precio y URL verificable", () => {
    const datos = leer<unknown>("mercadona-product.json");
    const parseado = zMercadonaProduct.safeParse(datos);
    expect(parseado.success).toBe(true);
    if (!parseado.success) return;

    const sp = mercadonaProducto(parseado.data);
    expect(sp).not.toBeNull();
    expect(sp!.price).toBeGreaterThan(0);
    expect(sp!.url).toMatch(/^https:\/\/tienda\.mercadona\.es\/product\//);
    expect(sp!.name.length).toBeGreaterThan(0);
    expect(Number.isNaN(Date.parse(sp!.fetchedAt))).toBe(false);
    // El precio viene del campo real `bulk_price`, nunca inventado.
    expect(sp!.price).toBeCloseTo(2.45, 2);
  });

  it("convierte los productos de la categoría con precio", () => {
    const datos = leer<unknown>("mercadona-category.json");
    const parseado = zMercadonaCategory.safeParse(datos);
    if (!parseado.success) throw new Error("fixture inválido");

    const crudos = (parseado.data.categories ?? []).flatMap(
      (c) => (c as { products?: unknown[] }).products ?? [],
    );
    const convertidos = crudos
      .map((p) =>
        mercadonaProducto(p as Parameters<typeof mercadonaProducto>[0]),
      )
      .filter((p): p is NonNullable<typeof p> => p !== null);

    expect(convertidos.length).toBeGreaterThan(0);
    for (const p of convertidos) {
      expect(p.price).toBeGreaterThan(0);
      expect(p.url).toContain("tienda.mercadona.es");
      expect(p.storeId).toBe("mercadona");
    }
  });
});

describe("Consum", () => {
  it("valida la respuesta de búsqueda con precios", () => {
    const datos = leer<unknown>("consum-search.json");
    const parseado = zConsumResponse.safeParse(datos);
    expect(parseado.success).toBe(true);
    if (!parseado.success) return;
    expect(parseado.data.products.length).toBeGreaterThan(0);
    for (const p of parseado.data.products) {
      expect(p.priceData.prices[0]!.value.centAmount).toBeGreaterThan(0);
      expect(p.productData.url).toMatch(/^https:\/\/tienda\.consum\.es\//);
    }
  });

  it("convierte precios (en euros pese al nombre del campo)", () => {
    const datos = leer<unknown>("consum-search.json");
    const parseado = zConsumResponse.safeParse(datos);
    if (!parseado.success) throw new Error("fixture inválido");

    const convertidos = parseado.data.products
      .map(consumProducto)
      .filter((p): p is NonNullable<typeof p> => p !== null);

    expect(convertidos.length).toBeGreaterThan(0);
    for (const p of convertidos) {
      expect(p.price).toBeGreaterThan(0);
      expect(p.price).toBeLessThan(500); // es EUR, no céntimos
      expect(p.url).toContain("tienda.consum.es");
    }
    // Caso conocido de la prueba de aceptación: leche semidesnatada 0,83 €.
    const leche = convertidos.find((p) => /semidesnatada/i.test(p.name));
    expect(leche?.price).toBeCloseTo(0.83, 2);
  });
});

describe("Aldi", () => {
  it("valida la respuesta de Algolia", () => {
    const datos = leer<unknown>("aldi-search.json");
    const parseado = zAldiResponse.safeParse(datos);
    expect(parseado.success).toBe(true);
    if (!parseado.success) return;
    expect(parseado.data.nbHits).toBeGreaterThan(0);
  });

  it("convierte hits con precio, unidad y URL de producto", () => {
    const datos = leer<unknown>("aldi-search.json");
    const parseado = zAldiResponse.safeParse(datos);
    if (!parseado.success) throw new Error("fixture inválido");

    const convertidos = parseado.data.hits
      .map(aldiProducto)
      .filter((p): p is NonNullable<typeof p> => p !== null);

    expect(convertidos.length).toBeGreaterThan(0);
    for (const p of convertidos) {
      expect(p.price).toBeGreaterThan(0);
      expect(p.url).toMatch(/^https:\/\/www\.aldi\.es\/producto\/.+\.html$/);
      expect(p.storeId).toBe("aldi");
    }
    // El hit de leche del fixture: 1,03 €.
    const leche = convertidos.find((p) => /leche/i.test(p.name));
    expect(leche?.price).toBeCloseTo(1.03, 2);
  });

  it("descarta productos no disponibles", () => {
    const hit = {
      objectID: "1",
      name: "Producto agotado",
      productSlug: "producto-agotado-1",
      currentPrice: { priceValue: 1 },
      isComingSoon: true,
    };
    expect(aldiProducto(hit as never)).toBeNull();
  });
});

describe("Lidl", () => {
  it("extrae el JSON-LD Product de una página real", () => {
    const html = readFileSync(join(FIXTURES, "lidl-product.html"), "utf8");
    const ld = extraerJsonLd(html);
    expect(ld).not.toBeNull();
    const parseado = zLidlJsonLd.safeParse(ld);
    expect(parseado.success).toBe(true);
  });

  it("convierte el JSON-LD en un producto con precio", () => {
    const html = readFileSync(join(FIXTURES, "lidl-product.html"), "utf8");
    const ld = extraerJsonLd(html);
    if (!ld) throw new Error("sin JSON-LD");
    const sp = lidlProducto(ld, "https://www.lidl.es/p/ejemplo/p123", "123");
    expect(sp).not.toBeNull();
    expect(sp!.price).toBeGreaterThan(0);
    expect(sp!.url).toContain("lidl.es");
    expect(sp!.storeId).toBe("lidl");
    // Precio real del fixture: 109,99 €.
    expect(sp!.price).toBeCloseTo(109.99, 2);
  });

  it("devuelve null si no hay oferta", () => {
    const ld = { "@type": "Product" as const, name: "Sin precio" };
    expect(
      lidlProducto(ld as never, "https://www.lidl.es/p/x/p1", "1"),
    ).toBeNull();
  });
});

describe("Utilidades de formato", () => {
  it("extrae tamaño y unidad", () => {
    expect(extraerFormato("Leche Entera Brik 1 L")).toEqual({
      format: "1 L",
      unitPriceUnit: "L",
      cantidad: 1,
    });
    expect(extraerFormato("500 g")?.cantidad).toBeCloseTo(0.5);
    expect(extraerFormato("12 ud")?.unitPriceUnit).toBe("ud");
    expect(extraerFormato("sin cantidad")).toBeNull();
  });

  it("normaliza unidades", () => {
    expect(normalizarUnidad("kg")).toBe("kg");
    expect(normalizarUnidad("l")).toBe("L");
    expect(normalizarUnidad(null)).toBeNull();
  });
});
