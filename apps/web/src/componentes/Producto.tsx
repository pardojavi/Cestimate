import { ExternalLink, Plus } from "lucide-react";
import type { StoreProduct } from "@cestimate/shared";
import { haceTiempo, formatoEUR } from "@cestimate/shared";
import { formatoPeso, precioPorPeso } from "../lib/peso";

/**
 * Fila de resultado (ESTILOS.md §6.3): nombre (15 / 700), línea mono
 * «formato · precio unitario», precio a la derecha (Space Mono 18 / 700)
 * y botón «+». Si es el más barato: fondo --best, precio --best e
 * insignia «Precio más bajo». Cada precio lleva enlace y tiempo de
 * consulta («hace 2 min», Space Mono 11,5).
 *
 * Con `pesoKg` (modo «comparar por peso») los productos que cotizan por
 * kilo muestran como precio principal el **calculado para ese peso**
 * (€/kg × peso) con la etiqueta «para X kg» debajo; el €/kg real sigue en
 * la línea mono para poder verificarlo. Los no comparables (€/L, €/ud)
 * conservan su precio real.
 */
export default function Producto({
  producto,
  destacado,
  onAnadir,
  anadiendo,
  seleccionado,
  onToggle,
  pesoKg,
}: {
  producto: StoreProduct;
  destacado?: boolean;
  onAnadir?: (p: StoreProduct) => void;
  anadiendo?: boolean;
  /** Casilla «marcar para comparar» (pestaña Buscar). */
  seleccionado?: boolean;
  /** Si no se pasa, no se muestra la casilla. */
  onToggle?: (p: StoreProduct) => void;
  /** Peso en kg del modo «comparar por peso» (null: precio real). */
  pesoKg?: number | null;
}) {
  const datos = [
    producto.format,
    producto.unitPrice &&
      `${formatoEUR(producto.unitPrice.value)}/${producto.unitPrice.unit}`,
  ]
    .filter(Boolean)
    .join(" · ");

  const unit = producto.unitPrice;
  const calculado = pesoKg != null ? precioPorPeso(producto, pesoKg) : null;
  const precioVisible = calculado ?? producto.price;
  // Transparencia: el precio calculado explica de dónde sale.
  const tituloCalculo =
    calculado !== null && unit && pesoKg != null
      ? `Calculado: ${formatoEUR(unit.value)}/${unit.unit} × ${formatoPeso(pesoKg)} kg`
      : undefined;

  return (
    <article className={destacado ? "producto destacado" : "producto"}>
      {producto.imageUrl ? (
        <img
          className="producto__img"
          src={producto.imageUrl}
          alt=""
          loading="lazy"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.visibility = "hidden";
          }}
        />
      ) : (
        <div className="producto__img" aria-hidden />
      )}

      <div className="producto__info">
        <div className="producto__nombre">
          {producto.name}
          {destacado && (
            <>
              {" "}
              <span className="badge mejor">Precio más bajo</span>
            </>
          )}
        </div>
        {datos && <div className="producto__datos">{datos}</div>}
        <div className="producto__meta">
          {haceTiempo(producto.fetchedAt)} ·{" "}
          <a
            className="enlace-precio"
            href={producto.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            ver en la tienda <ExternalLink size={11} aria-hidden />
          </a>
        </div>
      </div>

      <div className="producto__acciones">
        {onToggle && (
          <label
            className="casilla-marcar"
            title={
              producto.localId
                ? "Marcar para comparar en la cesta"
                : "Producto no localizable en la base de datos"
            }
          >
            <input
              type="checkbox"
              checked={!!seleccionado}
              onChange={() => onToggle(producto)}
              disabled={!producto.localId}
              aria-label={`Marcar ${producto.name} para comparar`}
            />
          </label>
        )}
        <span
          className="precio"
          title={tituloCalculo}
          aria-label={
            calculado !== null && pesoKg != null
              ? `${formatoEUR(calculado)} para ${formatoPeso(pesoKg)} kg (calculado con el precio por kilo de la tienda)`
              : undefined
          }
        >
          {formatoEUR(precioVisible)}
        </span>
        {calculado !== null && pesoKg != null && (
          <span className="producto__peso">para {formatoPeso(pesoKg)} kg</span>
        )}
        {onAnadir && (
          <button
            className="btn-anadir"
            onClick={() => onAnadir(producto)}
            disabled={anadiendo || !producto.localId}
            aria-label={`Añadir ${producto.name} a la cesta`}
            title={
              producto.localId
                ? "Añadir a la cesta"
                : "Producto no localizable en la base de datos"
            }
          >
            <Plus size={24} aria-hidden />
          </button>
        )}
      </div>
    </article>
  );
}
