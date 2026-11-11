import { beforeEach, describe, expect, it, vi } from "vitest";
import { guardarBaseApi, obtenerBaseApi } from "./api";

/**
 * Tests mínimos del cliente: la URL de la API se guarda en localStorage
 * (sección 3.7) y normaliza barras finales.
 */

const almacen = new Map<string, string>();

beforeEach(() => {
  almacen.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => almacen.get(k) ?? null,
    setItem: (k: string, v: string) => void almacen.set(k, v),
    removeItem: (k: string) => void almacen.delete(k),
  });
});

describe("URL de la API", () => {
  it("devuelve cadena vacía si no hay nada guardado (desarrollo)", () => {
    expect(obtenerBaseApi()).toBe("");
  });

  it("guarda y recupera la URL", () => {
    guardarBaseApi("https://cestimate-api.example.com");
    expect(obtenerBaseApi()).toBe("https://cestimate-api.example.com");
  });

  it("elimina la barra final para no duplicar rutas", () => {
    guardarBaseApi("https://cestimate-api.example.com/");
    expect(obtenerBaseApi()).toBe("https://cestimate-api.example.com");
  });
});
