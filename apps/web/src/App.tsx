import { useState } from "react";
import {
  BarChart3,
  ChevronLeft,
  History,
  Search,
  Settings,
  ShoppingCart,
  Store,
} from "lucide-react";
import { MARCA } from "@cestimate/shared";
import Buscador from "./tabs/Buscador";
import Cesta from "./tabs/Cesta";
import Graficas from "./tabs/Graficas";
import Historial from "./tabs/Historial";
import Tiendas from "./tabs/Tiendas";
import Ajustes from "./tabs/Ajustes";
import { useAjustes, useCesta } from "./lib/api";

/**
 * Estructura común (ESTILOS.md §5): cabecera tinta, contenido con scroll
 * y barra de 5 pestañas. Ajustes no es pestaña: se abre desde Tiendas.
 */
type Vista =
  "buscar" | "cesta" | "graficas" | "historial" | "tiendas" | "ajustes";

const PESTANAS: {
  id: Exclude<Vista, "ajustes">;
  etiqueta: string;
  Icono: typeof Search;
}[] = [
  { id: "buscar", etiqueta: "Buscar", Icono: Search },
  { id: "cesta", etiqueta: "Cesta", Icono: ShoppingCart },
  { id: "graficas", etiqueta: "Gráficas", Icono: BarChart3 },
  { id: "historial", etiqueta: "Historial", Icono: History },
  { id: "tiendas", etiqueta: "Tiendas", Icono: Store },
];

export default function App() {
  const [vista, setVista] = useState<Vista>("buscar");
  const { data: ajustes } = useAjustes();
  const { data: cesta } = useCesta();
  const numArticulos = cesta?.items.length ?? 0;
  const pestanaActiva = vista === "ajustes" ? "tiendas" : vista;

  return (
    <>
      <header className="cabecera">
        {vista === "ajustes" ? (
          <>
            <button
              className="icono-cabecera"
              onClick={() => setVista("tiendas")}
              aria-label="Volver a Tiendas"
            >
              <ChevronLeft size={22} aria-hidden />
            </button>
            <span className="titulo-vista">Ajustes</span>
          </>
        ) : (
          <>
            <img
              className="logo"
              src="./icon.svg"
              alt=""
              width={34}
              height={34}
            />
            <div>
              <div className="nombre">{MARCA.nombre}</div>
              <div className="eslogan">{MARCA.eslogan}</div>
            </div>
            <span className="relleno" />
            {vista === "tiendas" ? (
              <button
                className="icono-cabecera"
                onClick={() => setVista("ajustes")}
                aria-label="Ajustes"
              >
                <Settings size={22} aria-hidden />
              </button>
            ) : (
              ajustes && (
                <span className="chip-codigo">{ajustes.postalCode}</span>
              )
            )}
          </>
        )}
      </header>

      <main className="contenido">
        {vista === "buscar" && <Buscador />}
        {vista === "cesta" && <Cesta irA={setVista} />}
        {vista === "graficas" && <Graficas />}
        {vista === "historial" && <Historial />}
        {vista === "tiendas" && <Tiendas />}
        {vista === "ajustes" && <Ajustes />}
      </main>

      <nav className="pestanas" aria-label="Secciones">
        {PESTANAS.map(({ id, etiqueta, Icono }) => (
          <button
            key={id}
            aria-current={pestanaActiva === id ? "page" : undefined}
            onClick={() => setVista(id)}
          >
            <Icono size={24} aria-hidden />
            {etiqueta}
            {id === "cesta" && numArticulos > 0 && (
              <span
                className="badge-cesta"
                aria-label={`${numArticulos} artículos`}
              >
                {numArticulos}
              </span>
            )}
          </button>
        ))}
      </nav>

      <footer className="pie">
        Precios obtenidos de las webs de cada tienda. Comprueba siempre el
        enlace de origen antes de comprar.
      </footer>
    </>
  );
}
