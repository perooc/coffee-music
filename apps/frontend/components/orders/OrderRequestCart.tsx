"use client";

/**
 * Customer cart for building an OrderRequest.
 *
 * UI flow (drill-down):
 *   - View A: grid of categories. Each tile shows product count, sold-out
 *     hint, and the running cart count for that category.
 *   - View B: products inside one category, with quantity steppers.
 *   - Footer is shared and shows cart estimate + submit button regardless
 *     of which view is active. Cart state survives navigation between
 *     A and B; only `submit` or `close` clears it.
 *
 * Strict separation:
 *   - Catalog (products)   → backend, read from the store.
 *   - Cart items           → local state only. Not persisted.
 *   - Submitted requests   → backend + socket. We do NOT read them here.
 *   - Active orders        → backend + socket. We do NOT read them here.
 */
import { useEffect, useMemo, useState } from "react";
import { orderRequestsApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import type { OrderRequest, Product } from "@coffee-bar/shared";

const fmt = (n: number) =>
  new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);

type CartState = Record<number, number>; // product_id -> quantity

/**
 * Two modes:
 *   - create: opens empty, submits POST /order-requests.
 *   - edit:   opens prefilled with `editing.items`, submits PATCH
 *             /order-requests/:id. Reuses the same UI; only the entry
 *             state and the submit endpoint differ.
 */
type EditingTarget = {
  requestId: number;
  items: { product_id: number; quantity: number }[];
};

interface Props {
  open: boolean;
  onClose: () => void;
  /**
   * Called after a successful create/update. We hand back the OrderRequest
   * the server returned so the parent can seed it into local state
   * immediately, without waiting for the socket. The socket may arrive
   * before, after, or never (mobile Safari sometimes drops the first
   * event of a freshly-joined room) — `upsertById` upstream means the
   * extra event becomes a harmless no-op.
   */
  onSubmitted: (request: OrderRequest) => void;
  tableSessionId: number;
  products: Product[];
  /** When provided, the modal opens in edit mode. */
  editing?: EditingTarget | null;
}

export function OrderRequestCart({
  open,
  onClose,
  onSubmitted,
  tableSessionId,
  products,
  editing,
}: Props) {
  const [cart, setCart] = useState<CartState>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<
    { kind: "categories" } | { kind: "products"; category: string }
  >({ kind: "categories" });

  const isEditMode = editing != null;

  useEffect(() => {
    // Reset on open: cart and navigation state are ephemeral and must not
    // leak between openings. In edit mode, prefill from the request being
    // edited so the customer sees their current items already loaded.
    if (open) {
      if (editing) {
        const seeded: CartState = {};
        for (const it of editing.items) {
          seeded[it.product_id] = (seeded[it.product_id] ?? 0) + it.quantity;
        }
        setCart(seeded);
      } else {
        setCart({});
      }
      setError(null);
      setView({ kind: "categories" });
    }
  }, [open, editing]);

  // Lock the page's scroll while the modal is open. We set
  // `overflow: hidden` on the body so the page underneath can't move,
  // but we DON'T set touch-action there — that would also disable the
  // pinch/zoom-style gestures inside the modal on some Android builds.
  // Inner scroll containers explicitly opt back into `pan-y` to keep
  // their gesture surface alive.
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  const cartEntries = useMemo(
    () =>
      Object.entries(cart)
        .map(([id, qty]) => ({ id: Number(id), qty }))
        .filter((e) => e.qty > 0),
    [cart],
  );

  const cartUnitCount = useMemo(
    () => cartEntries.reduce((acc, e) => acc + e.qty, 0),
    [cartEntries],
  );

  const productsById = useMemo(
    () => new Map(products.map((p) => [p.id, p])),
    [products],
  );

  const estimatedTotal = useMemo(() => {
    return cartEntries.reduce((acc, e) => {
      const p = productsById.get(e.id);
      if (!p) return acc;
      return acc + Number(p.price) * e.qty;
    }, 0);
  }, [cartEntries, productsById]);

  const productsByCategory = useMemo(() => {
    const m = new Map<string, Product[]>();
    for (const p of products) {
      const list = m.get(p.category) ?? [];
      list.push(p);
      m.set(p.category, list);
    }
    return m;
  }, [products]);

  /**
   * Aggregated metadata per category. We hide categories with zero products
   * (so we don't show empty tiles), but keep ones whose products are all
   * sold out — the customer should still see the category exists.
   */
  const categories = useMemo(() => {
    const out: {
      name: string;
      total: number;
      available: number;
      cartCount: number;
    }[] = [];
    for (const [name, list] of productsByCategory) {
      if (list.length === 0) continue;
      const available = list.filter(
        (p) => p.is_active && p.stock > 0,
      ).length;
      const cartCount = list.reduce(
        (acc, p) => acc + (cart[p.id] ?? 0),
        0,
      );
      out.push({ name, total: list.length, available, cartCount });
    }
    out.sort((a, b) => a.name.localeCompare(b.name));
    return out;
  }, [productsByCategory, cart]);

  const bump = (product: Product, delta: number) => {
    setCart((prev) => {
      const current = prev[product.id] ?? 0;
      const next = Math.max(0, current + delta);
      // Cap locally at stock to avoid obvious errors. Backend re-validates.
      const capped = Math.min(next, product.stock);
      if (capped === current) return prev;
      const updated = { ...prev, [product.id]: capped };
      if (capped === 0) delete updated[product.id];
      return updated;
    });
  };

  const submit = async () => {
    if (cartEntries.length === 0) return;
    setSubmitting(true);
    setError(null);
    try {
      const items = cartEntries.map((e) => ({
        product_id: e.id,
        quantity: e.qty,
      }));
      // Always capture the server-returned row so the parent can seed it
      // into local state without waiting for the socket. iOS Safari drops
      // the first event of a freshly-joined room more often than chrome
      // does, which is why the very first request used to "disappear"
      // until a manual refresh.
      const result = isEditMode && editing
        ? await orderRequestsApi.update(editing.requestId, { items })
        : await orderRequestsApi.create({
            table_session_id: tableSessionId,
            items,
          });
      onSubmitted(result);
      onClose();
    } catch (err) {
      // Surface the canonical "admin already accepted" case in plain words.
      const code = (err as { response?: { data?: { code?: string } } })
        ?.response?.data?.code;
      if (code === "ORDER_REQUEST_NOT_PENDING") {
        setError(
          "Tu pedido ya fue aceptado por el bar. Recarga para ver tu pedido.",
        );
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (!open) return null;

  const inCategoriesView = view.kind === "categories";

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Pedir productos"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        zIndex: 50,
        padding: 0,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 540,
          // Fixed height (not max-height): without a definite height the
          // flex children can't compute a real `flex: 1` size, so the
          // inner overflow:auto hands the scroll to the page behind. With
          // 92dvh the rail has a concrete budget and the lists scroll
          // inside the sheet as expected.
          height: "92dvh",
          background: "#FFFDF8",
          borderRadius: "20px 20px 0 0",
          display: "flex",
          flexDirection: "column",
          boxShadow: "0 -20px 60px -20px rgba(43,29,20,0.45)",
          overflow: "hidden",
        }}
      >
        <header
          style={{
            padding: "18px 22px 14px",
            borderBottom: "1px solid #F1E6D2",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            gap: 10,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
            {!inCategoriesView && (
              <button
                type="button"
                aria-label="Volver a categorías"
                onClick={() => setView({ kind: "categories" })}
                style={{
                  background: "transparent",
                  border: "1px solid #F1E6D2",
                  borderRadius: 999,
                  width: 34,
                  height: 34,
                  fontFamily: "var(--font-bebas)",
                  fontSize: 18,
                  lineHeight: 1,
                  color: "#6B4E2E",
                  cursor: "pointer",
                  flexShrink: 0,
                }}
              >
                ←
              </button>
            )}
            <div style={{ minWidth: 0 }}>
              <span
                style={{
                  fontFamily: "var(--font-oswald)",
                  fontSize: 10,
                  letterSpacing: 3,
                  color: "#A89883",
                  textTransform: "uppercase",
                  fontWeight: 600,
                }}
              >
                {inCategoriesView
                  ? isEditMode
                    ? "— Editar pedido"
                    : "— Pedir"
                  : "← Volver"}
              </span>
              <h2
                style={{
                  fontFamily: "var(--font-bebas)",
                  fontSize: 28,
                  letterSpacing: 1,
                  color: "#2B1D14",
                  margin: 0,
                  lineHeight: 1,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  textTransform: "uppercase",
                }}
              >
                {inCategoriesView
                  ? isEditMode
                    ? `Pedido #${editing?.requestId ?? ""}`
                    : "Carta"
                  : view.category}
              </h2>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            style={{
              background: "transparent",
              border: "1px solid #F1E6D2",
              borderRadius: 999,
              width: 36,
              height: 36,
              fontSize: 18,
              color: "#6B4E2E",
              cursor: "pointer",
              flexShrink: 0,
            }}
          >
            ✕
          </button>
        </header>

        {/* Sliding rail: two views side by side, translate to switch.
            `minHeight: 0` is critical — without it the flex item refuses
            to shrink below its content's natural height, the inner
            overflow:auto stops working, and on mobile the scroll bleeds
            through to the page behind the overlay.
            `touchAction: pan-y` re-enables vertical gestures inside this
            sub-tree; the body has touchAction:none while the modal is
            open and CSS inherits that down the tree. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            overflow: "hidden",
            position: "relative",
            touchAction: "pan-y",
          }}
        >
          <div
            style={{
              display: "flex",
              width: "200%",
              height: "100%",
              transform: inCategoriesView
                ? "translateX(0)"
                : "translateX(-50%)",
              transition: "transform 220ms cubic-bezier(0.16, 1, 0.3, 1)",
            }}
          >
            <CategoriesView
              categories={categories}
              empty={products.length === 0}
              onPick={(name) => setView({ kind: "products", category: name })}
            />
            <ProductsView
              category={view.kind === "products" ? view.category : null}
              products={
                view.kind === "products"
                  ? (productsByCategory.get(view.category) ?? [])
                  : []
              }
              cart={cart}
              onBump={bump}
            />
          </div>
        </div>

        <footer
          style={{
            padding: "14px 22px calc(14px + env(safe-area-inset-bottom))",
            borderTop: "1px solid #F1E6D2",
            background: "#FDF8EC",
          }}
        >
          {error && (
            <p
              role="alert"
              style={{
                margin: "0 0 10px",
                fontFamily: "var(--font-oswald)",
                fontSize: 11,
                color: "#8B2635",
                letterSpacing: 1.5,
                textTransform: "uppercase",
              }}
            >
              {error}
            </p>
          )}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: 10,
              gap: 10,
            }}
          >
            <span
              style={{
                fontFamily: "var(--font-oswald)",
                fontSize: 10,
                letterSpacing: 3,
                color: "#A89883",
                textTransform: "uppercase",
              }}
            >
              {cartUnitCount === 0
                ? "Carrito vacío"
                : `${cartUnitCount} ${cartUnitCount === 1 ? "producto" : "productos"}`}
            </span>
            <span
              style={{
                fontFamily: "var(--font-bebas)",
                fontSize: 26,
                color: cartUnitCount === 0 ? "#A89883" : "#B8894A",
                letterSpacing: 1,
              }}
            >
              {fmt(estimatedTotal)}
            </span>
          </div>
          <button
            type="button"
            onClick={submit}
            disabled={cartEntries.length === 0 || submitting}
            style={{
              width: "100%",
              padding: "16px 20px",
              border: "none",
              borderRadius: 999,
              background:
                cartEntries.length === 0 || submitting
                  ? "#F1E6D2"
                  : "linear-gradient(135deg, #B8894A 0%, #C9944F 100%)",
              color:
                cartEntries.length === 0 || submitting ? "#A89883" : "#FFFDF8",
              fontFamily: "var(--font-bebas)",
              fontSize: 16,
              letterSpacing: 3,
              textTransform: "uppercase",
              cursor:
                cartEntries.length === 0 || submitting
                  ? "not-allowed"
                  : "pointer",
            }}
          >
            {submitting
              ? "Enviando..."
              : isEditMode
                ? "Guardar cambios"
                : "Enviar pedido"}
          </button>
          <p
            style={{
              margin: "8px 0 0",
              fontFamily: "var(--font-oswald)",
              fontSize: 10,
              color: "#A89883",
              letterSpacing: 1.5,
              textAlign: "center",
              lineHeight: 1.5,
            }}
          >
            Tu pedido será revisado por el bar antes de prepararse.
          </p>
        </footer>
      </div>
    </div>
  );
}

// ─── View A: categories grid ─────────────────────────────────────────────
function CategoriesView({
  categories,
  empty,
  onPick,
}: {
  categories: {
    name: string;
    total: number;
    available: number;
    cartCount: number;
  }[];
  empty: boolean;
  onPick: (name: string) => void;
}) {
  return (
    <div
      style={{
        width: "50%",
        height: "100%",
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        // Without `touchAction: pan-y` iOS sometimes assigns the gesture
        // to the parent backdrop (which has touchAction:none from the
        // body lock). pan-y explicitly says "this region scrolls
        // vertically — don't hijack the touch".
        touchAction: "pan-y",
        padding: "16px 22px 18px",
      }}
    >
      {empty && (
        <p
          style={{
            padding: "40px 20px",
            textAlign: "center",
            fontFamily: "var(--font-oswald)",
            fontSize: 11,
            color: "#A89883",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          No hay productos disponibles
        </p>
      )}

      {!empty && categories.length === 0 && (
        <p
          style={{
            padding: "40px 20px",
            textAlign: "center",
            fontFamily: "var(--font-oswald)",
            fontSize: 11,
            color: "#A89883",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Sin categorías
        </p>
      )}

      {categories.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))",
            gap: 12,
          }}
        >
          {categories.map((c) => {
            const allSoldOut = c.available === 0;
            return (
              <button
                key={c.name}
                type="button"
                onClick={() => onPick(c.name)}
                aria-label={`Abrir ${c.name}${allSoldOut ? " (agotada)" : ""}`}
                style={{
                  position: "relative",
                  textAlign: "left",
                  padding: "16px 14px",
                  border: `1px solid ${allSoldOut ? "#F1E6D2" : "#E6D8BF"}`,
                  borderRadius: 14,
                  background: allSoldOut
                    ? "#F8F1E4"
                    : "linear-gradient(160deg, #FFFDF8 0%, #FDF8EC 100%)",
                  color: "#2B1D14",
                  cursor: "pointer",
                  display: "flex",
                  flexDirection: "column",
                  gap: 8,
                  minHeight: 96,
                  transition: "transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.18s ease",
                  boxShadow:
                    "0 1px 0 rgba(43,29,20,0.04), 0 8px 22px -16px rgba(107,78,46,0.28)",
                  opacity: allSoldOut ? 0.65 : 1,
                  fontFamily: "var(--font-manrope)",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <div
                  style={{
                    fontFamily: "var(--font-bebas)",
                    fontSize: 22,
                    color: "#2B1D14",
                    letterSpacing: 1,
                    textTransform: "uppercase",
                    lineHeight: 1.05,
                  }}
                >
                  {c.name}
                </div>
                <div
                  style={{
                    fontFamily: "var(--font-oswald)",
                    fontSize: 10,
                    letterSpacing: 1.5,
                    color: "#A89883",
                    textTransform: "uppercase",
                    fontWeight: 600,
                    marginTop: "auto",
                  }}
                >
                  {allSoldOut ? (
                    <span style={{ color: "#8B2635" }}>Agotada</span>
                  ) : c.available === c.total ? (
                    <>{c.total} productos</>
                  ) : (
                    <>
                      {c.available} disponibles · {c.total - c.available} agotados
                    </>
                  )}
                </div>
                {c.cartCount > 0 && (
                  <span
                    aria-label={`${c.cartCount} en carrito`}
                    style={{
                      position: "absolute",
                      top: 10,
                      right: 10,
                      minWidth: 24,
                      height: 24,
                      padding: "0 8px",
                      borderRadius: 999,
                      background: "linear-gradient(135deg, #B8894A 0%, #C9944F 100%)",
                      color: "#FFFDF8",
                      fontFamily: "var(--font-bebas)",
                      fontSize: 13,
                      letterSpacing: 0.5,
                      display: "inline-flex",
                      alignItems: "center",
                      justifyContent: "center",
                    }}
                  >
                    {c.cartCount}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── View B: products inside one category ────────────────────────────────
function ProductsView({
  category,
  products,
  cart,
  onBump,
}: {
  category: string | null;
  products: Product[];
  cart: CartState;
  onBump: (p: Product, delta: number) => void;
}) {
  return (
    <div
      style={{
        width: "50%",
        height: "100%",
        overflowY: "auto",
        overscrollBehavior: "contain",
        WebkitOverflowScrolling: "touch",
        touchAction: "pan-y",
        padding: "14px 22px 18px",
      }}
    >
      {category == null && <div />}
      {category != null && products.length === 0 && (
        <p
          style={{
            padding: "40px 20px",
            textAlign: "center",
            fontFamily: "var(--font-oswald)",
            fontSize: 11,
            color: "#A89883",
            letterSpacing: 2,
            textTransform: "uppercase",
          }}
        >
          Sin productos en esta categoría
        </p>
      )}
      {category != null && products.length > 0 && (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {products.map((p) => {
            const qty = cart[p.id] ?? 0;
            const soldOut = !p.is_active || p.stock === 0;
            const atCap = qty >= p.stock;
            return (
              <li
                key={p.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "12px 0",
                  borderBottom: "1px solid #F8F1E4",
                  opacity: soldOut ? 0.5 : 1,
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontFamily: "var(--font-bebas)",
                      fontSize: 18,
                      color: "#2B1D14",
                      letterSpacing: 0.4,
                    }}
                  >
                    {p.name}
                  </div>
                  <div
                    style={{
                      fontFamily: "var(--font-oswald)",
                      fontSize: 11,
                      color: "#B8894A",
                      letterSpacing: 1,
                      marginTop: 2,
                    }}
                  >
                    {fmt(Number(p.price))}
                    {soldOut && (
                      <span style={{ marginLeft: 10, color: "#8B2635" }}>
                        Agotado
                      </span>
                    )}
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <button
                    type="button"
                    onClick={() => onBump(p, -1)}
                    disabled={qty === 0 || soldOut}
                    aria-label={`Quitar ${p.name}`}
                    style={stepperStyle(qty === 0 || soldOut)}
                  >
                    −
                  </button>
                  <span
                    style={{
                      fontFamily: "var(--font-bebas)",
                      fontSize: 18,
                      minWidth: 22,
                      textAlign: "center",
                      color: qty > 0 ? "#2B1D14" : "#A89883",
                    }}
                  >
                    {qty}
                  </span>
                  <button
                    type="button"
                    onClick={() => onBump(p, 1)}
                    disabled={soldOut || atCap}
                    aria-label={`Agregar ${p.name}`}
                    style={stepperStyle(soldOut || atCap)}
                  >
                    +
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function stepperStyle(disabled: boolean): React.CSSProperties {
  return {
    width: 32,
    height: 32,
    borderRadius: 999,
    border: `1px solid ${disabled ? "#F1E6D2" : "#B8894A"}`,
    background: disabled ? "#F8F1E4" : "#FFFDF8",
    color: disabled ? "#A89883" : "#2B1D14",
    fontFamily: "var(--font-bebas)",
    fontSize: 20,
    lineHeight: 1,
    cursor: disabled ? "not-allowed" : "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
  };
}
