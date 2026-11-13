# AGENT.md — Cestimate

**Cestimate** es una webapp para comparar el precio de una cesta de la compra entre supermercados españoles (Mercadona, Consum, Aldi, Lidl y tiendas añadidas por el usuario), con precios obtenidos de las webs reales.

Idioma de la interfaz, textos y comentarios de producto: **español (es-ES)**. Moneda: EUR, formato `es-ES`.

---

## 0. Identidad de marca

- **Nombre:** Cestimate (de _cesta_ + _estimate_: la estimación de lo que te costará la cesta). Se escribe siempre con mayúscula inicial y sin acento.
- **Eslogan sugerido (editable):** «Compara tu cesta, no tus precios.»
- Usar el nombre en: `<title>` de la página, cabecera de la app, manifest, README, `package.json` y metadatos.
- Antes de publicar: comprobar disponibilidad del dominio, de las tiendas de apps y de la marca en la OEPM (una búsqueda web no prueba que esté libre).

### Icono

Cesta de color papel sobre fondo verde, con una etiqueta de precio roja con el símbolo del euro. Sin texto, así que no depende del nombre. Colores de la paleta de la app: verde `#2F6F4E`, papel `#EEF1E6`, rojo `#C23B32`.

- Guardar el SVG original en `apps/web/public/icon.svg` (copia en `branding/icon.svg`). El archivo `icono-app.svg` que acompaña a este documento es el original; si no está disponible, el código completo está justo debajo.
- A partir de él, generar: `favicon.ico` (32×32), `icon-192.png`, `icon-512.png` y `apple-touch-icon.png` (180×180). Para el PNG de la tienda de apps, 1024×1024.
- Enlazar `favicon`, `apple-touch-icon` y un `manifest.webmanifest` (con `name: "Cestimate"`, `theme_color: "#2F6F4E"`, `background_color: "#EEF1E6"`) desde `index.html`.
- Para un icono maskable (Android), añadir un margen de seguridad alrededor de la cesta y usar fondo verde sin esquinas redondeadas.
- En la cabecera de la app usar una versión pequeña del icono junto al nombre.

Código del SVG (512×512):

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512" role="img" aria-label="Cestimate: cesta con etiqueta de precio">
  <rect width="512" height="512" rx="112" fill="#2F6F4E"/>

  <!-- Asa de la cesta -->
  <path d="M176 236 C176 148 336 148 336 236" fill="none" stroke="#EEF1E6" stroke-width="24" stroke-linecap="round"/>

  <!-- Cuerpo de la cesta -->
  <path d="M104 236 H408 L372 394 Q368 410 352 410 H160 Q144 410 140 394 Z" fill="#EEF1E6" stroke="#EEF1E6" stroke-width="12" stroke-linejoin="round"/>

  <!-- Listones -->
  <g stroke="#2F6F4E" stroke-width="14" stroke-linecap="round">
    <line x1="196" y1="274" x2="204" y2="372"/>
    <line x1="256" y1="274" x2="256" y2="372"/>
    <line x1="316" y1="274" x2="308" y2="372"/>
  </g>

  <!-- Etiqueta de precio -->
  <g transform="translate(366 184) rotate(16) scale(1.5)">
    <path d="M-52 0 L-24 -36 H52 V36 H-24 Z" fill="#C23B32" stroke="#2F6F4E" stroke-width="9" stroke-linejoin="round" paint-order="stroke"/>
    <circle cx="-27" cy="0" r="6" fill="#2F6F4E"/>
    <g fill="none" stroke="#FFFFFF" stroke-width="4.5" stroke-linecap="round">
      <path d="M32 -12 A16 16 0 1 0 32 12"/>
      <line x1="4" y1="-4" x2="30" y2="-4"/>
      <line x1="4" y1="4" x2="30" y2="4"/>
    </g>
  </g>
</svg>
```

---

## 1. Objetivo y lección aprendida

Hubo un prototipo previo: un componente React de un solo archivo que corría en el navegador. Funcionaba para la UI, pero **no puede obtener precios reales**: los supermercados no ofrecen API pública oficial, bloquean CORS y el scraping desde cliente. Se intentó parchear con búsqueda web de un LLM y resultó poco fiable (precios inventados, dominios mal configurados, fallos en Consum).

**Decisión de arquitectura para esta versión: necesita backend.** Los precios se obtienen en servidor, con un adaptador por tienda, se cachean y se sirven al frontend. El LLM no es la fuente de precios.

---

## 2. Stack propuesto

- **Frontend:** React + TypeScript + Vite, Tailwind (o CSS modules), Recharts para gráficas, lucide-react para iconos, TanStack Query para datos remotos.
- **Backend:** Node.js + TypeScript con Fastify (o Express). Un único proceso.
- **Base de datos:** SQLite (better-sqlite3 + Drizzle u otro ORM ligero). Un archivo local, sin infraestructura.
- **Validación:** Zod en los bordes (respuestas de tiendas y API propia).
- **Tests:** Vitest. Tests de contrato por adaptador con respuestas grabadas (fixtures).
- Monorepo simple: `apps/web`, `apps/api`, `packages/shared` (tipos), `branding/` (icono y recursos de marca). Nombre del paquete raíz: `cestimate`.

Si algo del stack no encaja, proponer alternativa antes de implementar y justificarla.

---

## 3. Funcionalidades

### 3.1 Buscador de productos

- Caja de búsqueda por texto libre.
- Al buscar, el backend consulta **todas las tiendas activas en paralelo** y devuelve resultados agrupados por tienda: nombre, formato/tamaño, precio, precio por kg/L si existe, imagen, URL del producto, fecha de consulta.
- Mostrar el estado por tienda: cargando / resultados / sin resultados / error (con motivo). Un fallo en una tienda **nunca** bloquea las demás.
- El usuario puede añadir a la cesta el resultado concreto de cada tienda.

### 3.2 Cesta y emparejamiento

- Un **artículo de cesta** es un concepto genérico ("Leche entera 1L") con cantidad y, por cada tienda, un producto concreto elegido (o ninguno).
- Para cada tienda el usuario elige qué producto de esa tienda representa el artículo. Se puede sugerir automáticamente el mejor candidato (mismo formato, precio unitario comparable), siempre editable.
- Cantidades editables.
- **Artículos por peso** (fruta, carne, pescado): al añadir desde Buscar con un kilaje puesto, el artículo nace en **modo kg** —la cantidad es un peso con decimales— y la celda cobra **€/kg real × kg** (nunca el precio de la pieza). La cesta muestra el €/kg con el que se calcula y permite cambiar el peso o volver a unidades.

### 3.3 Resumen de la cesta

- Tabla: filas = artículos, columnas = tiendas, celda = precio × cantidad (o **€/kg × kg** si el artículo está en modo kilo; la única fuente del cálculo es `precioPorCantidad` de `@cestimate/shared`).
- Marcar la celda más barata por fila y el total más barato.
- Totales por tienda; si a una tienda le faltan artículos, indicarlo y **no declararla ganadora** salvo que se pida comparar solo los artículos comunes.
- Mostrar el ahorro frente a la tienda más cara.
- Cada precio enlaza a la página del producto en la tienda y muestra cuándo se consultó.

### 3.4 Tiendas

- Gestionar tiendas: nombre, color, web, activa/inactiva, adaptador asociado.
- **Añadir más tiendas:** tienda con adaptador integrado, o tienda "manual" (el usuario introduce precio y URL a mano).
- Editar y eliminar tiendas existentes (incluidas las predefinidas), incluida la edición de la web de una tienda ya creada.

### 3.5 Gráficas y estadísticas

- Total de la cesta actual por tienda (barras).
- Precio por artículo entre tiendas (barras agrupadas).
- Evolución temporal del total por tienda a partir de cestas guardadas (líneas).
- Evolución del precio de un producto (se guarda histórico de cada consulta).
- Estadísticas: tienda más barata más veces, ahorro acumulado, categorías con mayor diferencia.

### 3.6 Cestas guardadas

- Guardar la cesta con **fecha** y **texto descriptivo**.
- Se guarda una **foto de los precios** de ese momento (no depender de precios futuros).
- Listado, ver detalle, cargar como cesta activa, duplicar, eliminar.
- Al recargar una cesta, ofrecer actualizar precios y mostrar la diferencia respecto a lo guardado.

### 3.7 Ajustes

- **Código postal / ubicación**: los precios y la disponibilidad de varias tiendas dependen de ella. Configurable y persistido.
- Activar/desactivar tiendas, TTL de caché, borrar caché.

---

## 4. Obtención de precios (parte crítica)

### 4.1 Patrón adaptador

Interfaz común por tienda:

```ts
interface StoreAdapter {
  id: string; // 'mercadona' | 'consum' | ...
  search(query: string, ctx: { postalCode: string }): Promise<StoreProduct[]>;
  getProduct?(
    externalId: string,
    ctx: { postalCode: string },
  ): Promise<StoreProduct | null>;
}

interface StoreProduct {
  storeId: string;
  externalId: string;
  name: string;
  format?: string; // "1 L", "12 ud"
  price: number; // EUR, precio actual
  unitPrice?: { value: number; unit: "kg" | "L" | "ud" };
  imageUrl?: string;
  url: string; // enlace verificable al producto
  fetchedAt: string; // ISO
}
```

### 4.2 Estrategia por tienda

Investigar y **verificar en vivo** cada una antes de implementarla; no asumir nada de esta tabla sin comprobarlo (las webs cambian):

| Tienda    | Vía a investigar                                                                                                                                                          | Notas                                                                |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Mercadona | Endpoints JSON internos que usa `tienda.mercadona.es` (inspeccionar pestaña Network); la búsqueda y las categorías suelen depender del almacén asociado al código postal. | Verificar parámetros de almacén/idioma.                              |
| Consum    | Web `tienda.consum.es` (la tienda online real; **no** `tiendaonline.consum.es`). Inspeccionar llamadas XHR del buscador.                                                  | Depende de la tienda/zona; puede requerir cookies o sesión anónima.  |
| Aldi      | `www.aldi.es`: el catálogo online puede ser limitado (más folleto que tienda).                                                                                            | Puede que solo haya parte del surtido; documentar la cobertura real. |
| Lidl      | `www.lidl.es`: tienda online centrada en no alimentación; alimentación vía folleto/ofertas.                                                                               | Documentar cobertura real; si no hay datos fiables, tienda "manual". |

Si una tienda no ofrece datos accesibles de forma legítima y estable, **no inventar ni simular**: marcarla como `manual` o `no disponible` y decirlo en la UI.

### 4.3 Reglas obligatorias

- **Nunca inventar precios.** Sin dato real → "n/d".
- Respetar `robots.txt` y términos de uso; User-Agent identificable; **rate limiting** y concurrencia baja por tienda; reintentos con backoff.
- **Caché** en SQLite con TTL configurable (por defecto 6–24 h) para no martillear las webs. Mostrar la antigüedad del dato.
- Cada resultado lleva su URL de origen para que el usuario lo verifique.
- Aislar cada adaptador: timeouts (~10 s), errores tipados, logs claros de por qué falló (bloqueo, cambio de formato, sin resultados).
- Validar con Zod la respuesta de cada tienda; si el formato cambia, fallar con un error explícito y no devolver basura.
- Uso de LLM: **solo opcional y secundario** (p. ej. sugerir emparejamientos entre productos). Nunca como fuente de precios.

---

## 5. Modelo de datos (SQLite)

- `store` (id, name, color, website, adapter, active, created_at)
- `product` (id, store_id, external_id, name, format, image_url, url) — único por (store_id, external_id)
- `price_snapshot` (id, product_id, price, unit_price, unit, fetched_at, postal_code)
- `basket_item` (id, generic_name, qty) — cesta activa
- `basket_item_match` (basket_item_id, store_id, product_id) — producto elegido por tienda
- `saved_basket` (id, date, description, created_at)
- `saved_basket_line` (id, saved_basket_id, generic_name, qty, store_id, product_name, price_at_save, url)
- `setting` (key, value) — código postal, TTL, etc.
- `search_cache` (query_hash, store_id, payload, fetched_at)

---

## 6. API (REST, JSON)

- `GET /api/search?q=...&stores=a,b` → resultados por tienda (con estado por tienda)
- `GET/POST/PATCH/DELETE /api/stores`
- `GET/PUT /api/basket`, `POST /api/basket/items`, `PATCH/DELETE /api/basket/items/:id`
- `PUT /api/basket/items/:id/match/:storeId`
- `GET /api/basket/summary` → totales, más barato, faltantes, ahorro
- `POST /api/basket/refresh` → vuelve a consultar precios de lo emparejado
- `GET/POST/DELETE /api/saved-baskets`, `POST /api/saved-baskets/:id/load`
- `GET /api/stats/...` (series para las gráficas)
- `GET/PUT /api/settings`

---

## 7. Diseño de la UI

Cabecera: icono de Cestimate + nombre en Archivo Black + subtítulo breve. Pestañas: **Buscador · Cesta · Gráficas · Historial · Tiendas · Ajustes**.

Estética: papel de ticket / etiqueta de precio. Paleta base: fondo `#EEF1E6`, tinta `#1E2A22`, verde "mejor precio" `#2F6F4E` sobre `#DCEBDD`, rojo sello `#C23B32`, azul informativo `#2B5D8C`. Tipografías: Archivo Black (títulos), Barlow (texto), Space Mono (precios). Colores por tienda: Mercadona `#2F6F4E`, Consum `#E08E2B`, Aldi `#2B5D8C`, Lidl `#C23B32`.

Requisitos de UX:

- Responsive (móvil primero), accesible (foco visible, contraste, etiquetas).
- Estados vacío, cargando y error cuidados en cada vista.
- La mejor opción se destaca con estrella y color, no solo con color.
- Mensaje claro cuando falte un precio y por qué.

---

## 8. Fases de implementación

1. **Esqueleto:** monorepo, API Fastify, SQLite + migraciones, frontend Vite, tipos compartidos, y la identidad de marca (nombre, icono, favicon, manifest) de la sección 0.
2. **Adaptador Mercadona** de extremo a extremo (el más accesible): búsqueda, caché, UI del buscador.
3. **Cesta + resumen + guardado** con tiendas manuales para poder probar el flujo completo.
4. **Adaptador Consum**, luego investigar Aldi y Lidl y documentar la cobertura real de cada una.
5. **Gráficas, estadísticas e histórico de precios.**
6. **Gestión de tiendas** (alta/edición/baja), ajustes y código postal.
7. **Pulido:** tests, manejo de errores, README, scripts de arranque.

Al terminar cada fase: arrancar, probar con datos reales y mostrar el resultado antes de seguir.

---

## 9. Criterios de aceptación

- Buscar "leche" devuelve precios reales y actuales de al menos Mercadona y Consum, con enlace verificable y fecha.
- Si una tienda falla, el resto de resultados se muestran igualmente y se explica el fallo.
- El resumen de la cesta calcula bien totales, mínimos y faltantes (con tests).
- Una cesta guardada conserva fecha, descripción y precios de ese día aunque cambien después.
- Se puede añadir, editar y eliminar tiendas, incluida una tienda manual.
- No hay precios inventados en ningún flujo.
- `README.md` (titulado «Cestimate») explica instalación, variables de entorno, cómo arrancar y cómo añadir un adaptador nuevo.
- La app muestra el nombre y el icono de Cestimate en la pestaña del navegador, en la cabecera y en el manifest.

---

## 10. Convenciones

- TypeScript estricto, sin `any` salvo justificación. ESLint + Prettier.
- Commits pequeños y descriptivos (en español o inglés, pero consistentes).
- Sin secretos en el repo; configuración por `.env` con `.env.example`.
- Ante dudas de producto (cobertura de una tienda, emparejamiento, alcance), **preguntar** en vez de asumir.

---

## 11. Fuera de alcance (por ahora)

Autenticación multiusuario, pagos, compra real en las tiendas, app nativa, notificaciones de bajadas de precio (posible futuro).
