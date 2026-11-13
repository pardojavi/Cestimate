import { beforeAll, describe, expect, it } from "vitest";
import { precioPorCantidad } from "@cestimate/shared";
import { abrirDB, guardarProducto } from "../src/lib/db.js";
import { calcularResumen, crearArticulo } from "../src/routes/basket.js";

/**
 * Tests del resumen de la cesta (§3.3, §9): totales, mínimo por fila,
 * faltantes y ahorro. Incluye el modo «kg» (artículos por peso: la celda
 * cobra €/kg × kg, no el precio de la pieza).
 */

let db: ReturnType<typeof abrirDB>;

function anadirArticulo(nombre: string, qty: number): number {
  const r = db
    .prepare("INSERT INTO basket_item (generic_name, qty) VALUES (?, ?)")
    .run(nombre, qty);
  return Number(r.lastInsertRowid);
}

function anadirProducto(
  storeId: string,
  nombre: string,
  precio: number,
): number {
  return guardarProducto(db, {
    storeId,
    externalId: `${storeId}-${nombre}-${precio}`,
    name: nombre,
    url: `https://ejemplo/${storeId}/${encodeURIComponent(nombre)}`,
    price: precio,
  });
}

function emparejar(itemId: number, storeId: string, productId: number): void {
  db.prepare(
    "INSERT INTO basket_item_match (basket_item_id, store_id, product_id) VALUES (?, ?, ?)",
  ).run(itemId, storeId, productId);
}

beforeAll(() => {
  db = abrirDB();
  // Limpia el estado por si otros tests han escrito.
  db.exec(
    "DELETE FROM basket_item_match; DELETE FROM basket_item; DELETE FROM price_snapshot; DELETE FROM product; DELETE FROM saved_basket_line; DELETE FROM saved_basket;",
  );
});

describe("calcularResumen", () => {
  it("calcula totales, mínimo por fila y ahorro", () => {
    // Artículos: Leche ×2 y Arroz ×1.
    const leche = anadirArticulo("Leche entera 1 L", 2);
    const arroz = anadirArticulo("Arroz 1 kg", 1);

    // Mercadona: leche 0,96 · arroz 1,15 → total 3,07
    emparejar(
      leche,
      "mercadona",
      anadirProducto("mercadona", "Leche entera", 0.96),
    );
    emparejar(arroz, "mercadona", anadirProducto("mercadona", "Arroz", 1.15));

    // Consum: leche 0,83 · arroz 1,20 → total 2,86
    emparejar(leche, "consum", anadirProducto("consum", "Leche entera", 0.83));
    emparejar(arroz, "consum", anadirProducto("consum", "Arroz", 1.2));

    const resumen = calcularResumen(db, false);

    const mercadona = resumen.stores.find((s) => s.storeId === "mercadona")!;
    const consum = resumen.stores.find((s) => s.storeId === "consum")!;

    expect(mercadona.total).toBeCloseTo(0.96 * 2 + 1.15, 2);
    expect(consum.total).toBeCloseTo(0.83 * 2 + 1.2, 2);
    expect(mercadona.complete).toBe(true);
    expect(consum.complete).toBe(true);

    // Consum es la más barata y el ahorro frente a Mercadona es 0,21 €.
    expect(resumen.cheapest).toBe("consum");
    expect(resumen.saving).toBeCloseTo(0.21, 2);

    // En la fila de la leche gana Consum (0,83 < 0,96); en el arroz, Mercadona.
    const filaLeche = resumen.rows.find((r) => r.basketItemId === leche)!;
    const filaArroz = resumen.rows.find((r) => r.basketItemId === arroz)!;
    expect(filaLeche.cells.find((c) => c.storeId === "consum")!.cheapest).toBe(
      true,
    );
    expect(
      filaLeche.cells.find((c) => c.storeId === "mercadona")!.cheapest,
    ).toBe(false);
    expect(
      filaArroz.cells.find((c) => c.storeId === "mercadona")!.cheapest,
    ).toBe(true);
  });

  it("marca faltantes y no declara ganadora a una tienda incompleta", () => {
    db.exec("DELETE FROM basket_item_match; DELETE FROM basket_item;");

    const leche = anadirArticulo("Leche entera 1 L", 1);
    const queso = anadirArticulo("Queso", 1);

    // Mercadona tiene ambos; Consum solo la leche.
    emparejar(
      leche,
      "mercadona",
      anadirProducto("mercadona", "Leche entera", 0.96),
    );
    emparejar(queso, "mercadona", anadirProducto("mercadona", "Queso", 2.5));
    emparejar(leche, "consum", anadirProducto("consum", "Leche entera", 0.83));

    const resumen = calcularResumen(db, false);
    const mercadona = resumen.stores.find((s) => s.storeId === "mercadona")!;
    const consum = resumen.stores.find((s) => s.storeId === "consum")!;

    expect(mercadona.complete).toBe(true);
    expect(consum.complete).toBe(false);
    expect(consum.missing).toBe(1);
    // Solo hay una tienda completa: no hay ahorro posible.
    expect(resumen.cheapest).toBe("mercadona");
    expect(resumen.saving).toBeNull();

    // La celda del queso en Consum es «n/d» (null), nunca un precio inventado.
    const filaQueso = resumen.rows.find((r) => r.basketItemId === queso)!;
    expect(
      filaQueso.cells.find((c) => c.storeId === "consum")!.price,
    ).toBeNull();
  });

  it("con «solo comunes» solo compara los artículos presentes en todas", () => {
    const resumen = calcularResumen(db, true);
    const mercadona = resumen.stores.find((s) => s.storeId === "mercadona")!;
    const consum = resumen.stores.find((s) => s.storeId === "consum")!;

    // Ambas solo cuentan la leche (el queso no está en Consum).
    expect(mercadona.total).toBeCloseTo(0.96, 2);
    expect(consum.total).toBeCloseTo(0.83, 2);
    expect(resumen.cheapest).toBe("consum");
    expect(resumen.saving).toBeCloseTo(0.13, 2);
  });
});

describe("crearArticulo", () => {
  it("crea el artículo con sus emparejamientos en una transacción", () => {
    db.exec("DELETE FROM basket_item_match; DELETE FROM basket_item;");

    const idLecheM = anadirProducto("mercadona", "Leche entera", 0.96);
    const idLecheC = anadirProducto("consum", "Leche Entera Brik", 0.83);

    const id = crearArticulo(db, {
      genericName: "Leche entera 1 L",
      qty: 2,
      matches: [
        { storeId: "mercadona", productId: idLecheM },
        { storeId: "consum", productId: idLecheC },
      ],
    });

    const item = db
      .prepare("SELECT generic_name, qty FROM basket_item WHERE id = ?")
      .get(id) as { generic_name: string; qty: number };
    expect(item.generic_name).toBe("Leche entera 1 L");
    expect(item.qty).toBe(2);

    const matches = db
      .prepare(
        "SELECT store_id, product_id FROM basket_item_match WHERE basket_item_id = ?",
      )
      .all(id) as { store_id: string; product_id: number }[];
    expect(matches).toHaveLength(2);
    expect(matches.find((m) => m.store_id === "mercadona")!.product_id).toBe(
      idLecheM,
    );
    expect(matches.find((m) => m.store_id === "consum")!.product_id).toBe(
      idLecheC,
    );
  });

  it("no escribe nada si un emparejamiento no es válido", () => {
    db.exec("DELETE FROM basket_item_match; DELETE FROM basket_item;");

    const idLecheM = anadirProducto("mercadona", "Leche entera", 0.96);
    const antes = db.prepare("SELECT COUNT(*) n FROM basket_item").get() as {
      n: number;
    };

    // Producto de otra tienda: debe fallar sin dejar el artículo a medias.
    expect(() =>
      crearArticulo(db, {
        genericName: "No debe quedar",
        qty: 1,
        matches: [
          { storeId: "mercadona", productId: idLecheM },
          { storeId: "consum", productId: idLecheM }, // no es de Consum
        ],
      }),
    ).toThrow();

    const despues = db.prepare("SELECT COUNT(*) n FROM basket_item").get() as {
      n: number;
    };
    expect(despues.n).toBe(antes.n);
    const huerfanos = db
      .prepare("SELECT COUNT(*) n FROM basket_item_match")
      .get() as { n: number };
    expect(huerfanos.n).toBe(0);
  });

  it("recuerda el modo de la cantidad (ud o kg)", () => {
    db.exec("DELETE FROM basket_item_match; DELETE FROM basket_item;");

    const id = crearArticulo(db, {
      genericName: "Banana",
      qty: 1,
      qtyUnit: "kg",
    });
    const kg = db
      .prepare("SELECT qty_unit FROM basket_item WHERE id = ?")
      .get(id) as { qty_unit: string };
    expect(kg.qty_unit).toBe("kg");

    // Sin qtyUnit sigue naciendo en unidades (compatibilidad hacia atrás).
    const ud = crearArticulo(db, { genericName: "Leche", qty: 2 });
    const filaUd = db
      .prepare("SELECT qty_unit FROM basket_item WHERE id = ?")
      .get(ud) as { qty_unit: string };
    expect(filaUd.qty_unit).toBe("ud");
  });
});

describe("precioPorCantidad", () => {
  it("en modo kg cobra el €/kg real × kg, redondeado a céntimos", () => {
    // Banana Mercadona: 0,28 € la pieza, 1,55 €/kg → 1 kg = 1,55 €.
    const banana = { price: 0.28, unitPrice: 1.55, unit: "kg" };
    expect(precioPorCantidad(banana, 1, "kg")).toBe(1.55);
    // 1,55 × 1,5 = 2,325 → 2,33 €.
    expect(precioPorCantidad(banana, 1.5, "kg")).toBe(2.33);
    expect(
      precioPorCantidad(
        { price: 2.99, unitPrice: 29.9, unit: "kg" },
        0.5,
        "kg",
      ),
    ).toBe(14.95);
  });

  it("en modo ud multiplica el precio real de la pieza/pack", () => {
    expect(
      precioPorCantidad({ price: 0.28, unitPrice: 1.55, unit: "kg" }, 3, "ud"),
    ).toBe(0.84);
    // Por defecto es unidades: no cambia el comportamiento antiguo.
    expect(
      precioPorCantidad({ price: 0.96, unitPrice: null, unit: null }, 2),
    ).toBe(1.92);
  });

  it("si el producto no cotiza por kg, en modo kg manda su precio real", () => {
    // Sin €/kg (p. ej. mascarilla): nunca se inventa un precio (§4.3).
    expect(
      precioPorCantidad({ price: 6.35, unitPrice: null, unit: null }, 2, "kg"),
    ).toBe(12.7);
    // Cotiza en litros: el modo kg no aplica.
    expect(
      precioPorCantidad({ price: 1.2, unitPrice: 1.15, unit: "L" }, 2, "kg"),
    ).toBe(2.4);
  });
});

describe("cesta por kilo", () => {
  it("cobra €/kg × kg en celdas y totales, y respeta el cambio de peso", () => {
    db.exec(
      "DELETE FROM basket_item_match; DELETE FROM basket_item; DELETE FROM price_snapshot; DELETE FROM product;",
    );

    // Datos reales de banana: ambas tiendas a 1,55 €/kg con piezas distintas.
    const bananaM = guardarProducto(db, {
      storeId: "mercadona",
      externalId: "banana-m",
      name: "Banana",
      url: "https://tienda.mercadona.es/product/banana",
      price: 0.28,
      unitPrice: 1.55,
      unit: "kg",
    });
    const bananaC = guardarProducto(db, {
      storeId: "consum",
      externalId: "banana-c",
      name: "Banana",
      url: "https://tienda.consum.es/product/banana",
      price: 0.31,
      unitPrice: 1.55,
      unit: "kg",
    });

    const id = crearArticulo(db, {
      genericName: "Banana",
      qty: 1,
      qtyUnit: "kg",
      matches: [
        { storeId: "mercadona", productId: bananaM },
        { storeId: "consum", productId: bananaC },
      ],
    });

    // 1 kg → 1,55 € por tienda (no el precio de la pieza: 0,28 / 0,31).
    const resumen = calcularResumen(db, false);
    expect(resumen.stores.find((s) => s.storeId === "mercadona")!.total).toBe(
      1.55,
    );
    expect(resumen.stores.find((s) => s.storeId === "consum")!.total).toBe(
      1.55,
    );
    const fila = resumen.rows.find((r) => r.basketItemId === id)!;
    expect(fila.qtyUnit).toBe("kg");
    expect(fila.cells.every((c) => c.price === 1.55)).toBe(true);

    // Cambiar el peso en la cesta a 1,5 kg → 2,33 € (1,55 × 1,5 = 2,325).
    db.prepare("UPDATE basket_item SET qty = 1.5 WHERE id = ?").run(id);
    const conPeso = calcularResumen(db, false);
    expect(conPeso.stores.find((s) => s.storeId === "mercadona")!.total).toBe(
      2.33,
    );
    expect(conPeso.stores.find((s) => s.storeId === "consum")!.total).toBe(
      2.33,
    );
    expect(conPeso.saving).toBe(0);

    // Un artículo en modo ud con el mismo producto sigue cobrando la pieza.
    const porPieza = crearArticulo(db, {
      genericName: "Banana por pieza",
      qty: 2,
      qtyUnit: "ud",
      matches: [{ storeId: "mercadona", productId: bananaM }],
    });
    const mixto = calcularResumen(db, false);
    const filaPieza = mixto.rows.find((r) => r.basketItemId === porPieza)!;
    expect(filaPieza.qtyUnit).toBe("ud");
    expect(filaPieza.cells.find((c) => c.storeId === "mercadona")!.price).toBe(
      0.56,
    );
    expect(mixto.stores.find((s) => s.storeId === "mercadona")!.total).toBe(
      2.89,
    );
    expect(mixto.stores.find((s) => s.storeId === "consum")!.total).toBe(2.33);
  });
});
