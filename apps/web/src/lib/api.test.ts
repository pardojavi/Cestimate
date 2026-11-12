import { afterEach, describe, expect, it, vi } from "vitest";
import {
  obtenerBaseApi,
  terminoDeBusqueda,
  type IdentificacionCodigo,
} from "./api";

/**
 * Tests del cliente: la base de la API viene del build (VITE_API_URL) y se
 * normaliza la barra final para no duplicar rutas. No hay configuración del
 * usuario (sección 3.7). Además cubre la regla del código de barras:
 * «si hay chip, hay búsqueda» (nunca un chip sin resultados ni aviso).
 */

function ident(parcial: Partial<IdentificacionCodigo>): IdentificacionCodigo {
  return {
    code: "8402001002083",
    encontrado: true,
    nombre: null,
    marca: null,
    consulta: null,
    fuente: "Open Food Facts",
    fuenteUrl: "https://world.openfoodfacts.org/product/8402001002083",
    fechaConsulta: "2026-11-12T10:00:00.000Z",
    ...parcial,
  };
}

describe("Término de búsqueda de una identificación", () => {
  it("busca solo el nombre, sin la marca", () => {
    const termino = terminoDeBusqueda(
      ident({
        nombre: "Leche Entera",
        marca: "MERCADONA",
        consulta: "Leche Entera MERCADONA",
      }),
    );
    expect(termino).toBe("Leche Entera");
  });

  it("con solo marca busca por consulta para no dejar el chip sin búsqueda", () => {
    const termino = terminoDeBusqueda(
      ident({ nombre: null, marca: "Hacendado", consulta: "Hacendado" }),
    );
    expect(termino).toBe("Hacendado");
  });

  it("sin código reconocido no hay nada que buscar (aviso §6.4)", () => {
    expect(terminoDeBusqueda(ident({ encontrado: false }))).toBeNull();
    expect(
      terminoDeBusqueda(
        ident({ encontrado: false, nombre: "  ", consulta: null }),
      ),
    ).toBeNull();
  });
});

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
