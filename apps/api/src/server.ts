import Fastify from "fastify";
import cors from "@fastify/cors";
import { config } from "./config.js";
import { abrirDB } from "./lib/db.js";
import { registrarBusqueda } from "./routes/search.js";
import { registrarTiendas } from "./routes/stores.js";
import { registrarCesta } from "./routes/basket.js";
import { registrarGuardadas } from "./routes/saved.js";
import { registrarEstadisticas } from "./routes/stats.js";
import { registrarAjustes } from "./routes/settings.js";

/**
 * Servidor único de Cestimate (§2): Fastify + SQLite, un proceso.
 */
async function main(): Promise<void> {
  const app = Fastify({
    logger: true,
  });

  await app.register(cors, {
    origin: config.corsOrigin === "*" ? true : config.corsOrigin.split(","),
  });

  // Acepta POST/PUT/DELETE sin cuerpo aunque envíen content-type JSON
  // (los clientes antiguos lo hacían; Fastify lo rechazaba con 400).
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (_req, cuerpo, done) => {
      const texto = typeof cuerpo === "string" ? cuerpo : String(cuerpo ?? "");
      if (texto.trim() === "") return done(null, undefined);
      try {
        done(null, JSON.parse(texto));
      } catch {
        done(
          Object.assign(new Error("JSON no válido."), { statusCode: 400 }),
          undefined,
        );
      }
    },
  );

  // Abre SQLite y siembra las tiendas predefinidas antes de servir.
  abrirDB();

  registrarBusqueda(app);
  registrarTiendas(app);
  registrarCesta(app);
  registrarGuardadas(app);
  registrarEstadisticas(app);
  registrarAjustes(app);

  app.get("/api/health", async () => ({ ok: true, name: "Cestimate" }));

  // Errores no capturados: respuesta JSON limpia, sin stack al cliente.
  // Se respeta el código original (4xx = petición inválida, p. ej. cuerpo
  // vacío) y el 500 se reserva para fallos reales del servidor.
  app.setErrorHandler((error, _request, reply) => {
    const e = error as { statusCode?: number; message?: string };
    const codigo =
      typeof e.statusCode === "number" &&
      e.statusCode >= 400 &&
      e.statusCode < 500
        ? e.statusCode
        : 500;
    if (codigo >= 500) app.log.error(error);
    else app.log.warn(error);
    reply.code(codigo).send({
      error:
        codigo >= 500
          ? "Error interno de la API."
          : (e.message ?? "Petición no válida."),
    });
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Cestimate API escuchando en http://localhost:${config.port}`);
}

main().catch((error) => {
  console.error("No se pudo arrancar la API:", error);
  process.exit(1);
});
