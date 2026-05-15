"use client";

/**
 * Editor de receta de un producto compuesto. Se monta como sección
 * dentro del modo Edit del panel de productos.
 *
 * Estado interno:
 *   - `slots`: estructura WIP que el operador está armando.
 *   - `dirty`: flag para mostrar el botón de guardar habilitado.
 *
 * Validación local (live):
 *   - Cada slot debe tener al menos 1 opción.
 *   - Cada opción debe tener un componente seleccionado.
 *   - Sin duplicar componente dentro de un mismo slot.
 *   - Suma de default_quantity por slot debe igualar quantity.
 *
 * Persistencia:
 *   - Botón "Guardar receta" envía un PUT al backend.
 *   - El backend revalida + transacción.
 *   - Vacío (slots=[]) borra la receta → producto se vuelve simple.
 */

import {
  ChangeEvent,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { Product } from "@coffee-bar/shared";
import {
  adminProductsApi,
  type ProductRecipeSlotView,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { C, FONT_DISPLAY, FONT_MONO, FONT_UI } from "@/lib/theme";

interface Props {
  productId: number;
  allProducts: Product[];
}

interface SlotState {
  // Si tiene `id`, viene del backend; null = nuevo slot local sin
  // persistir. No usamos el id para nada del UI — la clave del map es
  // la posición en el array. Sólo para depurar.
  id: number | null;
  label: string;
  quantity: number;
  options: OptionState[];
}

interface OptionState {
  id: number | null;
  component_id: number | null;
  default_quantity: number;
}

const inputBase: React.CSSProperties = {
  padding: "8px 10px",
  border: `1px solid ${C.sand}`,
  borderRadius: 8,
  background: C.paper,
  color: C.ink,
  fontFamily: FONT_UI,
  fontSize: 13,
  outline: "none",
};

export function ProductRecipeEditor({ productId, allProducts }: Props) {
  const [slots, setSlots] = useState<SlotState[]>([]);
  const [originalSlots, setOriginalSlots] = useState<SlotState[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  // Productos que pueden usarse como componentes:
  //   - is_active = true
  //   - id distinto al del producto que estamos editando (no auto-ref)
  // El backend rechaza si el componente es compuesto, pero acá no
  // tenemos esa info por producto sin pedirle. Lo dejamos al backend.
  const eligibleComponents = useMemo(
    () =>
      allProducts
        .filter((p) => p.is_active && p.id !== productId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allProducts, productId],
  );

  const reload = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await adminProductsApi.getRecipe(productId);
      const snapshot = serverToState(data);
      setSlots(snapshot);
      setOriginalSlots(snapshot);
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [productId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const dirty = useMemo(
    () => JSON.stringify(slots) !== JSON.stringify(originalSlots),
    [slots, originalSlots],
  );

  const slotErrors = useMemo(() => validateSlots(slots), [slots]);
  const hasErrors = slotErrors.some((e) => e !== null);
  const canSave = dirty && !hasErrors && !saving;

  const addSlot = () => {
    setSlots((prev) => [
      ...prev,
      {
        id: null,
        label: prev.length === 0 ? "Cervezas" : `Slot ${prev.length + 1}`,
        quantity: 6,
        options: [{ id: null, component_id: null, default_quantity: 6 }],
      },
    ]);
  };

  const removeSlot = (idx: number) => {
    setSlots((prev) => prev.filter((_, i) => i !== idx));
  };

  const updateSlot = (idx: number, patch: Partial<SlotState>) => {
    setSlots((prev) =>
      prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)),
    );
  };

  const addOption = (slotIdx: number) => {
    setSlots((prev) =>
      prev.map((s, i) =>
        i === slotIdx
          ? {
              ...s,
              options: [
                ...s.options,
                { id: null, component_id: null, default_quantity: 0 },
              ],
            }
          : s,
      ),
    );
  };

  const removeOption = (slotIdx: number, optIdx: number) => {
    setSlots((prev) =>
      prev.map((s, i) =>
        i === slotIdx
          ? { ...s, options: s.options.filter((_, j) => j !== optIdx) }
          : s,
      ),
    );
  };

  const updateOption = (
    slotIdx: number,
    optIdx: number,
    patch: Partial<OptionState>,
  ) => {
    setSlots((prev) =>
      prev.map((s, i) =>
        i === slotIdx
          ? {
              ...s,
              options: s.options.map((o, j) =>
                j === optIdx ? { ...o, ...patch } : o,
              ),
            }
          : s,
      ),
    );
  };

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const payload = slots.map((s) => ({
        label: s.label.trim(),
        quantity: s.quantity,
        options: s.options.map((o) => ({
          component_id: o.component_id!,
          default_quantity: o.default_quantity,
        })),
      }));
      const refreshed = await adminProductsApi.putRecipe(productId, payload);
      const snapshot = serverToState(refreshed);
      setSlots(snapshot);
      setOriginalSlots(snapshot);
      setSuccess(
        snapshot.length === 0
          ? "Receta eliminada. Producto vuelve a ser simple."
          : "Receta guardada.",
      );
    } catch (e) {
      setError(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      style={{
        marginTop: 14,
        paddingTop: 14,
        borderTop: `1px solid ${C.sand}`,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 2.5,
            color: C.cacao,
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          Composición
        </span>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.mute,
            letterSpacing: 0.5,
          }}
        >
          {loading
            ? "Cargando..."
            : slots.length === 0
              ? "Producto simple"
              : `${slots.length} slot(s)`}
        </span>
      </div>

      {loading ? null : slots.length === 0 ? (
        <div
          style={{
            padding: "10px 12px",
            border: `1px dashed ${C.sand}`,
            borderRadius: 10,
            background: C.cream,
            fontFamily: FONT_UI,
            fontSize: 12,
            color: C.cacao,
            lineHeight: 1.5,
          }}
        >
          Este producto se vende como una unidad simple — al pedirse,
          descuenta 1 unidad de su propio stock. Para convertirlo en
          un compuesto (cubetazo, sixpack, combo), agregá uno o más
          slots con sus componentes.
        </div>
      ) : (
        slots.map((slot, idx) => (
          <SlotEditor
            key={idx}
            slot={slot}
            index={idx}
            error={slotErrors[idx]}
            eligible={eligibleComponents}
            onChange={(patch) => updateSlot(idx, patch)}
            onRemove={() => removeSlot(idx)}
            onAddOption={() => addOption(idx)}
            onRemoveOption={(j) => removeOption(idx, j)}
            onUpdateOption={(j, p) => updateOption(idx, j, p)}
          />
        ))
      )}

      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          onClick={addSlot}
          style={{
            padding: "6px 12px",
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 1.5,
            color: C.cacao,
            background: C.paper,
            border: `1px solid ${C.sand}`,
            borderRadius: 999,
            cursor: "pointer",
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          + Slot
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!canSave}
          style={{
            padding: "6px 14px",
            fontFamily: FONT_DISPLAY,
            fontSize: 12,
            letterSpacing: 2,
            color: canSave ? C.paper : C.mute,
            background: canSave
              ? `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`
              : C.sand,
            border: "none",
            borderRadius: 999,
            cursor: canSave ? "pointer" : "not-allowed",
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          {saving
            ? "Guardando..."
            : slots.length === 0 && originalSlots.length > 0
              ? "Quitar receta"
              : "Guardar receta"}
        </button>
        {dirty && !saving && (
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              color: C.mute,
              letterSpacing: 0.5,
            }}
          >
            Cambios sin guardar
          </span>
        )}
      </div>

      {error && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: 8,
            background: C.terracottaSoft,
            color: C.terracotta,
            borderRadius: 8,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 0.5,
          }}
        >
          {error}
        </p>
      )}
      {success && (
        <p
          role="status"
          style={{
            margin: 0,
            padding: 8,
            background: `${C.olive}11`,
            color: C.olive,
            border: `1px solid ${C.olive}55`,
            borderRadius: 8,
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 0.5,
          }}
        >
          {success}
        </p>
      )}
    </div>
  );
}

function SlotEditor({
  slot,
  index,
  error,
  eligible,
  onChange,
  onRemove,
  onAddOption,
  onRemoveOption,
  onUpdateOption,
}: {
  slot: SlotState;
  index: number;
  error: string | null;
  eligible: Product[];
  onChange: (patch: Partial<SlotState>) => void;
  onRemove: () => void;
  onAddOption: () => void;
  onRemoveOption: (optIdx: number) => void;
  onUpdateOption: (optIdx: number, patch: Partial<OptionState>) => void;
}) {
  const sumDefaults = slot.options.reduce(
    (acc, o) => acc + (o.default_quantity || 0),
    0,
  );
  const slotMatchesTotal = sumDefaults === slot.quantity;

  return (
    <div
      style={{
        padding: "10px 12px",
        border: `1px solid ${error ? C.terracotta : C.sand}`,
        borderRadius: 10,
        background: C.cream,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
        }}
      >
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            color: C.mute,
            fontWeight: 700,
            letterSpacing: 1.5,
            textTransform: "uppercase",
            minWidth: 28,
          }}
        >
          #{index + 1}
        </span>
        <input
          type="text"
          value={slot.label}
          onChange={(e) => onChange({ label: e.target.value })}
          placeholder="Etiqueta (ej. Cervezas, Licor)"
          maxLength={60}
          style={{ ...inputBase, flex: 1 }}
        />
        <input
          type="number"
          min={1}
          step={1}
          value={slot.quantity}
          onChange={(e) =>
            onChange({
              quantity: Math.max(0, Math.floor(Number(e.target.value) || 0)),
            })
          }
          style={{ ...inputBase, width: 72, textAlign: "right" }}
          aria-label="Cantidad total del slot"
        />
        <button
          type="button"
          onClick={onRemove}
          aria-label="Eliminar slot"
          title="Eliminar slot"
          style={{
            width: 28,
            height: 28,
            border: `1px solid ${C.sand}`,
            background: C.paper,
            color: C.mute,
            borderRadius: 999,
            cursor: "pointer",
            fontSize: 14,
            lineHeight: 1,
          }}
        >
          ✕
        </button>
      </div>

      {/* Suma de defaults vs quantity */}
      <div
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          color: slotMatchesTotal ? C.olive : C.terracotta,
          letterSpacing: 0.5,
        }}
      >
        Suma defaults: {sumDefaults} / {slot.quantity}{" "}
        {slotMatchesTotal ? "✓" : "(debe coincidir)"}
      </div>

      {slot.options.map((option, optIdx) => (
        <OptionEditor
          key={optIdx}
          option={option}
          eligible={eligible}
          usedComponentIds={new Set(
            slot.options
              .filter((_, i) => i !== optIdx)
              .map((o) => o.component_id)
              .filter((id): id is number => id != null),
          )}
          onChange={(patch) => onUpdateOption(optIdx, patch)}
          onRemove={() => onRemoveOption(optIdx)}
          canRemove={slot.options.length > 1}
        />
      ))}

      <button
        type="button"
        onClick={onAddOption}
        style={{
          alignSelf: "flex-start",
          padding: "4px 10px",
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 1.5,
          color: C.cacao,
          background: "transparent",
          border: `1px dashed ${C.sand}`,
          borderRadius: 999,
          cursor: "pointer",
          fontWeight: 700,
          textTransform: "uppercase",
        }}
      >
        + Opción
      </button>

      {error && (
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 10,
            color: C.terracotta,
            letterSpacing: 0.5,
          }}
        >
          {error}
        </span>
      )}
    </div>
  );
}

function OptionEditor({
  option,
  eligible,
  usedComponentIds,
  onChange,
  onRemove,
  canRemove,
}: {
  option: OptionState;
  eligible: Product[];
  usedComponentIds: Set<number>;
  onChange: (patch: Partial<OptionState>) => void;
  onRemove: () => void;
  canRemove: boolean;
}) {
  const onSelect = (e: ChangeEvent<HTMLSelectElement>) => {
    const val = Number(e.target.value);
    onChange({ component_id: Number.isFinite(val) && val > 0 ? val : null });
  };

  return (
    <div
      style={{
        display: "flex",
        gap: 6,
        alignItems: "center",
      }}
    >
      <select
        value={option.component_id ?? ""}
        onChange={onSelect}
        style={{
          ...inputBase,
          flex: 1,
          appearance: "none",
          backgroundImage:
            "linear-gradient(45deg, transparent 50%, currentColor 50%), linear-gradient(135deg, currentColor 50%, transparent 50%)",
          backgroundPosition:
            "calc(100% - 14px) center, calc(100% - 8px) center",
          backgroundSize: "6px 6px",
          backgroundRepeat: "no-repeat",
          paddingRight: 24,
        }}
      >
        <option value="">— Elegí componente —</option>
        {eligible.map((p) => {
          const isUsed = usedComponentIds.has(p.id);
          return (
            <option key={p.id} value={p.id} disabled={isUsed}>
              {p.name}
              {isUsed ? " (ya elegido en este slot)" : ""}
            </option>
          );
        })}
      </select>
      <input
        type="number"
        min={0}
        step={1}
        value={option.default_quantity}
        onChange={(e) =>
          onChange({
            default_quantity: Math.max(0, Math.floor(Number(e.target.value) || 0)),
          })
        }
        style={{ ...inputBase, width: 60, textAlign: "right" }}
        aria-label="Cantidad por defecto"
      />
      <button
        type="button"
        onClick={onRemove}
        disabled={!canRemove}
        aria-label="Eliminar opción"
        title={canRemove ? "Eliminar opción" : "Al menos una opción requerida"}
        style={{
          width: 26,
          height: 26,
          border: `1px solid ${C.sand}`,
          background: C.paper,
          color: canRemove ? C.mute : C.sand,
          borderRadius: 999,
          cursor: canRemove ? "pointer" : "not-allowed",
          fontSize: 12,
          lineHeight: 1,
        }}
      >
        ✕
      </button>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function serverToState(slots: ProductRecipeSlotView[]): SlotState[] {
  return slots.map((s) => ({
    id: s.id,
    label: s.label,
    quantity: s.quantity,
    options: s.options.map((o) => ({
      id: o.id,
      component_id: o.component_id,
      default_quantity: o.default_quantity,
    })),
  }));
}

function validateSlots(slots: SlotState[]): (string | null)[] {
  return slots.map((slot) => {
    if (!slot.label.trim()) return "Etiqueta requerida";
    if (slot.quantity <= 0) return "Cantidad debe ser > 0";
    if (slot.options.length === 0) return "Al menos una opción";
    const seen = new Set<number>();
    for (const opt of slot.options) {
      if (opt.component_id == null) return "Falta elegir componente en una opción";
      if (seen.has(opt.component_id)) return "Componente repetido";
      seen.add(opt.component_id);
      if (opt.default_quantity < 0) return "Cantidad no puede ser negativa";
    }
    const sum = slot.options.reduce((acc, o) => acc + o.default_quantity, 0);
    if (sum !== slot.quantity)
      return `Suma de defaults (${sum}) debe igualar cantidad (${slot.quantity})`;
    return null;
  });
}
