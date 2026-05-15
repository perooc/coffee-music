"use client";

/**
 * Panel derecho contextual del catálogo de productos.
 *
 * Reemplaza tres modales que antes vivían encima del catálogo:
 *   - ProductFormModal (modo edit)
 *   - StockMovementModal
 *   - ProductHistoryDrawer
 *
 * Aquí los unificamos en un solo panel persistente que se mantiene visible
 * mientras navegas el catálogo. Al seleccionar otra fila el panel se
 * actualiza in-place — no hay close/open ni pérdida de contexto.
 *
 * El panel tiene 3 modos visibles según `mode`:
 *   - "view"  → resumen + acciones (Editar / Activar / +Movimiento) + mini historial.
 *   - "edit"  → form de edición inline (mismo set de campos que ProductFormModal).
 *   - "stock" → form de movimiento de stock (mismo set que StockMovementModal).
 *
 * Sin selección → empty state simple ("Selecciona un producto").
 *
 * IMPORTANTE: el modal de "create" SE QUEDA arriba (en page.tsx). El panel
 * derecho es solo para leer/editar productos existentes — crear es un
 * flujo distinto que no tiene "selección previa".
 */

import {
  FormEvent,
  useEffect,
  useMemo,
  useState,
} from "react";
import { motion, AnimatePresence } from "framer-motion";
import type {
  InventoryMovement,
  InventoryMovementType,
  Product,
} from "@coffee-bar/shared";
import {
  adminProductsApi,
  inventoryMovementsApi,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { ProductRecipeEditor } from "./ProductRecipeEditor";
import {
  C,
  FONT_DISPLAY,
  FONT_MONO,
  FONT_UI,
  fmt,
  btnPrimary,
  btnGhost,
  DUR_BASE,
} from "@/lib/theme";

type Mode = "view" | "edit" | "stock";

interface Props {
  product: Product | null;
  /**
   * Mode inicial al montar el panel. El page le pasa "stock" cuando el
   * operador clickeó "+ Stock" en una fila, "view" en cualquier otro
   * caso. Para que el cambio surta efecto el page DEBE remontar el
   * panel cambiando su `key` (típicamente `key={selectedId-nonce}`).
   * Esto evita el patrón setState-in-effect.
   */
  initialMode?: Mode;
  /**
   * Catálogo completo. Necesario para el editor de recetas (modo edit)
   * porque necesita listar los productos componentes elegibles.
   */
  allProducts?: Product[];
  onSaved: () => void;
  onClose: () => void;
}

export function ProductDetailPanel({
  product,
  initialMode = "view",
  allProducts = [],
  onSaved,
  onClose,
}: Props) {
  // El mode arranca con `initialMode` y de ahí en adelante lo controla
  // el operador desde dentro del panel. El page resetea el mode
  // remontando el panel con un `key` distinto cuando cambia el producto
  // o cuando se dispara el shortcut de "+ Stock".
  const [mode, setMode] = useState<Mode>(initialMode);

  return (
    <aside
      style={{
        position: "sticky",
        top: 16,
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 14,
        padding: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minHeight: 360,
        maxHeight: "calc(100dvh - 32px)",
      }}
    >
      <AnimatePresence mode="wait" initial={false}>
        {product == null ? (
          <EmptyState key="empty" />
        ) : (
          <motion.div
            key={`product-${product.id}-${mode}`}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 8 }}
            transition={{
              duration: DUR_BASE / 1000,
              ease: [0.16, 1, 0.3, 1],
            }}
            style={{
              flex: 1,
              display: "flex",
              flexDirection: "column",
              overflow: "hidden",
            }}
          >
            {mode === "view" && (
              <ViewMode
                product={product}
                onEdit={() => setMode("edit")}
                onStock={() => setMode("stock")}
                onSaved={onSaved}
                onClose={onClose}
              />
            )}
            {mode === "edit" && (
              <EditMode
                product={product}
                allProducts={allProducts}
                onCancel={() => setMode("view")}
                onSaved={() => {
                  onSaved();
                  setMode("view");
                }}
              />
            )}
            {mode === "stock" && (
              <StockMode
                product={product}
                onCancel={() => setMode("view")}
                onSaved={() => {
                  onSaved();
                  setMode("view");
                }}
              />
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </aside>
  );
}

// ─── Empty state ────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <motion.div
      key="empty"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: DUR_BASE / 1000 }}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: 32,
        textAlign: "center",
        gap: 10,
      }}
    >
      <span
        aria-hidden
        style={{
          fontSize: 32,
          color: C.mute,
          lineHeight: 1,
        }}
      >
        ⌕
      </span>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 16,
          color: C.cacao,
          letterSpacing: 1.5,
          textTransform: "uppercase",
        }}
      >
        Selecciona un producto
      </div>
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 11,
          color: C.mute,
          letterSpacing: 1,
          maxWidth: 220,
          lineHeight: 1.5,
        }}
      >
        Click en una fila del catálogo para ver detalle, editar o registrar un movimiento de stock.
      </div>
    </motion.div>
  );
}

// ─── View mode ─────────────────────────────────────────────────────────────

function ViewMode({
  product,
  onEdit,
  onStock,
  onSaved,
  onClose,
}: {
  product: Product;
  onEdit: () => void;
  onStock: () => void;
  onSaved: () => void;
  onClose: () => void;
}) {
  return (
    <>
      <PanelHeader
        title={product.name}
        category={product.category}
        active={product.is_active}
        onClose={onClose}
      />

      <div
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 18px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 18,
        }}
      >
        {/* Resumen: precio + stock */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr 1fr",
            gap: 10,
          }}
        >
          <SummaryTile label="Precio">
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 22,
                color: C.gold,
                letterSpacing: 0.5,
              }}
            >
              {fmt(product.price)}
            </span>
          </SummaryTile>
          <SummaryTile label="Stock">
            <span
              style={{
                fontFamily: FONT_DISPLAY,
                fontSize: 22,
                color: product.is_out_of_stock
                  ? C.terracotta
                  : product.is_low_stock
                    ? C.gold
                    : C.ink,
                letterSpacing: 0.5,
              }}
            >
              {product.stock}
            </span>
            {product.low_stock_threshold > 0 && (
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  color: C.mute,
                  letterSpacing: 1.2,
                  marginTop: 2,
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                Umbral {product.low_stock_threshold}
              </div>
            )}
          </SummaryTile>
        </div>

        {product.description && (
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 13,
              color: C.cacao,
              lineHeight: 1.5,
              padding: "10px 12px",
              background: C.parchment,
              borderRadius: 10,
            }}
          >
            {product.description}
          </div>
        )}

        {/* Acciones primarias */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <button
            type="button"
            className="crown-btn crown-btn-primary"
            onClick={onStock}
            style={btnPrimary({ bg: C.gold, fg: C.paper, fullWidth: true })}
          >
            + REGISTRAR MOVIMIENTO
          </button>
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              className="crown-btn crown-btn-ghost"
              onClick={onEdit}
              style={{
                ...btnGhost({ fg: C.cacao, border: C.sand }),
                flex: 1,
              }}
            >
              Editar
            </button>
            <ToggleActiveButton product={product} onSaved={onSaved} />
          </div>
        </div>

        {/* Mini historial */}
        <MiniHistory productId={product.id} />
      </div>
    </>
  );
}

function ToggleActiveButton({
  product,
  onSaved,
}: {
  product: Product;
  onSaved: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const handle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (product.is_active) await adminProductsApi.deactivate(product.id);
      else await adminProductsApi.activate(product.id);
      onSaved();
    } catch {
      // Error swallowed silently — el operador ve que el badge no cambió.
      // Si se vuelve un problema podemos surfacear al banner del page.
    } finally {
      setBusy(false);
    }
  };
  const danger = product.is_active;
  return (
    <button
      type="button"
      onClick={handle}
      disabled={busy}
      className={`crown-btn crown-btn-ghost${danger ? " crown-btn-ghost-danger" : ""}`}
      style={{
        ...btnGhost({
          fg: danger ? C.terracotta : C.olive,
          border: danger ? C.terracotta : C.olive,
        }),
        flex: 1,
      }}
    >
      {product.is_active ? "Desactivar" : "Activar"}
    </button>
  );
}

// ─── Edit mode ─────────────────────────────────────────────────────────────

function EditMode({
  product,
  allProducts,
  onCancel,
  onSaved,
}: {
  product: Product;
  allProducts: Product[];
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product.name);
  const [description, setDescription] = useState(product.description ?? "");
  const [price, setPrice] = useState(String(product.price));
  const [category, setCategory] = useState(product.category ?? "");
  const [stock, setStock] = useState(String(product.stock));
  const [threshold, setThreshold] = useState(
    String(product.low_stock_threshold ?? "0"),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await adminProductsApi.update(product.id, {
        name: name.trim(),
        description: description.trim() || undefined,
        price: Number(price),
        category: category.trim(),
        low_stock_threshold: Number(threshold) || 0,
      });
      // Stock can't ride through /admin/products/:id update — that
      // route refuses it to keep audit trail clean. If the value
      // changed, post an InventoryMovement with the signed delta and
      // an auto reason so the audit log shows "edición directa".
      const targetStock = Math.round(Number(stock));
      if (
        Number.isFinite(targetStock) &&
        targetStock !== product.stock
      ) {
        const delta = targetStock - product.stock;
        await inventoryMovementsApi.record(product.id, {
          type: "adjustment",
          quantity: delta,
          reason: `Stock establecido por edición directa: ${product.stock} → ${targetStock}`,
        });
      }
      onSaved();
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <PanelHeader
        title="Editar producto"
        subtitle={product.name}
        onBack={onCancel}
      />
      <form
        onSubmit={submit}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 18px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
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
        <Field label="Stock">
          <input
            type="number"
            required
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
        <PanelActions onCancel={onCancel} submitting={submitting} />
      </form>

      {/* Recipe editor — vive afuera del form principal porque tiene
          su propio submit (PUT al endpoint de receta) y queremos que
          el operador pueda guardar metadatos y receta por separado. */}
      <div
        style={{
          padding: "0 18px 18px",
        }}
      >
        <ProductRecipeEditor
          productId={product.id}
          allProducts={allProducts}
        />
      </div>
    </>
  );
}

// ─── Stock mode ────────────────────────────────────────────────────────────

// Tipos visibles en la UI. El backend acepta también "correction" pero
// para una operación de un solo dueño es redundante con "adjustment" —
// se removió de la UI. Si en el futuro hace falta diferenciar errores
// administrativos de pérdidas reales (con varios operarios), reactivar
// "correction" aquí basta.
type VisibleMovementType = Exclude<InventoryMovementType, "correction">;

const TYPE_LABELS: Record<
  VisibleMovementType,
  { title: string; helper: string; sign: 1 | -1 | 0 }
> = {
  restock: { title: "Reponer", helper: "Unidades a sumar", sign: 1 },
  waste: { title: "Merma", helper: "Unidades a desechar", sign: -1 },
  adjustment: {
    title: "Ajuste",
    helper: "Delta firmado (+ suma / − resta)",
    sign: 0,
  },
};

function StockMode({
  product,
  onCancel,
  onSaved,
}: {
  product: Product;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const [type, setType] = useState<VisibleMovementType>("restock");
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const meta = TYPE_LABELS[type];

  function computeQuantity(): number {
    const n = Number(amount);
    if (!Number.isFinite(n)) return NaN;
    if (meta.sign === 1) return Math.abs(n);
    if (meta.sign === -1) return -Math.abs(n);
    return n;
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    const q = computeQuantity();
    if (!Number.isFinite(q) || q === 0) {
      setError("La cantidad debe ser distinta de cero.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await inventoryMovementsApi.record(product.id, {
        type,
        quantity: q,
        reason: reason.trim(),
        notes: notes.trim() || undefined,
      });
      onSaved();
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })?.response
        ?.data?.code;
      const data = (err as { response?: { data?: Record<string, unknown> } })
        ?.response?.data;
      if (code === "STOCK_WOULD_GO_NEGATIVE") {
        setError(
          `Stock insuficiente. Actual: ${data?.current_stock}. Intento: ${data?.attempted_delta}.`,
        );
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  }

  const delta = computeQuantity();
  return (
    <>
      <PanelHeader
        title="Movimiento de stock"
        subtitle={product.name}
        onBack={onCancel}
      />
      <form
        onSubmit={submit}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "14px 18px 18px",
          display: "flex",
          flexDirection: "column",
          gap: 14,
        }}
      >
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1.5,
            color: C.mute,
            textTransform: "uppercase",
          }}
        >
          Stock actual:{" "}
          <strong style={{ color: C.ink, fontWeight: 800 }}>
            {product.stock}
          </strong>
        </div>

        <Field label="Tipo">
          <div style={{ display: "flex", gap: 6 }}>
            {(["restock", "waste", "adjustment"] as const).map((t) => {
              const active = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  style={{
                    flex: 1,
                    padding: "8px 10px",
                    border: `1px solid ${active ? C.ink : C.sand}`,
                    background: active ? C.ink : C.paper,
                    color: active ? C.paper : C.cacao,
                    borderRadius: 10,
                    fontFamily: FONT_DISPLAY,
                    fontSize: 12,
                    letterSpacing: 1.5,
                    textTransform: "uppercase",
                    cursor: "pointer",
                    fontWeight: 600,
                    transition:
                      "background 160ms cubic-bezier(0.16,1,0.3,1), color 160ms cubic-bezier(0.16,1,0.3,1)",
                  }}
                >
                  {TYPE_LABELS[t].title}
                </button>
              );
            })}
          </div>
        </Field>

        <Field label={meta.helper}>
          <input
            type="number"
            required
            step={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            style={inputStyle}
          />
          <div
            style={{
              marginTop: 5,
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: C.mute,
              letterSpacing: 1,
            }}
          >
            Delta a aplicar:{" "}
            <strong
              style={{
                color: delta > 0 ? C.olive : delta < 0 ? C.terracotta : C.ink,
                fontWeight: 800,
              }}
            >
              {delta > 0 ? "+" : ""}
              {Number.isFinite(delta) ? delta : 0}
            </strong>
          </div>
        </Field>

        <Field label="Razón (obligatoria)">
          <input
            type="text"
            required
            minLength={3}
            maxLength={200}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej: entrega proveedor, botellas rotas..."
            style={inputStyle}
          />
        </Field>

        <Field label="Notas (opcional)">
          <textarea
            rows={2}
            maxLength={500}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            style={{ ...inputStyle, resize: "vertical", fontFamily: FONT_UI }}
          />
        </Field>

        {error && <ErrorBanner text={error} />}
        <PanelActions onCancel={onCancel} submitting={submitting} />
      </form>
    </>
  );
}

// ─── Mini historial ─────────────────────────────────────────────────────────

function MiniHistory({ productId }: { productId: number }) {
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  // Recargamos cuando cambia el producto seleccionado. No usamos
  // setLoading dentro del effect synchronously porque el lint lo marca;
  // en cambio, el spinner se muestra basado en `movements.length` y
  // estado intermedio.
  useEffect(() => {
    let cancelled = false;
    inventoryMovementsApi
      .listForProduct(productId, { limit: 100 })
      .then((list) => {
        if (!cancelled) {
          setMovements(list);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [productId]);

  const visible = showAll ? movements : movements.slice(0, 5);
  const hasMore = movements.length > 5;

  return (
    <div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          marginBottom: 8,
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            letterSpacing: 3,
            color: C.mute,
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          — Historial
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.cacao,
            fontWeight: 700,
          }}
        >
          {movements.length}
        </span>
      </div>
      {loading ? (
        <div
          style={{
            padding: 16,
            textAlign: "center",
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.mute,
            letterSpacing: 1.5,
            textTransform: "uppercase",
          }}
        >
          Cargando...
        </div>
      ) : movements.length === 0 ? (
        <div
          style={{
            padding: "14px 12px",
            background: C.parchment,
            borderRadius: 10,
            color: C.mute,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1.5,
            textAlign: "center",
            textTransform: "uppercase",
            fontWeight: 600,
          }}
        >
          Sin movimientos
        </div>
      ) : (
        <>
          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: 6,
            }}
          >
            {visible.map((m) => (
              <CompactMovement key={m.id} movement={m} />
            ))}
          </ul>
          {hasMore && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="crown-btn crown-btn-ghost"
              style={{
                ...btnGhost({ fg: C.cacao, border: C.sand }),
                width: "100%",
                marginTop: 8,
                padding: "6px 12px",
                fontSize: 11,
              }}
            >
              {showAll
                ? "Ver menos"
                : `Ver todos (${movements.length})`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

function CompactMovement({ movement }: { movement: InventoryMovement }) {
  const typeMeta = useMemo(
    () => ({
      restock: { label: "Reposición", bg: C.oliveSoft, fg: C.olive },
      waste: { label: "Merma", bg: C.terracottaSoft, fg: C.terracotta },
      adjustment: { label: "Ajuste", bg: C.sandDark, fg: C.ink },
      correction: { label: "Corrección", bg: C.goldSoft, fg: C.cacao },
    }),
    [],
  );
  const m = typeMeta[movement.type];
  const positive = movement.quantity > 0;

  return (
    <li
      style={{
        padding: "8px 10px",
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 10,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 4,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <span
            style={{
              padding: "1px 6px",
              borderRadius: 999,
              background: m.bg,
              color: m.fg,
              fontFamily: FONT_MONO,
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: 1,
              textTransform: "uppercase",
            }}
          >
            {m.label}
          </span>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 0.5,
              color: C.mute,
            }}
          >
            {new Date(movement.created_at).toLocaleString("es-CO", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
        </div>
        {movement.reason && (
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 11,
              color: C.cacao,
              fontStyle: "italic",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={movement.reason}
          >
            “{movement.reason}”
          </div>
        )}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 16,
          color: positive ? C.olive : C.terracotta,
          letterSpacing: 0.5,
          alignSelf: "center",
          whiteSpace: "nowrap",
        }}
      >
        {positive ? "+" : ""}
        {movement.quantity}
      </div>
    </li>
  );
}

// ─── Shared subcomponents ───────────────────────────────────────────────────

function PanelHeader({
  title,
  subtitle,
  category,
  active,
  onClose,
  onBack,
}: {
  title: string;
  subtitle?: string;
  category?: string;
  active?: boolean;
  onClose?: () => void;
  onBack?: () => void;
}) {
  return (
    <header
      style={{
        padding: "14px 16px 12px",
        borderBottom: `1px solid ${C.sand}`,
        background: `linear-gradient(180deg, ${C.paper} 0%, ${C.parchment} 100%)`,
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 8,
      }}
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        {category != null && (
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 3,
              color: C.mute,
              fontWeight: 700,
              textTransform: "uppercase",
              marginBottom: 2,
              display: "flex",
              alignItems: "center",
              gap: 6,
              flexWrap: "wrap",
            }}
          >
            <span>{category || "Sin categoría"}</span>
            {active === false && (
              <span
                style={{
                  padding: "1px 6px",
                  borderRadius: 999,
                  background: C.sand,
                  color: C.mute,
                  fontWeight: 800,
                }}
              >
                Inactivo
              </span>
            )}
          </div>
        )}
        <div
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 18,
            color: C.ink,
            letterSpacing: 0.5,
            lineHeight: 1.15,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
          title={title}
        >
          {title}
        </div>
        {subtitle && (
          <div
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: C.cacao,
              letterSpacing: 1,
              marginTop: 2,
              fontWeight: 600,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={subtitle}
          >
            {subtitle}
          </div>
        )}
      </div>
      {onBack && (
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver"
          className="crown-btn crown-btn-ghost"
          style={{
            ...btnGhost({ fg: C.cacao, border: C.sand }),
            padding: "5px 10px",
            fontSize: 12,
            fontWeight: 700,
          }}
        >
          ←
        </button>
      )}
      {onClose && (
        <button
          type="button"
          onClick={onClose}
          aria-label="Cerrar"
          className="crown-btn crown-btn-ghost"
          style={{
            ...btnGhost({ fg: C.cacao, border: C.sand }),
            padding: "5px 10px",
            fontSize: 14,
            fontWeight: 700,
          }}
        >
          ×
        </button>
      )}
    </header>
  );
}

function SummaryTile({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        padding: "10px 12px",
        background: C.parchment,
        border: `1px solid ${C.sand}`,
        borderRadius: 10,
      }}
    >
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 2,
          color: C.mute,
          fontWeight: 700,
          textTransform: "uppercase",
          marginBottom: 4,
        }}
      >
        {label}
      </div>
      {children}
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
    <label
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 4,
        fontFamily: FONT_MONO,
        fontSize: 9,
        letterSpacing: 2,
        color: C.mute,
        fontWeight: 700,
        textTransform: "uppercase",
      }}
    >
      <span>{label}</span>
      {children}
    </label>
  );
}

function PanelActions({
  onCancel,
  submitting,
}: {
  onCancel: () => void;
  submitting: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        marginTop: 4,
      }}
    >
      <button
        type="button"
        onClick={onCancel}
        className="crown-btn crown-btn-ghost"
        style={{
          ...btnGhost({ fg: C.cacao, border: C.sand }),
          flex: 1,
        }}
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={submitting}
        className="crown-btn crown-btn-primary"
        style={{
          ...btnPrimary({
            bg: submitting ? C.sand : C.gold,
            fg: submitting ? C.mute : C.paper,
          }),
          flex: 1.5,
        }}
      >
        {submitting ? "Guardando..." : "Guardar"}
      </button>
    </div>
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
      }}
    >
      {text}
    </div>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "9px 11px",
  border: `1px solid ${C.sand}`,
  background: C.paper,
  color: C.ink,
  fontFamily: FONT_UI,
  fontSize: 13,
  letterSpacing: 0.3,
  borderRadius: 8,
  outline: "none",
};
