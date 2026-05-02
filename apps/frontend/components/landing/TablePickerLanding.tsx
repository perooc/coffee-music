"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  publicTablesApi,
  type PublicTableSummary,
} from "@/lib/api/services";
import { setTableToken } from "@/lib/auth/token-storage";
import { getErrorMessage } from "@/lib/errors";

const C = {
  cream: "#FDF8EC",
  parchment: "#F8F1E4",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
  sandDark: "#E6D8BF",
  gold: "#B8894A",
  goldSoft: "#E8D4A8",
  terracotta: "#8B2635",
  olive: "#6B7E4A",
  cacao: "#6B4E2E",
  ink: "#2B1D14",
  mute: "#A89883",
};

const FONT_HEADING =
  "var(--font-blackletter), 'UnifrakturCook', 'Old English Text MT', serif";
const FONT_DISPLAY = "var(--font-bebas), 'Bebas Neue', Impact, sans-serif";
const FONT_UI = "var(--font-manrope), system-ui, sans-serif";
const FONT_MONO = "var(--font-manrope), system-ui, sans-serif";

const pad = (n: number) => String(n).padStart(2, "0");

type Step = "code" | "picker";

/**
 * Two-step landing:
 *   1. Code step — user enters BAR_ACCESS_CODE. We validate it on the
 *      server only when they pick a table (no separate "verify code"
 *      endpoint is needed; the token-issue endpoint already enforces it).
 *      We move to step 2 optimistically once the input is non-empty so
 *      the customer sees the table grid immediately.
 *   2. Picker step — fetch /public/tables/available, render a grid, on
 *      tap call /public/tables/:id/access with the code, store the token
 *      in sessionStorage, navigate to /mesa/:id?t=<token>.
 */
export function TablePickerLanding() {
  const [step, setStep] = useState<Step>("code");
  const [code, setCode] = useState("");
  const [codeError, setCodeError] = useState<string | null>(null);
  const router = useRouter();

  const handleCodeSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = code.trim();
    if (!trimmed) {
      setCodeError("Escribe el código de la entrada del bar");
      return;
    }
    setCodeError(null);
    setStep("picker");
  };

  return (
    <main
      style={{
        minHeight: "100dvh",
        background: `radial-gradient(ellipse at 50% 0%, ${C.parchment} 0%, ${C.cream} 60%)`,
        color: C.ink,
        fontFamily: FONT_UI,
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Header />

      <div
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "8px 18px 16px",
        }}
      >
        {step === "code" ? (
          <CodeCard
            code={code}
            onChange={(v) => {
              setCode(v);
              if (codeError) setCodeError(null);
            }}
            onSubmit={handleCodeSubmit}
            error={codeError}
          />
        ) : (
          <PickerCard
            code={code}
            onBack={() => setStep("code")}
            onPicked={(table, token) => {
              setTableToken(token);
              router.push(`/mesa/${table.id}?t=${encodeURIComponent(token)}`);
            }}
            onCodeRejected={(message) => {
              setCodeError(message);
              setStep("code");
            }}
          />
        )}
      </div>

      <footer
        style={{
          padding: "8px 18px calc(10px + env(safe-area-inset-bottom))",
          textAlign: "center",
          fontFamily: FONT_MONO,
          fontSize: 9,
          letterSpacing: 1.4,
          color: C.mute,
        }}
      >
        Crown Bar 4.90 · Jukebox social
      </footer>
    </main>
  );
}

// ─── Header ──────────────────────────────────────────────────────────────────

function Header() {
  return (
    <header
      style={{
        padding: "16px 18px 4px",
        textAlign: "center",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src="/logo.png"
        alt="Crown Bar 4.90"
        style={{
          width: "min(54vw, 200px)",
          height: "auto",
          display: "block",
          filter:
            "drop-shadow(0 6px 16px rgba(107,78,46,0.18)) drop-shadow(0 1px 2px rgba(43,29,20,0.12))",
        }}
      />
      <p
        style={{
          fontFamily: FONT_MONO,
          fontSize: 10,
          letterSpacing: 2,
          color: C.cacao,
          margin: "10px 0 0",
          textTransform: "uppercase",
          fontWeight: 600,
        }}
      >
        Pub · Cafetería · Jukebox
      </p>
    </header>
  );
}

// ─── Step 1: Code ────────────────────────────────────────────────────────────

function CodeCard({
  code,
  onChange,
  onSubmit,
  error,
}: {
  code: string;
  onChange: (v: string) => void;
  onSubmit: (e: React.FormEvent) => void;
  error: string | null;
}) {
  return (
    <form
      onSubmit={onSubmit}
      style={{
        width: "100%",
        maxWidth: 380,
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 16,
        padding: "18px 18px 16px",
        display: "flex",
        flexDirection: "column",
        gap: 10,
        boxShadow:
          "0 1px 0 rgba(43,29,20,0.04), 0 22px 50px -32px rgba(107,78,46,0.4)",
      }}
    >
      <div>
        <span
          style={{
            fontFamily: FONT_MONO,
            fontSize: 9,
            letterSpacing: 2.5,
            color: C.mute,
            textTransform: "uppercase",
            fontWeight: 700,
          }}
        >
          — Paso 1 de 2
        </span>
        <h2
          style={{
            fontFamily: FONT_DISPLAY,
            fontSize: 22,
            color: C.ink,
            letterSpacing: 2,
            margin: "2px 0 0",
            textTransform: "uppercase",
            lineHeight: 1.05,
          }}
        >
          Código del bar
        </h2>
        <p
          style={{
            margin: "6px 0 0",
            fontSize: 12,
            color: C.cacao,
            fontFamily: FONT_UI,
            lineHeight: 1.4,
          }}
        >
          Está en la pizarra de la entrada. Pídelo al staff si no lo ves.
        </p>
      </div>

      <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        <input
          type="text"
          inputMode="text"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          value={code}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Escribe el código…"
          style={{
            padding: "12px 14px",
            border: `1px solid ${error ? C.terracotta : C.sand}`,
            borderRadius: 10,
            background: C.cream,
            color: C.ink,
            fontFamily: FONT_UI,
            fontSize: 16,
            outline: "none",
          }}
        />
        {error && (
          <span
            role="alert"
            style={{
              fontSize: 11,
              color: C.terracotta,
              fontFamily: FONT_UI,
              letterSpacing: 0.3,
            }}
          >
            {error}
          </span>
        )}
      </label>

      <button
        type="submit"
        style={{
          padding: "12px 16px",
          border: "none",
          borderRadius: 999,
          background: `linear-gradient(135deg, ${C.olive} 0%, #7E8F58 100%)`,
          color: C.paper,
          fontFamily: FONT_DISPLAY,
          fontSize: 14,
          letterSpacing: 2.5,
          fontWeight: 600,
          cursor: "pointer",
          textTransform: "uppercase",
          boxShadow: `0 6px 18px -8px ${C.olive}`,
        }}
      >
        Continuar
      </button>
    </form>
  );
}

// ─── Step 2: Picker ──────────────────────────────────────────────────────────

function PickerCard({
  code,
  onBack,
  onPicked,
  onCodeRejected,
}: {
  code: string;
  onBack: () => void;
  onPicked: (
    table: { id: number; number: number },
    token: string,
  ) => void;
  onCodeRejected: (message: string) => void;
}) {
  const [tables, setTables] = useState<PublicTableSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selecting, setSelecting] = useState<number | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoadError(null);
    try {
      const data = await publicTablesApi.listAvailable();
      setTables(data);
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })
        ?.response?.data?.code;
      if (code === "PUBLIC_TABLES_DISABLED") {
        setLoadError(
          "El acceso público a mesas está deshabilitado. Acércate a la barra para que el staff te asigne una.",
        );
      } else {
        setLoadError(getErrorMessage(err));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    // Auto-refresh while the picker is open. 15s is a comfortable middle
    // ground: fresh enough that a customer rarely sees a stale "free"
    // table, slow enough that the per-IP rate-limit window has plenty of
    // headroom for retries.
    const interval = setInterval(refresh, 15_000);
    return () => clearInterval(interval);
  }, [refresh]);

  async function pickTable(table: PublicTableSummary) {
    setSelecting(table.id);
    setActionError(null);
    try {
      const res = await publicTablesApi.requestAccess(table.id, code);
      onPicked({ id: table.id, number: table.number }, res.table_token);
    } catch (err) {
      const errorCode = (err as { response?: { data?: { code?: string } } })
        ?.response?.data?.code;
      const message =
        (err as { response?: { data?: { message?: string } } })?.response
          ?.data?.message ?? getErrorMessage(err);

      if (errorCode === "BAR_CODE_INVALID" || errorCode === "BAR_CODE_REQUIRED") {
        onCodeRejected("El código del bar es incorrecto. Intenta otra vez.");
        return;
      }
      if (errorCode === "TABLE_NOT_AVAILABLE") {
        // Someone took the table between the list refresh and our click.
        setActionError("Esa mesa ya fue tomada. Elige otra.");
        refresh();
      } else {
        setActionError(message);
      }
    } finally {
      setSelecting(null);
    }
  }

  return (
    <div
      style={{
        width: "100%",
        maxWidth: 520,
        background: C.paper,
        border: `1px solid ${C.sand}`,
        borderRadius: 16,
        padding: "16px 18px 18px",
        display: "flex",
        flexDirection: "column",
        gap: 12,
        boxShadow:
          "0 1px 0 rgba(43,29,20,0.04), 0 22px 50px -32px rgba(107,78,46,0.4)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div>
          <span
            style={{
              fontFamily: FONT_MONO,
              fontSize: 9,
              letterSpacing: 2.5,
              color: C.mute,
              textTransform: "uppercase",
              fontWeight: 700,
            }}
          >
            — Paso 2 de 2
          </span>
          <h2
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 22,
              color: C.ink,
              letterSpacing: 2,
              margin: "2px 0 0",
              textTransform: "uppercase",
              lineHeight: 1.05,
            }}
          >
            Elige tu mesa
          </h2>
        </div>
        <button
          type="button"
          onClick={onBack}
          aria-label="Volver"
          style={{
            background: "transparent",
            border: `1px solid ${C.sand}`,
            color: C.cacao,
            width: 32,
            height: 32,
            fontSize: 16,
            cursor: "pointer",
            borderRadius: 999,
            fontFamily: FONT_UI,
            flexShrink: 0,
          }}
        >
          ←
        </button>
      </div>

      {actionError && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: "8px 10px",
            background: `${C.terracotta}10`,
            border: `1px solid ${C.terracotta}33`,
            borderRadius: 8,
            color: C.terracotta,
            fontFamily: FONT_UI,
            fontSize: 12,
          }}
        >
          {actionError}
        </p>
      )}

      {loading && (
        <p
          style={{
            margin: 0,
            padding: "20px 14px",
            textAlign: "center",
            fontFamily: FONT_MONO,
            fontSize: 11,
            color: C.mute,
            letterSpacing: 1.4,
            textTransform: "uppercase",
          }}
        >
          Buscando mesas…
        </p>
      )}

      {!loading && loadError && (
        <p
          role="alert"
          style={{
            margin: 0,
            padding: "16px",
            background: `${C.terracotta}0e`,
            border: `1px solid ${C.terracotta}33`,
            borderRadius: 12,
            color: C.terracotta,
            fontFamily: FONT_UI,
            fontSize: 13,
            lineHeight: 1.5,
            textAlign: "center",
          }}
        >
          {loadError}
        </p>
      )}

      {!loading && !loadError && tables.length === 0 && <NoTables />}

      {!loading && !loadError && tables.length > 0 && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(92px, 1fr))",
            gap: 8,
            // Cap height so the grid never pushes the layout past one
            // viewport. Internal scroll handles 20+ tables on phones.
            maxHeight: "min(46dvh, 360px)",
            overflowY: "auto",
            paddingRight: 2,
          }}
        >
          {tables.map((t) => {
            const busy = selecting === t.id;
            const otherBusy = selecting !== null && !busy;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => pickTable(t)}
                disabled={otherBusy}
                aria-label={`Elegir mesa ${pad(t.number)}`}
                style={{
                  position: "relative",
                  padding: "10px 8px 10px",
                  border: `1px solid ${busy ? C.gold : C.sand}`,
                  borderRadius: 12,
                  background: busy
                    ? `linear-gradient(160deg, ${C.goldSoft} 0%, ${C.paper} 100%)`
                    : `linear-gradient(160deg, ${C.paper} 0%, ${C.parchment} 100%)`,
                  color: C.ink,
                  fontFamily: FONT_UI,
                  cursor: otherBusy ? "not-allowed" : "pointer",
                  opacity: otherBusy ? 0.45 : 1,
                  textAlign: "center",
                  transition:
                    "transform 0.18s cubic-bezier(0.16, 1, 0.3, 1), border-color 0.2s ease",
                  boxShadow:
                    "0 1px 0 rgba(43,29,20,0.04), 0 6px 16px -14px rgba(107,78,46,0.28)",
                  WebkitTapHighlightColor: "transparent",
                }}
              >
                <span
                  style={{
                    display: "block",
                    fontFamily: FONT_MONO,
                    fontSize: 8,
                    letterSpacing: 2,
                    color: C.mute,
                    textTransform: "uppercase",
                    fontWeight: 700,
                  }}
                >
                  Mesa
                </span>
                <span
                  style={{
                    display: "block",
                    fontFamily: FONT_HEADING,
                    fontSize: 30,
                    color: C.ink,
                    lineHeight: 1,
                    marginTop: 2,
                  }}
                >
                  {pad(t.number)}
                </span>
                {busy && (
                  <span
                    style={{
                      display: "block",
                      marginTop: 4,
                      fontFamily: FONT_MONO,
                      fontSize: 8,
                      letterSpacing: 1.6,
                      color: C.gold,
                      textTransform: "uppercase",
                      fontWeight: 700,
                    }}
                  >
                    Abriendo…
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

function NoTables() {
  return (
    <div
      style={{
        padding: "16px 14px",
        textAlign: "center",
        background: C.cream,
        border: `1px dashed ${C.sand}`,
        borderRadius: 12,
      }}
    >
      <div
        style={{
          fontFamily: FONT_HEADING,
          fontSize: 24,
          color: C.terracotta,
          lineHeight: 1,
          marginBottom: 6,
        }}
      >
        Bar lleno
      </div>
      <p
        style={{
          margin: 0,
          fontFamily: FONT_UI,
          fontSize: 12,
          color: C.cacao,
          lineHeight: 1.4,
        }}
      >
        Todas las mesas están ocupadas. Acércate a la barra y el staff te
        asignará una.
      </p>
    </div>
  );
}
