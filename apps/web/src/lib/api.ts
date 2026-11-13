import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import type {
  BasketSummary,
  SearchResponse,
  Settings,
  Store,
  StoreProduct,
  UnidadCantidad,
} from "@cestimate/shared";

/* ------------------------------------------------------------------ */
/* Cliente HTTP                                                        */
/* ------------------------------------------------------------------ */

/**
 * Base de la API, incorporada en el propio build (archivo
 * `apps/web/.env.production` → variable `VITE_API_URL`). En desarrollo
 * queda vacía y las peticiones `/api` van al proxy de Vite. El usuario no
 * tiene que configurar nada.
 */
export function obtenerBaseApi(): string {
  return (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
}

export class ErrorApi extends Error {}

export async function pedir<T>(
  ruta: string,
  opciones: RequestInit = {},
): Promise<T> {
  const base = obtenerBaseApi();
  let respuesta: Response;
  try {
    respuesta = await fetch(`${base}${ruta}`, {
      ...opciones,
      // Content-Type solo si hay cuerpo: Fastify rechaza un body vacío con
      // application/json (afectaba a DELETE y a POST sin datos).
      headers: {
        ...(opciones.body ? { "Content-Type": "application/json" } : {}),
        ...opciones.headers,
      },
    });
  } catch {
    throw new ErrorApi(
      "No se puede contactar con el servidor de Cestimate. Si hace poco que no lo usas, puede estar arrancando (~1 min): inténtalo de nuevo.",
    );
  }
  const datos = (await respuesta.json().catch(() => null)) as {
    error?: string;
  } | null;
  if (!respuesta.ok) {
    throw new ErrorApi(datos?.error ?? `Error ${respuesta.status} de la API.`);
  }
  return datos as T;
}

/* ------------------------------------------------------------------ */
/* Tipos de la API                                                     */
/* ------------------------------------------------------------------ */

export interface ItemCesta {
  id: number;
  genericName: string;
  qty: number;
  /** «kg» = la cantidad es un peso (€/kg × kg); «ud» = unidades. */
  qtyUnit: UnidadCantidad;
  matches: Record<
    string,
    {
      storeId: string;
      productId: number;
      product: {
        name: string;
        format: string | null;
        price: number;
        unitPrice: number | null;
        unit: string | null;
        url: string;
        imageUrl: string | null;
        fetchedAt: string;
      };
    }
  >;
}

export interface CestaGuardada {
  id: number;
  date: string;
  description: string;
  created_at: string;
  totals: { storeId: string; storeName: string; total: number }[];
}

export interface DetalleGuardada extends Omit<CestaGuardada, "totals"> {
  lines: {
    id: number;
    genericName: string;
    qty: number;
    qtyUnit: UnidadCantidad;
    storeId: string;
    storeName: string;
    productName: string | null;
    priceAtSave: number | null;
    unitPriceAtSave: number | null;
    unitPriceNow: number | null;
    unit: string | null;
    url: string | null;
    priceNow: number | null;
    fetchedNow: string | null;
  }[];
  totals: { storeId: string; storeName: string; total: number }[];
}

export interface Stats {
  baskets: {
    basketId: number;
    date: string;
    values: { storeId: string; storeName: string; total: number }[];
  }[];
  products: {
    productId: number;
    name: string;
    storeId: string;
    storeName: string;
    points: { date: string; price: number }[];
  }[];
}

export interface ResumenStats {
  savedBaskets: number;
  cheapestWins: { store: string; count: number }[];
  totalSaving: number;
  comparisons: number;
  biggestDiffs: {
    name: string;
    min: number;
    max: number;
    diff: number;
    stores: number;
  }[];
}

/* ------------------------------------------------------------------ */
/* Queries                                                             */
/* ------------------------------------------------------------------ */

export function useTiendas() {
  return useQuery({
    queryKey: ["stores"],
    queryFn: () => pedir<Store[]>("/api/stores"),
  });
}

export function useBusqueda(
  q: string,
  opciones: Partial<UseQueryOptions<SearchResponse>> & {
    /** Restringe la búsqueda a una tienda (p. ej. el selector de la Cesta). */
    stores?: string;
  } = {},
) {
  const { stores, ...resto } = opciones;
  const params = new URLSearchParams({ q });
  if (stores) params.set("stores", stores);
  return useQuery({
    queryKey: ["search", q, stores ?? ""],
    queryFn: () => pedir<SearchResponse>(`/api/search?${params.toString()}`),
    enabled: q.trim().length >= 2 && (resto.enabled ?? true),
    staleTime: 60_000,
    ...resto,
  });
}

export function useCesta() {
  return useQuery({
    queryKey: ["basket"],
    queryFn: () => pedir<{ items: ItemCesta[] }>("/api/basket"),
  });
}

export function useResumen(soloComunes: boolean) {
  return useQuery({
    queryKey: ["summary", soloComunes],
    queryFn: () =>
      pedir<BasketSummary>(
        `/api/basket/summary${soloComunes ? "?comunes=1" : ""}`,
      ),
  });
}

export function useGuardadas() {
  return useQuery({
    queryKey: ["saved"],
    queryFn: () => pedir<CestaGuardada[]>("/api/saved-baskets"),
  });
}

export function useGuardada(id: number | null) {
  return useQuery({
    queryKey: ["saved", id],
    queryFn: () => pedir<DetalleGuardada>(`/api/saved-baskets/${id}`),
    enabled: id !== null,
  });
}

export function useStats() {
  return useQuery({
    queryKey: ["stats"],
    queryFn: () => pedir<Stats>("/api/stats/series"),
  });
}

export function useResumenStats() {
  return useQuery({
    queryKey: ["stats", "summary"],
    queryFn: () => pedir<ResumenStats>("/api/stats/summary"),
  });
}

export function useAjustes() {
  return useQuery({
    queryKey: ["settings"],
    queryFn: () => pedir<Settings>("/api/settings"),
  });
}

/* ------------------------------------------------------------------ */
/* Mutaciones                                                          */
/* ------------------------------------------------------------------ */

function invalidar(
  queryClient: ReturnType<typeof useQueryClient>,
  ...claves: string[][]
) {
  for (const c of claves) queryClient.invalidateQueries({ queryKey: c });
}

export function useAnadirArticulo() {
  const qc = useQueryClient();
  return useMutation({
    /**
     * Añade un artículo a la cesta. `productos` puede llevar varios (uno
     * por tienda): todos se emparejan de golpe y el artículo queda listo
     * para comparar. Si un producto no tiene `localId` se crea el artículo
     * sin ese emparejamiento (se podrá elegir luego desde la Cesta).
     *
     * `qty`/`qtyUnit` llegan desde Buscar cuando hay peso puesto: el
     * artículo nace en modo kg y la cuesta cobra €/kg × kg.
     */
    mutationFn: async ({
      productos,
      qty,
      qtyUnit,
    }: {
      productos: StoreProduct[];
      qty?: number;
      qtyUnit?: UnidadCantidad;
    }) => {
      if (productos.length === 0)
        throw new ErrorApi("No has seleccionado ningún producto.");
      // Un solo producto por tienda: si se repite, gana el último.
      const porTienda = new Map<string, StoreProduct>();
      for (const p of productos) if (p.localId) porTienda.set(p.storeId, p);
      const creado = await pedir<{ id: number }>("/api/basket/items", {
        method: "POST",
        body: JSON.stringify({
          genericName: productos[0]!.name,
          qty: qty ?? 1,
          qtyUnit: qtyUnit ?? "ud",
          matches: [...porTienda.values()].map((p) => ({
            storeId: p.storeId,
            productId: p.localId!,
          })),
        }),
      });
      return creado;
    },
    onSuccess: () => invalidar(qc, ["basket"], ["summary"]),
  });
}

export function useActualizarArticulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      ...datos
    }: {
      id: number;
      genericName?: string;
      qty?: number;
      qtyUnit?: UnidadCantidad;
    }) =>
      pedir(`/api/basket/items/${id}`, {
        method: "PATCH",
        body: JSON.stringify(datos),
      }),
    onSuccess: () => invalidar(qc, ["basket"], ["summary"]),
  });
}

export function useEliminarArticulo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      pedir(`/api/basket/items/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidar(qc, ["basket"], ["summary"]),
  });
}

export function useElegirProducto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      itemId,
      storeId,
      productId,
    }: {
      itemId: number;
      storeId: string;
      productId: number;
    }) =>
      pedir(`/api/basket/items/${itemId}/match/${storeId}`, {
        method: "PUT",
        body: JSON.stringify({ productId }),
      }),
    onSuccess: () => invalidar(qc, ["basket"], ["summary"]),
  });
}

export function useQuitarProducto() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ itemId, storeId }: { itemId: number; storeId: string }) =>
      pedir(`/api/basket/items/${itemId}/match/${storeId}`, {
        method: "DELETE",
      }),
    onSuccess: () => invalidar(qc, ["basket"], ["summary"]),
  });
}

export function useActualizarPrecios() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      pedir<{ resultados: { store: string; ok: boolean; motivo?: string }[] }>(
        "/api/basket/refresh",
        { method: "POST" },
      ),
    onSuccess: () => invalidar(qc, ["basket"], ["summary"], ["stats"]),
  });
}

export function useGuardarCesta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      date,
      description,
    }: {
      date: string;
      description: string;
    }) =>
      pedir<{ id: number }>("/api/saved-baskets", {
        method: "POST",
        body: JSON.stringify({ date, description }),
      }),
    onSuccess: () => invalidar(qc, ["saved"], ["stats"]),
  });
}

export function useCargarCesta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      pedir(`/api/saved-baskets/${id}/load`, { method: "POST" }),
    onSuccess: () => invalidar(qc, ["basket"], ["summary"]),
  });
}

export function useEliminarCesta() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: number) =>
      pedir(`/api/saved-baskets/${id}`, { method: "DELETE" }),
    onSuccess: () => invalidar(qc, ["saved"], ["stats"]),
  });
}

export function useGuardarAjustes() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (datos: Partial<Settings>) =>
      pedir<Settings>("/api/settings", {
        method: "PUT",
        body: JSON.stringify(datos),
      }),
    onSuccess: () => invalidar(qc, ["settings"]),
  });
}

export function useTiendaMutations() {
  const qc = useQueryClient();
  const invalidarTiendas = () => invalidar(qc, ["stores"]);
  return {
    crear: useMutation({
      mutationFn: (datos: {
        name: string;
        color?: string;
        website?: string | null;
        adapter?: string;
      }) =>
        pedir<Store>("/api/stores", {
          method: "POST",
          body: JSON.stringify(datos),
        }),
      onSuccess: invalidarTiendas,
    }),
    editar: useMutation({
      mutationFn: ({
        id,
        ...datos
      }: {
        id: string;
        name?: string;
        color?: string;
        website?: string | null;
        adapter?: string;
        active?: boolean;
      }) =>
        pedir<Store>(`/api/stores/${id}`, {
          method: "PATCH",
          body: JSON.stringify(datos),
        }),
      onSuccess: invalidarTiendas,
    }),
    eliminar: useMutation({
      mutationFn: (id: string) =>
        pedir(`/api/stores/${id}`, { method: "DELETE" }),
      onSuccess: invalidarTiendas,
    }),
    anadirProductoManual: useMutation({
      mutationFn: ({
        storeId,
        ...datos
      }: {
        storeId: string;
        name: string;
        price: number;
        url: string;
        format?: string | null;
      }) =>
        pedir(`/api/stores/${storeId}/products`, {
          method: "POST",
          body: JSON.stringify(datos),
        }),
      onSuccess: invalidarTiendas,
    }),
  };
}

export interface IdentificacionCodigo {
  code: string;
  encontrado: boolean;
  nombre: string | null;
  marca: string | null;
  consulta: string | null;
  fuente: string;
  fuenteUrl: string;
  fechaConsulta: string;
}

/**
 * Término de búsqueda para una identificación de código de barras.
 *
 * Regla: **si hay chip, hay búsqueda** (nunca un chip sin resultados ni
 * aviso). Se busca el nombre solo —sin la marca, que no aparece en los
 * nombres de las tiendas (usan su propia marca: Hacendado, Consum…)— y,
 * si OFF solo conoce la marca, `consulta` (la propia marca) para que el
 * campo quede relleno y editable. `null` cuando no hay nada que buscar
 * (código no reconocido: el aviso §6.4 invita a escribirlo a mano).
 */
export function terminoDeBusqueda(ident: IdentificacionCodigo): string | null {
  if (!ident.encontrado) return null;
  return (ident.nombre ?? ident.consulta)?.trim() || null;
}

export function useIdentificarCodigo() {
  return useMutation({
    mutationFn: (codigo: string) =>
      pedir<IdentificacionCodigo>(`/api/barcode/${encodeURIComponent(codigo)}`),
  });
}

export function useBorrarCache() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      pedir<{ message: string }>("/api/cache/clear", { method: "POST" }),
    onSuccess: () => invalidar(qc, ["search"], ["settings"]),
  });
}

export function useReindexar() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      pedir<{ resultados: { store: string; ok: boolean; motivo?: string }[] }>(
        "/api/catalog/refresh",
        { method: "POST" },
      ),
    onSuccess: () => invalidar(qc, ["search"], ["stores"]),
  });
}
