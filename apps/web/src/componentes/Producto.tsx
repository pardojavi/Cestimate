import { ExternalLink, Plus } from "lucide-react";
import type { StoreProduct } from "@cestimate/shared";
import { haceTiempo, formatoEUR } from "@cestimate/shared";

/**
 * Fila de producto (ESTILOS.md §6.3): nombre (15 / 700), línea mono
 * «formato · precio unitario», precio a la derecha (Space Mono 18 / 700)
 * y botón «+». Si es el más barato: fondo --best, precio --best e
 * insignia «Precio más bajo». Cada precio lleva enlace y tiempo de
 * consulta («hace 2 min», Space Mono 11,5).
 */
export default function Producto({
  producto,
  destacado,
  onAnadir,
  anadiendo,
}: {
  producto: StoreProduct;
  destacado?: boolean;
  onAnadir?: (p: StoreProduct) => void;
  anadiendo?: boolean;
}) {
  const datos = [
    producto.format,
    producto.unitPrice &&
      `${formatoEUR(producto.unitPrice.value)}/${producto.unitPrice.unit}`,
  ]
    .filter(Boolean)
    .join(" · ");

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
        <span className="precio">{formatoEUR(producto.price)}</span>
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
