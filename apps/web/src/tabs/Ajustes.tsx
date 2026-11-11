import { useEffect, useState } from "react";
import { Eraser, Globe, MapPin, RefreshCw, Server } from "lucide-react";
import {
  guardarBaseApi,
  obtenerBaseApi,
  useAjustes,
  useBorrarCache,
  useGuardarAjustes,
  useReindexar,
} from "../lib/api";

/** Antigüedad de la caché (ESTILOS.md §8: radiogroup 6/12/24 h). */
const OPCIONES_TTL = [6, 12, 24];

/**
 * Ajustes (agent.md §3.7 + ESTILOS.md §8): no es pestaña; se abre desde
 * Tiendas. Tarjetas: Ubicación, Antigüedad (radiogroup), Datos (borrar
 * caché), URL de la API (necesaria en GitHub Pages) y mantenimiento.
 */
export default function Ajustes() {
  const { data: ajustes } = useAjustes();
  const guardar = useGuardarAjustes();
  const borrarCache = useBorrarCache();
  const reindexar = useReindexar();

  const [postal, setPostal] = useState("");
  const [ttl, setTtl] = useState(12);
  const [urlApi, setUrlApi] = useState("");
  const [guardadoUrl, setGuardadoUrl] = useState(false);

  useEffect(() => {
    if (ajustes) {
      setPostal(ajustes.postalCode);
      setTtl(ajustes.ttlHours);
    }
  }, [ajustes]);

  useEffect(() => {
    setUrlApi(obtenerBaseApi());
  }, []);

  function guardarUrl() {
    guardarBaseApi(urlApi);
    setGuardadoUrl(true);
    setTimeout(() => setGuardadoUrl(false), 2500);
    // Recarga para que las queries usen la nueva base.
    window.location.reload();
  }

  return (
    <section aria-label="Ajustes">
      <div className="aviso">
        <strong>
          <Globe size={16} aria-hidden /> Cómo obtiene Cestimate los precios
        </strong>
        Cada resultado enlaza a la página real del producto en la tienda y
        muestra la fecha de consulta. Si una tienda falla, se indica el motivo y
        el resto de resultados se muestran igualmente. Nunca se inventan
        precios: sin dato real verá «n/d».
      </div>

      {/* Ubicación (código postal) */}
      <div className="tarjeta">
        <h3>
          <MapPin size={15} aria-hidden /> Ubicación
        </h3>
        <p className="subtitulo">
          El código postal influye en la disponibilidad y los horarios de
          entrega de algunas tiendas.
        </p>
        <label className="campo">
          <span>Código postal</span>
          <input
            inputMode="numeric"
            maxLength={5}
            value={postal}
            onChange={(e) => setPostal(e.target.value.replace(/\D/g, ""))}
            placeholder="28001"
          />
        </label>
        <button
          className="btn primario"
          disabled={guardar.isPending || postal.length !== 5}
          onClick={() => guardar.mutate({ postalCode: postal, ttlHours: ttl })}
        >
          Guardar ubicación
        </button>
        {guardar.isSuccess && (
          <span className="badge mejor" style={{ marginLeft: 8 }}>
            guardado
          </span>
        )}
        {guardar.isError && (
          <div className="error-rojo">
            {guardar.error instanceof Error
              ? guardar.error.message
              : "Error al guardar."}
          </div>
        )}
      </div>

      {/* Antigüedad de la caché: radiogroup 6 / 12 / 24 h */}
      <div className="tarjeta">
        <h3>Antigüedad de los precios</h3>
        <p className="subtitulo">
          Durante este tiempo no se vuelve a consultar la web de la tienda:
          protege las tiendas y acelera la búsqueda.
        </p>
        <div
          className="radiogroup"
          role="radiogroup"
          aria-label="Antigüedad de la caché"
        >
          {OPCIONES_TTL.map((h) => (
            <button
              key={h}
              role="radio"
              aria-checked={ttl === h}
              onClick={() => {
                setTtl(h);
                guardar.mutate({ postalCode: postal, ttlHours: h });
              }}
            >
              {h} h
            </button>
          ))}
        </div>
      </div>

      {/* URL de la API — necesaria cuando la web está publicada en GitHub Pages */}
      <div className="tarjeta">
        <h3>
          <Server size={15} aria-hidden /> URL de la API
        </h3>
        <p className="subtitulo">
          Cuando usas Cestimate desde GitHub Pages, la web necesita una API
          desplegada en la nube. Pega aquí su dirección (por ejemplo
          <code> https://cestimate-api.onrender.com</code>).
        </p>
        <label className="campo">
          <span>Dirección</span>
          <input
            type="url"
            inputMode="url"
            placeholder="http://localhost:8787"
            value={urlApi}
            onChange={(e) => setUrlApi(e.target.value)}
          />
        </label>
        <button className="btn primario" onClick={guardarUrl}>
          Guardar y conectar
        </button>
        {guardadoUrl && (
          <span className="badge mejor" style={{ marginLeft: 8 }}>
            guardado
          </span>
        )}
        {!urlApi && (
          <p className="producto__meta">
            Sin URL configurada se usa el servidor local (desarrollo).
          </p>
        )}
      </div>

      {/* Datos: borrar caché y reindexar */}
      <div className="tarjeta">
        <h3>Datos</h3>
        <p className="subtitulo">
          La caché guarda los últimos precios consultados. Borrarla obliga a
          reconsultar las webs de las tiendas en la próxima búsqueda.
        </p>
        <div className="acciones-fila" style={{ marginTop: 6 }}>
          <button
            className="btn peligro"
            onClick={() => borrarCache.mutate()}
            disabled={borrarCache.isPending}
          >
            <Eraser size={15} aria-hidden /> Borrar caché
          </button>
          <button
            className="btn"
            onClick={() => reindexar.mutate()}
            disabled={reindexar.isPending}
          >
            <RefreshCw size={15} aria-hidden /> Reindexar catálogo
          </button>
        </div>
        {borrarCache.data && (
          <div className="aviso" role="status">
            {borrarCache.data.message}
          </div>
        )}
        {reindexar.data && (
          <div className="aviso" role="status">
            {reindexar.data.resultados
              .map((r) => `${r.store}: ${r.ok ? "indexado" : r.motivo}`)
              .join(" · ")}
          </div>
        )}
        {(borrarCache.isError || reindexar.isError) && (
          <div className="error-rojo">No se pudo completar la operación.</div>
        )}
      </div>

      <div className="tarjeta">
        <h3>Cobertura de las tiendas</h3>
        <ul
          className="lista-sin-margen"
          style={{ display: "grid", gap: 6, fontSize: "0.88rem" }}
        >
          <li>
            <strong>Mercadona:</strong> catálogo completo indexado desde la API
            de tienda.mercadona.es (la primera búsqueda indexa ~152
            subcategorías).
          </li>
          <li>
            <strong>Consum:</strong> búsqueda directa en tienda.consum.es.
          </li>
          <li>
            <strong>Aldi:</strong> catálogo online de aldi.es (surtido parcial
            frente a la tienda física).
          </li>
          <li>
            <strong>Lidl:</strong> catálogo online de lidl.es, sobre todo no
            alimentación; la alimentación suele estar en el folleto semanal.
          </li>
          <li>
            <strong>Manual:</strong> introduces precio y URL tú mismo desde la
            pestaña Tiendas.
          </li>
        </ul>
      </div>

      <p className="pie">Cestimate · versión 0.1.0</p>
    </section>
  );
}
