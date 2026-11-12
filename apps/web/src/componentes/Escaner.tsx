import { useCallback, useEffect, useRef, useState } from "react";
import { Camera, Loader2, RotateCw, ScanBarcode, X } from "lucide-react";
import { esCodigoBarrasValido } from "@cestimate/shared";

/**
 * Panel de escaneo de códigos de barras (pestaña Buscar).
 *
 * Intenta primero `BarcodeDetector` nativo (Chrome Android con ean_13);
 * si no está disponible o no soporta EAN, usa `zxing-wasm` con el `.wasm`
 * alojado en local (`public/zxing_reader.wasm`), sin depender de CDN.
 *
 * El `<video>` se renderiza desde el inicio (mientras carga, tapado por el
 * superpuesto): si no, `videoRef.current` sería null al resolver
 * `getUserMedia` y el panel se quedaría en «iniciando» para siempre.
 *
 * Todos los pasos críticos llevan timeout y el panel ofrece **Reintentar**:
 * nunca se queda «pensando» sin salida (permiso denegado, cámara colgada,
 * descarga del lector lenta…).
 *
 * El bucle de captura va a ~4 img/s (cada 250 ms). Al detectar un código
 * válido se llama `onDetectado(codigo)` y se detiene la cámara.
 */
type Estado = "iniciando" | "escaneando" | "sin-camara" | "error";

type Detector = (canvas: HTMLCanvasElement) => Promise<string | null>;

/** Límite de tiempo para una promesa; si expira, se rechaza con `TimeoutError`. */
function conLimite<T>(promesa: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promesa,
    new Promise<never>((_, rechazar) =>
      setTimeout(() => rechazar(new Error("TimeoutError")), ms),
    ),
  ]);
}

export default function Escaner({
  onDetectado,
  onCerrar,
}: {
  onDetectado: (codigo: string) => void;
  onCerrar: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [estado, setEstado] = useState<Estado>("iniciando");
  const [mensaje, setMensaje] = useState("");
  const [manual, setManual] = useState("");
  // Número de intento: sirve de «key» del efecto para poder reintentar.
  const [intento, setIntento] = useState(0);

  const detectarRef = useRef<Detector | null>(null);

  // Callback en un ref: así el efecto de la cámara no se re-ejecuta (y no
  // reinicia el stream) cuando el padre re-renderiza con una función nueva.
  const onDetectadoRef = useRef(onDetectado);
  useEffect(() => {
    onDetectadoRef.current = onDetectado;
  }, [onDetectado]);

  useEffect(() => {
    let cancelado = false;
    let stream: MediaStream | null = null;
    let temporizador: ReturnType<typeof setInterval> | null = null;
    // true cuando el stream ya no se va a usar (timeout, error o cierre):
    // evita que una cámara concedida tarde quede encendida sin uso.
    let obsoleto = false;

    setEstado("iniciando");
    setMensaje("");

    async function iniciar() {
      // 1. Cámara (guard: mediaDevices solo existe en contextos seguros).
      //    Límite 30 s: da tiempo al diálogo de permiso de iOS/Safari.
      if (!navigator.mediaDevices?.getUserMedia) {
        setEstado("sin-camara");
        setMensaje(
          "Este navegador no permite usar la cámara. Escribe el código a mano.",
        );
        return;
      }
      const promesaCamara = navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
      });
      // Si el permiso llega tarde (tras el timeout o al desmontar el panel),
      // el stream no debe quedar huérfano: la cámara se apaga en cuanto
      // llega, porque ya no la usamos.
      void promesaCamara
        .then((s) => {
          if (obsoleto) s.getTracks().forEach((t) => t.stop());
        })
        .catch(() => undefined);

      try {
        stream = await conLimite(promesaCamara, 30_000);
      } catch (error) {
        obsoleto = true;
        if (cancelado) return;
        const esTimeout =
          error instanceof Error && error.message === "TimeoutError";
        setEstado("sin-camara");
        setMensaje(
          esTimeout
            ? "La cámara no respondió (¿has concedido el permiso?). Puedes reintentar o escribir el código a mano."
            : "No se pudo acceder a la cámara. Escribe el código a mano.",
        );
        return;
      }
      if (cancelado || obsoleto) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      try {
        // Límite 10 s: si no arranca, no bloqueamos el resto del panel.
        await conLimite(video.play(), 10_000);
      } catch {
        // Sin reproducción no hay escaneo: apagamos la cámara.
        stream.getTracks().forEach((t) => t.stop());
        if (cancelado) return;
        setEstado("error");
        setMensaje(
          "No se pudo reproducir la vista de la cámara. Puedes reintentar o escribir el código a mano.",
        );
        return;
      }
      if (cancelado) return;

      // 2. Detector (nativo o zxing-wasm; el WASM puede tardar en bajar).
      try {
        detectarRef.current = await conLimite(crearDetector(), 20_000);
      } catch {
        stream.getTracks().forEach((t) => t.stop());
        if (cancelado) return;
        setEstado("error");
        setMensaje(
          "No se pudo cargar el lector de códigos. Puedes reintentar o escribir el código a mano.",
        );
        return;
      }
      if (cancelado) return;

      // 3. Bucle de captura ~4 img/s
      setEstado("escaneando");
      temporizador = setInterval(() => {
        if (cancelado || !detectarRef.current) return;
        const v = videoRef.current;
        const canvas = canvasRef.current;
        if (!v || !canvas || v.readyState < 2) return;
        canvas.width = v.videoWidth;
        canvas.height = v.videoHeight;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;
        ctx.drawImage(v, 0, 0);
        void detectarRef.current(canvas).then((codigo) => {
          if (codigo && esCodigoBarrasValido(codigo)) {
            if (temporizador) clearInterval(temporizador);
            onDetectadoRef.current(codigo);
          }
        });
      }, 250);
    }

    void iniciar();

    return () => {
      cancelado = true;
      obsoleto = true;
      if (temporizador) clearInterval(temporizador);
      if (stream) stream.getTracks().forEach((t) => t.stop());
    };
  }, [intento]);

  const enviarManual = useCallback(() => {
    const limpio = manual.trim().replace(/[\s-]/g, "");
    if (esCodigoBarrasValido(limpio)) {
      onDetectado(limpio);
    } else {
      setMensaje(
        "El código debe tener 8, 12, 13 o 14 dígitos y un dígito de control válido.",
      );
    }
  }, [manual, onDetectado]);

  const reintenta = useCallback(() => setIntento((n) => n + 1), []);

  const fallo =
    (estado === "sin-camara" || estado === "error") && mensaje !== "";

  return (
    <div
      className="panel-escaner tarjeta"
      role="dialog"
      aria-label="Escanear código de barras"
    >
      <div className="panel-escaner__cabecera">
        <strong>
          <ScanBarcode size={16} aria-hidden /> Escanear código de barras
        </strong>
        <button
          className="btn-escaner-cerrar"
          onClick={onCerrar}
          aria-label="Cerrar escáner"
        >
          <X size={20} aria-hidden />
        </button>
      </div>

      {/* Zona de vídeo: el <video> está en el DOM desde el primer render
          (tapado por el superpuesto mientras carga). */}
      {estado !== "sin-camara" && (
        <div className="panel-escaner__video">
          <video ref={videoRef} playsInline muted autoPlay />
          {estado === "iniciando" && (
            <div className="panel-escaner__superpuesto">
              <Loader2 size={22} aria-hidden className="girar" />
              <span>Pidiendo permiso de cámara…</span>
            </div>
          )}
          {estado === "error" && (
            <div className="panel-escaner__superpuesto" role="alert">
              <span>{mensaje}</span>
              <button className="btn reintentar mini" onClick={reintenta}>
                <RotateCw size={15} aria-hidden /> Reintentar
              </button>
            </div>
          )}
        </div>
      )}

      {estado === "sin-camara" && (
        <div className="aviso warn" role="status">
          <strong>
            <Camera size={15} aria-hidden /> Sin cámara
          </strong>
          <span>{mensaje}</span>
          <button className="btn reintentar mini" onClick={reintenta}>
            <RotateCw size={15} aria-hidden /> Reintentar
          </button>
        </div>
      )}

      {estado === "escaneando" && (
        <p className="panel-escaner__pista">
          Apunta al código de barras del producto. Se leerá automáticamente.
        </p>
      )}

      {/* Entrada manual: siempre disponible como respaldo. */}
      <div className="panel-escaner__manual">
        <label className="campo-etiqueta" htmlFor="codigo-manual">
          O escribe el código a mano
        </label>
        <div className="panel-escaner__fila-manual">
          <input
            id="codigo-manual"
            type="text"
            inputMode="numeric"
            autoComplete="off"
            placeholder="8402001002083"
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                enviarManual();
              }
            }}
            className="campo-mono"
          />
          <button className="btn secundario" onClick={enviarManual}>
            Identificar
          </button>
        </div>
      </div>

      <canvas ref={canvasRef} className="oculto-visual" aria-hidden />
      {fallo && <span className="visually-hidden">{mensaje}</span>}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Fábrica de detector                                                 */
/* ------------------------------------------------------------------ */

/**
 * 1. `BarcodeDetector` nativo si soporta `ean_13` (Chrome Android).
 * 2. Fallback: `zxing-wasm` con `.wasm` local (`public/zxing_reader.wasm`),
 *    sin peticiones a CDN.
 */
async function crearDetector(): Promise<Detector> {
  const BD = (
    window as unknown as {
      BarcodeDetector?: {
        getSupportedFormats?: () => Promise<string[]>;
        new (opciones: { formats: string[] }): {
          detect: (
            fuente: CanvasImageSource,
          ) => Promise<{ rawValue: string }[]>;
        };
      };
    }
  ).BarcodeDetector;

  if (BD && typeof BD.getSupportedFormats === "function") {
    try {
      const formatos = await BD.getSupportedFormats();
      if (formatos.includes("ean_13")) {
        const det = new BD({ formats: ["ean_13", "ean_8"] });
        return async (canvas) => {
          const codes = await det.detect(canvas);
          return codes[0]?.rawValue ?? null;
        };
      }
    } catch {
      // Sigue con zxing-wasm.
    }
  }

  const { readBarcodes, setZXingModuleOverrides } =
    await import("zxing-wasm/reader");
  // El `.wasm` vive en public/ (no en CDN): la URL se resuelve contra la
  // base del sitio (GitHub Pages sirve bajo /Cestimate/).
  const base = (import.meta.env.BASE_URL ?? "/").replace(/\/?$/, "/");
  setZXingModuleOverrides({
    locateFile: (path: string, prefix: string) => {
      if (path.endsWith(".wasm")) return `${base}zxing_reader.wasm`;
      return prefix + path;
    },
  });

  return async (canvas) => {
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const resultados = await readBarcodes(imageData, {
      formats: ["EAN13", "EAN8", "UPCA"],
      tryHarder: true,
    });
    return resultados[0]?.text ?? null;
  };
}
