import { useState } from "react";
import {
  ChevronDown,
  Link2Off,
  Minus,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
} from "lucide-react";
import type { BasketSummary } from "@cestimate/shared";
import { haceTiempo, formatoEUR } from "@cestimate/shared";
import {
  useActualizarArticulo,
  useActualizarPrecios,
  useBusqueda,
  useCesta,
  useElegirProducto,
  useEliminarArticulo,
  useGuardarCesta,
  useQuitarProducto,
  useResumen,
  useTiendas,
  type ItemCesta,
} from "../lib/api";
import { colorDeTienda } from "./Buscador";

/**
 * Cesta (ESTILOS.md §8): filas de artículo con selector de cantidad,
 * «Total por tienda» ordenado de más barata a más cara (incompletas en
 * amarillo), aviso verde de ahorro y botón «Guardar esta cesta».
 */
export default function Cesta({ irA }: { irA: (v: "historial") => void }) {
  const [soloComunes, setSoloComunes] = useState(false);
  const { data: cesta, isLoading } = useCesta();
  const { data: resumen } = useResumen(soloComunes);
  const { data: tiendas } = useTiendas();
  const guardar = useGuardarCesta();
  const refrescar = useActualizarPrecios();

  const items = cesta?.items ?? [];
  const activas = tiendas?.filter((t) => t.active) ?? [];

  function guardarCesta() {
    const fecha = new Date().toISOString().slice(0, 10);
    guardar.mutate(
      { date: fecha, description: "Cesta guardada desde la pestaña Cesta" },
      { onSuccess: () => irA("historial") },
    );
  }

  if (isLoading) return <div className="cargando">Consultando la cesta…</div>;

  return (
    <section aria-label="Tu cesta">
      <div className="seccion-titulo">
        <h2>Tu cesta</h2>
        <span className="subtitulo">
          {items.length} artículo{items.length === 1 ? "" : "s"}
        </span>
      </div>

      {items.length === 0 && (
        <div className="vacio">
          La cesta está vacía. Añade productos desde <strong>Buscar</strong>.
        </div>
      )}

      {items.map((item) => (
        <ArticuloCesta key={item.id} item={item} activas={activas} />
      ))}

      {items.length > 0 && (
        <>
          <div className="seccion-titulo">
            <h2>Total por tienda</h2>
            <label
              className="subtitulo"
              style={{ display: "flex", gap: 6, alignItems: "center" }}
            >
              <input
                type="checkbox"
                style={{ width: "auto", minHeight: 20 }}
                checked={soloComunes}
                onChange={(e) => setSoloComunes(e.target.checked)}
              />
              Solo artículos comunes
            </label>
          </div>

          <Totales resumen={resumen} />

          {resumen?.cheapest &&
            resumen.saving !== null &&
            resumen.saving > 0 && (
              <div className="aviso exito" role="status">
                <strong>
                  <Star size={15} fill="currentColor" aria-hidden /> Con la
                  cesta completa, {nombreTienda(resumen, resumen.cheapest)} es
                  la más barata: ahorras {formatoEUR(resumen.saving)} frente a{" "}
                  {nombreTienda(resumen, resumen.stores.at(-1)!.storeId)}.
                </strong>
              </div>
            )}

          {resumen && resumen.stores.some((s) => !s.complete) && (
            <div className="aviso warn" role="status">
              <strong>Hay tiendas incompletas</strong>
              <span>
                {resumen.stores
                  .filter((s) => !s.complete)
                  .map(
                    (s) =>
                      `${s.storeName}: falta${s.missing > 1 ? "n" : ""} ${s.missing} producto${s.missing > 1 ? "s" : ""}`,
                  )
                  .join(". ")}
                . No se compara su total; activa «Solo artículos comunes» para
                un enfrentamiento equilibrado.
              </span>
            </div>
          )}

          <button
            className="btn primario ancho"
            onClick={guardarCesta}
            disabled={guardar.isPending}
          >
            Guardar esta cesta
          </button>

          <div className="acciones-fila">
            <button
              className="btn"
              onClick={() => refrescar.mutate()}
              disabled={refrescar.isPending}
            >
              <RefreshCw size={16} aria-hidden /> Actualizar precios
            </button>
          </div>

          {refrescar.isPending && (
            <div className="cargando" role="status">
              Reconsultando precios en las tiendas…
            </div>
          )}
          {refrescar.isError && (
            <div className="error-rojo">
              {refrescar.error instanceof Error
                ? refrescar.error.message
                : "Error al actualizar."}
            </div>
          )}

          <Detalle resumen={resumen} />
        </>
      )}
    </section>
  );
}

function nombreTienda(resumen: BasketSummary, storeId: string): string {
  return (
    resumen.stores.find((s) => s.storeId === storeId)?.storeName ?? storeId
  );
}

/* --------------------- Filas de total por tienda ------------------ */

function Totales({ resumen }: { resumen: BasketSummary | undefined }) {
  if (!resumen) return <div className="cargando">Calculando totales…</div>;
  if (resumen.stores.length === 0) {
    return (
      <div className="vacio">
        Empareja al menos un producto con una tienda para ver el total.
      </div>
    );
  }

  // Completas primero, de más barata a más cara; incompletas al final.
  const completas = resumen.stores
    .filter((s) => s.complete && s.total !== null)
    .sort((a, b) => (a.total ?? 0) - (b.total ?? 0));
  const incompletas = resumen.stores.filter((s) => !s.complete);
  const orden = [...completas, ...incompletas];
  const ganadora = completas[0];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {orden.map((t) => {
        const esGanadora = ganadora?.storeId === t.storeId;
        const clase = esGanadora
          ? "fila-total ganadora"
          : !t.complete
            ? "fila-total incompleta"
            : "fila-total";
        return (
          <div key={t.storeId} className={clase}>
            <span
              className="punto-color"
              style={{ background: t.color }}
              aria-hidden
            />
            <span className="fila-total__info">
              <span className="fila-total__nombre">{t.storeName}</span>
              <span className="fila-total__nota">
                {t.complete
                  ? esGanadora
                    ? "Cesta completa · más barata"
                    : "Cesta completa"
                  : `Falta${t.missing > 1 ? "n" : ""} ${t.missing} producto${t.missing > 1 ? "s" : ""}: no se compara`}
              </span>
            </span>
            <span className="fila-total__importe">
              {t.total === null || (!t.complete && t.total === 0)
                ? "—"
                : formatoEUR(t.total)}
            </span>
          </div>
        );
      })}
    </div>
  );
}

/* -------------------------- Artículo ------------------------------ */

function ArticuloCesta({
  item,
  activas,
}: {
  item: ItemCesta;
  activas: { id: string; name: string; color: string }[];
}) {
  const [editando, setEditando] = useState(false);
  const [nombre, setNombre] = useState(item.genericName);
  const actualizar = useActualizarArticulo();
  const eliminar = useEliminarArticulo();

  const cubiertas = activas.filter((t) => item.matches[t.id]);

  function guardarNombre() {
    const valor = nombre.trim();
    if (valor && valor !== item.genericName) {
      actualizar.mutate({ id: item.id, genericName: valor });
    }
    setEditando(false);
  }

  return (
    <article className="tarjeta">
      <div
        style={{
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <div style={{ flex: 1, minWidth: 150 }}>
          {editando ? (
            <input
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              onBlur={guardarNombre}
              onKeyDown={(e) => e.key === "Enter" && guardarNombre()}
              autoFocus
              aria-label="Nombre del artículo"
            />
          ) : (
            <div className="producto__nombre" style={{ fontSize: 15 }}>
              {item.genericName}
            </div>
          )}
          {/* Nota de cobertura (12,5 px; en amarillo si falta alguna tienda) */}
          <div
            className="producto__datos"
            style={{
              color:
                cubiertas.length < activas.length
                  ? "var(--warn-ink)"
                  : "var(--ink-soft)",
            }}
          >
            {cubiertas.length === activas.length
              ? `${activas.length} de ${activas.length} tiendas`
              : `${cubiertas.length} de ${activas.length} tiendas`}
          </div>
        </div>

        <div className="cantidad">
          <button
            onClick={() =>
              actualizar.mutate({ id: item.id, qty: Math.max(1, item.qty - 1) })
            }
            aria-label="Quitar una unidad"
          >
            <Minus size={16} aria-hidden />
          </button>
          <span aria-label={`Cantidad ${item.qty}`}>{item.qty}</span>
          <button
            onClick={() =>
              actualizar.mutate({ id: item.id, qty: item.qty + 1 })
            }
            aria-label="Añadir una unidad"
          >
            <Plus size={16} aria-hidden />
          </button>
        </div>

        <button
          className="btn neutro mini"
          onClick={() => (editando ? guardarNombre() : setEditando(true))}
          aria-label="Editar nombre"
        >
          <Pencil size={15} aria-hidden />
        </button>
        <button
          className="btn neutro mini"
          onClick={() => eliminar.mutate(item.id)}
          aria-label="Eliminar artículo"
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </div>

      <div className="selector-tienda">
        {activas.map((t) => (
          <SelectorTienda key={t.id} tienda={t} item={item} />
        ))}
      </div>
    </article>
  );
}

/** Por cada tienda: el usuario elige qué producto representa al artículo. */
function SelectorTienda({
  tienda,
  item,
}: {
  tienda: { id: string; name: string; color: string };
  item: ItemCesta;
}) {
  const [abierto, setAbierto] = useState(false);
  const match = item.matches[tienda.id];
  const elegir = useElegirProducto();
  const quitar = useQuitarProducto();
  const { data, isFetching } = useBusqueda(item.genericName, {
    enabled: abierto,
  });

  const candidatos =
    data?.results.find((r) => r.storeId === tienda.id)?.products ?? [];

  if (match) {
    const p = match.product;
    return (
      <div className="resumen-item">
        <div className="cab">
          <span
            className="punto-color"
            style={{ background: colorDeTienda(tienda.id) }}
            aria-hidden
          />
          <strong>{tienda.name}</strong>
          <span style={{ flex: 1, minWidth: 0 }}>{p.name}</span>
          <a
            className="precio"
            style={{ fontSize: 15, color: "var(--ink)" }}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            {formatoEUR(p.price * item.qty)}
          </a>
          <button
            className="btn neutro mini"
            onClick={() =>
              quitar.mutate({ itemId: item.id, storeId: tienda.id })
            }
            aria-label={`Quitar el producto de ${tienda.name}`}
          >
            <Link2Off size={15} aria-hidden />
          </button>
        </div>
        <div className="producto__meta">
          {p.format ? `${p.format} · ` : ""}
          consultado {haceTiempo(p.fetchedAt)}
        </div>
      </div>
    );
  }

  return (
    <div style={{ marginTop: 6 }}>
      <button
        className="btn mini"
        onClick={() => setAbierto((v) => !v)}
        aria-expanded={abierto}
        style={{ width: "100%", justifyContent: "space-between" }}
      >
        <span>{tienda.name}: sin elegir producto</span>
        <ChevronDown size={16} aria-hidden />
      </button>

      {abierto && (
        <div className="tarjeta" style={{ marginTop: 6 }}>
          {isFetching && (
            <div
              className="cargando"
              style={{ border: 0, background: "transparent" }}
            >
              Consultando…
            </div>
          )}

          {!isFetching && candidatos.length === 0 && (
            <div className="vacio" style={{ padding: 12 }}>
              Sin candidatos en {tienda.name}. Búscalos en Buscar y añádelos a
              la cesta.
            </div>
          )}

          {candidatos.map((p) => (
            <button
              key={p.externalId}
              className="btn mini"
              style={{
                width: "100%",
                justifyContent: "space-between",
                marginBottom: 6,
              }}
              onClick={() => {
                if (!p.localId) return;
                elegir.mutate({
                  itemId: item.id,
                  storeId: tienda.id,
                  productId: p.localId,
                });
                setAbierto(false);
              }}
              disabled={!p.localId}
            >
              <span style={{ flex: 1, textAlign: "left" }}>
                {p.name} {p.format ? `· ${p.format}` : ""}
              </span>
              <span className="precio" style={{ fontSize: 14 }}>
                {formatoEUR(p.price)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* --------------- Detalle por producto y tienda -------------------- */

function Detalle({ resumen }: { resumen: BasketSummary | undefined }) {
  if (!resumen || resumen.rows.length === 0) return null;

  return (
    <details className="detalle-caja">
      <summary>Ver detalle por producto y tienda</summary>
      <div className="tabla-scroll">
        <table className="detalle">
          <caption className="visually-hidden">
            Precio de cada artículo en cada tienda
          </caption>
          <thead>
            <tr>
              <th scope="col">Artículo</th>
              {resumen.stores.map((t) => (
                <th key={t.storeId} scope="col">
                  {t.storeName}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {resumen.rows.map((fila) => (
              <tr key={fila.basketItemId}>
                <td>
                  {fila.genericName}{" "}
                  <span className="badge cantidad">×{fila.qty}</span>
                </td>
                {fila.cells.map((c) => (
                  <td
                    key={c.storeId}
                    className={
                      c.cheapest
                        ? "celda-mejor"
                        : c.price === null
                          ? "celda-falta"
                          : ""
                    }
                  >
                    {c.cheapest && <Star size={11} aria-hidden />}{" "}
                    {c.price === null ? "n/d" : formatoEUR(c.price)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td>Total</td>
              {resumen.stores.map((t) => (
                <td key={t.storeId}>
                  {t.total === null ? "—" : formatoEUR(t.total)}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>
    </details>
  );
}
