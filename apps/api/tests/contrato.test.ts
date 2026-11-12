import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  coincideFlex,
  esCodigoBarrasValido,
  normalizarCodigoBarras,
  tokenizar,
  terminosExigidos,
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
import { aIdentificacion } from "../src/lib/barcode.js";

/**
 * Tests de contrato por adaptador con respuestas grabadas (§2, §9).
 * Las fixtures son respuestas reales capturadas en vivo (2026-11-11 y
 * 2026-11-12, ver «Precios reales»).
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
    // El precio total sale de `unit_price` (aquí 1 L, igual que bulk_price),
    // nunca inventado.
    expect(sp!.price).toBeCloseTo(2.45, 2);
    // Y el precio unitario es `bulk_price`: 2,45 €/L.
    expect(sp!.unitPrice?.value).toBeCloseTo(2.45, 2);
    expect(sp!.unitPrice?.unit).toBe("L");
  });

  it("cuenta el precio TOTAL de un pack (unit_price, no €/kg)", () => {
    // Regresión del bug de precios: se usaba `bulk_price` (0,83 €/L) como
    // total y un pack de 6 briks salía por 0,83 € en vez de 4,98 €.
    const datos = leer<unknown>("mercadona-category.json");
    const parseado = zMercadonaCategory.safeParse(datos);
    if (!parseado.success) throw new Error("fixture inválido");

    const crudos = (parseado.data.categories ?? []).flatMap(
      (c) => (c as { products?: unknown[] }).products ?? [],
    );
    const convertir = (id: string) =>
      crudos
        .filter((p) => String((p as { id?: unknown }).id) === id)
        .map((p) =>
          mercadonaProducto(p as Parameters<typeof mercadonaProducto>[0]),
        )[0];

    const pack6 = convertir("10381"); // pack de 6 × 1 L
    expect(pack6).not.toBeNull();
    expect(pack6!.price).toBeCloseTo(4.98, 2); // total real
    expect(pack6!.format).toBe("6 L");
    expect(pack6!.unitPrice?.value).toBeCloseTo(0.83, 2); // €/L
    expect(pack6!.unitPrice?.unit).toBe("L");

    const brick = convertir("10382"); // 1 L suelto
    expect(brick).not.toBeNull();
    expect(brick!.price).toBeCloseTo(0.83, 2);
    expect(brick!.unitPrice?.value).toBeCloseTo(0.83, 2);
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

  it("usa la imagen de `media` (la de productData.imageURL está caducada)", () => {
    const datos = leer<unknown>("consum-search.json");
    const parseado = zConsumResponse.safeParse(datos);
    if (!parseado.success) throw new Error("fixture inválido");

    const conMedia = parseado.data.products.find(
      (p) => (p.media?.length ?? 0) > 0,
    );
    expect(conMedia).toBeDefined();

    const sp = consumProducto(conMedia!);
    expect(sp).not.toBeNull();
    // La URL válida lleva el sufijo de `media` (…_001.jpg); imageURL (404)
    // termina en …/{code}.jpg.
    expect(sp!.imageUrl).toContain("_001.jpg");
    expect(sp!.imageUrl).toContain("cdn-consum.aktiosdigitalservices.com");
  });

  it("respeta el precio TOTAL y el precio unitario de Consum", () => {
    // Regresión: se dividía el total entre un tamaño mal leído y un tomate
    // sin peso declarado acababa con «0,51 €/kg» en vez de 2,55 €/kg.
    const datos = leer<unknown>("consum-precios.json");
    const parseado = zConsumResponse.safeParse(datos);
    if (!parseado.success) throw new Error("fixture inválido");

    const convertir = (nombre: string) =>
      parseado.data.products
        .filter((p) => p.productData.name === nombre)
        .map(consumProducto)
        .filter((p): p is NonNullable<typeof p> => p !== null);

    // Pack «3 x 200 ml»: total 1,45 € y 2,42 €/L (lo que reporta Consum).
    const pack = convertir("Leche Semi sin Lactosa Minibrik Pack de 3")[0];
    expect(pack).toBeDefined();
    expect(pack!.price).toBeCloseTo(1.45, 2);
    expect(pack!.format).toBe("0,6 L");
    expect(pack!.unitPrice?.value).toBeCloseTo(2.42, 2);
    expect(pack!.unitPrice?.unit).toBe("L");

    // Peso variable (sin gramos en el nombre): formato nulo y €/kg real.
    const tomate = convertir("Tomate Ensalada")[0];
    expect(tomate).toBeDefined();
    expect(tomate!.price).toBeCloseTo(0.51, 2);
    expect(tomate!.format).toBeNull();
    expect(tomate!.unitPrice?.value).toBeCloseTo(2.55, 2);
    expect(tomate!.unitPrice?.unit).toBe("kg");

    // Con tamaño declarado: 500 g → 0,5 kg y 4,40 €/kg.
    const cherry = convertir("Tomate Cherry Cubeta")[0];
    expect(cherry!.format).toBe("0,5 kg");
    expect(cherry!.unitPrice?.value).toBeCloseTo(4.4, 2);

    // Base «100 Gr»: 2,22 €/100 g → 22,20 €/kg.
    const chicle = convertir("Chicle Fresa sin Azúcar Paquete 32 Unidades")[0];
    expect(chicle!.unitPrice?.value).toBeCloseTo(22.2, 2);
    expect(chicle!.unitPrice?.unit).toBe("kg");
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
    const leche = convertidos.find((p) => /leche/i.test(p.name))!;
    expect(leche.price).toBeCloseTo(1.03, 2);
    // Sin basePrice se deduce del salesUnit «1 l unidad»: 1,03 €/L (nunca
    // «€/ud», que es lo que devolvía normalizarUnidad("… unidad")).
    expect(leche.unitPrice?.value).toBeCloseTo(1.03, 2);
    expect(leche.unitPrice?.unit).toBe("L");

    // Turrón 150 g: usa el basePrice oficial de Aldi (15,27 €/kg).
    const turron = convertidos.find((p) => /turrón/i.test(p.name))!;
    expect(turron.price).toBeCloseTo(2.29, 2);
    expect(turron.format).toBe("0,15 kg");
    expect(turron.unitPrice?.value).toBeCloseTo(15.27, 2);
    expect(turron.unitPrice?.unit).toBe("kg");
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

describe("Búsqueda flexible", () => {
  it("tokeniza separando letras y cifras («1l» → «1», «l»)", () => {
    expect(tokenizar("Leche Entera 1L")).toEqual(["leche", "entera", "1", "l"]);
    expect(tokenizar("  Tomate  Frito ")).toEqual(["tomate", "frito"]);
    expect(tokenizar("arándano 500gr")).toEqual(["arandano", "500", "gr"]);
    expect(tokenizar("")).toEqual([]);
  });

  it("exige solo los términos de 2+ caracteres", () => {
    expect(terminosExigidos(["leche", "entera", "1", "l"])).toEqual([
      "leche",
      "entera",
    ]);
    // Si no hay ninguno relevante, se exigen todos.
    expect(terminosExigidos(["1", "l"])).toEqual(["1", "l"]);
  });

  it("encuentra el producto aunque la consulta lleve tamaño y unidad", () => {
    const terminos = tokenizar("leche entera 1 l");
    expect(coincideFlex("Leche Entera Brik", terminos)).toBe(true);
    expect(coincideFlex("Leche Semidesnatada Brik", terminos)).toBe(false);
    expect(coincideFlex("Tomate frito", terminos)).toBe(false);
  });

  it("no exige el número suelto cuando el nombre no lo trae", () => {
    // Caso de la pestaña Cesta: «leche entera 1 l» vs. «Leche Entera Brik».
    expect(
      coincideFlex("Leche Entera Brik", tokenizar("leche entera 1l")),
    ).toBe(true);
    expect(coincideFlex("", tokenizar(""))).toBe(false);
  });
});

describe("Open Food Facts (identificación por código de barras)", () => {
  it("convierte una respuesta real en identificación con nombre y marca", () => {
    const datos = leer<unknown>("openfoodfacts-found.json");
    const ident = aIdentificacion("8402001002083", datos);

    expect(ident.encontrado).toBe(true);
    expect(ident.nombre).toBe("Leche Entera");
    expect(ident.marca).toBe("MERCADONA");
    expect(ident.consulta).toBe("Leche Entera MERCADONA");
    expect(ident.fuente).toBe("Open Food Facts");
    expect(ident.fuenteUrl).toBe(
      "https://world.openfoodfacts.org/product/8402001002083",
    );
    expect(Number.isNaN(Date.parse(ident.fechaConsulta))).toBe(false);
  });

  it("marca «no encontrado» cuando OFF devuelve status 0", () => {
    const datos = leer<unknown>("openfoodfacts-notfound.json");
    const ident = aIdentificacion("99999999999999", datos);

    expect(ident.encontrado).toBe(false);
    expect(ident.nombre).toBeNull();
    expect(ident.marca).toBeNull();
    expect(ident.consulta).toBeNull();
    expect(ident.code).toBe("99999999999999");
    expect(ident.fuente).toBe("Open Food Facts");
  });

  it("no inventa identificación con una respuesta malformada", () => {
    const ident = aIdentificacion("8402001002083", { foo: "bar" });
    expect(ident.encontrado).toBe(false);
    expect(ident.consulta).toBeNull();
  });

  it("prefiere product_name_es y recorta la marca a la primera", () => {
    const ident = aIdentificacion("123", {
      status: 1,
      product: {
        product_name: "Leche",
        product_name_es: "Leche Entera",
        brands: "MERCADONA,marca secundaria",
      },
    });
    expect(ident.nombre).toBe("Leche Entera");
    expect(ident.marca).toBe("MERCADONA");
    expect(ident.consulta).toBe("Leche Entera MERCADONA");
  });

  it("usa product_name cuando product_name_es viene como cadena vacía", () => {
    // OFF envía "" (no ausente) cuando no hay traducción: sin este caso el
    // producto quedaría «conocido pero sin nombre» y la web no buscaría.
    const ident = aIdentificacion("2000000000001", {
      status: 1,
      product: {
        product_name: "Spiruline",
        product_name_es: "",
        brands: "Les Hauts de Montrouge",
      },
    });
    expect(ident.nombre).toBe("Spiruline");
    expect(ident.encontrado).toBe(true);
    expect(ident.consulta).toBe("Spiruline Les Hauts de Montrouge");
  });

  it("con solo marca queda encontrado, sin nombre y con consulta = marca", () => {
    // Encontrado sin nombre: la web busca por `consulta` (la marca) para
    // que el chip nunca quede sin búsqueda (bug del chip muerto).
    const ident = aIdentificacion("4800000000000", {
      status: 1,
      product: { product_name: "  ", product_name_es: "", brands: "Hacendado" },
    });
    expect(ident.encontrado).toBe(true);
    expect(ident.nombre).toBeNull();
    expect(ident.marca).toBe("Hacendado");
    expect(ident.consulta).toBe("Hacendado");
  });
});

describe("Utilidades de formato", () => {
  it("valida códigos de barras (longitud + checksum EAN-13/8)", () => {
    // EAN-13 real de Mercadona (leche entera 1 L) — checksum correcto.
    expect(esCodigoBarrasValido("8402001002083")).toBe(true);
    // EAN-13 de pan de Mercadona — checksum correcto.
    expect(esCodigoBarrasValido("8480000832023")).toBe(true);
    // EAN-8 con checksum correcto (96385074).
    expect(esCodigoBarrasValido("96385074")).toBe(true);
    // UPC-A (12) e ITF-14 (14): solo se valida la longitud.
    expect(esCodigoBarrasValido("012345678905")).toBe(true);
    expect(esCodigoBarrasValido("12345678901234")).toBe(true);

    // Checksum incorrecto.
    expect(esCodigoBarrasValido("8402001002084")).toBe(false);
    expect(esCodigoBarrasValido("96385075")).toBe(false);
    // Longitudes inválidas.
    expect(esCodigoBarrasValido("1234567")).toBe(false);
    expect(esCodigoBarrasValido("123456789012345")).toBe(false);
    // No numérico o vacío.
    expect(esCodigoBarrasValido("abc")).toBe(false);
    expect(esCodigoBarrasValido("")).toBe(false);
    // Se toleran espacios y guiones.
    expect(esCodigoBarrasValido(" 8402001002083 ")).toBe(true);
    expect(esCodigoBarrasValido("8402-0010-02083")).toBe(true);
  });

  it("normaliza el código devolviendo null si no es válido", () => {
    expect(normalizarCodigoBarras(" 8402001002083 ")).toBe("8402001002083");
    expect(normalizarCodigoBarras("8402-0010-02083")).toBe("8402001002083");
    expect(normalizarCodigoBarras("12345")).toBeNull();
    expect(normalizarCodigoBarras("8402001002084")).toBeNull();
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

  it("en un pack manda el total («3 x 200 ml» → 0,6 L)", () => {
    expect(extraerFormato("Leche Mini Pack de 3 3 x 200 ml")).toEqual({
      format: "0,6 L",
      unitPriceUnit: "L",
      cantidad: 0.6,
    });
    expect(extraerFormato("Yogur Griego 4 x 125 Gr")?.cantidad).toBeCloseTo(
      0.5,
    );
    // Sin notación de pack sigue leyendo el tamaño unitario.
    expect(extraerFormato("Yogur Griego Natural 1 Kg")?.cantidad).toBe(1);
  });

  it("normaliza unidades", () => {
    expect(normalizarUnidad("kg")).toBe("kg");
    expect(normalizarUnidad("l")).toBe("L");
    expect(normalizarUnidad(null)).toBeNull();
  });
});
