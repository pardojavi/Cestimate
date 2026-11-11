/**
 * Configuración de la API desde variables de entorno (.env).
 */
function entero(valor: string | undefined, porDefecto: number): number {
  const n = Number(valor);
  return Number.isFinite(n) && n > 0 ? n : porDefecto;
}

export const config = {
  port: entero(process.env.PORT, 8787),
  corsOrigin: process.env.CORS_ORIGIN ?? "*",
  databasePath: process.env.DATABASE_PATH ?? "./data/cestimate.db",
  ttlHours: entero(process.env.TTL_HOURS, 12),
  userAgent:
    process.env.USER_AGENT ??
    "Cestimate/1.0 (+https://github.com/cestimate/cestimate)",
  defaultPostalCode: process.env.DEFAULT_POSTAL_CODE ?? "28001",
  /** Timeout por petición a las tiendas (§4.3, ~10 s). */
  timeoutMs: 10_000,
  /** Conocimiento del puerto de desarrollo de Vite para el proxy. */
  isDev: process.env.NODE_ENV !== "production",
};
