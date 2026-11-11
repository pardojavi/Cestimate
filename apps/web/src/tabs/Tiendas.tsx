import { useState } from "react";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { useTiendas, useTiendaMutations } from "../lib/api";
import type { Store } from "@cestimate/shared";

const ADAPTADORES = [
  { id: "mercadona", etiqueta: "Mercadona (API de tienda.mercadona.es)" },
  { id: "consum", etiqueta: "Consum (API de tienda.consum.es)" },
  { id: "aldi", etiqueta: "Aldi (buscador de aldi.es)" },
  { id: "lidl", etiqueta: "Lidl (catálogo de lidl.es)" },
  { id: "manual", etiqueta: "Manual (introduces precios tú)" },
];

/** Paleta de colores para tiendas nuevas (ESTILOS.md §2). */
const PALETA = [
  "#2F6F4E",
  "#E08E2B",
  "#2B5D8C",
  "#C23B32",
  "#7A5C9E",
  "#B08968",
  "#3E7C7C",
  "#A3444A",
];

/**
 * Tiendas (ESTILOS.md §8): lista con punto, nombre, web, chip de tipo y
 * interruptor; tarjeta discontinua «Añadir tienda»; editar y eliminar.
 */
export default function Tiendas() {
  const { data: tiendas, isLoading } = useTiendas();
  const mut = useTiendaMutations();
  const [editando, setEditando] = useState<string | null>(null);
  const [mostrarAlta, setMostrarAlta] = useState(false);

  if (isLoading) return <div className="cargando">Consultando tiendas…</div>;

  return (
    <section aria-label="Gestión de tiendas">
      <div className="seccion-titulo">
        <h2>Tiendas</h2>
        <span className="subtitulo">{tiendas?.length ?? 0} configuradas</span>
      </div>

      {tiendas?.length === 0 && (
        <div className="vacio">No hay tiendas configuradas.</div>
      )}

      {tiendas?.map((t) => (
        <TarjetaTienda
          key={t.id}
          tienda={t}
          editando={editando === t.id}
          setEditando={(v) => setEditando(v ? t.id : null)}
          mut={mut}
        />
      ))}

      {/* Tarjeta discontinua «Añadir tienda» */}
      {!mostrarAlta ? (
        <button
          className="tarjeta discontinua"
          style={{
            width: "100%",
            textAlign: "left",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "inherit",
            fontSize: 15,
            fontWeight: 600,
            color: "var(--ink)",
          }}
          onClick={() => setMostrarAlta(true)}
        >
          <Plus size={18} aria-hidden /> Añadir tienda
        </button>
      ) : (
        <div className="tarjeta discontinua">
          <FormularioTienda
            onGuardar={(datos) =>
              mut.crear.mutate(datos, {
                onSuccess: () => setMostrarAlta(false),
              })
            }
            cancelar={() => setMostrarAlta(false)}
            pendiente={mut.crear.isPending}
            error={
              mut.crear.error instanceof Error ? mut.crear.error.message : null
            }
          />
        </div>
      )}
    </section>
  );
}

function TarjetaTienda({
  tienda,
  editando,
  setEditando,
  mut,
}: {
  tienda: Store;
  editando: boolean;
  setEditando: (v: boolean) => void;
  mut: ReturnType<typeof useTiendaMutations>;
}) {
  if (editando) {
    return (
      <div className="tarjeta">
        <FormularioTienda
          inicial={tienda}
          onGuardar={(datos) =>
            mut.editar.mutate(
              { id: tienda.id, ...datos },
              { onSuccess: () => setEditando(false) },
            )
          }
          cancelar={() => setEditando(false)}
          pendiente={mut.editar.isPending}
          error={
            mut.editar.error instanceof Error ? mut.editar.error.message : null
          }
        />
      </div>
    );
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
        <span
          className="punto-color"
          style={{ background: tienda.color, width: 12, height: 12 }}
          aria-hidden
        />
        <span style={{ flex: 1, minWidth: 120 }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>{tienda.name}</div>
          {tienda.website && (
            <a
              className="producto__meta"
              style={{ textDecoration: "none" }}
              href={tienda.website}
              target="_blank"
              rel="noopener noreferrer"
            >
              {tienda.website.replace(/^https?:\/\//, "")}
            </a>
          )}
        </span>
        <ChipAdapter adapter={tienda.adapter} />
        <Interruptor
          activa={tienda.active}
          etiqueta={`Tienda ${tienda.name} activa`}
          onToggle={() =>
            mut.editar.mutate({ id: tienda.id, active: !tienda.active })
          }
        />
        <button
          className="btn neutro mini"
          onClick={() => setEditando(true)}
          aria-label={`Editar ${tienda.name}`}
        >
          <Pencil size={15} aria-hidden />
        </button>
        <button
          className="btn peligro mini"
          onClick={() => {
            if (
              confirm(`¿Eliminar la tienda «${tienda.name}» y sus precios?`)
            ) {
              mut.eliminar.mutate(tienda.id);
            }
          }}
          aria-label={`Eliminar ${tienda.name}`}
        >
          <Trash2 size={15} aria-hidden />
        </button>
      </div>

      {tienda.adapter === "manual" && (
        <ProductoManual storeId={tienda.id} mut={mut} />
      )}
    </article>
  );
}

function ChipAdapter({ adapter }: { adapter: string }) {
  if (adapter === "manual") {
    return <span className="badge manual">Manual</span>;
  }
  if (adapter === "aldi" || adapter === "lidl") {
    return (
      <span className="badge limitada">Automática · surtido limitado</span>
    );
  }
  return <span className="badge automatica">Automática</span>;
}

/** Interruptor (ESTILOS.md §6.6): role="switch", pista 46 × 28. */
function Interruptor({
  activa,
  etiqueta,
  onToggle,
}: {
  activa: boolean;
  etiqueta: string;
  onToggle: () => void;
}) {
  return (
    <button
      role="switch"
      aria-checked={activa}
      aria-label={etiqueta}
      className="switch"
      onClick={onToggle}
    >
      <span className="pista">
        <span className="bolita" />
      </span>
    </button>
  );
}

function FormularioTienda({
  inicial,
  onGuardar,
  cancelar,
  pendiente,
  error,
}: {
  inicial?: Store;
  onGuardar: (datos: {
    name: string;
    color?: string;
    website?: string | null;
    adapter?: string;
  }) => void;
  cancelar: () => void;
  pendiente: boolean;
  error: string | null;
}) {
  const [name, setName] = useState(inicial?.name ?? "");
  const [color, setColor] = useState(inicial?.color ?? "#2F6F4E");
  const [website, setWebsite] = useState(inicial?.website ?? "");
  const [adapter, setAdapter] = useState(inicial?.adapter ?? "manual");

  return (
    <div>
      <h3>{inicial ? `Editar ${inicial.name}` : "Añadir tienda"}</h3>
      <label className="campo">
        <span>Nombre</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Mi frutería"
        />
      </label>
      <div className="fila-campos">
        <label className="campo" style={{ flex: 2 }}>
          <span>Web</span>
          <input
            type="url"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
            placeholder="https://…"
          />
        </label>
        <label className="campo">
          <span>Adaptador</span>
          <select value={adapter} onChange={(e) => setAdapter(e.target.value)}>
            {ADAPTADORES.map((a) => (
              <option key={a.id} value={a.id}>
                {a.etiqueta}
              </option>
            ))}
          </select>
        </label>
      </div>
      <fieldset
        className="campo"
        style={{ border: 0, padding: 0, margin: "0 0 12px" }}
      >
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            fontWeight: 600,
            marginBottom: 5,
            color: "var(--ink-soft)",
          }}
        >
          Color
        </span>
        <div
          className="paleta-colores"
          role="radiogroup"
          aria-label="Color de la tienda"
        >
          {PALETA.map((c) => (
            <button
              key={c}
              role="radio"
              aria-checked={color.toUpperCase() === c}
              aria-label={`Color ${c}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
            />
          ))}
        </div>
      </fieldset>
      <p className="nota-seccion" style={{ marginTop: 0 }}>
        Las tiendas nuevas empiezan como manuales: introduces tú el precio y la
        URL de verificación de cada producto.
      </p>
      <div className="acciones-fila" style={{ marginTop: 6 }}>
        <button
          className="btn primario"
          disabled={pendiente || name.trim().length === 0}
          onClick={() =>
            onGuardar({
              name: name.trim(),
              color,
              website: website.trim() || null,
              adapter,
            })
          }
        >
          {inicial ? (
            <>
              <Check size={16} aria-hidden /> Guardar
            </>
          ) : (
            "Añadir tienda"
          )}
        </button>
        <button className="btn" onClick={cancelar}>
          <X size={16} aria-hidden /> Cancelar
        </button>
      </div>
      {error && <div className="error-rojo">{error}</div>}
    </div>
  );
}

/** Formulario de producto con precio manual (agent.md §3.4). */
function ProductoManual({
  storeId,
  mut,
}: {
  storeId: string;
  mut: ReturnType<typeof useTiendaMutations>;
}) {
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [url, setUrl] = useState("");

  function guardar() {
    const precio = Number(price.replace(",", "."));
    if (!name.trim() || !Number.isFinite(precio) || precio <= 0 || !url.trim())
      return;
    mut.anadirProductoManual.mutate(
      { storeId, name: name.trim(), price: precio, url: url.trim() },
      {
        onSuccess: () => {
          setName("");
          setPrice("");
          setUrl("");
        },
      },
    );
  }

  return (
    <div style={{ marginTop: 12 }}>
      <h3 style={{ fontSize: 14 }}>Añadir precio a mano</h3>
      <label className="campo">
        <span>Producto</span>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Plátano de Canarias"
        />
      </label>
      <div className="fila-campos">
        <label className="campo">
          <span>Precio (€)</span>
          <input
            inputMode="decimal"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            placeholder="1,89"
          />
        </label>
        <label className="campo" style={{ flex: 2 }}>
          <span>URL de verificación</span>
          <input
            type="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://…"
          />
        </label>
      </div>
      <button className="btn primario" onClick={guardar}>
        Añadir el precio a mano
      </button>
      {mut.anadirProductoManual.isError && (
        <div className="error-rojo">
          {mut.anadirProductoManual.error instanceof Error
            ? mut.anadirProductoManual.error.message
            : "Error al guardar."}
        </div>
      )}
      <p className="producto__meta">
        El precio se guardará con la fecha de hoy y aparecerá en Buscar.
      </p>
    </div>
  );
}
