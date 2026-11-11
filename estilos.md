# ESTILOS.md — Guía de diseño de Cestimate (iPhone)

Documento de estilos para construir la interfaz de **Cestimate** tal y como está diseñada. Complementa a `agent.md` (funcionalidad y arquitectura). Si hay conflicto entre ambos sobre cómo se **ve** algo, manda este documento; sobre cómo **funciona**, manda `agent.md`.

El diseño es **mobile-first para iPhone**: pantallas de **390 × 844 px**, con barra de pestañas inferior. Se construye como web móvil instalable (PWA) y debe seguir funcionando en pantallas más anchas centrando el contenido (ancho máximo ~480 px o layout adaptado).

Los precios, productos y cestas que aparecen en los diseños son **ejemplos**. En la app salen de las webs de las tiendas.

---

## 1. Idea visual

Papel de ticket y etiquetas de precio de supermercado. Fondo color papel, tinta verde muy oscura, un verde fuerte para "lo más barato" y un rojo de sello para lo que llama la atención. Las etiquetas de precio, los números en tipografía monoespaciada y los bordes finos tipo ticket son la firma del diseño.

Principios:

- Lo más barato se destaca con **color + texto/icono**, nunca solo con color.
- Los precios siempre en tipografía monoespaciada.
- Cada precio muestra su origen (enlace) y cuándo se consultó.
- Un fallo o un dato que falta se explica con texto claro, no se oculta.
- Plano y sobrio: sin sombras, sin degradados, sin emojis.

---

## 2. Tokens de color

Definir como variables CSS en `:root`.

```css
:root {
  /* Base */
  --paper: #eef1e6; /* fondo de pantalla */
  --paper-2: #e5e9db; /* barra de pestañas, fondos suaves */
  --paper-3: #f6f8f0; /* cabeceras de tarjeta */
  --surface: #ffffff; /* tarjetas */
  --ink: #1e2a22; /* texto principal, cabecera, botón principal */
  --ink-soft: #4b5a4f; /* texto secundario */
  --line: #c7cdb9; /* bordes */
  --line-soft: #e5e9db; /* separadores dentro de tarjeta */

  /* Semánticos */
  --best: #2f6f4e; /* mejor precio */
  --best-bg: #dcebdd;
  --best-ink: #1b4a33; /* texto sobre --best-bg */
  --stamp: #c23b32; /* rojo sello: acento, pestaña activa, errores */
  --stamp-bg: #fbeae8;
  --stamp-ink: #8e2a23;
  --warn-bg: #fbf3dc; /* dato incompleto / aviso */
  --warn-line: #b88a1b;
  --warn-ink: #5c4308;
  --info: #2b5d8c; /* enlaces y notas informativas */
  --info-bg: #e3ebf2;

  /* Sobre fondo oscuro (cabecera) */
  --on-ink: #eef1e6;
  --on-ink-soft: #c9d6c6;
  --ink-line: #4b5a4f;

  /* Tiendas (editable por el usuario; estos son los valores por defecto) */
  --store-mercadona: #2f6f4e;
  --store-consum: #e08e2b;
  --store-aldi: #2b5d8c;
  --store-lidl: #c23b32;
}
```

Paleta para tiendas nuevas (elegible al añadirlas): `#2F6F4E #E08E2B #2B5D8C #C23B32 #7A5C9E #B08968 #3E7C7C #A3444A`.

Reglas de color:

- El texto debe cumplir contraste 4,5:1 sobre su fondo. Sobre `--best` y `--stamp` el texto va en blanco.
- Colores que deben distinguirse (series de gráficas) varían también en luminosidad, no solo en tono.
- Un dato "incompleto" usa el amarillo (`--warn-*`), nunca el verde.

---

## 3. Tipografía

Cargar desde Google Fonts:

```html
<link
  href="https://fonts.googleapis.com/css2?family=Archivo+Black&family=Barlow:wght@400;500;600;700&family=Space+Mono:wght@400;700&display=swap"
  rel="stylesheet"
/>
```

| Rol     | Fuente                       | Uso                                                                               |
| ------- | ---------------------------- | --------------------------------------------------------------------------------- |
| Títulos | **Archivo Black**            | Nombre de la app, títulos de pantalla y de sección, nombre de tienda en cabeceras |
| Texto   | **Barlow** (400/500/600/700) | Todo el texto de interfaz, botones, etiquetas                                     |
| Datos   | **Space Mono** (400/700)     | Precios, cantidades, fechas, precio por litro/kg, código postal                   |

Escala (px):

| Elemento                     | Fuente        | Tamaño  | Peso    |
| ---------------------------- | ------------- | ------- | ------- |
| Nombre de la app en cabecera | Archivo Black | 22      | —       |
| Título de pantalla           | Archivo Black | 17      | —       |
| Título de tarjeta/sección    | Archivo Black | 15–16   | —       |
| Nombre de producto           | Barlow        | 15–16   | 700     |
| Texto de botón principal     | Barlow        | 16–17   | 700     |
| Texto de botón secundario    | Barlow        | 15      | 600     |
| Texto secundario / notas     | Barlow        | 12,5–14 | 400–600 |
| Etiquetas de campo           | Barlow        | 12,5    | 600     |
| Precio destacado             | Space Mono    | 18–24   | 700     |
| Precio en tabla / fila       | Space Mono    | 13–19   | 700     |
| Formato y precio unitario    | Space Mono    | 11,5–12 | 400     |
| Texto de pestaña             | Barlow        | 11      | 600     |

Textos en **español, minúscula inicial salvo la primera letra** (sentence case). Sin signos de exclamación en mensajes del sistema. Sin "por favor". Botones con verbo: «Añadir a la cesta», «Guardar cesta», «Reintentar».

---

## 4. Espaciado, forma y elevación

- Márgenes laterales de pantalla: **16 px**. Separación vertical entre bloques: **14 px** (8–10 px dentro de listas).
- Radios: tarjetas **14 px**, filas y campos **10–12 px**, botones **10–12 px**, chips/insignias **999 px**, etiquetas de precio **6 px 10 px 10 px 6 px**.
- Bordes: **1 px sólido `--line`**. Estado de error: borde `--stamp`. Estado destacado: borde `--best`. Estado vacío: borde **1,5 px discontinuo** `--line`.
- **Sin sombras, sin degradados, sin blur.**
- Objetivos táctiles de **mínimo 44 × 44 px**.
- Iconos: trazo (outline) de 2 px, 24 px en la barra de pestañas, 18–22 px en línea. Sin emojis.

---

## 5. Estructura común de pantalla

Columna de 390 × 844 con tres zonas:

1. **Cabecera** (fondo `--ink`, texto `--on-ink`): `padding: 54px 20px 14px` (el 54 deja sitio a la barra de estado del iPhone; usar `env(safe-area-inset-top)` en la versión real). Icono de la app de 34 px + «Cestimate» en Archivo Black 22 + a la derecha una chip con el código postal (`Space Mono` 12, borde `--ink-line`, radio 8). En Tiendas, a la derecha va un botón cuadrado de 44 px con el icono de ajustes. En Ajustes hay un botón «volver» (chevron) a la izquierda y el título «Ajustes».
2. **Contenido**: zona con scroll vertical, `padding: 16px 16px 12px`, columna con `gap: 14px`.
3. **Barra de pestañas** (fondo `--paper-2`, borde superior 1 px `--line`): `padding: 0 6px 26px` (usar `env(safe-area-inset-bottom)`). Cinco pestañas iguales: **Buscar, Cesta, Gráficas, Historial, Tiendas**.
   - Cada pestaña: icono de 24 px + etiqueta de 11 px / 600, centrados, mínimo 44 px de alto.
   - **Activa:** color `--ink` y **borde superior de 3 px `--stamp`**. **Inactiva:** color `--ink-soft`, borde transparente.
   - La pestaña **Cesta** muestra una insignia roja (`--stamp`, texto blanco, 10,5 px / 700, mínimo 16 px) con el número de artículos.
   - Iconos: Buscar (lupa), Cesta (cesta con asa), Gráficas (tres barras), Historial (reloj), Tiendas (tienda con toldo).
   - Ajustes no tiene pestaña propia: se abre desde la cabecera de Tiendas y mantiene Tiendas como pestaña activa.

Logo/icono: ver `branding/icon.svg` (definido en `agent.md`). En cabecera se muestra a 34 px.

---

## 6. Componentes

### 6.1 Botones

- **Principal:** fondo `--ink`, texto `--paper`, borde `--ink`, radio 12, mínimo 48–52 px de alto, Barlow 16–17 / 700.
- **Secundario:** transparente, texto `--ink`, borde 1 px `--ink`, radio 10, mínimo 44 px.
- **Terciario/neutro** (Eliminar, Quitar): transparente, texto `--ink-soft`, borde `--line`.
- **Peligro** (Borrar caché): transparente, texto `--stamp-ink`, borde `--stamp`. **Reintentar:** fondo `--stamp`, texto blanco.
- **Botón «+» de añadir** (en fila de resultado): cuadrado 44 × 44, radio 12, borde 1 px `--ink`, símbolo «+» de 24 px.
- Estados: `hover`/`pressed` con ligera bajada de opacidad; foco visible con contorno de 2 px `--info` y separación de 2 px. No usar botones deshabilitados salvo imprescindible; si se usa, texto explicativo.

### 6.2 Campos de formulario

- Etiqueta encima (12,5 px / 600 / `--ink-soft`), siempre con `<label>` asociada.
- Campo: alto mínimo 44, radio 10, borde 1 px `--line`, fondo `--paper`, texto Barlow 16 (mínimo 16 px para evitar el zoom automático de iOS). Campos numéricos y de código postal en Space Mono con `inputmode="numeric"`.
- Buscador: caja blanca de 48 px de alto, radio 12, icono de lupa a la izquierda, botón «Buscar» al lado.

### 6.3 Tarjetas

- Fondo `--surface`, borde 1 px `--line`, radio 14, `padding: 14px`.
- **Tarjeta de tienda en resultados:** cabecera (`--paper-3`, borde inferior `--line`) con punto de color de la tienda (10 px), nombre en Archivo Black 15 y a la derecha el estado en Space Mono 11,5 («2 de 8», «0 resultados», «Error»). Debajo, filas de producto separadas por `--line-soft`.
- **Fila de producto:** nombre (15 / 700), línea mono «formato · precio unitario», precio a la derecha (Space Mono 18 / 700) y botón «+». Si es el más barato: fondo `--best-bg`, precio en `--best` e insignia «Precio más bajo» (fondo `--best`, texto blanco, 11,5 / 700, radio 999).
- **Fila de artículo de cesta:** nombre (15 / 700), nota de cobertura debajo (12,5 px; en amarillo `--warn-ink` si falta alguna tienda), y a la derecha un selector de cantidad: contenedor `--paper` radio 12 con botones «−» y «+» de 44 px y la cifra en Space Mono 15.
- **Fila de total por tienda:** punto de color, nombre (16 / 700), nota (12,5), importe a la derecha en Space Mono 19 / 700.
  - Ganadora (cesta completa más barata): fondo `--best`, texto blanco.
  - Incompleta (falta algún producto): fondo `--warn-bg`, borde `--warn-line`, texto `--warn-ink`, nota «Falta N producto: no se compara».
  - Resto: fondo blanco, borde `--line`.
- **Tarjeta de cesta guardada:** descripción (16 / 700) + fecha (Space Mono 12, `--ink-soft`), resumen («12 productos · precios guardados ese día»), rejilla de 2 columnas con totales por tienda (celda `--paper`; la más barata en `--best` con texto blanco), y botones «Cargar cesta» (secundario) y «Eliminar» (neutro).
- **Tarjeta de estadística:** etiqueta (12,5 / `--ink-soft`), valor grande (Archivo Black 20 o Space Mono 20 / 700 en `--best`), nota (12,5).

### 6.4 Avisos

- **Informativo:** fondo `--info-bg`, borde `--info`, texto `--ink`.
- **Éxito / ahorro:** fondo `--best-bg`, borde 1,5 px discontinuo `--best`, texto `--best-ink` en 600, con icono de estrella.
- **Aviso (dato incompleto):** fondo `--warn-bg`, borde `--warn-line`, texto `--ink`, icono de triángulo.
- **Error por tienda:** fondo `--stamp-bg`, texto `--ink`, botón «Reintentar». El mensaje dice qué pasó, sin culpar al usuario.

### 6.5 Etiquetas pequeñas (chips)

- «Automática»: fondo `--best-bg`, texto `--best-ink`. «Manual» o «Automática · surtido limitado»: fondo `--warn-bg`, texto `--warn-ink`. 12 px / 600, radio 999, `padding: 2px 8px`.

### 6.6 Interruptor (tienda activa)

- `<button role="switch" aria-checked>` con área táctil de 52 × 44. Pista de 46 × 28, radio 14; encendido `--best` con la bolita a la derecha, apagado `#9AA396` con la bolita a la izquierda. Bolita blanca de 22 px.

### 6.7 Selector de opciones (tiempo de caché)

- Grupo `role="radiogroup"` de 3 botones iguales en rejilla, mínimo 44 px. Seleccionado: fondo `--ink`, texto `--paper`. No seleccionado: transparente, borde `--line`, texto `--ink`.

### 6.8 Estados vacío, cargando y error

- **Vacío:** tarjeta con borde discontinuo, título corto, una frase y una acción («Añadir el precio a mano», «Ir al buscador»).
- **Cargando:** esqueleto de las filas con el color `--paper-2` y estado «Consultando…» en la cabecera de cada tienda; una tienda lenta no bloquea las demás.
- **Error:** ver 6.4.

---

## 7. Gráficas

Sin librerías pesadas obligatorias; vale Recharts o SVG propio, respetando estos estilos.

- Tarjeta blanca con título (Barlow 15 / 700).
- **Barras horizontales de total por tienda:** fila con nombre (14 / 600) a la izquierda y total mono (700) a la derecha, barra de 14 px de alto con pista `--paper` y relleno del color de la tienda (radio 4), y una nota debajo (12 px). La tienda incompleta usa un color atenuado (`#9FB1D0`) y la nota lo explica.
- **Líneas de evolución:** grosor 3, esquinas redondeadas, puntos finales huecos con borde del color de la serie, cuadrícula `#D8DECB`, ejes en Space Mono 11 / `--ink-soft`. **Etiquetar las series directamente** junto al último punto y añadir leyenda debajo. Tarjeta con `aria-label` que describe la tendencia en una frase.
- Series diferenciadas por color de tienda y, cuando sea posible, también por etiqueta directa (no solo por color).

---

## 8. Pantallas

### Buscar

1. Fila con campo de búsqueda + botón «Buscar».
2. Nota breve (13 px, `--ink-soft`): «Precios de la web de cada tienda para tu código postal. Cada uno lleva su enlace y la hora de consulta.»
3. Una tarjeta de tienda por cada tienda activa, en orden. Casos: con resultados, «sin resultados» (explicación + «Añadir el precio a mano») y «error» (mensaje + «Reintentar»).
4. En cada resultado: enlace «Ver en la tienda» y hora de consulta («hace 2 min») en Space Mono 11,5.

### Cesta

1. «Tu cesta»: filas de artículo con selector de cantidad.
2. «Total por tienda»: filas de total ordenadas de más barata a más cara entre las completas; las incompletas se marcan en amarillo.
3. Aviso verde de ahorro: «Con la cesta completa, {tienda} es la más barata: ahorras {importe} frente a {tienda más cara}.»
4. Botón principal a ancho completo «Guardar esta cesta».
5. Acceso al detalle por producto y tienda (tabla o lista expandible) enlazando cada precio a su página.

### Gráficas

Dos tarjetas de estadística en rejilla de 2 columnas («Tienda más barata», «Ahorro acumulado»), después la tarjeta de barras del total actual y la de evolución de cestas guardadas. Más gráficas (precio por producto, evolución de un producto) se añaden como tarjetas del mismo estilo.

### Historial

1. Tarjeta «Guardar la cesta actual»: campos **Fecha** y **Descripción** y botón «Guardar cesta con los precios de hoy».
2. «Cestas guardadas»: tarjetas de cesta guardada (ver 6.3), de más reciente a más antigua.

### Tiendas

1. Lista de tiendas: punto de color, nombre (16 / 700), web (Space Mono 11,5), chip de tipo y interruptor de activa.
2. Tarjeta discontinua «Añadir tienda» con campos Nombre y Web, selector de color, texto «Las tiendas nuevas empiezan como manuales…» y botón «Añadir tienda».
3. Editar y eliminar cualquier tienda (incluidas las predefinidas), incluida su web.

### Ajustes

Tres tarjetas: **Ubicación** (código postal), **Antigüedad de los precios** (6 / 12 / 24 horas) y **Datos** (botón «Borrar caché de precios», con la aclaración de que las cestas guardadas no se ven afectadas). Pie con «Cestimate · versión x.y».

---

## 9. Accesibilidad y calidad

- Elementos interactivos reales (`<button>`, `<a href>`, `<input>` con `<label>`); nada de `div` con `onClick`.
- Botones solo con icono llevan `aria-label` («Añadir a la cesta», «Quitar una unidad», «Ajustes», «Volver a Tiendas»). Iconos decorativos con `aria-hidden="true"`.
- Interruptores y selectores con `role="switch"` / `role="radiogroup"` y `aria-checked`.
- Navegación: `<nav aria-label="Secciones">` para la barra de pestañas; pestaña activa con `aria-current="page"`.
- Foco visible en todo; contraste mínimo 4,5:1 en texto.
- Respetar `prefers-reduced-motion`. Animaciones mínimas: solo cambios de estado breves (≤150 ms).
- Modo oscuro: **no requerido en esta versión**. Si se añade, invertir `--paper`/`--ink` y revisar contrastes de todos los estados.
- Tipografías con `font-display: swap`; si no cargan, usar `system-ui` y `ui-monospace`.

---

## 10. Entregables de marca

- `branding/icon.svg`: cesta color papel sobre fondo verde `#2F6F4E` con etiqueta de precio roja con símbolo €. Código SVG en `agent.md`.
- Derivados: `favicon.ico` (32), `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` (180), 1024 para tiendas.
- `manifest.webmanifest`: `name: "Cestimate"`, `short_name: "Cestimate"`, `theme_color: "#1E2A22"` (cabecera), `background_color: "#EEF1E6"`, `display: "standalone"`.
- Metadatos para iPhone: `<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">`, `apple-mobile-web-app-capable`, `apple-mobile-web-app-status-bar-style` y `apple-touch-icon`.

---

## 11. Cómo usar este documento

1. Crear primero los **tokens** (sección 2–4) como variables CSS y la **estructura común** (sección 5): cabecera, contenido y barra de pestañas.
2. Construir los **componentes** (sección 6) como piezas reutilizables antes de las pantallas.
3. Montar cada pantalla siguiendo la sección 8, con datos reales del backend y los estados vacío, cargando y error.
4. Comparar con el diseño visual de referencia del lienzo de Claude (seis pantallas de iPhone) cuando haya dudas de aspecto.
