import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zSettings } from "@cestimate/shared";
import { abrirDB } from "../lib/db.js";

/** Ajustes (§3.7): código postal, TTL de caché y borrado de caché. */

const zEdicion = z.object({
  postalCode: z
    .string()
    .regex(/^\d{5}$/, "Código postal de 5 dígitos")
    .optional(),
  ttlHours: z.number().int().min(1).max(168).optional(),
});

export function registrarAjustes(app: FastifyInstance): void {
  app.get("/api/settings", async () => {
    const base = abrirDB();
    const filas = base.prepare("SELECT key, value FROM setting").all() as {
      key: string;
      value: string;
    }[];
    const mapa = Object.fromEntries(filas.map((f) => [f.key, f.value]));
    const ttl = Number(mapa.ttl_hours);
    return zSettings.parse({
      postalCode: mapa.postal_code ?? "28001",
      ttlHours: Number.isFinite(ttl) && ttl > 0 ? ttl : 12,
    });
  });

  app.put("/api/settings", async (request, reply) => {
    const parseado = zEdicion.safeParse(request.body);
    if (!parseado.success) {
      return reply
        .code(400)
        .send({
          error: "Ajustes no válidos.",
          detalle: parseado.error.flatten(),
        });
    }
    const base = abrirDB();
    const guardar = base.prepare(
      `INSERT INTO setting (key, value) VALUES (?, ?)
       ON CONFLICT (key) DO UPDATE SET value = excluded.value`,
    );
    if (parseado.data.postalCode)
      guardar.run("postal_code", parseado.data.postalCode);
    if (parseado.data.ttlHours)
      guardar.run("ttl_hours", String(parseado.data.ttlHours));
    const filas = base.prepare("SELECT key, value FROM setting").all() as {
      key: string;
      value: string;
    }[];
    const mapa = Object.fromEntries(filas.map((f) => [f.key, f.value]));
    return {
      postalCode: mapa.postal_code ?? "28001",
      ttlHours: Number(mapa.ttl_hours) || 12,
    };
  });

  /** Borra la caché de búsquedas y la marca de catálogo (§3.7). */
  app.post("/api/cache/clear", async () => {
    const base = abrirDB();
    base.prepare("DELETE FROM search_cache").run();
    base.prepare("DELETE FROM catalog_meta").run();
    return {
      ok: true,
      message:
        "Caché borrada. El catálogo se reindexará en la próxima búsqueda.",
    };
  });
}
