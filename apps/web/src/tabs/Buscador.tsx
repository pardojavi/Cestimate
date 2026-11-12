import { lazy, Suspense, useState } from "react";
import {
  AlertTriangle,
  Info,
  Loader2,
  RotateCw,
  ScanBarcode,
  Search,
  X,
} from "lucide-react";
import {
  terminoDeBusqueda,
  useAnadirArticulo,
  useBusqueda,
  useIdentificarCodigo,
  useTiendas,
  type IdentificacionCodigo,
} from "../lib/api";
import type { StoreProduct, StoreSearchResult } from "@cestimate/shared";
import Producto from "../componentes/Producto";

/** Se carga solo al abrir el panel: zxing-wasm (~1 MB) va en su propio chunk. */
const Escaner = lazy(() => import("../componentes/Escaner"));

/**
 * Buscar (ESTILOS.md §8): campo + botón, nota breve, una tarjeta de
 * tienda por tienda activa. Cada tienda informa de su estado de forma
 * independiente: con resultados, «sin resultados» o «error» + Reintentar.
 *
 * Además permite marcar productos de distintas tiendas (aunque tengan
 * nombres diferentes) y añadirlos a la cesta de una vez, ya emparejados
 * para comparar (§3.2).
 */
export default function Buscador({ irA }: { irA?: (v: "cesta") => void }) {
  const [texto, setTexto] = useState("");
  const [consulta, setConsulta] = useState("");
  const [marcados, setMarcados] = useState<Record<string, StoreProduct>>({});
  const [mostrarEscaneador, setMostrarEscaneador] = useState(false);
  const [identificacion, setIdentificacion] =
    useState<IdentificacionCodigo | null>(null);
  const { data: tiendas } = useTiendas();
  const { data, isFetching, isError, error, refetch } = useBusqueda(consulta);
  const anadir = useAnadirArticulo();
  const identificar = useIdentificarCodigo();

  const activas = tiendas?.filter((t) => t.active) ?? [];
  const listaMarcados = Object.values(marcados);

  // ¿Hay una consulta en curso? La query está habilitada con ≥2 caracteres
  // (ver useBusqueda): sin datos y sin error significa que está fetchando o
  // a punto de hacerlo (el fotograma previo al arranque: isFetching aún
  // false). Sin esto, el estado vacío parpadearía al pulsar Buscar.
  const cargando = !data && !isError && consulta.trim().length >= 2;
  // Para el botón: incluye también los refetch con datos ya en pantalla.
  const buscando = cargando || isFetching;

  // Precio más bajo de toda la respuesta (para la insignia).
  const masBarato = data?.results
    .flatMap((r) => r.products)
    .reduce<StoreProduct | null>(
      (min, p) => (min === null || p.price < min.price ? p : min),
      null,
    );

  function buscar(e: React.FormEvent) {
    e.preventDefault();
    setIdentificacion(null);
    setConsulta(texto.trim());
  }

  /** Recibe un código del escáner o de la entrada manual y lo identifica. */
  function identificarCodigo(codigo: string) {
    identificar.mutate(codigo, {
      onSuccess: (ident) => {
        setIdentificacion(ident);
        // Si hay chip, SIEMPRE se lanza la búsqueda (antes solo ocurría si
        // había nombre y un producto «conocido pero sin nombre» dejaba el
        // chip sin resultados ni aviso). `terminoDeBusqueda` pone el nombre
        // solo —la marca (p. ej. «MERCADONA») no aparece en los nombres de
        // las tiendas: usan su propia marca: Hacendado, Consum…— o, si OFF
        // solo conoce la marca, la propia marca (campo editable).
        const termino = terminoDeBusqueda(ident);
        if (termino) {
          setTexto(termino);
          setConsulta(termino);
          setMostrarEscaneador(false);
        }
        // Si no se encontró, el panel queda abierto: el aviso §6.4 invita a
        // escribir el nombre a mano en el campo de búsqueda.
      },
    });
  }

  /** Cierra el chip de identificación. */
  function cerrarIdentificacion() {
    setIdentificacion(null);
  }

  /** Marca/desmarca un producto; por tienda solo vale uno (gana el último). */
  function alternar(p: StoreProduct) {
    setMarcados((prev) => {
      const clave = `${p.storeId}:${p.externalId}`;
      const nuevo = { ...prev };
      if (nuevo[clave]) {
        delete nuevo[clave];
      } else {
        for (const k of Object.keys(nuevo)) {
          if (nuevo[k]!.storeId === p.storeId) delete nuevo[k];
        }
        nuevo[clave] = p;
      }
      return nuevo;
    });
  }

  function anadirComparacion() {
    anadir.mutate(
      { productos: listaMarcados },
      {
        onSuccess: () => {
          setMarcados({});
          irA?.("cesta");
        },
      },
    );
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
          <button
            type="button"
            className="btn-escanear"
            onClick={() => setMostrarEscaneador((v) => !v)}
            aria-label={
              mostrarEscaneador ? "Cerrar escáner" : "Escanear código de barras"
            }
            aria-expanded={mostrarEscaneador}
            title="Escanear código de barras"
          >
            <ScanBarcode size={18} aria-hidden />
          </button>
        </label>
        {/* No se deshabilita: si la búsqueda tarda, el usuario puede cambiar
            de consulta (React Query desduplica por clave, así que pulsar
            dos veces lo mismo no dispara dos peticiones). */}
        <button className="btn primario" type="submit" aria-busy={buscando}>
          {buscando ? (
            <>
              <Loader2 size={15} aria-hidden className="girar" /> Buscando…
            </>
          ) : (
            "Buscar"
          )}
        </button>
      </form>

      {mostrarEscaneador && (
        <Suspense
          fallback={
            <div className="cargando" role="status">
              <Loader2 size={15} aria-hidden /> Cargando escáner…
            </div>
          }
        >
          <Escaner
            onDetectado={identificarCodigo}
            onCerrar={() => setMostrarEscaneador(false)}
          />
        </Suspense>
      )}

      {identificar.isPending && (
        <div className="cargando" role="status">
          <Loader2 size={15} aria-hidden /> Identificando código…
        </div>
      )}

      {identificar.isError && (
        <div className="aviso error" role="alert">
          <strong>
            <AlertTriangle size={16} aria-hidden /> No se pudo identificar el
            código
          </strong>
          <span>
            {identificar.error instanceof Error
              ? identificar.error.message
              : "Error desconocido."}{" "}
            Escribe el nombre del producto a mano para buscarlo.
          </span>
        </div>
      )}

      {identificacion &&
        !identificacion.encontrado &&
        !identificar.isPending && (
          <div className="aviso warn" role="status">
            <strong>
              <AlertTriangle size={16} aria-hidden /> Código no reconocido
            </strong>
            <span>
              Open Food Facts no tiene este producto. Escribe su nombre en el
              campo de búsqueda para compararlo entre tiendas.
            </span>
            <button
              className="btn reintentar mini"
              onClick={() => setMostrarEscaneador(false)}
            >
              <X size={15} aria-hidden /> Cerrar escáner
            </button>
          </div>
        )}

      {identificacion && identificacion.encontrado && (
        <div className="chip-identificacion" role="status">
          <Info size={13} aria-hidden />
          <span>
            <strong>{identificacion.code}</strong> · {identificacion.nombre}
            {identificacion.marca ? ` (${identificacion.marca})` : ""} ·
            identificado con{" "}
            <a
              href={identificacion.fuenteUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {identificacion.fuente}
            </a>
          </span>
          <button
            className="chip-identificacion__cerrar"
            onClick={cerrarIdentificacion}
            aria-label="Quitar identificación"
          >
            <X size={14} aria-hidden />
          </button>
        </div>
      )}

      {identificacion &&
        identificacion.encontrado &&
        !identificacion.nombre &&
        !identificar.isPending && (
          <div className="aviso warn" role="status">
            <strong>
              <AlertTriangle size={16} aria-hidden /> Solo se conoce la marca
            </strong>
            <span>
              Open Food Facts tiene este producto pero sin nombre (solo la marca
              {identificacion.marca ? ` ${identificacion.marca}` : ""}). Hemos
              buscado por la marca: completa el nombre en el campo para
              compararlo entre tiendas.
            </span>
          </div>
        )}

      <p className="nota-seccion">
        Precios de la web de cada tienda para tu código postal. Cada uno lleva
        su enlace y la hora de consulta.
      </p>

      {/* Región viva permanente: anuncia el estado de la consulta aunque
          el contenido visual cambie (los esqueletos son decorativos). */}
      <span className="visually-hidden" role="status">
        {isFetching ? "Consultando precios…" : ""}
      </span>

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

      {/* Carga inicial (§6.8): esqueleto por tienda activa con «Consultando…»
          en la cabecera. Sin esto, la primera búsqueda (que indexa el
          catálogo de Mercadona y tarda) no daba señal ninguna de trabajo. */}
      {cargando && (
        <div className="esqueletos" aria-hidden="true">
          {activas.length > 0 ? (
            activas.map((t) => (
              <div className="grupo-tienda" key={t.id}>
                <div className="grupo-tienda__cabecera">
                  <span
                    className="punto-color"
                    style={{ background: colorDeTienda(t.id) }}
                  />
                  <span className="grupo-tienda__nombre">{t.name}</span>
                  <span className="grupo-tienda__estado">
                    <Loader2
                      size={12}
                      aria-hidden
                      className="girar esqueleto__spinner"
                    />
                    Consultando…
                  </span>
                </div>
                <div className="grupo-tienda__cuerpo">
                  {[0, 1, 2].map((i) => (
                    <div className="esqueleto-fila" key={i}>
                      <span className="esqueleto-img" />
                      <span className="esqueleto-texto">
                        <span className="esqueleto-linea" />
                        <span className="esqueleto-linea esqueleto-linea--corta" />
                      </span>
                      <span className="esqueleto-precio" />
                    </div>
                  ))}
                </div>
              </div>
            ))
          ) : (
            <div className="cargando">
              <Loader2 size={15} aria-hidden className="girar" /> Consultando
              precios…
            </div>
          )}
        </div>
      )}

      {data && (
        <>
          {isFetching && (
            <div className="cargando">
              <Loader2 size={15} aria-hidden className="girar" /> Consultando
              precios…
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
              onAnadir={(p) => anadir.mutate({ productos: [p] })}
              anadiendo={anadir.isPending}
              marcados={marcados}
              onToggle={alternar}
            />
          ))}
        </>
      )}

      {!data && !cargando && !isError && (
        <div className="vacio">
          Escribe un producto y pulsa <strong>Buscar</strong> para comparar
          precios entre tiendas. También puedes escanear el código de barras con
          el icono <ScanBarcode size={14} aria-hidden /> del campo.
        </div>
      )}

      {listaMarcados.length > 0 && (
        <>
          <div className="barra-comparacion" role="status">
            <div className="barra-comparacion__datos">
              {anadir.isError ? (
                <strong className="barra-comparacion__error">
                  {anadir.error instanceof Error
                    ? anadir.error.message
                    : "No se pudo añadir a la cesta."}
                </strong>
              ) : (
                <strong>
                  {listaMarcados.length} producto
                  {listaMarcados.length === 1 ? "" : "s"} marcado
                  {listaMarcados.length === 1 ? "" : "s"}
                </strong>
              )}
              <div className="barra-comparacion__chips">
                {listaMarcados.map((p) => (
                  <span
                    key={`${p.storeId}:${p.externalId}`}
                    className="chip-tienda"
                  >
                    <span
                      className="punto-color"
                      style={{ background: colorDeTienda(p.storeId) }}
                      aria-hidden
                    />
                    {tiendas?.find((t) => t.id === p.storeId)?.name ??
                      p.storeId}
                  </span>
                ))}
              </div>
            </div>
            <button
              className="btn primario"
              onClick={anadirComparacion}
              disabled={anadir.isPending}
            >
              {anadir.isPending ? "Añadiendo…" : "Comparar en la cesta"}
            </button>
          </div>
          <div className="relleno-barra" aria-hidden />
        </>
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
  marcados,
  onToggle,
}: {
  resultado: StoreSearchResult;
  destacadoId?: string;
  destacadoStore?: string;
  onAnadir: (p: StoreProduct) => void;
  anadiendo: boolean;
  marcados: Record<string, StoreProduct>;
  onToggle: (p: StoreProduct) => void;
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
            seleccionado={!!marcados[`${p.storeId}:${p.externalId}`]}
            onToggle={onToggle}
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
