import { z } from "zod";

/**
 * Cestimate — tipos y esquemas compartidos entre apps/api y apps/web.
 * Idioma es-ES, moneda EUR.
 */

/* ------------------------------------------------------------------ */
/* Marca                                                               */
/* ------------------------------------------------------------------ */

export const MARCA = {
  nombre: "Cestimate",
  eslogan: "Compara tu cesta, no tus precios.",
  verde: "#2F6F4E",
  papel: "#EEF1E6",
  tinta: "#1E2A22",
  rojo: "#C23B32",
  azul: "#2B5D8C",
  verdeClaro: "#DCEBDD",
} as const;

/** Colores por tienda (sección 7 del AGENT.md). */
export const COLORES_TIENDA: Record<string, string> = {
  mercadona: "#2F6F4E",
  consum: "#E08E2B",
  aldi: "#2B5D8C",
  lidl: "#C23B32",
};

/* ------------------------------------------------------------------ */
/* Modelo de datos (§5)                                                */
/* ------------------------------------------------------------------ */

export const zUnit = z.enum(["kg", "L", "ud"]);

export const zStoreProduct = z.object({
  storeId: z.string(),
  externalId: z.string(),
  name: z.string(),
  format: z.string().nullable().optional(),
  price: z.number().nonnegative(),
  unitPrice: z
    .object({
      value: z.number().nonnegative(),
      unit: zUnit,
    })
    .nullable()
    .optional(),
  imageUrl: z.string().nullable().optional(),
  url: z.string(),
  fetchedAt: z.string(),
  /** Id local en SQLite (para poder elegirlo en la cesta). */
  localId: z.number().optional(),
});

export type StoreProduct = z.infer<typeof zStoreProduct>;

/** Estado de una tienda dentro de una búsqueda (§3.1). */
export type StoreSearchStatus = "ok" | "sin-resultados" | "error" | "indexando";

export interface StoreSearchResult {
  storeId: string;
  storeName: string;
  status: StoreSearchStatus;
  /** Motivo legible del fallo o del estado (nunca precios inventados). */
  message?: string;
  products: StoreProduct[];
  fetchedAt: string | null;
}

export interface SearchResponse {
  query: string;
  results: StoreSearchResult[];
}

export interface Store {
  id: string;
  name: string;
  color: string;
  website: string | null;
  adapter: string;
  active: boolean;
  createdAt: string;
}

export interface BasketItem {
  id: number;
  genericName: string;
  qty: number;
  matches: Record<string, BasketMatch>;
}

export interface BasketMatch {
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

export interface BasketSummaryStore {
  storeId: string;
  storeName: string;
  color: string;
  total: number | null;
  missing: number;
  complete: boolean;
}

export interface BasketSummary {
  stores: BasketSummaryStore[];
  /** Total más barato entre tiendas completas (null si no hay ninguna). */
  cheapest: string | null;
  /** Ahorro frente a la tienda más cara (entre tiendas completas). */
  saving: number | null;
  rows: {
    basketItemId: number;
    genericName: string;
    qty: number;
    cells: {
      storeId: string;
      price: number | null;
      cheapest: boolean;
    }[];
  }[];
}

/* ------------------------------------------------------------------ */
/* Ajustes (§3.7)                                                      */
/* ------------------------------------------------------------------ */

export const zSettings = z.object({
  postalCode: z.string().regex(/^\d{5}$/, "Código postal de 5 dígitos"),
  ttlHours: z.number().int().min(1).max(168),
});

export type Settings = z.infer<typeof zSettings>;

/* ------------------------------------------------------------------ */
/* Esquemas de respuestas externas (§4.3 — validar en el borde)         */
/* ------------------------------------------------------------------ */

/** Mercadona: GET /api/categories/{id}/ (verificado en vivo 2026-11-11). */
export const zMercadonaCategory = z.object({
  id: z.number(),
  name: z.string(),
  categories: z.array(z.any()).optional(),
  products: z.array(z.any()).optional(),
});

export const zMercadonaPriceInstructions = z.object({
  bulk_price: z.string(),
  unit_price: z.string().nullable().optional(),
  size_format: z.string().nullable().optional(),
  unit_size: z.number().nullable().optional(),
  reference_price: z.string().nullable().optional(),
  previous_unit_price: z.string().nullable().optional(),
});

export const zMercadonaProduct = z.object({
  id: z.union([z.string(), z.number()]),
  display_name: z.string().optional(),
  slug: z.string().optional(),
  thumbnail: z.string().nullable().optional(),
  price_instructions: zMercadonaPriceInstructions,
});

/** Consum: GET /api/rest/V1.0/catalog/product?q= (verificado en vivo). */
export const zConsumResponse = z.object({
  totalCount: z.number(),
  products: z.array(
    z.object({
      id: z.union([z.string(), z.number()]),
      code: z.string().optional(),
      ean: z.string().nullable().optional(),
      // `productData.imageURL` está caducada (404); las URLs válidas están
      // en `media[].url` (verificado en vivo 2026-11-11).
      media: z
        .array(
          z.object({
            url: z.string(),
            order: z.number().optional(),
            type: z.string().optional(),
          }),
        )
        .nullable()
        .optional(),
      productData: z.object({
        name: z.string(),
        description: z.string().nullable().optional(),
        url: z.string(),
        imageURL: z.string().nullable().optional(),
      }),
      priceData: z.object({
        prices: z.array(
          z.object({
            value: z.object({
              centAmount: z.number(),
            }),
          }),
        ),
        unitPriceUnitType: z.string().nullable().optional(),
      }),
    }),
  ),
});

/** Aldi: Algolia index an_prd_es_es_pen_products2 (clave pública en su JS). */
export const zAldiResponse = z.object({
  nbHits: z.number(),
  hits: z.array(
    z.object({
      objectID: z.string(),
      name: z.string(),
      productSlug: z.string().nullable().optional(),
      brandName: z.string().nullable().optional(),
      salesUnit: z.string().nullable().optional(),
      isAvailable: z.boolean().optional(),
      isComingSoon: z.boolean().optional(),
      isRecall: z.boolean().optional(),
      currentPrice: z
        .object({
          priceValue: z.number(),
        })
        .nullable()
        .optional(),
      assets: z
        .array(
          z.object({
            type: z.string(),
            url: z.string(),
          }),
        )
        .nullable()
        .optional(),
    }),
  ),
});

/** Lidl: JSON-LD Product en las páginas /p/... (verificado en vivo). */
export const zLidlJsonLd = z.object({
  "@type": z.literal("Product"),
  sku: z.string().optional(),
  name: z.string(),
  image: z.union([z.string(), z.array(z.string())]).optional(),
  brand: z.union([z.object({ name: z.string() }), z.string()]).optional(),
  offers: z
    .union([
      z.object({
        price: z.union([z.string(), z.number()]),
        priceCurrency: z.string().optional(),
        url: z.string().optional(),
        availability: z.string().optional(),
      }),
      z.array(
        z.object({
          price: z.union([z.string(), z.number()]),
          priceCurrency: z.string().optional(),
          url: z.string().optional(),
          availability: z.string().optional(),
        }),
      ),
    ])
    .optional(),
});

/* ------------------------------------------------------------------ */
/* Tipos inferidos de los esquemas externos                            */
/* ------------------------------------------------------------------ */

export type MercadonaCategory = z.infer<typeof zMercadonaCategory>;
export type MercadonaProduct = z.infer<typeof zMercadonaProduct>;
export type ConsumResponse = z.infer<typeof zConsumResponse>;
export type AldiResponse = z.infer<typeof zAldiResponse>;
export type AldiHit = AldiResponse["hits"][number];
export type ConsumProduct = ConsumResponse["products"][number];
export type LidlJsonLd = z.infer<typeof zLidlJsonLd>;

/* ------------------------------------------------------------------ */
/* Utilidades                                                          */
/* ------------------------------------------------------------------ */

/** Normaliza texto para búsqueda local (minúsculas y sin tildes). */
export function normalizar(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

/**
 * Tokeniza una consulta de búsqueda: normaliza, parte por espacios y separa
 * los tokens que mezclan letras y cifras («1l» → «1», «l») para que las
 * unidades no se exijan como texto literal.
 */
export function tokenizar(texto: string): string[] {
  return normalizar(texto)
    .split(/\s+/)
    .filter(Boolean)
    .flatMap((t) => t.match(/[a-z]+|[0-9]+/g) ?? [t]);
}

/**
 * Términos que se exigen en un texto: los de 2+ caracteres («leche»,
 * «entera»). Los términos cortos («1», «l») suelen ser ruido de formato y
 * solo puntúan; si la consulta no tiene ninguno de 2+, se exigen todos.
 */
export function terminosExigidos(terminos: string[]): string[] {
  const largos = terminos.filter((t) => t.length >= 2);
  return largos.length > 0 ? largos : terminos;
}

/**
 * ¿Coincide el texto con la consulta de forma flexible? Se exigen todos los
 * términos relevantes (sin obligar a que aparezcan números o unidades), lo
 * que permite encontrar «Leche Entera Brik» con la consulta «leche entera 1 l».
 */
export function coincideFlex(texto: string, terminos: string[]): boolean {
  if (terminos.length === 0) return false;
  const norm = normalizar(texto);
  return terminosExigidos(terminos).every((t) => norm.includes(t));
}

/** Divisa es-ES. */
export function formatoEUR(valor: number): string {
  return new Intl.NumberFormat("es-ES", {
    style: "currency",
    currency: "EUR",
  }).format(valor);
}

/** Normaliza un valor guardado (SQLite `YYYY-MM-DD HH:MM:SS` o ISO) a ISO-8601 con Z. */
export function aISO(valor: string): string {
  const s = valor.trim();
  if (!/^\d{4}-\d{2}-\d{2}[ T]/.test(s)) return s;
  const base = s.replace(" ", "T");
  // Si ya trae zona horaria (Z o ±hh:mm), no la tocamos.
  return /[zZ]$|[+-]\d{2}:?\d{2}$/.test(base) ? base : `${base}Z`;
}

/** Fecha/hora es-ES. */
export function formatoFecha(iso: string): string {
  return new Date(iso).toLocaleString("es-ES", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/** Fecha es-ES. */
export function formatoDia(iso: string): string {
  return new Date(iso).toLocaleDateString("es-ES", { dateStyle: "long" });
}

/** Tiempo relativo en español («hace 2 min»). */
export function haceTiempo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  if (!Number.isFinite(diff)) return "";
  if (diff < 60_000) return "hace un momento";
  const min = Math.floor(diff / 60_000);
  if (min < 60) return `hace ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `hace ${h} h`;
  const d = Math.floor(h / 24);
  return `hace ${d} d`;
}
