"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import { adminProductsApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type { Product } from "@coffee-bar/shared";
import {
  C,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  fmt,
  btnPrimary,
  btnGhost,
  BUTTON_STYLES,
  SHARED_KEYFRAMES,
  DUR_BASE,
} from "@/lib/theme";
import { ProductDetailPanel } from "@/components/admin/ProductDetailPanel";

// ─── Page ────────────────────────────────────────────────────────────────────
export default function AdminProductsPage() {
  // El state del catálogo vive en el page (no en CatalogTab) para que el
  // header (búsqueda, CTA "Nuevo") pueda interactuar directamente con el
  // catálogo sin tener que pasar callbacks a través de refs. Esto también
  // prepara el terreno para el panel derecho contextual (Paso 5), que
  // necesitará leer/escribir esta misma data.
  const router = useRouter();
  const searchParams = useSearchParams();

  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<
    "all" | "active" | "low_stock" | "inactive"
  >("all");
  const [categoryFilter, setCategoryFilter] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  // Editor solo se usa para "crear" — editar pasa al panel derecho inline.
  // Mantenemos el state como objeto por consistencia con el modal existente.
  const [editor, setEditor] = useState<{ mode: "create" } | null>(null);

  // Cuando el operador clickea "+ Stock" en una fila, queremos: (1)
  // seleccionar el producto, (2) abrir el panel directamente en modo
  // stock. Trackeamos el "intent" del último cambio de selección — si
  // vino de "+ Stock" el panel arranca en modo stock; si vino de un
  // click normal en la fila, arranca en modo view. El nonce dentro del
  // intent fuerza el remount del panel aunque el operador clickee dos
  // veces "+ Stock" en la misma fila.
  const [panelIntent, setPanelIntent] = useState<{
    mode: "view" | "stock";
    nonce: number;
  }>({ mode: "view", nonce: 0 });

  // Selección persistida en query param `?id=X` para que el operador pueda
  // refrescar / compartir un link directo a un producto concreto. El Paso 5
  // usará `selectedId` para alimentar el panel derecho contextual; por
  // ahora solo aplica el highlight visual de la fila.
  const selectedIdRaw = searchParams?.get("id");
  const selectedId = selectedIdRaw ? Number(selectedIdRaw) : null;
  const setSelectedId = useCallback(
    (id: number | null) => {
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      if (id == null) params.delete("id");
      else params.set("id", String(id));
      const qs = params.toString();
      router.replace(qs ? `?${qs}` : "?", { scroll: false });
    },
    [router, searchParams],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // El filtro por activos/inactivos vive en el cliente (tabs).
      // Pedimos TODO al backend para que la grilla pueda mostrar las
      // dos vistas sin un round-trip extra al cambiar de tab.
      const list = await adminProductsApi.getAll({ include_inactive: true });
      setProducts(list);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Derivado de selectedId — siempre miramos al `products` actual para
  // que después de un refresh el panel muestre la versión nueva del
  // producto editado.
  const selectedProduct = useMemo(
    () =>
      selectedId == null
        ? null
        : products.find((p) => p.id === selectedId) ?? null,
    [products, selectedId],
  );

  // Aplicar filtros en el page (no en Catalog) para poder usar la misma
  // lista en el keyboard handler de abajo. Si el cálculo se quedaba en
  // Catalog, tendríamos que duplicarlo aquí o exponerlo via ref — peor.
  const filtered = useMemo(() => {
    let list = products;
    // Tab "all" oculta inactivos por design (los inactivos viven en
    // su propio tab para no contaminar la operación normal).
    if (filter === "all") list = list.filter((p) => p.is_active);
    else if (filter === "active") list = list.filter((p) => p.is_active);
    else if (filter === "inactive") list = list.filter((p) => !p.is_active);
    else if (filter === "low_stock")
      list = list.filter(
        (p) => p.is_active && (p.is_low_stock || p.is_out_of_stock),
      );
    if (categoryFilter) {
      list = list.filter((p) => p.category === categoryFilter);
    }
    const q = query.trim().toLowerCase();
    if (q.length > 0) {
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          (p.category ?? "").toLowerCase().includes(q),
      );
    }
    return list;
  }, [products, filter, categoryFilter, query]);

  // Keyboard navigation: ↑/↓ mueven la selección dentro del catálogo
  // filtrado, Escape cierra el panel. Ignoramos las teclas si el foco
  // está en un input/textarea/select/contenteditable (típicamente la
  // barra de búsqueda) — el operador escribe normalmente sin que el
  // page secuestre los flechazos del cursor.
  useEffect(() => {
    function isFormElement(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      if (target.isContentEditable) return true;
      return false;
    }
    function onKeyDown(e: KeyboardEvent) {
      if (isFormElement(e.target)) return;
      if (e.key === "Escape") {
        if (selectedId != null) {
          e.preventDefault();
          setSelectedId(null);
        }
        return;
      }
      if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return;
      if (filtered.length === 0) return;
      e.preventDefault();
      const currentIndex = selectedId
        ? filtered.findIndex((p) => p.id === selectedId)
        : -1;
      const nextIndex =
        e.key === "ArrowDown"
          ? (currentIndex < 0 ? 0 : Math.min(filtered.length - 1, currentIndex + 1))
          : (currentIndex < 0 ? filtered.length - 1 : Math.max(0, currentIndex - 1));
      const next = filtered[nextIndex];
      if (next) {
        setSelectedId(next.id);
        setPanelIntent((prev) => ({ mode: "view", nonce: prev.nonce + 1 }));
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [filtered, selectedId, setSelectedId]);

  return (
    <>
    <style>{`
      ${SHARED_KEYFRAMES}
      ${BUTTON_STYLES}
    `}</style>
    <main
      style={{
        minHeight: "100dvh",
        background: C.cream,
        color: C.ink,
        fontFamily: FONT_UI,
        padding: "20px 24px 40px",
      }}
    >
      <header
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 18,
          flexWrap: "wrap",
          gap: 12,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
          <Link
            href="/admin"
            className="crown-btn crown-btn-ghost"
            aria-label="Volver al tablero"
            style={{
              ...btnGhost({ fg: C.cacao, border: C.sand }),
              textDecoration: "none",
              padding: "6px 12px",
              fontSize: 11,
            }}
          >
            ←
          </Link>
          <div>
            <span
              style={{
                fontFamily: FONT_MONO,
                fontSize: 9,
                letterSpacing: 3,
                color: C.mute,
                textTransform: "uppercase",
                fontWeight: 600,
              }}
            >
              — Crown Bar 4.90
            </span>
            <h1
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 26,
                color: C.ink,
                letterSpacing: 4,
                margin: "2px 0 0",
                textTransform: "uppercase",
              }}
            >
              Productos
            </h1>
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", flex: 1, justifyContent: "flex-end", minWidth: 0 }}>
          <SearchInput value={query} onChange={setQuery} />
          <button
            type="button"
            className="crown-btn crown-btn-primary"
            onClick={() => setEditor({ mode: "create" })}
            style={btnPrimary({ bg: C.olive, fg: C.paper })}
          >
            + Nuevo producto
          </button>
        </div>
      </header>

      {/* Layout 3 columnas:
            sidebar filtros (220px) | catálogo (1fr) | detalle (360px)
          Todas siempre visibles. El catálogo se ajusta al espacio sobrante;
          el detalle solo muestra contenido cuando hay producto seleccionado.
          En pantallas chicas el grid se ajusta con minmax para evitar
          overflow horizontal. */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "220px minmax(0, 1fr) 360px",
          gap: 16,
          alignItems: "start",
        }}
      >
        <CatalogFilters
          products={products}
          filter={filter}
          onFilterChange={setFilter}
          categoryFilter={categoryFilter}
          onCategoryChange={setCategoryFilter}
        />
        <Catalog
          filtered={filtered}
          loading={loading}
          error={error}
          query={query}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id);
            setPanelIntent((p) => ({ mode: "view", nonce: p.nonce + 1 }));
          }}
          onStock={(p) => {
            setSelectedId(p.id);
            setPanelIntent((prev) => ({
              mode: "stock",
              nonce: prev.nonce + 1,
            }));
          }}
        />
        {/* `key` fuerza remount del panel cada vez que cambia el intent
            del operador (selección normal vs "+ Stock"), reseteando el
            `mode` interno sin setState-in-effect. */}
        <ProductDetailPanel
          key={
            selectedProduct
              ? `${selectedProduct.id}-${panelIntent.nonce}`
              : "empty"
          }
          product={selectedProduct}
          initialMode={panelIntent.mode}
          allProducts={products}
          onSaved={() => void refresh()}
          onClose={() => setSelectedId(null)}
        />
      </div>

      {editor && (
        <ProductFormModal
          mode={editor.mode}
          product={null}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
          }}
        />
      )}
    </main>
    </>
  );
}

/**
 * Input de búsqueda del header. Búsqueda client-side por nombre y
 * categoría — para 100 productos `includes()` corre instantáneo. Si en
 * el futuro pasamos a 500+, swap a Fuse.js sin tocar la API del componente.
 */
function SearchInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div
      style={{
        position: "relative",
        flex: "1 1 220px",
        maxWidth: 360,
        minWidth: 180,
      }}
    >
      <span
        aria-hidden
        style={{
          position: "absolute",
          left: 12,
          top: "50%",
          transform: "translateY(-50%)",
          color: C.mute,
          fontSize: 13,
          pointerEvents: "none",
        }}
      >
        ⌕
      </span>
      <input
        type="search"
        placeholder="Buscar por nombre o categoría..."
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          width: "100%",
          padding: "8px 12px 8px 32px",
          border: `1px solid ${C.sand}`,
          borderRadius: 999,
          background: C.paper,
          color: C.ink,
          fontFamily: FONT_UI,
          fontSize: 13,
          outline: "none",
        }}
      />
    </div>
  );
}

// ─── Catalog (presentational) ────────────────────────────────────────────────
//
// Recibe data + callbacks por props. La búsqueda + filtros se aplican aquí
// (client-side) sobre el array de products que ya vino del page. Esto evita
// re-fetches por cada keystroke y es trivial para 100 productos.
//
// El header sticky y las filas comparten esta grid template para que las
// columnas queden alineadas. La columna "Acción" es chica (90px) porque
// solo lleva un botón rápido `+ Stock` — el resto de acciones (editar,
// historial, activar/desactivar) viven en el panel derecho contextual
// que se abre al seleccionar la fila.
const GRID_COLS = "minmax(180px,2fr) 1fr 1fr 1fr 90px";
function Catalog({
  filtered,
  loading,
  error,
  query,
  selectedId,
  onSelect,
  onStock,
}: {
  filtered: Product[];
  loading: boolean;
  error: string | null;
  query: string;
  selectedId: number | null;
  onSelect: (id: number | null) => void;
  onStock: (p: Product) => void;
}) {
  // El header sticky vive en un elemento separado (grid header) y las
  // filas en otro (lista virtualizable a futuro). El sticky funciona solo
  // si el contenedor padre permite scroll — en este caso, el body de la
  // página entera. Si en algún punto encerramos esto en un overflow:auto,
  // el sticky seguirá pegándose al top del scroller correcto.
  return (
    <section>
      {error && <ErrorBanner text={error} />}

      <div
        style={{
          background: C.paper,
          border: `1px solid ${C.sand}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: GRID_COLS,
            padding: "12px 18px",
            background: `linear-gradient(180deg, ${C.paper} 0%, ${C.parchment} 100%)`,
            borderBottom: `1px solid ${C.sand}`,
            fontFamily: FONT_MONO,
            fontSize: 9,
            letterSpacing: 2,
            color: C.mute,
            textTransform: "uppercase",
            fontWeight: 700,
            position: "sticky",
            top: 0,
            zIndex: 2,
            backdropFilter: "blur(6px)",
            WebkitBackdropFilter: "blur(6px)",
          }}
        >
          <div>Producto</div>
          <div>Categoría</div>
          <div>Precio</div>
          <div>Stock</div>
          <div style={{ textAlign: "right" }}>Acción</div>
        </div>

        {loading && filtered.length === 0 && (
          <div aria-label="Cargando productos">
            {Array.from({ length: 6 }).map((_, i) => (
              <SkeletonRow key={i} index={i} />
            ))}
          </div>
        )}

        {!loading && filtered.length === 0 && (
          <div
            style={{
              padding: 40,
              textAlign: "center",
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.mute,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            {query.trim().length > 0 ? "Sin coincidencias" : "Sin resultados"}
          </div>
        )}

        <AnimatePresence initial={false}>
        {filtered.map((p, i) => (
          <ProductRow
            key={p.id}
            product={p}
            index={i}
            selected={p.id === selectedId}
            onSelect={() => onSelect(p.id === selectedId ? null : p.id)}
            onStock={() => onStock(p)}
          />
        ))}
        </AnimatePresence>
      </div>
    </section>
  );
}

// ─── Catalog filters (sidebar izquierdo) ─────────────────────────────────────
//
// Sidebar 220px con dos secciones:
//   1. Estado: lista vertical (Todos / Activos / Bajo stock / Inactivos)
//      con contador por bucket. El item activo lleva fondo ink + texto
//      paper para contraste claro.
//   2. Categorías: derivadas del catálogo. Click selecciona/deselecciona
//      la categoría como filtro adicional. El "deselect" (click en la
//      misma) regresa a "todas las categorías".
//
// Los contadores reflejan el catálogo COMPLETO (no el filtrado), así el
// operador siempre ve totales reales y no cifras que cambien al
// seleccionar una categoría.
type StatusKey = "all" | "active" | "low_stock" | "inactive";

function CatalogFilters({
  products,
  filter,
  onFilterChange,
  categoryFilter,
  onCategoryChange,
}: {
  products: Product[];
  filter: StatusKey;
  onFilterChange: (v: StatusKey) => void;
  categoryFilter: string | null;
  onCategoryChange: (v: string | null) => void;
}) {
  const counts = useMemo(() => {
    const all = products.length;
    const active = products.filter((p) => p.is_active).length;
    const low = products.filter(
      (p) => p.is_low_stock || p.is_out_of_stock,
    ).length;
    const inactive = products.filter((p) => !p.is_active).length;
    return { all, active, low_stock: low, inactive };
  }, [products]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      const cat = (p.category ?? "").trim();
      if (!cat) continue;
      map.set(cat, (map.get(cat) ?? 0) + 1);
    }
    return Array.from(map.entries())
      .sort((a, b) => a[0].localeCompare(b[0], "es"))
      .map(([name, count]) => ({ name, count }));
  }, [products]);

  const statusItems: { key: StatusKey; label: string; tone: "neutral" | "alert" }[] = [
    { key: "all", label: "Todos", tone: "neutral" },
    { key: "active", label: "Activos", tone: "neutral" },
    { key: "low_stock", label: "Bajo stock", tone: "alert" },
    { key: "inactive", label: "Inactivos", tone: "neutral" },
  ];

  return (
    <aside
      style={{
        position: "sticky",
        top: 16,
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 14,
        padding: "14px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 18,
      }}
    >
      <div>
        <SidebarHeading>Estado</SidebarHeading>
        <ul
          style={{
            listStyle: "none",
            padding: 0,
            margin: 0,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {statusItems.map((item) => {
            const isActive = filter === item.key;
            const count = counts[item.key];
            const isAlert = item.tone === "alert" && count > 0;
            return (
              <li key={item.key}>
                <button
                  type="button"
                  onClick={() => onFilterChange(item.key)}
                  className="crown-btn"
                  style={{
                    width: "100%",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "8px 12px",
                    border: "none",
                    borderRadius: 10,
                    background: isActive ? C.ink : "transparent",
                    color: isActive ? C.paper : isAlert ? C.terracotta : C.cacao,
                    fontFamily: FONT_UI,
                    fontSize: 12,
                    fontWeight: 700,
                    letterSpacing: 0.3,
                    cursor: "pointer",
                    textAlign: "left",
                    textTransform: "uppercase",
                    transition:
                      "background 160ms cubic-bezier(0.16,1,0.3,1), color 160ms cubic-bezier(0.16,1,0.3,1)",
                  }}
                >
                  <span>{item.label}</span>
                  <CountChip
                    value={count}
                    active={isActive}
                    alert={isAlert}
                  />
                </button>
              </li>
            );
          })}
        </ul>
      </div>

      {categories.length > 0 && (
        <div>
          <SidebarHeading>
            Categorías
            {categoryFilter && (
              <button
                type="button"
                onClick={() => onCategoryChange(null)}
                style={{
                  marginLeft: 8,
                  background: "transparent",
                  border: "none",
                  color: C.terracotta,
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  fontWeight: 700,
                  letterSpacing: 1,
                  cursor: "pointer",
                  textTransform: "uppercase",
                  padding: 0,
                }}
              >
                Limpiar
              </button>
            )}
          </SidebarHeading>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 2,
              maxHeight: 360,
              overflowY: "auto",
            }}
          >
            {categories.map((c) => {
              const isActive = categoryFilter === c.name;
              return (
                <li key={c.name}>
                  <button
                    type="button"
                    onClick={() => onCategoryChange(isActive ? null : c.name)}
                    className="crown-btn"
                    style={{
                      width: "100%",
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      padding: "6px 10px",
                      border: "none",
                      borderRadius: 8,
                      background: isActive
                        ? `color-mix(in srgb, ${C.goldSoft} 50%, ${C.paper})`
                        : "transparent",
                      color: isActive ? C.cacao : C.ink,
                      fontFamily: FONT_UI,
                      fontSize: 12,
                      fontWeight: isActive ? 700 : 500,
                      cursor: "pointer",
                      textAlign: "left",
                      transition:
                        "background 160ms cubic-bezier(0.16,1,0.3,1)",
                    }}
                  >
                    <span
                      style={{
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        flex: 1,
                        minWidth: 0,
                      }}
                    >
                      {c.name}
                    </span>
                    <span
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 10,
                        color: C.mute,
                        fontWeight: 700,
                        marginLeft: 6,
                      }}
                    >
                      {c.count}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </aside>
  );
}

function SidebarHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 9,
        letterSpacing: 3,
        color: C.mute,
        fontWeight: 700,
        textTransform: "uppercase",
        marginBottom: 8,
        paddingLeft: 4,
        display: "flex",
        alignItems: "baseline",
      }}
    >
      {children}
    </div>
  );
}

function CountChip({
  value,
  active,
  alert,
}: {
  value: number;
  active: boolean;
  alert: boolean;
}) {
  let bg: string;
  let fg: string;
  if (active) {
    bg = C.paper;
    fg = C.ink;
  } else if (alert) {
    bg = C.terracottaSoft;
    fg = C.terracotta;
  } else {
    bg = C.parchment;
    fg = C.mute;
  }
  return (
    <span
      style={{
        minWidth: 22,
        padding: "1px 8px",
        borderRadius: 999,
        background: bg,
        color: fg,
        fontFamily: FONT_MONO,
        fontSize: 10,
        fontWeight: 800,
        letterSpacing: 0.5,
        textAlign: "center",
        lineHeight: "16px",
      }}
    >
      {value}
    </span>
  );
}

function ProductRow({
  product,
  index,
  selected,
  onSelect,
  onStock,
}: {
  product: Product;
  index: number;
  selected: boolean;
  onSelect: () => void;
  onStock: () => void;
}) {
  const needsAttention = product.is_low_stock || product.is_out_of_stock;
  // Borde lateral: gold si está seleccionada, terracotta si pide atención
  // (low/out of stock), transparente si no aplica nada. Selección gana
  // sobre alerta — el feedback de "estoy en este producto" es lo más
  // crítico cuando el operador navega con teclado.
  const accentBorder = selected
    ? C.gold
    : needsAttention
      ? C.terracotta
      : "transparent";

  // Cuando la selección cambia (ej. via keyboard ↑/↓), aseguramos que la
  // fila quede visible. `block: "nearest"` evita scrolls bruscos cuando
  // la fila ya está en viewport — solo desplaza si está fuera.
  const ref = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (selected && ref.current) {
      ref.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [selected]);

  return (
    <motion.div
      ref={ref}
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      transition={{
        duration: DUR_BASE / 1000,
        ease: [0.16, 1, 0.3, 1],
        delay: Math.min(index * 0.015, 0.18),
      }}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect();
        }
      }}
      style={{
        position: "relative",
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        padding: "14px 18px 14px 21px",
        borderBottom: `1px solid ${C.sand}`,
        borderLeft: `3px solid ${accentBorder}`,
        alignItems: "center",
        opacity: product.is_active ? 1 : 0.55,
        cursor: "pointer",
        background: selected
          ? `color-mix(in srgb, ${C.goldSoft} 35%, ${C.paper})`
          : C.paper,
        transition:
          "background 160ms cubic-bezier(0.16,1,0.3,1), border-color 160ms cubic-bezier(0.16,1,0.3,1)",
        outline: "none",
      }}
      onMouseEnter={(e) => {
        if (!selected) {
          e.currentTarget.style.background = C.parchment;
        }
      }}
      onMouseLeave={(e) => {
        if (!selected) {
          e.currentTarget.style.background = C.paper;
        }
      }}
      onFocus={(e) => {
        e.currentTarget.style.boxShadow = `inset 0 0 0 2px ${C.gold}`;
      }}
      onBlur={(e) => {
        e.currentTarget.style.boxShadow = "none";
      }}
      aria-pressed={selected}
    >
      {/* Chevron indicator de selección. Aparece desde la izquierda con
          slide+fade cuando el row está activo. Es decorativo (aria-hidden)
          — el aria-pressed ya comunica el estado para screen readers. */}
      <AnimatePresence>
        {selected && (
          <motion.span
            aria-hidden
            initial={{ opacity: 0, x: -6 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: -6 }}
            transition={{ duration: DUR_BASE / 1000, ease: [0.16, 1, 0.3, 1] }}
            style={{
              position: "absolute",
              left: 6,
              top: "50%",
              transform: "translateY(-50%)",
              color: C.gold,
              fontFamily: FONT_DISPLAY,
              fontSize: 14,
              lineHeight: 1,
              pointerEvents: "none",
            }}
          >
            ▸
          </motion.span>
        )}
      </AnimatePresence>

      <div>
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 16,
            color: C.ink,
            letterSpacing: 0.5,
          }}
        >
          {product.name}
        </div>
        <div
          style={{
            display: "flex",
            gap: 6,
            marginTop: 4,
            flexWrap: "wrap",
          }}
        >
          {!product.is_active && <Badge color={C.mute} bg={C.sand} text="Inactivo" />}
          {product.is_out_of_stock && (
            <Badge color={C.terracotta} bg={C.terracottaSoft} text="Agotado" />
          )}
          {product.is_low_stock && (
            <Badge color={C.cacao} bg={C.goldSoft} text="Bajo stock" />
          )}
        </div>
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 12, color: C.cacao }}>
        {product.category}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 16,
          color: C.gold,
        }}
      >
        {fmt(product.price)}
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 13, color: C.ink }}>
        {product.stock}
        {product.low_stock_threshold > 0 && (
          <span style={{ color: C.mute, fontSize: 10, marginLeft: 6 }}>
            (umbral {product.low_stock_threshold})
          </span>
        )}
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          type="button"
          className="crown-btn crown-btn-ghost"
          onClick={(e) => {
            // Stop propagation: si no, el click sube al row y dispara
            // selección/deselección — no queremos eso al pulsar +Stock.
            e.stopPropagation();
            onStock();
          }}
          style={{
            ...btnGhost({ fg: C.cacao, border: C.sand }),
            padding: "5px 10px",
            fontSize: 10,
            letterSpacing: 1,
          }}
        >
          + Stock
        </button>
      </div>
    </motion.div>
  );
}

/**
 * Skeleton row mostrado mientras `adminProductsApi.getAll()` está
 * pending. Usa la misma grid del row real para que cuando llegue la
 * data el operador no perciba salto de layout. El shimmer es un
 * gradient animado en background — no requiere keyframe global porque
 * el animation está inline.
 */
function SkeletonRow({ index }: { index: number }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: GRID_COLS,
        padding: "14px 18px 14px 21px",
        borderBottom: `1px solid ${C.sand}`,
        alignItems: "center",
        opacity: Math.max(0.3, 1 - index * 0.12),
      }}
    >
      <SkeletonBar width="60%" />
      <SkeletonBar width="50%" />
      <SkeletonBar width="40%" />
      <SkeletonBar width="30%" />
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <SkeletonBar width={60} />
      </div>
    </div>
  );
}

function SkeletonBar({ width }: { width: string | number }) {
  return (
    <span
      aria-hidden
      style={{
        display: "inline-block",
        width,
        height: 12,
        borderRadius: 6,
        background: `linear-gradient(90deg, ${C.parchment} 0%, ${C.sand} 50%, ${C.parchment} 100%)`,
        backgroundSize: "200% 100%",
        animation: "crown-skeleton-shimmer 1.4s ease-in-out infinite",
      }}
    />
  );
}

function Badge({ color, bg, text }: { color: string; bg: string; text: string }) {
  return (
    <span
      style={{
        padding: "2px 8px",
        borderRadius: 999,
        background: bg,
        color,
        fontFamily: FONT_MONO,
        fontSize: 9,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        fontWeight: 700,
      }}
    >
      {text}
    </span>
  );
}

function ErrorBanner({ text }: { text: string }) {
  return (
    <div
      role="alert"
      style={{
        padding: 10,
        borderRadius: 8,
        background: C.terracottaSoft,
        color: C.terracotta,
        fontFamily: FONT_MONO,
        fontSize: 11,
        letterSpacing: 1.5,
        textTransform: "uppercase",
        marginBottom: 14,
      }}
    >
      {text}
    </div>
  );
}

// ─── Product form modal (solo create) ────────────────────────────────────────
//
// Este modal SOLO se usa para crear productos nuevos. La edición pasó al
// `ProductDetailPanel` (panel derecho contextual). Mantenemos el modal
// para "Nuevo producto" porque crear es un flujo sin selección previa
// — no encaja con el patrón "selecciona una fila para ver/editar".
function ProductFormModal({
  onClose,
  onSaved,
}: {
  mode: "create";
  product: null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [category, setCategory] = useState("");
  const [stock, setStock] = useState("0");
  const [threshold, setThreshold] = useState("0");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminProductsApi.create({
        name: name.trim(),
        description: description.trim() || undefined,
        price: Number(price),
        category: category.trim(),
        stock: Number(stock) || 0,
        low_stock_threshold: Number(threshold) || 0,
      });
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell title="Nuevo producto" onClose={onClose}>
      <form onSubmit={submit} style={formStyle}>
        <Field label="Nombre">
          <input
            type="text"
            required
            minLength={2}
            maxLength={120}
            value={name}
            onChange={(e) => setName(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Categoría">
          <input
            type="text"
            required
            minLength={2}
            maxLength={60}
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Precio (COP)">
          <input
            type="number"
            required
            min={0}
            step={1}
            value={price}
            onChange={(e) => setPrice(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Stock inicial">
          <input
            type="number"
            min={0}
            step={1}
            value={stock}
            onChange={(e) => setStock(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Umbral bajo stock (0 = sin alerta)">
          <input
            type="number"
            min={0}
            step={1}
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            style={inputStyle}
          />
        </Field>
        <Field label="Descripción (opcional)">
          <textarea
            maxLength={500}
            rows={2}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...inputStyle, resize: "vertical", fontFamily: FONT_UI }}
          />
        </Field>
        {error && <ErrorBanner text={error} />}
        <ModalActions onCancel={onClose} submitting={submitting} />
      </form>
    </ModalShell>
  );
}


// ─── Reusable bits ───────────────────────────────────────────────────────────
function ModalShell({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  wide?: boolean;
}) {
  return (
    <div
      role="dialog"
      aria-modal
      aria-label={title}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        zIndex: 60,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 20,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: wide ? 640 : 460,
          maxHeight: "92dvh",
          overflowY: "auto",
          background: C.paper,
          borderRadius: 16,
          padding: 22,
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.45)",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <header
          style={{ display: "flex", justifyContent: "space-between", gap: 12 }}
        >
          <h3
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              color: C.ink,
              letterSpacing: 0.5,
              margin: 0,
            }}
          >
            {title}
          </h3>
          <button
            type="button"
            aria-label="Cerrar"
            onClick={onClose}
            className="crown-btn crown-btn-ghost"
            style={{
              ...btnGhost({ fg: C.cacao, border: C.sand }),
              width: 32,
              height: 32,
              padding: 0,
              fontSize: 16,
            }}
          >
            ✕
          </button>
        </header>
        {children}
      </div>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <span
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 2,
          color: C.mute,
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        {label}
      </span>
      {children}
    </label>
  );
}

function ModalActions({
  onCancel,
  submitting,
}: {
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <div
      style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 4 }}
    >
      <button
        type="button"
        className="crown-btn crown-btn-ghost"
        onClick={onCancel}
        style={btnGhost({ fg: C.cacao, border: C.sand })}
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={submitting}
        className="crown-btn crown-btn-primary"
        style={btnPrimary({
          bg: submitting ? C.sand : C.gold,
          fg: submitting ? C.mute : C.paper,
        })}
      >
        {submitting ? "Guardando..." : "Guardar"}
      </button>
    </div>
  );
}

const formStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const inputStyle: React.CSSProperties = {
  padding: "9px 11px",
  border: `1px solid ${C.sand}`,
  borderRadius: 10,
  background: C.cream,
  color: C.ink,
  fontFamily: FONT_UI,
  fontSize: 14,
  outline: "none",
};
