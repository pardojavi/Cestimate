import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { COLORES_TIENDA } from "@cestimate/shared";
import { registrarAdaptadores } from "../adapters/index.js";
import { abrirDB, guardarProducto, obtenerAjustes } from "../lib/db.js";

/** Gestión de tiendas (§3.4): alta, edición, baja y productos manuales. */

const adaptadores = registrarAdaptadores(abrirDB());

const zNuevaTienda = z.object({
  name: z.string().min(1).max(80),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  website: z.string().url().nullable().optional(),
  adapter: z.string().min(1).default("manual"),
  active: z.boolean().default(true),
});

const zEdicionTienda = z.object({
  name: z.string().min(1).max(80).optional(),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  website: z.string().url().nullable().optional(),
  adapter: z.string().min(1).optional(),
  active: z.boolean().optional(),
});

const zProductoManual = z.object({
  name: z.string().min(1).max(200),
  price: z.number().positive(),
  url: z.string().url(),
  format: z.string().max(40).nullable().optional(),
  unitPrice: z.number().positive().nullable().optional(),
  unit: z.enum(["kg", "L", "ud"]).nullable().optional(),
});

interface FilaTienda {
  id: string;
  name: string;
  color: string;
  website: string | null;
  adapter: string;
  active: number;
  created_at: string;
}

function aTienda(f: FilaTienda) {
  return {
    id: f.id,
    name: f.name,
    color: f.color,
    website: f.website,
    adapter: f.adapter,
    active: f.active === 1,
    createdAt: f.created_at,
  };
}

export function registrarTiendas(app: FastifyInstance): void {
  app.get("/api/stores", async () => {
    const base = abrirDB();
    const filas = base
      .prepare("SELECT * FROM store ORDER BY active DESC, name")
      .all() as FilaTienda[];
    return filas.map(aTienda);
  });

  app.post("/api/stores", async (request, reply) => {
    const parseado = zNuevaTienda.safeParse(request.body);
    if (!parseado.success) {
      return reply
        .code(400)
        .send({
          error: "Datos de tienda no válidos.",
          detalle: parseado.error.flatten(),
        });
    }
    const datos = parseado.data;
    if (datos.adapter !== "manual" && !adaptadores.has(datos.adapter)) {
      return reply
        .code(400)
        .send({
          error: `Adaptador «${datos.adapter}» no disponible. Usa uno de la lista o «manual».`,
        });
    }
    const base = abrirDB();
    const id = slugUnico(base, datos.name);
    const color = datos.color ?? COLORES_TIENDA[datos.adapter] ?? "#2F6F4E";
    base
      .prepare(
        "INSERT INTO store (id, name, color, website, adapter, active) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        id,
        datos.name,
        color,
        datos.website ?? null,
        datos.adapter,
        datos.active ? 1 : 0,
      );
    const fila = base
      .prepare("SELECT * FROM store WHERE id = ?")
      .get(id) as FilaTienda;
    return reply.code(201).send(aTienda(fila));
  });

  app.patch<{ Params: { id: string } }>(
    "/api/stores/:id",
    async (request, reply) => {
      const parseado = zEdicionTienda.safeParse(request.body);
      if (!parseado.success) {
        return reply
          .code(400)
          .send({
            error: "Datos no válidos.",
            detalle: parseado.error.flatten(),
          });
      }
      const base = abrirDB();
      const existente = base
        .prepare("SELECT * FROM store WHERE id = ?")
        .get(request.params.id);
      if (!existente)
        return reply.code(404).send({ error: "Tienda no encontrada." });

      const d = parseado.data;
      if (d.adapter && d.adapter !== "manual" && !adaptadores.has(d.adapter)) {
        return reply
          .code(400)
          .send({ error: `Adaptador «${d.adapter}» no disponible.` });
      }
      base
        .prepare(
          `UPDATE store SET
           name = COALESCE(?, name),
           color = COALESCE(?, color),
           website = CASE WHEN ? THEN ? ELSE website END,
           adapter = COALESCE(?, adapter),
           active = COALESCE(?, active)
         WHERE id = ?`,
        )
        .run(
          d.name ?? null,
          d.color ?? null,
          "website" in d ? 1 : 0,
          d.website ?? null,
          d.adapter ?? null,
          d.active === undefined ? null : d.active ? 1 : 0,
          request.params.id,
        );
      const fila = base
        .prepare("SELECT * FROM store WHERE id = ?")
        .get(request.params.id) as FilaTienda;
      return aTienda(fila);
    },
  );

  app.delete<{ Params: { id: string } }>(
    "/api/stores/:id",
    async (request, reply) => {
      const base = abrirDB();
      const resultado = base
        .prepare("DELETE FROM store WHERE id = ?")
        .run(request.params.id);
      if (resultado.changes === 0)
        return reply.code(404).send({ error: "Tienda no encontrada." });
      return { ok: true };
    },
  );

  /** Producto con precio manual (tiendas sin adaptador, §3.4). */
  app.post<{ Params: { id: string } }>(
    "/api/stores/:id/products",
    async (request, reply) => {
      const parseado = zProductoManual.safeParse(request.body);
      if (!parseado.success) {
        return reply
          .code(400)
          .send({
            error: "Datos no válidos.",
            detalle: parseado.error.flatten(),
          });
      }
      const base = abrirDB();
      const tienda = base
        .prepare("SELECT id FROM store WHERE id = ?")
        .get(request.params.id);
      if (!tienda)
        return reply.code(404).send({ error: "Tienda no encontrada." });

      const ajustes = obtenerAjustes(base);
      const datos = parseado.data;
      const id = guardarProducto(base, {
        storeId: request.params.id,
        externalId: `manual-${Date.now()}`,
        name: datos.name,
        format: datos.format ?? null,
        url: datos.url,
        price: datos.price,
        unitPrice: datos.unitPrice ?? null,
        unit: datos.unit ?? null,
        postalCode: ajustes.postalCode,
      });
      return reply.code(201).send({ id, ...datos });
    },
  );

  /** Fuerza la indexación del catálogo de las tiendas que lo necesitan. */
  app.post<{ Querystring: { store?: string } }>(
    "/api/catalog/refresh",
    async (request, reply) => {
      const base = abrirDB();
      const ajustes = obtenerAjustes(base);
      const objetivo = request.query.store;
      const tiendas = (
        base
          .prepare("SELECT id, adapter FROM store WHERE active = 1")
          .all() as { id: string; adapter: string }[]
      ).filter((t) => !objetivo || t.id === objetivo);

      const trabajos = tiendas.map(async (t) => {
        const adaptador = adaptadores.get(t.adapter);
        if (!adaptador?.ensureCatalog)
          return { store: t.id, ok: false, motivo: "sin catálogo que indexar" };
        try {
          await adaptador.ensureCatalog({ postalCode: ajustes.postalCode });
          return { store: t.id, ok: true };
        } catch (error) {
          return {
            store: t.id,
            ok: false,
            motivo: error instanceof Error ? error.message : String(error),
          };
        }
      });
      return { resultados: await Promise.all(trabajos) };
    },
  );
}

function slugUnico(base: ReturnType<typeof abrirDB>, nombre: string): string {
  const base1 =
    nombre
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 40) || "tienda";
  let candidato = base1;
  let n = 1;
  while (base.prepare("SELECT 1 FROM store WHERE id = ?").get(candidato)) {
    n++;
    candidato = `${base1}-${n}`;
  }
  return candidato;
}
