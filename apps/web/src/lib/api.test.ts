import { afterEach, describe, expect, it, vi } from "vitest";
import { obtenerBaseApi } from "./api";

/**
 * Tests del cliente: la base de la API viene del build (VITE_API_URL) y se
 * normaliza la barra final para no duplicar rutas. No hay configuración del
 * usuario (sección 3.7).
 */

describe("URL de la API", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("devuelve la URL inyectada en el build", () => {
    vi.stubEnv("VITE_API_URL", "https://cestimate-api.example.com");
    expect(obtenerBaseApi()).toBe("https://cestimate-api.example.com");
  });

  it("elimina la barra final para no duplicar rutas", () => {
    vi.stubEnv("VITE_API_URL", "https://cestimate-api.example.com/");
    expect(obtenerBaseApi()).toBe("https://cestimate-api.example.com");
  });

  it("devuelve cadena vacía en desarrollo (proxy de Vite)", () => {
    vi.stubEnv("VITE_API_URL", "");
    expect(obtenerBaseApi()).toBe("");
  });
});
