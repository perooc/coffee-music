"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import {
  adminProductsApi,
  inventoryMovementsApi,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type {
  InventoryMovement,
  InventoryMovementType,
  Product,
} from "@coffee-bar/shared";

// ─── Warm palette (matches /admin) ────────────────────────────────────────────
const C = {
  cream: "#FDF8EC",
  parchment: "#F8F1E4",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
  sandDark: "#E6D8BF",
  gold: "#B8894A",
  goldSoft: "#E8D4A8",
  burgundy: "#8B2635",
  burgundySoft: "#E8CDD2",
  olive: "#6B7E4A",
  oliveSoft: "#E5EAD3",
  cacao: "#6B4E2E",
  ink: "#2B1D14",
  mute: "#A89883",
};
const FONT_DISPLAY = "var(--font-bebas)";
const FONT_MONO = "var(--font-oswald)";
const FONT_UI = "var(--font-manrope)";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

type Tab = "catalog" | "movements";

// ─── Page ────────────────────────────────────────────────────────────────────
export default function AdminProductsPage() {
  const [tab, setTab] = useState<Tab>("catalog");

  return (
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
        <Link
          href="/admin"
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 2,
            color: C.cacao,
            textDecoration: "none",
            border: `1px solid ${C.sand}`,
            padding: "8px 14px",
            borderRadius: 999,
            background: C.paper,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          ← Tablero
        </Link>
      </header>

      <nav
        role="tablist"
        aria-label="Pestañas de productos"
        style={{
          display: "flex",
          gap: 8,
          marginBottom: 18,
          borderBottom: `1px solid ${C.sand}`,
          paddingBottom: 0,
        }}
      >
        <TabButton active={tab === "catalog"} onClick={() => setTab("catalog")}>
          Catálogo
        </TabButton>
        <TabButton
          active={tab === "movements"}
          onClick={() => setTab("movements")}
        >
          Movimientos
        </TabButton>
      </nav>

      {tab === "catalog" ? <CatalogTab /> : <MovementsTab />}
    </main>
  );
}

function TabButton({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      style={{
        padding: "9px 16px",
        border: "none",
        borderBottom: `3px solid ${active ? C.ink : "transparent"}`,
        background: "transparent",
        color: active ? C.ink : C.mute,
        fontFamily: FONT_DISPLAY,
        fontSize: 14,
        letterSpacing: 3,
        textTransform: "uppercase",
        cursor: "pointer",
        marginBottom: -1,
        fontWeight: 600,
      }}
    >
      {children}
    </button>
  );
}

// ─── Catalog tab ─────────────────────────────────────────────────────────────
function CatalogTab() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<
    "all" | "active" | "low_stock" | "inactive"
  >("all");

  const [editor, setEditor] = useState<
    | { mode: "create" }
    | { mode: "edit"; product: Product }
    | null
  >(null);
  const [stockEditor, setStockEditor] = useState<Product | null>(null);
  const [historyOpen, setHistoryOpen] = useState<Product | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await adminProductsApi.getAll();
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

  const filtered = useMemo(() => {
    if (filter === "active") return products.filter((p) => p.is_active);
    if (filter === "inactive") return products.filter((p) => !p.is_active);
    if (filter === "low_stock")
      return products.filter((p) => p.is_low_stock || p.is_out_of_stock);
    return products;
  }, [products, filter]);

  return (
    <section>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 14,
          flexWrap: "wrap",
          gap: 10,
        }}
      >
        <FilterChips value={filter} onChange={setFilter} />
        <button
          type="button"
          onClick={() => setEditor({ mode: "create" })}
          style={primaryBtnStyle}
        >
          + Nuevo producto
        </button>
      </div>

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
            gridTemplateColumns: "minmax(180px,2fr) 1fr 1fr 1fr 200px",
            padding: "12px 18px",
            background: C.parchment,
            borderBottom: `1px solid ${C.sand}`,
            fontFamily: FONT_MONO,
            fontSize: 9,
            letterSpacing: 2,
            color: C.mute,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          <div>Producto</div>
          <div>Categoría</div>
          <div>Precio</div>
          <div>Stock</div>
          <div style={{ textAlign: "right" }}>Acciones</div>
        </div>

        {loading && filtered.length === 0 && (
          <div
            style={{
              padding: 32,
              textAlign: "center",
              fontFamily: FONT_MONO,
              fontSize: 11,
              color: C.mute,
              letterSpacing: 2,
              textTransform: "uppercase",
            }}
          >
            Cargando...
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
            Sin resultados
          </div>
        )}

        {filtered.map((p) => (
          <ProductRow
            key={p.id}
            product={p}
            onEdit={() => setEditor({ mode: "edit", product: p })}
            onStock={() => setStockEditor(p)}
            onHistory={() => setHistoryOpen(p)}
            onToggleActive={async () => {
              try {
                if (p.is_active) await adminProductsApi.deactivate(p.id);
                else await adminProductsApi.activate(p.id);
                await refresh();
              } catch (e) {
                setError(getErrorMessage(e));
              }
            }}
          />
        ))}
      </div>

      {editor && (
        <ProductFormModal
          mode={editor.mode}
          product={editor.mode === "edit" ? editor.product : null}
          onClose={() => setEditor(null)}
          onSaved={async () => {
            setEditor(null);
            await refresh();
          }}
        />
      )}

      {stockEditor && (
        <StockMovementModal
          product={stockEditor}
          onClose={() => setStockEditor(null)}
          onSaved={async () => {
            setStockEditor(null);
            await refresh();
          }}
        />
      )}

      {historyOpen && (
        <ProductHistoryDrawer
          product={historyOpen}
          onClose={() => setHistoryOpen(null)}
        />
      )}
    </section>
  );
}

function FilterChips({
  value,
  onChange,
}: {
  value: "all" | "active" | "low_stock" | "inactive";
  onChange: (v: "all" | "active" | "low_stock" | "inactive") => void;
}) {
  const items: { key: typeof value; label: string }[] = [
    { key: "all", label: "Todos" },
    { key: "active", label: "Activos" },
    { key: "low_stock", label: "Bajo stock" },
    { key: "inactive", label: "Inactivos" },
  ];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      {items.map((i) => {
        const active = value === i.key;
        return (
          <button
            key={i.key}
            type="button"
            onClick={() => onChange(i.key)}
            style={{
              padding: "6px 12px",
              borderRadius: 999,
              border: `1px solid ${active ? C.ink : C.sand}`,
              background: active ? C.ink : C.paper,
              color: active ? C.paper : C.cacao,
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 2,
              cursor: "pointer",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            {i.label}
          </button>
        );
      })}
    </div>
  );
}

function ProductRow({
  product,
  onEdit,
  onStock,
  onHistory,
  onToggleActive,
}: {
  product: Product;
  onEdit: () => void;
  onStock: () => void;
  onHistory: () => void;
  onToggleActive: () => void;
}) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "minmax(180px,2fr) 1fr 1fr 1fr 200px",
        padding: "14px 18px",
        borderBottom: `1px solid ${C.sand}`,
        alignItems: "center",
        opacity: product.is_active ? 1 : 0.55,
      }}
    >
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
            <Badge color={C.burgundy} bg={C.burgundySoft} text="Agotado" />
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
      <div
        style={{ display: "flex", gap: 6, justifyContent: "flex-end", flexWrap: "wrap" }}
      >
        <RowButton onClick={onStock}>Stock</RowButton>
        <RowButton onClick={onEdit}>Editar</RowButton>
        <RowButton onClick={onHistory}>Historial</RowButton>
        <RowButton onClick={onToggleActive}>
          {product.is_active ? "Desactivar" : "Activar"}
        </RowButton>
      </div>
    </div>
  );
}

function RowButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        padding: "5px 10px",
        border: `1px solid ${C.sand}`,
        background: C.paper,
        color: C.cacao,
        borderRadius: 999,
        fontFamily: FONT_MONO,
        fontSize: 10,
        letterSpacing: 1.5,
        cursor: "pointer",
        textTransform: "uppercase",
        fontWeight: 700,
      }}
    >
      {children}
    </button>
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
        background: C.burgundySoft,
        color: C.burgundy,
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

// ─── Product form modal (create + edit) ──────────────────────────────────────
function ProductFormModal({
  mode,
  product,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  product: Product | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState(product?.name ?? "");
  const [description, setDescription] = useState(product?.description ?? "");
  const [price, setPrice] = useState(String(product?.price ?? ""));
  const [category, setCategory] = useState(product?.category ?? "");
  const [stock, setStock] = useState(String(product?.stock ?? "0"));
  const [threshold, setThreshold] = useState(
    String(product?.low_stock_threshold ?? "0"),
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      if (mode === "create") {
        await adminProductsApi.create({
          name: name.trim(),
          description: description.trim() || undefined,
          price: Number(price),
          category: category.trim(),
          stock: Number(stock) || 0,
          low_stock_threshold: Number(threshold) || 0,
        });
      } else if (product) {
        await adminProductsApi.update(product.id, {
          name: name.trim(),
          description: description.trim() || undefined,
          price: Number(price),
          category: category.trim(),
          low_stock_threshold: Number(threshold) || 0,
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
    <ModalShell title={mode === "create" ? "Nuevo producto" : `Editar ${product?.name}`} onClose={onClose}>
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
        {mode === "create" && (
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
        )}
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

// ─── Stock movement modal ────────────────────────────────────────────────────
function StockMovementModal({
  product,
  onClose,
  onSaved,
}: {
  product: Product;
  onClose: () => void;
  onSaved: () => void;
}) {
  // The UI surfaces semantic actions; the wire payload always carries a
  // signed delta (waste -> negative, restock -> positive, etc).
  const [type, setType] = useState<InventoryMovementType>("restock");
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const labels: Record<
    InventoryMovementType,
    { title: string; helper: string; sign: 1 | -1 | 0 }
  > = {
    restock: {
      title: "Reponer",
      helper: "Unidades a sumar",
      sign: 1,
    },
    waste: {
      title: "Merma",
      helper: "Unidades a desechar",
      sign: -1,
    },
    adjustment: {
      title: "Ajuste",
      helper: "Delta firmado (+ suma / − resta)",
      sign: 0,
    },
    correction: {
      title: "Corrección",
      helper: "Delta firmado para corregir un error previo",
      sign: 0,
    },
  };
  const meta = labels[type];

  function computeQuantity(): number {
    const n = Number(amount);
    if (!Number.isFinite(n)) return NaN;
    if (meta.sign === 1) return Math.abs(n);
    if (meta.sign === -1) return -Math.abs(n);
    return n; // adjustment / correction → use as-is
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

  return (
    <ModalShell title={`Stock — ${product.name}`} onClose={onClose}>
      <form onSubmit={submit} style={formStyle}>
        <div
          style={{
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1.5,
            color: C.mute,
            textTransform: "uppercase",
          }}
        >
          Stock actual: <strong style={{ color: C.ink }}>{product.stock}</strong>
        </div>

        <Field label="Tipo de movimiento">
          <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
            {(
              ["restock", "waste", "adjustment", "correction"] as const
            ).map((t) => {
              const active = type === t;
              return (
                <button
                  key={t}
                  type="button"
                  onClick={() => setType(t)}
                  style={{
                    padding: "8px 12px",
                    border: `1px solid ${active ? C.ink : C.sand}`,
                    background: active ? C.ink : C.paper,
                    color: active ? C.paper : C.cacao,
                    borderRadius: 999,
                    fontFamily: FONT_DISPLAY,
                    fontSize: 12,
                    letterSpacing: 2,
                    textTransform: "uppercase",
                    cursor: "pointer",
                    fontWeight: 600,
                  }}
                >
                  {labels[t].title}
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
            <strong style={{ color: C.ink }}>{computeQuantity() || 0}</strong>
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
            placeholder="Ej: entrega proveedor, botellas rotas, miscount..."
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
        <ModalActions onCancel={onClose} submitting={submitting} />
      </form>
    </ModalShell>
  );
}

// ─── Per-product history drawer ──────────────────────────────────────────────
function ProductHistoryDrawer({
  product,
  onClose,
}: {
  product: Product;
  onClose: () => void;
}) {
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    inventoryMovementsApi
      .listForProduct(product.id, { limit: 100 })
      .then(setMovements)
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false));
  }, [product.id]);

  return (
    <ModalShell
      title={`Historial — ${product.name}`}
      onClose={onClose}
      wide
    >
      {error && <ErrorBanner text={error} />}
      {loading && (
        <div style={{ padding: 24, color: C.mute, fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 2, textTransform: "uppercase" }}>
          Cargando...
        </div>
      )}
      {!loading && movements.length === 0 && (
        <div style={{ padding: 32, color: C.mute, fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", textAlign: "center" }}>
          Sin movimientos
        </div>
      )}
      <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {movements.map((m) => (
          <MovementRow key={m.id} movement={m} />
        ))}
      </ul>
    </ModalShell>
  );
}

// ─── Movements tab (global ledger) ───────────────────────────────────────────
function MovementsTab() {
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [type, setType] = useState<InventoryMovementType | "all">("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    inventoryMovementsApi
      .listGlobal({
        type: type === "all" ? undefined : type,
        limit: 200,
      })
      .then(setMovements)
      .catch((e) => setError(getErrorMessage(e)))
      .finally(() => setLoading(false));
  }, [type]);

  return (
    <section>
      <div
        style={{
          display: "flex",
          gap: 6,
          flexWrap: "wrap",
          marginBottom: 14,
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 2,
            color: C.mute,
            textTransform: "uppercase",
            marginRight: 4,
          }}
        >
          Tipo:
        </span>
        {(["all", "restock", "waste", "adjustment", "correction"] as const).map(
          (t) => (
            <button
              key={t}
              type="button"
              onClick={() => setType(t)}
              style={{
                padding: "6px 12px",
                borderRadius: 999,
                border: `1px solid ${type === t ? C.ink : C.sand}`,
                background: type === t ? C.ink : C.paper,
                color: type === t ? C.paper : C.cacao,
                fontFamily: FONT_MONO,
                fontSize: 10,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                cursor: "pointer",
                fontWeight: 700,
              }}
            >
              {t === "all" ? "Todos" : t}
            </button>
          ),
        )}
      </div>

      {error && <ErrorBanner text={error} />}

      <div
        style={{
          background: C.paper,
          border: `1px solid ${C.sand}`,
          borderRadius: 14,
          overflow: "hidden",
        }}
      >
        {loading && (
          <div style={{ padding: 24, color: C.mute, fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", textAlign: "center" }}>
            Cargando...
          </div>
        )}
        {!loading && movements.length === 0 && (
          <div style={{ padding: 32, color: C.mute, fontFamily: FONT_MONO, fontSize: 11, letterSpacing: 2, textTransform: "uppercase", textAlign: "center" }}>
            Sin movimientos
          </div>
        )}
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {movements.map((m) => (
            <MovementRow key={m.id} movement={m} showProductId />
          ))}
        </ul>
      </div>
    </section>
  );
}

function MovementRow({
  movement,
  showProductId,
}: {
  movement: InventoryMovement;
  showProductId?: boolean;
}) {
  const typeMeta: Record<
    InventoryMovementType,
    { label: string; bg: string; fg: string }
  > = {
    restock: { label: "Reposición", bg: C.oliveSoft, fg: C.olive },
    waste: { label: "Merma", bg: C.burgundySoft, fg: C.burgundy },
    adjustment: { label: "Ajuste", bg: C.sandDark, fg: C.ink },
    correction: { label: "Corrección", bg: C.goldSoft, fg: C.cacao },
  };
  const m = typeMeta[movement.type];
  const positive = movement.quantity > 0;
  return (
    <li
      style={{
        padding: "12px 18px",
        borderBottom: `1px solid ${C.sand}`,
        display: "grid",
        gridTemplateColumns: "1fr auto",
        gap: 6,
      }}
    >
      <div>
        <div
          style={{
            display: "flex",
            gap: 6,
            alignItems: "center",
            flexWrap: "wrap",
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 1.5,
            color: C.mute,
            textTransform: "uppercase",
          }}
        >
          <span
            style={{
              padding: "2px 8px",
              borderRadius: 999,
              background: m.bg,
              color: m.fg,
              fontWeight: 700,
            }}
          >
            {m.label}
          </span>
          <span>
            {new Date(movement.created_at).toLocaleString()}
          </span>
          {showProductId && (
            <span style={{ color: C.cacao }}>· producto #{movement.product_id}</span>
          )}
        </div>
        {movement.reason && (
          <div
            style={{
              fontFamily: FONT_UI,
              fontSize: 13,
              color: C.cacao,
              fontStyle: "italic",
              marginTop: 4,
            }}
          >
            “{movement.reason}”
            {movement.created_by && (
              <span style={{ marginLeft: 6, fontStyle: "normal", color: C.mute, fontSize: 11 }}>
                · {movement.created_by}
              </span>
            )}
          </div>
        )}
      </div>
      <div
        style={{
          fontFamily: FONT_DISPLAY,
          fontSize: 18,
          color: positive ? C.olive : C.burgundy,
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
            style={{
              background: "transparent",
              border: `1px solid ${C.sand}`,
              borderRadius: 999,
              width: 32,
              height: 32,
              cursor: "pointer",
              color: C.cacao,
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
        onClick={onCancel}
        style={{
          padding: "9px 16px",
          border: `1px solid ${C.sand}`,
          background: "transparent",
          color: C.cacao,
          borderRadius: 999,
          fontFamily: FONT_MONO,
          fontSize: 11,
          letterSpacing: 2,
          cursor: "pointer",
          textTransform: "uppercase",
        }}
      >
        Cancelar
      </button>
      <button
        type="submit"
        disabled={submitting}
        style={{
          padding: "9px 18px",
          border: "none",
          borderRadius: 999,
          background: submitting ? C.sand : C.ink,
          color: submitting ? C.mute : C.paper,
          fontFamily: FONT_DISPLAY,
          fontSize: 13,
          letterSpacing: 2.5,
          cursor: submitting ? "not-allowed" : "pointer",
          textTransform: "uppercase",
        }}
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

const primaryBtnStyle: React.CSSProperties = {
  padding: "9px 16px",
  border: "none",
  borderRadius: 999,
  background: `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`,
  color: C.paper,
  fontFamily: FONT_DISPLAY,
  fontSize: 13,
  letterSpacing: 3,
  cursor: "pointer",
  textTransform: "uppercase",
};
