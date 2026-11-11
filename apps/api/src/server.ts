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
  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(500).send({ error: "Error interno de la API." });
  });

  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`Cestimate API escuchando en http://localhost:${config.port}`);
}

main().catch((error) => {
  console.error("No se pudo arrancar la API:", error);
  process.exit(1);
});
