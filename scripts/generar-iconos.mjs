#!/usr/bin/env node
/**
 * Genera los PNG del icono de Cestimate a partir de public/icon.svg.
 * Requiere `npm install` en la raíz (usa sharp).
 *
 *   npm run iconos
 *
 * Genera: favicon.ico (32), icon-192.png, icon-512.png,
 * icon-maskable-512.png (con margen de seguridad, fondo verde plano)
 * y apple-touch-icon.png (180).
 */
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const raiz = join(dirname(fileURLToPath(import.meta.url)), "..");
const svg = await readFile(join(raiz, "apps/web/public/icon.svg"));
const publicDir = join(raiz, "apps/web/public");

async function png(tam, salida, { maskable = false } = {}) {
  let imagen = sharp(svg, { density: 300 }).resize(tam, tam);
  if (maskable) {
    // Fondo verde plano sin esquinas redondeadas + cesta centrada al 60 %.
    const cesta = await sharp(svg, { density: 300 })
      .resize(Math.round(tam * 0.6), Math.round(tam * 0.6), { fit: "contain" })
      .png()
      .toBuffer();
    await sharp({
      create: { width: tam, height: tam, channels: 4, background: "#2F6F4E" },
    })
      .composite([{ input: cesta, gravity: "centre" }])
      .png()
      .toFile(join(publicDir, salida));
  } else {
    await imagen.png().toFile(join(publicDir, salida));
  }
  console.log(`✓ ${salida} (${tam}×${tam})`);
}

// favicon.ico: lo guardamos como PNG de 32 px (los navegadores modernos lo aceptan
// vía <link rel="icon" type="image/png">; el SVG ya cubre el resto).
await png(32, "favicon-32.png");
await png(192, "icon-192.png");
await png(512, "icon-512.png");
await png(512, "icon-maskable-512.png", { maskable: true });
await png(180, "apple-touch-icon.png");

console.log(
  "\nIconos regenerados en apps/web/public/. Ejecuta `npm run build -w apps/web`.",
);
