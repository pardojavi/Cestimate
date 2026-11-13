import { useState } from "react";
import { Calendar, ChevronLeft, Trash2, Upload } from "lucide-react";
import {
  haceTiempo,
  formatoDia,
  formatoEUR,
  normalizar,
  precioPorCantidad,
} from "@cestimate/shared";
import {
  useCargarCesta,
  useEliminarCesta,
  useGuardarCesta,
  useGuardada,
  useGuardadas,
} from "../lib/api";

/**
 * Historial (ESTILOS.md §8): tarjeta «Guardar la cesta actual» con fecha
 * y descripción, y tarjetas de cesta guardada con rejilla de totales por
 * tienda (la más barata en --best).
 */
export default function Historial() {
  const [detalle, setDetalle] = useState<number | null>(null);
  const { data: guardadas, isLoading } = useGuardadas();

  if (detalle !== null) {
    return <Detalle id={detalle} volver={() => setDetalle(null)} />;
  }

  return (
    <section aria-label="Historial de cestas">
      <div className="seccion-titulo">
        <h2>Historial</h2>
        <span className="subtitulo">
          {guardadas?.length ?? 0} cesta{guardadas?.length === 1 ? "" : "s"}
        </span>
      </div>

      <NuevaCesta />

      {isLoading && <div className="cargando">Consultando el historial…</div>}

      {guardadas && guardadas.length === 0 && (
        <div className="vacio">
          Todavía no has guardado ninguna cesta. Prepara la cesta y pulsa
          «Guardar».
        </div>
      )}

      {guardadas?.map((c) => (
        <TarjetaGuardada
          key={c.id}
          cesta={c}
          verDetalle={() => setDetalle(c.id)}
        />
      ))}
    </section>
  );
}

function NuevaCesta() {
  const [fecha, setFecha] = useState(new Date().toISOString().slice(0, 10));
  const [descripcion, setDescripcion] = useState("");
  const guardar = useGuardarCesta();

  return (
    <div className="tarjeta">
      <h3>Guardar la cesta actual</h3>
      <div className="fila-campos">
        <label className="campo">
          <span>Fecha</span>
          <input
            type="date"
            value={fecha}
            onChange={(e) => setFecha(e.target.value)}
          />
        </label>
        <label className="campo" style={{ flex: 2 }}>
          <span>Descripción</span>
          <input
            type="text"
            placeholder="Compra semanal, cena de Navidad…"
            value={descripcion}
            onChange={(e) => setDescripcion(e.target.value)}
          />
        </label>
      </div>
      <button
        className="btn primario ancho"
        disabled={guardar.isPending || descripcion.trim().length === 0}
        onClick={() =>
          guardar.mutate(
            { date: fecha, description: descripcion.trim() },
            { onSuccess: () => setDescripcion("") },
          )
        }
      >
        Guardar cesta con los precios de hoy
      </button>
      {guardar.isError && (
        <div className="error-rojo">
          {guardar.error instanceof Error
            ? guardar.error.message
            : "Error al guardar."}
        </div>
      )}
      {guardar.isSuccess && (
        <div className="aviso exito" role="status" style={{ marginTop: 10 }}>
          <strong>Cesta guardada</strong>
          <span>Conserva los precios de hoy aunque cambien después.</span>
        </div>
      )}
    </div>
  );
}

function TarjetaGuardada({
  cesta,
  verDetalle,
}: {
  cesta: {
    id: number;
    date: string;
    description: string;
    created_at: string;
    totals: { storeId: string; storeName: string; total: number }[];
  };
  verDetalle: () => void;
}) {
  const cargar = useCargarCesta();
  const eliminar = useEliminarCesta();
  const totales = [...cesta.totals].sort((a, b) => a.total - b.total);
  const mejorId = totales[0]?.storeId;

  return (
    <article className="tarjeta tarjeta-guardada">
      <div className="descripcion">{cesta.description}</div>
      <div className="fecha">
        {formatoDia(cesta.created_at)} · {haceTiempo(cesta.created_at)}
      </div>
      <div className="subtitulo" style={{ marginTop: 4 }}>
        {totales.length} tienda{totales.length === 1 ? "" : "s"} · precios
        guardados ese día
      </div>

      {totales.length > 0 && (
        <div className="rejilla-totales">
          {totales.map((t) => (
            <div
              key={t.storeId}
              className={t.storeId === mejorId ? "celda mejor" : "celda"}
            >
              <div className="n">{t.storeName}</div>
              <div className="v">{formatoEUR(t.total)}</div>
            </div>
          ))}
        </div>
      )}

      <div className="acciones-fila">
        <button className="btn" onClick={verDetalle}>
          Ver detalle
        </button>
        <button
          className="btn"
          onClick={() => cargar.mutate(cesta.id)}
          disabled={cargar.isPending}
        >
          <Upload size={15} aria-hidden /> Cargar cesta
        </button>
        <button
          className="btn neutro"
          onClick={() => {
            if (confirm(`¿Eliminar la cesta «${cesta.description}»?`)) {
              eliminar.mutate(cesta.id);
            }
          }}
          disabled={eliminar.isPending}
        >
          <Trash2 size={15} aria-hidden /> Eliminar
        </button>
      </div>

      {cargar.isSuccess && (
        <div className="aviso exito" role="status" style={{ marginTop: 10 }}>
          <strong>Cesta cargada</strong>
          <span>Actualiza precios desde Cesta para ver la diferencia.</span>
        </div>
      )}
      {cargar.isError && (
        <div className="error-rojo">
          {cargar.error instanceof Error
            ? cargar.error.message
            : "Error al cargar."}
        </div>
      )}
    </article>
  );
}

function Detalle({ id, volver }: { id: number; volver: () => void }) {
  const { data: cesta, isLoading } = useGuardada(id);

  if (isLoading || !cesta) return <div className="cargando">Consultando…</div>;

  // Agrupa las líneas por artículo para comparar tiendas.
  const porArticulo = new Map<
    string,
    { qty: number; qtyUnit: "ud" | "kg"; lineas: typeof cesta.lines }
  >();
  for (const l of cesta.lines) {
    const clave = normalizar(l.genericName);
    let entrada = porArticulo.get(clave);
    if (!entrada) {
      entrada = { qty: l.qty, qtyUnit: l.qtyUnit, lineas: [] };
      porArticulo.set(clave, entrada);
    }
    entrada.lineas.push(l);
  }

  return (
    <section aria-label="Detalle de cesta guardada">
      <button className="btn mini" onClick={volver}>
        <ChevronLeft size={15} aria-hidden /> Volver
      </button>

      <div className="seccion-titulo" style={{ marginTop: 12 }}>
        <h2>{cesta.description}</h2>
        <span className="subtitulo">{formatoDia(cesta.created_at)}</span>
      </div>

      {[...porArticulo.values()].map((grupo, i) => (
        <div key={i} className="tarjeta">
          <h3>
            {grupo.lineas[0]?.genericName}{" "}
            <span className="badge cantidad">
              ×{grupo.qtyUnit === "kg" ? `${grupo.qty} kg` : grupo.qty}
            </span>
          </h3>
          <ul className="lista-sin-margen">
            {grupo.lineas.map((l) => (
              <li key={l.id} className="producto">
                <div className="producto__info">
                  <div className="producto__nombre">{l.storeName}</div>
                  <div className="producto__datos">{l.productName ?? "—"}</div>
                  <div className="producto__meta">
                    {l.url && (
                      <a
                        className="enlace-precio"
                        href={l.url}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        ver en la tienda
                      </a>
                    )}
                  </div>
                </div>
                <div className="producto__acciones">
                  <span className="precio">
                    {l.priceAtSave !== null
                      ? formatoEUR(
                          precioPorCantidad(
                            {
                              price: l.priceAtSave,
                              unitPrice: l.unitPriceAtSave,
                              unit: l.unit,
                            },
                            l.qty,
                            l.qtyUnit,
                          ),
                        )
                      : "n/d"}
                  </span>
                  {l.priceNow !== null && l.priceAtSave !== null && (
                    <Diferencia
                      antes={precioPorCantidad(
                        {
                          price: l.priceAtSave,
                          unitPrice: l.unitPriceAtSave,
                          unit: l.unit,
                        },
                        l.qty,
                        l.qtyUnit,
                      )}
                      ahora={precioPorCantidad(
                        {
                          price: l.priceNow,
                          unitPrice: l.unitPriceNow,
                          unit: l.unit,
                        },
                        l.qty,
                        l.qtyUnit,
                      )}
                    />
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}

      <div className="tarjeta">
        <h3>Totales por tienda (al guardar)</h3>
        <ul className="lista-sin-margen" style={{ display: "grid", gap: 8 }}>
          {cesta.totals.map((t) => (
            <li
              key={t.storeId}
              style={{
                display: "flex",
                justifyContent: "space-between",
                fontSize: 14,
              }}
            >
              <span>{t.storeName}</span>
              <strong
                style={{
                  fontFamily: "var(--fuente-precio)",
                  fontSize: 15,
                }}
              >
                {formatoEUR(t.total)}
              </strong>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function Diferencia({ antes, ahora }: { antes: number; ahora: number }) {
  const diff = ahora - antes;
  if (Math.abs(diff) < 0.005) {
    return <span className="diferencia">sin cambios</span>;
  }
  return (
    <span className={`diferencia ${diff > 0 ? "sube" : "baja"}`}>
      {diff > 0 ? "▲" : "▼"} {formatoEUR(Math.abs(diff))} ahora
    </span>
  );
}
