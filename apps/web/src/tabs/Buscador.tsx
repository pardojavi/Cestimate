import { useState } from "react";
import { AlertTriangle, Loader2, RotateCw, Search } from "lucide-react";
import { useAnadirArticulo, useBusqueda, useTiendas } from "../lib/api";
import type { StoreProduct, StoreSearchResult } from "@cestimate/shared";
import Producto from "../componentes/Producto";

/**
 * Buscar (ESTILOS.md §8): campo + botón, nota breve, una tarjeta de
 * tienda por tienda activa. Cada tienda informa de su estado de forma
 * independiente: con resultados, «sin resultados» o «error» + Reintentar.
 */
export default function Buscador() {
  const [texto, setTexto] = useState("");
  const [consulta, setConsulta] = useState("");
  const { data: tiendas } = useTiendas();
  const { data, isFetching, isError, error, refetch } = useBusqueda(consulta);
  const anadir = useAnadirArticulo();

  const activas = tiendas?.filter((t) => t.active) ?? [];

  // Precio más bajo de toda la respuesta (para la insignia).
  const masBarato = data?.results
    .flatMap((r) => r.products)
    .reduce<StoreProduct | null>(
      (min, p) => (min === null || p.price < min.price ? p : min),
      null,
    );

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    setConsulta(texto.trim());
  }

  return (
    <section aria-label="Buscar productos">
      <form className="busqueda" onSubmit={buscar} role="search">
        <label className="campo-busqueda">
          <span className="visually-hidden">Buscar productos</span>
          <Search size={18} aria-hidden />
          <input
            type="search"
            inputMode="search"
            placeholder="Leche, arroz, aceite…"
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            autoComplete="off"
          />
        </label>
        <button className="btn primario" type="submit">
          Buscar
        </button>
      </form>

      <p className="nota-seccion">
        Precios de la web de cada tienda para tu código postal. Cada uno lleva
        su enlace y la hora de consulta.
      </p>

      {isError && (
        <div className="aviso error" role="alert">
          <strong>
            <AlertTriangle size={16} aria-hidden /> No se pudo completar la
            búsqueda
          </strong>
          <span>
            {error instanceof Error ? error.message : "Error desconocido."}
          </span>
          <button className="btn reintentar mini" onClick={() => refetch()}>
            <RotateCw size={15} aria-hidden /> Reintentar
          </button>
        </div>
      )}

      {data && (
        <>
          {isFetching && (
            <div className="cargando" role="status">
              <Loader2 size={15} aria-hidden /> Consultando…
            </div>
          )}

          {data.results.length === 0 && (
            <div className="vacio">
              No hay tiendas activas. Activa alguna en la pestaña Tiendas.
            </div>
          )}

          {data.results.map((r) => (
            <GrupoTienda
              key={r.storeId}
              resultado={r}
              destacadoId={masBarato?.externalId}
              destacadoStore={masBarato?.storeId}
              onAnadir={(p) => anadir.mutate({ producto: p })}
              anadiendo={anadir.isPending}
            />
          ))}
        </>
      )}

      {!data && !isError && (
        <div className="vacio">
          Escribe un producto y pulsa <strong>Buscar</strong> para comparar
          precios entre tiendas.
        </div>
      )}
    </section>
  );
}

function GrupoTienda({
  resultado,
  destacadoId,
  destacadoStore,
  onAnadir,
  anadiendo,
}: {
  resultado: StoreSearchResult;
  destacadoId?: string;
  destacadoStore?: string;
  onAnadir: (p: StoreProduct) => void;
  anadiendo: boolean;
}) {
  const color = colorDeTienda(resultado.storeId);

  return (
    <div className="grupo-tienda">
      <div className="grupo-tienda__cabecera">
        <span
          className="punto-color"
          style={{ background: color }}
          aria-hidden
        />
        <span className="grupo-tienda__nombre">{resultado.storeName}</span>
        <Estado resultado={resultado} />
      </div>

      <div className="grupo-tienda__cuerpo">
        {resultado.status === "error" && (
          <div className="aviso error" role="status">
            <strong>
              <AlertTriangle size={15} aria-hidden /> Sin datos de{" "}
              {resultado.storeName}
            </strong>
            <span>
              {resultado.message} El resto de tiendas se muestra con normalidad.
            </span>
          </div>
        )}

        {resultado.status === "indexando" && (
          <div className="aviso" role="status">
            <strong>
              <Loader2 size={15} aria-hidden /> Indexando catálogo
            </strong>
            <span>{resultado.message}</span>
          </div>
        )}

        {resultado.products.map((p) => (
          <Producto
            key={`${p.storeId}-${p.externalId}`}
            producto={p}
            destacado={
              p.externalId === destacadoId && p.storeId === destacadoStore
            }
            onAnadir={onAnadir}
            anadiendo={anadiendo}
          />
        ))}

        {resultado.status === "sin-resultados" && (
          <div className="vacio" style={{ border: 0, padding: "10px 0" }}>
            {resultado.message ?? "Sin resultados."}
          </div>
        )}
      </div>
    </div>
  );
}

function Estado({ resultado }: { resultado: StoreSearchResult }) {
  const clase = "grupo-tienda__estado";
  switch (resultado.status) {
    case "ok":
      return (
        <span className={clase}>{resultado.products.length} resultados</span>
      );
    case "sin-resultados":
      return <span className={clase}>0 resultados</span>;
    case "indexando":
      return <span className={clase}>indexando…</span>;
    default:
      return <span className={`${clase} error`}>error</span>;
  }
}

export function colorDeTienda(storeId: string): string {
  const mapa: Record<string, string> = {
    mercadona: "#2f6f4e",
    consum: "#e08e2b",
    aldi: "#2b5d8c",
    lidl: "#c23b32",
  };
  return mapa[storeId] ?? "#4b5a4f";
}
