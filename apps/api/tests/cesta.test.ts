import { beforeAll, describe, expect, it } from "vitest";
import { abrirDB, guardarProducto } from "../src/lib/db.js";
import { calcularResumen } from "../src/routes/basket.js";

/**
 * Tests del resumen de la cesta (§3.3, §9): totales, mínimo por fila,
 * faltantes y ahorro.
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
