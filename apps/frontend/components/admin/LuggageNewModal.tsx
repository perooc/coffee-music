"use client";

/**
 * Modal de "Nueva maleta". Diseño minimal: el staff lo abre, captura
 * 4 datos, asigna ficha y entrega. El precio NO se muestra como input
 * — se renderiza como pill informativa porque viene fijo del backend
 * ($5.000). Mostrarlo editable invita confusión.
 *
 * Lista las fichas que YA están en uso (status=active) para que el
 * staff sepa cuáles números evitar. Esa lista se carga al abrir.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  luggageApi,
  type LuggageTicketApi,
} from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";
import { C, FONT_DISPLAY, FONT_MONO, FONT_UI, fmt } from "@/lib/theme";

const TICKET_MIN = 1;
const TICKET_MAX = 30;
const LUGGAGE_PRICE = 5000;

export function LuggageNewModal({
  onCancel,
  onCreated,
}: {
  onCancel: () => void;
  onCreated: (ticket: LuggageTicketApi) => void;
}) {
  const [active, setActive] = useState<LuggageTicketApi[]>([]);
  const [ticketNumber, setTicketNumber] = useState<number | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("");
  const [paid, setPaid] = useState(true);
  const [notes, setNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadActive = useCallback(async () => {
    try {
      const rows = await luggageApi.list({ status: "active" });
      setActive(rows);
    } catch (e) {
      console.error("[LuggageNewModal] list error", e);
    }
  }, []);

  useEffect(() => {
    void loadActive();
  }, [loadActive]);

  const usedTickets = useMemo(
    () => new Set(active.map((a) => a.ticket_number)),
    [active],
  );

  const availableTickets = useMemo(() => {
    const all: number[] = [];
    for (let n = TICKET_MIN; n <= TICKET_MAX; n++) {
      if (!usedTickets.has(n)) all.push(n);
    }
    return all;
  }, [usedTickets]);

  const canSubmit =
    ticketNumber !== null &&
    firstName.trim().length > 0 &&
    lastName.trim().length > 0 &&
    /^\+?\d{7,15}$/.test(phone.replace(/\s+/g, "")) &&
    !submitting;

  const submit = async () => {
    if (!canSubmit || ticketNumber === null) return;
    setSubmitting(true);
    setError(null);
    try {
      const created = await luggageApi.create({
        ticket_number: ticketNumber,
        customer_first_name: firstName.trim(),
        customer_last_name: lastName.trim(),
        customer_phone: phone.replace(/\s+/g, ""),
        payment_status: paid ? "paid" : "pending",
        notes: notes.trim() || undefined,
      });
      onCreated(created);
    } catch (e) {
      setError(getErrorMessage(e));
      setSubmitting(false);
      void loadActive(); // refresca por si la ficha se ocupó mientras tanto
    }
  };

  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Nueva maleta"
      onClick={onCancel}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(43,29,20,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 90,
        padding: 16,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "100%",
          maxWidth: 460,
          maxHeight: "92dvh",
          background: C.paper,
          borderRadius: 16,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          boxShadow: "0 30px 80px -20px rgba(43,29,20,0.55)",
        }}
      >
        <header
          style={{
            padding: "18px 22px 14px",
            borderBottom: `1px solid ${C.sand}`,
          }}
        >
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 10,
              letterSpacing: 3,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: 600,
            }}
          >
            — Guardarropa
          </span>
          <h2
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 24,
              letterSpacing: 1,
              color: C.ink,
              margin: "4px 0 0",
              lineHeight: 1.1,
              textTransform: "uppercase",
            }}
          >
            Nueva maleta
          </h2>
        </header>

        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "16px 22px",
            display: "flex",
            flexDirection: "column",
            gap: 14,
          }}
        >
          {/* Ficha física */}
          <section>
            <Label>Ficha física</Label>
            {availableTickets.length === 0 ? (
              <div
                style={{
                  padding: 10,
                  background: C.terracottaSoft,
                  color: C.terracotta,
                  borderRadius: 8,
                  fontFamily: FONT_MONO,
                  fontSize: 11,
                  letterSpacing: 0.5,
                }}
              >
                Todas las fichas (1–{TICKET_MAX}) están en uso. Entregá una
                maleta o reportá incidente para liberar una.
              </div>
            ) : (
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(48px, 1fr))",
                  gap: 6,
                }}
              >
                {Array.from(
                  { length: TICKET_MAX - TICKET_MIN + 1 },
                  (_, i) => TICKET_MIN + i,
                ).map((n) => {
                  const used = usedTickets.has(n);
                  const selected = ticketNumber === n;
                  return (
                    <button
                      key={n}
                      type="button"
                      disabled={used}
                      onClick={() => setTicketNumber(n)}
                      title={used ? "Ficha en uso" : undefined}
                      style={{
                        padding: "8px 0",
                        border: `1px solid ${
                          selected ? C.gold : used ? C.sand : C.cacao
                        }`,
                        background: selected
                          ? C.gold
                          : used
                            ? C.cream
                            : C.paper,
                        color: selected
                          ? C.paper
                          : used
                            ? C.mute
                            : C.ink,
                        borderRadius: 8,
                        fontFamily: FONT_DISPLAY,
                        fontSize: 14,
                        letterSpacing: 0.5,
                        cursor: used ? "not-allowed" : "pointer",
                        opacity: used ? 0.5 : 1,
                      }}
                    >
                      {n}
                    </button>
                  );
                })}
              </div>
            )}
          </section>

          {/* Datos del cliente */}
          <section style={{ display: "flex", gap: 8 }}>
            <div style={{ flex: 1 }}>
              <Label>Nombre</Label>
              <input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Camilo"
                style={inputStyle()}
                autoFocus
              />
            </div>
            <div style={{ flex: 1 }}>
              <Label>Apellido</Label>
              <input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Peñuela"
                style={inputStyle()}
              />
            </div>
          </section>

          <section>
            <Label>Teléfono</Label>
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="3001234567"
              inputMode="tel"
              autoComplete="tel"
              style={inputStyle()}
            />
          </section>

          {/* Precio + pago */}
          <section
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              background: C.cream,
              border: `1px solid ${C.sand}`,
              borderRadius: 10,
              padding: "10px 12px",
            }}
          >
            <div>
              <div
                style={{
                  fontFamily: FONT_MONO,
                  fontSize: 9,
                  letterSpacing: 2,
                  color: C.mute,
                  textTransform: "uppercase",
                  fontWeight: 700,
                }}
              >
                Precio fijo
              </div>
              <div
                style={{
                  fontFamily: FONT_DISPLAY,
                  fontSize: 20,
                  color: C.gold,
                  letterSpacing: 0.5,
                  marginTop: 2,
                }}
              >
                {fmt(LUGGAGE_PRICE)}
              </div>
            </div>
            <PaymentToggle paid={paid} onChange={setPaid} />
          </section>

          <section>
            <Label>Notas (opcional)</Label>
            <input
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Ej. dos morrales, una chaqueta"
              style={inputStyle()}
            />
          </section>

          {error && (
            <div
              role="alert"
              style={{
                padding: 10,
                borderRadius: 8,
                background: C.terracottaSoft,
                color: C.terracotta,
                fontFamily: FONT_MONO,
                fontSize: 11,
                letterSpacing: 0.5,
              }}
            >
              {error}
            </div>
          )}
        </div>

        <footer
          style={{
            padding: "12px 22px 18px",
            borderTop: `1px solid ${C.sand}`,
            background: C.cream,
            display: "flex",
            gap: 10,
            justifyContent: "flex-end",
          }}
        >
          <button
            type="button"
            onClick={onCancel}
            disabled={submitting}
            style={{
              padding: "10px 18px",
              border: `1px solid ${C.sand}`,
              background: "transparent",
              color: C.cacao,
              borderRadius: 999,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 2,
              cursor: submitting ? "wait" : "pointer",
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            Cancelar
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={!canSubmit}
            style={{
              padding: "10px 22px",
              border: "none",
              borderRadius: 999,
              background: canSubmit
                ? `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`
                : C.sand,
              color: canSubmit ? C.paper : C.mute,
              fontFamily: FONT_DISPLAY,
              fontSize: 14,
              letterSpacing: 2.5,
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontWeight: 600,
              textTransform: "uppercase",
            }}
          >
            {submitting ? "Guardando..." : "Registrar"}
          </button>
        </footer>
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: FONT_MONO,
        fontSize: 9,
        letterSpacing: 2,
        color: C.cacao,
        textTransform: "uppercase",
        fontWeight: 700,
        marginBottom: 5,
      }}
    >
      {children}
    </div>
  );
}

function inputStyle(): React.CSSProperties {
  return {
    width: "100%",
    padding: "10px 12px",
    border: `1px solid ${C.sand}`,
    borderRadius: 10,
    background: C.paper,
    color: C.ink,
    fontFamily: FONT_UI,
    fontSize: 14,
    outline: "none",
  };
}

/**
 * Toggle de pago en estilo del bar (no el checkbox nativo azul de Chrome).
 * Cuando está `paid`, el track va en olive (verde "ok") con label "Pagado";
 * cuando no, va en sand con label "Pendiente" en terracotta para llamar
 * la atención del staff (es el caso que requiere acción posterior).
 *
 * Botón nativo con role implícito de switch — accesible por teclado y
 * lectores de pantalla.
 */
function PaymentToggle({
  paid,
  onChange,
}: {
  paid: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={paid}
      onClick={() => onChange(!paid)}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 10,
        padding: "6px 6px 6px 14px",
        border: `1px solid ${paid ? C.olive : C.terracotta}`,
        background: paid ? `${C.olive}11` : `${C.terracotta}11`,
        borderRadius: 999,
        cursor: "pointer",
        fontFamily: FONT_UI,
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0.3,
        color: paid ? C.olive : C.terracotta,
      }}
    >
      <span style={{ textTransform: "uppercase", letterSpacing: 1.5 }}>
        {paid ? "Pagado" : "Pendiente"}
      </span>
      <span
        aria-hidden
        style={{
          position: "relative",
          width: 38,
          height: 22,
          background: paid ? C.olive : C.sand,
          borderRadius: 999,
          transition: "background 180ms ease",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            position: "absolute",
            top: 2,
            left: paid ? 18 : 2,
            width: 18,
            height: 18,
            background: "#FFFDF8",
            borderRadius: "50%",
            boxShadow: "0 2px 4px rgba(43,29,20,0.25)",
            transition: "left 180ms ease",
          }}
        />
      </span>
    </button>
  );
}
