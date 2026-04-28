"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useState } from "react";
import { useAdminAuth } from "@/lib/auth/auth-context";

const C = {
  cream: "#FDF8EC",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
  gold: "#B8894A",
  burgundy: "#8B2635",
  burgundySoft: "#E8CDD2",
  ink: "#2B1D14",
  mute: "#A89883",
  cacao: "#6B4E2E",
  shadow:
    "0 1px 0 rgba(43,29,20,0.04), 0 12px 32px -18px rgba(107,78,46,0.28)",
};
const FONT_DISPLAY = "var(--font-bebas)";
const FONT_MONO = "var(--font-oswald)";
const FONT_UI = "var(--font-manrope)";

export default function AdminLoginPage() {
  const router = useRouter();
  const { status, login } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // If we land on /admin/login while already authenticated (refresh of a
  // stale tab, for example), punt back to the dashboard instead of making
  // the user log in again.
  useEffect(() => {
    if (status === "authenticated") router.replace("/admin");
  }, [status, router]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await login(email.trim(), password);
      router.replace("/admin");
    } catch (err: unknown) {
      const code =
        (err as { response?: { data?: { code?: string; message?: string } } })
          ?.response?.data?.code;
      const message =
        (err as { response?: { data?: { message?: string } } })?.response?.data
          ?.message ?? "No se pudo iniciar sesión";
      setError(
        code === "LOGIN_RATE_LIMITED"
          ? "Demasiados intentos. Espera un momento."
          : message,
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.cream,
        padding: 24,
        fontFamily: FONT_UI,
      }}
    >
      <form
        onSubmit={onSubmit}
        style={{
          width: "100%",
          maxWidth: 380,
          background: C.paper,
          border: `1px solid ${C.sand}`,
          borderRadius: 18,
          padding: "28px 24px",
          boxShadow: C.shadow,
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        <div style={{ textAlign: "center", marginBottom: 6 }}>
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
            — Panel staff
          </span>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 32,
              color: C.ink,
              margin: "4px 0 0",
              letterSpacing: 1,
              lineHeight: 1,
            }}
          >
            Iniciar sesión
          </h1>
        </div>

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
            Email
          </span>
          <input
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="admin@cafe.local"
            style={inputStyle}
          />
        </label>

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
            Contraseña
          </span>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={inputStyle}
          />
        </label>

        {error && (
          <p
            role="alert"
            style={{
              margin: 0,
              padding: 10,
              borderRadius: 8,
              background: C.burgundySoft,
              color: C.burgundy,
              fontFamily: FONT_MONO,
              fontSize: 11,
              letterSpacing: 1.5,
              textTransform: "uppercase",
            }}
          >
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={submitting}
          style={{
            width: "100%",
            padding: "14px 20px",
            border: "none",
            borderRadius: 999,
            background: submitting
              ? C.sand
              : `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`,
            color: submitting ? C.mute : C.paper,
            fontFamily: FONT_DISPLAY,
            fontSize: 15,
            letterSpacing: 3,
            textTransform: "uppercase",
            cursor: submitting ? "not-allowed" : "pointer",
            boxShadow: submitting ? "none" : C.shadow,
          }}
        >
          {submitting ? "Entrando..." : "Entrar"}
        </button>

        <p
          style={{
            margin: "4px 0 0",
            textAlign: "center",
            fontFamily: FONT_MONO,
            fontSize: 10,
            letterSpacing: 1.5,
            color: C.mute,
            textTransform: "uppercase",
          }}
        >
          Solo personal autorizado.
        </p>
      </form>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: `1px solid ${C.sand}`,
  borderRadius: 10,
  background: C.cream,
  color: C.ink,
  fontFamily: FONT_UI,
  fontSize: 14,
  outline: "none",
};
