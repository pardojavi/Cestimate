import type { StoreAdapter } from "./types.js";
import { crearAldi } from "./aldi.js";
import { crearConsum } from "./consum.js";
import { crearLidl } from "./lidl.js";
import { crearMercadona } from "./mercadona.js";
import type { DB } from "../lib/db.js";

/**
 * Registro de adaptadores (§4.1). Para añadir una tienda nueva:
 *  1. Crea `src/adapters/mitienda.ts` que exporte `crearMitienda(db): StoreAdapter`.
 *  2. Añádelo aquí y en TIENDA_PREDEFINIDA del sembrado de `db.ts` (o créala
 *     desde la pestaña Tiendas de la UI con `adapter: 'mitienda'`).
 */
export type { StoreAdapter, Contexto } from "./types.js";

export function registrarAdaptadores(db: DB): Map<string, StoreAdapter> {
  const lista: StoreAdapter[] = [
    crearMercadona(db),
    crearConsum(db),
    crearAldi(db),
    crearLidl(db),
  ];
  return new Map(lista.map((a) => [a.id, a]));
}
