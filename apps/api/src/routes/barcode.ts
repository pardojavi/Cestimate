import type { FastifyInstance } from "fastify";
import { esCodigoBarrasValido } from "@cestimate/shared";
import {
  consultarOpenFoodFacts,
  guardarCacheBarcode,
  leerCacheBarcode,
} from "../lib/barcode.js";
import { abrirDB } from "../lib/db.js";

/**
 * GET /api/barcode/{codigo}
 * Identifica un producto por su código de barras usando Open Food Facts
 * (solo nombre y marca). Los precios no salen de aquí: el frontend usa la
 * identificación para lanzar la búsqueda normal en las tiendas.
 */
export function registrarCodigoBarras(app: FastifyInstance): void {
  app.get<{ Params: { codigo: string } }>(
    "/api/barcode/:codigo",
    async (request, reply) => {
      const codigo = request.params.codigo.trim();
      if (!esCodigoBarrasValido(codigo)) {
        return reply
          .code(400)
          .send({
            error: "Código de barras no válido (solo dígitos, 8/12/13/14).",
          });
      }

      const base = abrirDB();
      const cache = leerCacheBarcode(base, codigo);
      if (cache) return cache;

      try {
        const ident = await consultarOpenFoodFacts(codigo);
        // Solo se cachea el resultado (encontrado o no): evita martillear OFF.
        guardarCacheBarcode(base, codigo, ident);
        return ident;
      } catch (error) {
        console.warn(`[barcode] fallo consultando OFF para ${codigo}:`, error);
        return reply.code(502).send({
          error:
            "No se pudo identificar el código con Open Food Facts. Escribe el nombre del producto a mano.",
        });
      }
    },
  );
}
