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
    storeId: string;
    storeName: string;
    productName: string | null;
    priceAtSave: number | null;
    unitPriceAtSave: number | null;
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
  opciones: Partial<UseQueryOptions<SearchResponse>> = {},
) {
  return useQuery({
    queryKey: ["search", q],
    queryFn: () =>
      pedir<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`),
    enabled: q.trim().length >= 2 && (opciones.enabled ?? true),
    staleTime: 60_000,
    ...opciones,
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
    mutationFn: async (datos: { producto: StoreProduct }) => {
      const { producto } = datos;
      const creado = await pedir<{ id: number }>("/api/basket/items", {
        method: "POST",
        body: JSON.stringify({ genericName: producto.name, qty: 1 }),
      });
      if (producto.localId) {
        await pedir(
          `/api/basket/items/${creado.id}/match/${producto.storeId}`,
          {
            method: "PUT",
            body: JSON.stringify({ productId: producto.localId }),
          },
        );
      }
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
