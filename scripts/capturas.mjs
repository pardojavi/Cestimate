/**
 * Capturas de la UI a 390×844 (iPhone) usando Chrome DevTools Protocol.
 * Uso: node scripts/capturas.mjs
 */
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync, rmSync } from "node:fs";
import { setTimeout as dormir } from "node:timers/promises";

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const PUERTO = 9333;
const PERFIL = "/tmp/cestimate-chrome-perfil";
const SALIDA =
  "/private/var/folders/h3/032qrmdj6j9f1_lpg94b7fx00c0c_z/T/opencode";
const URL_APP = process.argv[2] || "http://localhost:5173/";
const SOLO_INICIAL = process.argv.includes("--solo-inicial");

rmSync(PERFIL, { recursive: true, force: true });
mkdirSync(SALIDA, { recursive: true });

const chrome = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PUERTO}`,
    `--user-data-dir=${PERFIL}`,
    "--no-first-run",
    "--no-default-browser-check",
    "--hide-scrollbars",
    "about:blank",
  ],
  { stdio: "ignore" },
);

let ws;
let id = 0;
const pendientes = new Map();

function enviar(method, params = {}) {
  const mensajeId = ++id;
  ws.send(JSON.stringify({ id: mensajeId, method, params }));
  return new Promise((resolver, rechazar) => {
    pendientes.set(mensajeId, { resolver, rechazar });
    setTimeout(() => {
      if (pendientes.has(mensajeId)) {
        pendientes.delete(mensajeId);
        rechazar(new Error(`Timeout en ${method}`));
      }
    }, 20000);
  });
}

async function esperarServidor() {
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PUERTO}/json/list`);
      const objetivos = await r.json();
      const pagina = objetivos.find((o) => o.type === "page");
      if (pagina) return pagina.webSocketDebuggerUrl;
    } catch {
      /* aún no está arriba */
    }
    await dormir(300);
  }
  throw new Error("Chrome debugging no respondió");
}

async function main() {
  const urlWs = await esperarServidor();
  ws = new WebSocket(urlWs);
  await new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = rej;
  });
  ws.onmessage = (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pendientes.has(msg.id)) {
      const { resolver, rechazar } = pendientes.get(msg.id);
      pendientes.delete(msg.id);
      msg.error ? rechazar(new Error(msg.error.message)) : resolver(msg.result);
    }
  };

  // Emulación iPhone 390×844 @2x
  await enviar("Page.enable");
  await enviar("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 844,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
  });
  await enviar("Page.navigate", { url: URL_APP });
  await dormir(4500); // fuentes + queries iniciales

  async function medir(etapa) {
    const { result } = await enviar("Runtime.evaluate", {
      expression:
        "JSON.stringify({w: innerWidth, sw: document.documentElement.scrollWidth, bw: document.body.scrollWidth})",
      returnByValue: true,
    });
    console.log(`medida ${etapa}: ${result.value}`);
  }

  async function capturar(nombre) {
    const { data } = await enviar("Page.captureScreenshot", { format: "png" });
    writeFileSync(`${SALIDA}/${nombre}.png`, Buffer.from(data, "base64"));
    console.log(`✓ ${nombre}.png`);
  }

  async function clic(expresion) {
    await enviar("Runtime.evaluate", { expression: expresion });
    await dormir(1200);
  }

  await medir("carga inicial");
  await capturar("p1_buscar");
  if (SOLO_INICIAL) {
    ws.close();
    return;
  }
  await dormir(2500);
  await medir("2,5 s después");
  await capturar("p1b_buscar");

  // Buscar: rellenar y consultar
  await enviar("Runtime.evaluate", {
    expression: `
      const i = document.querySelector('input[type=search]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
      setter.call(i, 'leche');
      i.dispatchEvent(new Event('input', { bubbles: true }));
      i.form.requestSubmit();
    `,
  });
  await dormir(7000);
  await capturar("p2_buscar_resultados");

  await clic(
    `[...document.querySelectorAll('.pestanas button')].find(b=>b.textContent.includes('Cesta')).click()`,
  );
  await capturar("p3_cesta");

  await clic(
    `[...document.querySelectorAll('.pestanas button')].find(b=>b.textContent.includes('Gráficas')).click()`,
  );
  await dormir(1500);
  await capturar("p4_graficas");

  await clic(
    `[...document.querySelectorAll('.pestanas button')].find(b=>b.textContent.includes('Historial')).click()`,
  );
  await capturar("p5_historial");

  await clic(
    `[...document.querySelectorAll('.pestanas button')].find(b=>b.textContent.includes('Tiendas')).click()`,
  );
  await capturar("p6_tiendas");

  await clic(`document.querySelector('button[aria-label="Ajustes"]').click()`);
  await capturar("p7_ajustes");

  ws.close();
}

main()
  .catch((e) => {
    console.error("ERROR:", e.message);
    process.exitCode = 1;
  })
  .finally(() => {
    chrome.kill("SIGTERM");
    setTimeout(() => rmSync(PERFIL, { recursive: true, force: true }), 1000);
  });
