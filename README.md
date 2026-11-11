# Cestimate

**Compara tu cesta, no tus precios.**

Cestimate es una webapp (mobile-first, pensada para iPhone) para comparar el precio de una cesta de la compra entre supermercados españoles —**Mercadona, Consum, Aldi y Lidl**— con precios obtenidos de las webs reales de cada tienda. Cada resultado muestra el **enlace a la página del producto** y la **fecha de consulta**: nunca se inventan precios.

- Idioma: **español (es-ES)** · Moneda: **EUR** (`1.234,56 €`)
- Estética: ticket / etiqueta de precio (verde `#2F6F4E`, papel `#EEF1E6`, rojo `#C23B32`)

---

## Cómo funciona

| Pestaña       | Qué hace                                                                                                                                                             |
| ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Buscador**  | Busca un producto en todas las tiendas activas en paralelo; cada tienda informa de su estado (ok / sin resultados / error / indexando) de forma independiente.       |
| **Cesta**     | Artículos genéricos con cantidad; por cada tiendas eliges qué producto real lo representa. Resumen con total por tienda, precio mínimo por fila, faltantes y ahorro. |
| **Gráficas**  | Total por tienda, precio por artículo, evolución temporal y estadísticas de ahorro (Recharts).                                                                       |
| **Historial** | Guarda «fotos» de precios con fecha y descripción; compara el precio guardado con el actual.                                                                         |
| **Tiendas**   | Alta/edición/baja de tiendas, activar/desactivar y productos manuales con URL de verificación. Desde su cabecera se abre **Ajustes**.                                |

**Ajustes** no es pestaña: se abre con el botón de la cabecera de Tiendas. Contiene código postal, antigüedad de la caché (radiogroup 6/12/24 h), URL de la API (para GitHub Pages), borrado de caché, reindexación y la cobertura de cada tienda.

## Requisitos

- **Node ≥ 22** (probado con Node 24; `better-sqlite3` 13 lo exige). Si usas nvm: `nvm use 24`.
- Sin dependencias de sistema: `better-sqlite3` se instala con binario precompilado.

## Instalación y arranque

```bash
git clone https://github.com/TU-USUARIO/cestimate.git
cd cestimate
npm install

# Desarrollo (API en :8787 + web en :5173 con proxy)
npm run dev

# Solo API / solo web
npm run dev:api
npm run dev:web
```

- Web: <http://localhost:5173>
- API: <http://localhost:8787/api/health>

### Tests y build

```bash
npm test          # vitest: contratos de adaptadores (fixtures reales) + cesta
npm run build     # tsc (api y web) + vite build
npm run iconos    # regenera los PNG del icono (usa sharp, ya instalado)
```

### Variables de entorno

Copia `.env.example` a `.env` y ajusta (todos opcionales):

| Variable              | Por defecto           | Descripción                                          |
| --------------------- | --------------------- | ---------------------------------------------------- |
| `PORT`                | `8787`                | Puerto de la API                                     |
| `CORS_ORIGIN`         | `*`                   | Orígenes permitidos (en producción, la URL de Pages) |
| `DATABASE_PATH`       | `./data/cestimate.db` | Ruta de SQLite (se crea solo)                        |
| `TTL_HOURS`           | `12`                  | TTL de caché de búsquedas (6–24 h recomendado)       |
| `USER_AGENT`          | `Cestimate/1.0 (…)`   | User-Agent **identificable** enviado a las tiendas   |
| `DEFAULT_POSTAL_CODE` | `28001`               | Código postal por defecto                            |

---

## Despliegue (GitHub Pages + API en la nube)

La web es **estática** (GitHub Pages) y la API corre en un servidor con Node y disco persistente.

1. **API en la nube** — Despliega `apps/api` en Render / Railway / Fly.io / un VPS:
   - Comando de arranque: `npm run start -w apps/api` (o `npm start` en la raíz).
   - Monta un volumen en `DATABASE_PATH` (p. ej. `/data/cestimate.db`) para no perder la cesta y el histórico.
   - Configura `CORS_ORIGIN=https://TU-USUARIO.github.io`.
2. **Web en GitHub Pages** — El workflow `.github/workflows/deploy.yml` compila, testea y publica `apps/web/dist` en Pages en cada push a `main`:
   - En el repo: _Settings → Pages → Source: GitHub Actions_.
   - Tras el primer despliegue, abre la app → **Ajustes → URL de la API** y pega la URL de tu API (p. ej. `https://cestimate-api.onrender.com`). Se guarda en el dispositivo (`localStorage`).
3. `vite.config.ts` usa `base: './'`, así que funciona bajo `/cestimate/` sin configuración extra.

## Añadir una tienda nueva

1. Crea `apps/api/src/adapters/mitienda.ts` exportando `crearMitienda(db): StoreAdapter` (ver `types.ts`; `search` y `getProduct` son suficientes).
2. Regístrala en `registrarAdaptadores()` (`apps/api/src/adapters/index.ts`).
3. Añade su color en `COLORES_TIENDA` (`packages/shared/src/index.ts`).
4. Crea la tienda desde la pestaña **Tiendas** de la UI (o siémbrala en `db.ts`).

## Cómo se obtienen los precios (importante)

**Regla de oro: nunca se inventa un precio.** Toda cifra mostrada procede de una respuesta real de la tienda, con su URL de origen y fecha de consulta; si una tienda falla, se muestra el motivo y los resultados de las demás siguen apareciendo (aislamiento por tienda). Cada respuesta externa se valida con **Zod** antes de usarla: si el formato cambia, se informa del error en lugar de mostrar datos dudosos.

| Tienda        | Fuente real                                                                                            | Cobertura                                                                                                                                                              | Nota sobre robots.txt                                                                                                                                                                                                                                                                                                                                        |
| ------------- | ------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Mercadona** | `GET https://tienda.mercadona.es/api/categories/{id}/` con cabecera `x-version: v10137`                | Catálogo completo: se indexan ~152 subcategorías en SQLite (≈4.700 productos con precio) y se busca en local. La primera búsqueda tarda ~15 s; después es instantánea. | ⚠️ Su `robots.txt` incluye `Disallow: /api`. El uso de esta API pública JSON **está documentado aquí como decisión explícita del desarrollador**; respeta los límites de tasa de este proyecto (concurrencia 3, 120 ms de espera, caché 6–24 h, User-Agent identificable). Si eres propietario del sitio y quieres que se deje de consultar, abre una issue. |
| **Consum**    | `GET https://tienda.consum.es/api/rest/V1.0/catalog/product?q=…&offset=…`                              | Búsqueda directa (30 páginas × 20 resultados como máximo), filtrado en local.                                                                                          | ⚠️ Su `robots.txt` incluye `Disallow: /api/`. Misma decisión documentada: uso puntual con caché, User-Agent identificable y sin sobrecarga.                                                                                                                                                                                                                  |
| **Aldi**      | API de búsqueda Algolia pública (clave embebida en su propio JS): `an_prd_es_es_pen_products2`         | Catálogo online de aldi.es (surtido **parcial** frente a la tienda física; no todos los productos del lineal).                                                         | Su `robots.txt` no prohíbe ni la búsqueda ni las páginas de producto.                                                                                                                                                                                                                                                                                        |
| **Lidl**      | Sitemap de productos (`product_sitemap.xml.gz`, ~7.700 URLs) + JSON-LD `Product` de cada página `/p/…` | Catálogo **online** de lidl.es: mayoritariamente **no alimentación** (la alimentación suele estar en el folleto semanal). Se leen como máximo 5 páginas por búsqueda.  | Su `robots.txt` permite `/p/`.                                                                                                                                                                                                                                                                                                                               |

Otras buenas prácticas aplicadas: timeout de 10 s por petición, reintentos con backoff, errores 4xx sin reintentar, y caché con TTL configurable.

> **Aviso legal:** este proyecto es una herramienta personal de comparación. Los precios pueden variar por tienda, fecha y disponibilidad; comprueba siempre el enlace de origen. Antes de publicar la marca, comprueba disponibilidad de dominio y marcas (OEPM) según el apartado 0 del AGENT.md.

## Estructura del repositorio

```
apps/api/        Fastify + SQLite (better-sqlite3) + adaptadores por tienda
  src/adapters/  mercadona.ts · consum.ts · aldi.ts · lidl.ts
  src/routes/    search · basket · saved · stats · stores · settings
  tests/         contrato.test.ts (fixtures reales) · cesta.test.ts
apps/web/        React + Vite + TanStack Query + Recharts (5 pestañas + Ajustes)
packages/shared/ Tipos, esquemas Zod y constantes de marca compartidos
branding/        Icono original (SVG)
scripts/         Generación de iconos PNG (sharp)
```

## Ruta crítica de datos

`price_snapshot.fetched_at` guarda siempre ISO-8601; el helper `aISO()` normaliza tanto el formato de SQLite (`YYYY-MM-DD HH:MM:SS`) como ISO con `Z` al servirlo.

## Licencia

MIT
