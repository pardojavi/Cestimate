import { config } from "../config.js";

/**
 * HTTP con timeout, reintentos con backoff y User-Agent identificable (§4.3).
 */

export class ErrorTienda extends Error {
  constructor(
    readonly storeId: string,
    readonly code: "timeout" | "http" | "formato" | "sin-datos" | "red",
    message: string,
  ) {
    super(message);
    this.name = "ErrorTienda";
  }
}

interface OpcionesPeticion {
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  reintentos?: number;
}

export async function pedir(
  storeId: string,
  url: string,
  opciones: OpcionesPeticion = {},
): Promise<Response> {
  const {
    method = "GET",
    headers = {},
    body,
    timeoutMs = config.timeoutMs,
    reintentos = 2,
  } = opciones;

  let ultimoError: unknown;
  for (let intento = 0; intento <= reintentos; intento++) {
    try {
      const respuesta = await fetch(url, {
        method,
        headers: {
          "User-Agent": config.userAgent,
          Accept: "application/json, text/html;q=0.9",
          "Accept-Language": "es-ES,es;q=0.9",
          ...headers,
        },
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (respuesta.ok) return respuesta;
      // 4xx: no se reintenta (no tiene sentido martillear).
      if (
        respuesta.status >= 400 &&
        respuesta.status < 500 &&
        respuesta.status !== 429
      ) {
        throw new ErrorTienda(
          storeId,
          "http",
          `HTTP ${respuesta.status} en ${url}`,
        );
      }
      ultimoError = new ErrorTienda(
        storeId,
        "http",
        `HTTP ${respuesta.status} en ${url}`,
      );
    } catch (error) {
      if (
        error instanceof ErrorTienda &&
        error.code === "http" &&
        !error.message.includes("429")
      ) {
        throw error;
      }
      ultimoError = error;
      if (error instanceof Error && error.name === "TimeoutError") {
        ultimoError = new ErrorTienda(storeId, "timeout", `Timeout en ${url}`);
      }
    }
    // Backoff exponencial suave antes de reintentar.
    if (intento < reintentos) {
      await new Promise((r) => setTimeout(r, 400 * 2 ** intento));
    }
  }
  if (ultimoError instanceof ErrorTienda) throw ultimoError;
  throw new ErrorTienda(
    storeId,
    "red",
    `Fallo de red en ${url}: ${ultimoError instanceof Error ? ultimoError.message : String(ultimoError)}`,
  );
}

/** GET + JSON con validación por el llamante. */
export async function pedirJSON<T>(
  storeId: string,
  url: string,
  opciones: OpcionesPeticion = {},
): Promise<T> {
  const respuesta = await pedir(storeId, url, opciones);
  const texto = await respuesta.text();
  try {
    return JSON.parse(texto) as T;
  } catch {
    throw new ErrorTienda(
      storeId,
      "formato",
      `Respuesta no es JSON válido en ${url} (¿ha cambiado el formato?)`,
    );
  }
}

/** Espera con límite para limitar la concurrencia por tienda. */
export function esperar(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
