import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatoEUR } from "@cestimate/shared";
import { useResumen, useResumenStats, useStats } from "../lib/api";

const COLORES: Record<string, string> = {
  mercadona: "#2f6f4e",
  consum: "#e08e2b",
  aldi: "#2b5d8c",
  lidl: "#c23b32",
};

function colorDe(storeId: string): string {
  return COLORES[storeId] ?? "#4b5a4f";
}

const ejePrecio = (v: number) => `${v.toFixed(2)} €`;

/** Fecha para ejes y tooltips: «10:15» si todo es del mismo día; si no, «11/11 10:15». */
const ejeFecha =
  (soloHora: boolean) =>
  (v: string): string => {
    const d = new Date(v);
    if (!Number.isFinite(d.getTime())) return v;
    const hora = d.toLocaleTimeString("es-ES", {
      hour: "2-digit",
      minute: "2-digit",
    });
    if (soloHora) return hora;
    const dia = d.toLocaleDateString("es-ES", {
      day: "2-digit",
      month: "2-digit",
    });
    return `${dia} ${hora}`;
  };

/**
 * Gráficas (ESTILOS.md §7 y §8): dos tarjetas de estadística en rejilla
 * de 2 columnas, barras horizontales del total actual, evolución de
 * cestas guardadas y evolución de precios.
 */
export default function Graficas() {
  const { data: resumen } = useResumen(false);
  const { data: stats } = useStats();
  const { data: rs } = useResumenStats();

  // Barras horizontales: total por tienda (completas primero).
  const totales = (resumen?.stores ?? [])
    .filter((s) => s.total !== null)
    .sort((a, b) => {
      if (a.complete !== b.complete) return a.complete ? -1 : 1;
      return (a.total ?? 0) - (b.total ?? 0);
    });
  const maxTotal = Math.max(...totales.map((t) => t.total ?? 0), 1);

  // Evolución: totales de cestas guardadas por fecha.
  const fechas = [...new Set((stats?.baskets ?? []).map((b) => b.date))];
  const seriesNombres = [
    ...new Set(
      (stats?.baskets ?? []).flatMap((b) => b.values.map((v) => v.storeName)),
    ),
  ];
  const evolucion = fechas.map((fecha) => {
    const entrada: Record<string, string | number> = { fecha };
    for (const b of stats?.baskets ?? []) {
      if (b.date !== fecha) continue;
      for (const v of b.values)
        entrada[v.storeName] = Number(v.total.toFixed(2));
    }
    return entrada;
  });

  const colorSerie = (nombre: string): string => {
    const v = (stats?.baskets ?? [])
      .flatMap((b) => b.values)
      .find((x) => x.storeName === nombre);
    return v ? colorDe(v.storeId) : "#4b5a4f";
  };

  // Evolución de precios de productos emparejados (más de un punto).
  const productos = (stats?.products ?? []).filter((p) => p.points.length > 1);

  // Ejes: hora sola si todo el rango es de un mismo día.
  const mismoDiaEvol = new Set(fechas.map((f) => f.slice(0, 10))).size <= 1;
  const mismoDiaProd =
    new Set(
      productos.flatMap((p) => p.points.map((pt) => pt.date.slice(0, 10))),
    ).size <= 1;
  const fmtEvol = ejeFecha(mismoDiaEvol);
  const fmtProd = ejeFecha(mismoDiaProd);

  const tiendaMasBarata = rs?.cheapestWins
    .slice()
    .sort((a, b) => b.count - a.count)[0];

  return (
    <section aria-label="Gráficas y estadísticas">
      <div className="rejilla-stats">
        <div className="tarjeta-stat">
          <div className="etiqueta">Tienda más barata</div>
          <div className="valor">{tiendaMasBarata?.store ?? "sin datos"}</div>
          <div className="nota">
            {tiendaMasBarata
              ? `${tiendaMasBarata.count} de ${rs?.comparisons ?? 0} cestas`
              : "Guarda cestas para acumular datos"}
          </div>
        </div>
        <div className="tarjeta-stat">
          <div className="etiqueta">Ahorro acumulado</div>
          <div className="valor best">{formatoEUR(rs?.totalSaving ?? 0)}</div>
          <div className="nota">frente a la tienda más cara</div>
        </div>
      </div>

      {totales.length === 0 ? (
        <div className="vacio">
          Empareja productos en la cesta para ver el total por tienda.
        </div>
      ) : (
        <div className="grafica-caja">
          <h3>Total de la cesta por tienda</h3>
          <ul className="lista-sin-margen" style={{ display: "grid", gap: 10 }}>
            {totales.map((t) => (
              <li key={t.storeId}>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: 8,
                    marginBottom: 4,
                  }}
                >
                  <span style={{ fontSize: 14, fontWeight: 600 }}>
                    {t.storeName}
                  </span>
                  <span
                    style={{
                      fontFamily: "var(--fuente-precio)",
                      fontWeight: 700,
                      fontSize: 14,
                    }}
                  >
                    {formatoEUR(t.total!)}
                  </span>
                </div>
                {/* Pista --paper, relleno del color de la tienda, radio 4 */}
                <div
                  style={{
                    height: 14,
                    background: "var(--paper)",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                  role="img"
                  aria-label={`${t.storeName}: ${formatoEUR(t.total!)}`}
                >
                  <div
                    style={{
                      height: "100%",
                      width: `${Math.max(4, ((t.total ?? 0) / maxTotal) * 100)}%`,
                      background: t.complete ? colorDe(t.storeId) : "#9fb1d0",
                      borderRadius: 4,
                    }}
                  />
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: "var(--ink-soft)",
                    marginTop: 3,
                  }}
                >
                  {t.complete
                    ? t.storeId === resumen?.cheapest
                      ? "cesta completa · más barata"
                      : "cesta completa"
                    : `incompleta: falta${t.missing > 1 ? "n" : ""} ${t.missing} producto${t.missing > 1 ? "s" : ""} (no se compara)`}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      {evolucion.length > 1 && (
        <div
          className="grafica-caja"
          aria-label="Evolución del total por tienda"
        >
          <h3>Evolución del total por tienda</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart
              data={evolucion}
              margin={{ top: 8, right: 32, left: 0, bottom: 0 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#d8decb" />
              <XAxis
                dataKey="fecha"
                tickFormatter={fmtEvol}
                minTickGap={36}
                tick={{
                  fontSize: 11,
                  fontFamily: "Space Mono",
                  fill: "#4b5a4f",
                }}
              />
              <YAxis
                tickFormatter={ejePrecio}
                tick={{
                  fontSize: 11,
                  fontFamily: "Space Mono",
                  fill: "#4b5a4f",
                }}
                width={64}
              />
              <Tooltip
                formatter={(v) => formatoEUR(Number(v))}
                labelFormatter={(v) => fmtEvol(String(v))}
              />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              {seriesNombres.map((n) => (
                <Line
                  key={n}
                  type="monotone"
                  dataKey={n}
                  name={n}
                  stroke={colorSerie(n)}
                  strokeWidth={3}
                  strokeDasharray={n === "Consum" ? "6 3" : undefined}
                  dot={{
                    r: 3,
                    fill: "#fff",
                    stroke: colorSerie(n),
                    strokeWidth: 2,
                  }}
                  activeDot={{ r: 5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {productos.length > 0 && (
        <div
          className="grafica-caja"
          aria-label="Evolución del precio de tus productos"
        >
          <h3>Evolución del precio de tus productos</h3>
          <ResponsiveContainer width="100%" height={220}>
            <LineChart margin={{ top: 8, right: 32, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d8decb" />
              <XAxis
                dataKey="date"
                type="category"
                allowDuplicatedCategory={false}
                tickFormatter={fmtProd}
                minTickGap={36}
                tick={{
                  fontSize: 10,
                  fontFamily: "Space Mono",
                  fill: "#4b5a4f",
                }}
              />
              <YAxis
                tickFormatter={ejePrecio}
                tick={{
                  fontSize: 11,
                  fontFamily: "Space Mono",
                  fill: "#4b5a4f",
                }}
                width={64}
              />
              <Tooltip
                formatter={(v) => formatoEUR(Number(v))}
                labelFormatter={(v) => fmtProd(String(v))}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {productos.map((p) => (
                <Line
                  key={p.productId}
                  data={p.points.map((pt) => ({ ...pt, name: p.name }))}
                  dataKey="price"
                  name={`${p.name} (${p.storeName})`}
                  type="stepAfter"
                  stroke={colorDe(p.storeId)}
                  strokeWidth={3}
                  dot={{ r: 2.5 }}
                />
              ))}
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      <div className="seccion-titulo">
        <h2>Estadísticas</h2>
      </div>

      <div className="tarjeta">
        {rs && rs.savedBaskets === 0 ? (
          <p className="subtitulo" style={{ margin: 0 }}>
            Guarda cestas en Historial para acumular estadísticas de ahorro.
          </p>
        ) : (
          <ul className="lista-sin-margen" style={{ display: "grid", gap: 8 }}>
            <li style={{ fontSize: 14 }}>
              <strong>Cestas guardadas:</strong> {rs?.savedBaskets ?? 0}
            </li>
            <li style={{ fontSize: 14 }}>
              <strong>Comparaciones:</strong> {rs?.comparisons ?? 0}
            </li>
            <li style={{ fontSize: 14 }}>
              <strong>Mayores diferencias de precio:</strong>{" "}
              {rs && rs.biggestDiffs.length > 0 ? (
                <ul className="lista-sin-margen" style={{ marginTop: 6 }}>
                  {rs.biggestDiffs.slice(0, 5).map((d) => (
                    <li key={d.name} style={{ fontSize: 13.5 }}>
                      {d.name}: {formatoEUR(d.min)} – {formatoEUR(d.max)}{" "}
                      <span className="diferencia sube">
                        (+{formatoEUR(d.diff)})
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                "todavía sin datos"
              )}
            </li>
          </ul>
        )}
      </div>
    </section>
  );
}
