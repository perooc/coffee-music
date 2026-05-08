"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import type { SyntheticEvent } from "react";
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
const FONT_MONO = "var(--font-manrope)";
const FONT_UI = "var(--font-manrope)";

export default function AdminLoginPage() {
  const router = useRouter();
  const { status, login } = useAdminAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [capsLockOn, setCapsLockOn] = useState(false);

  useEffect(() => {
    if (status === "authenticated") router.replace("/admin");
  }, [status, router]);

  async function onSubmit(e: SyntheticEvent<HTMLFormElement>) {
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
      // Always surface the same message regardless of which side failed
      // (wrong email vs wrong password vs locked account). That stops a
      // probe from telling them which axis of attack is "working".
      if (code === "LOGIN_RATE_LIMITED") {
        setError("Demasiados intentos. Espera un momento e intenta de nuevo.");
      } else {
        setError("Email o contraseña incorrectos.");
      }
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
        noValidate
        aria-label="Iniciar sesión administrativa"
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

        <label
          htmlFor="login-email"
          style={{ display: "flex", flexDirection: "column", gap: 5 }}
        >
          <span style={labelStyle}>Email</span>
          <input
            id="login-email"
            type="email"
            required
            autoComplete="username"
            // No spellcheck/autocorrect — both eat the @ on iOS sometimes.
            spellCheck={false}
            autoCapitalize="none"
            inputMode="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="correo admin"
            aria-label="Correo del administrador"
            style={inputStyle}
          />
        </label>

        <label
          htmlFor="login-password"
          style={{ display: "flex", flexDirection: "column", gap: 5 }}
        >
          <span style={labelStyle}>Contraseña</span>
          <div style={{ position: "relative" }}>
            <input
              id="login-password"
              // The visibility toggle flips the type without losing focus.
              type={showPassword ? "text" : "password"}
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyUp={(e) => {
                // Best-effort caps-lock indicator. KeyboardEvent.getModifierState
                // is available on every modern browser; we silently skip if not.
                const fn = (
                  e as unknown as { getModifierState?: (k: string) => boolean }
                ).getModifierState;
                if (typeof fn === "function") {
                  setCapsLockOn(fn.call(e, "CapsLock"));
                }
              }}
              placeholder="Ingresa la contraseña"
              aria-label="Contraseña"
              style={{ ...inputStyle, paddingRight: 44 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={
                showPassword ? "Ocultar contraseña" : "Mostrar contraseña"
              }
              aria-pressed={showPassword}
              tabIndex={0}
              style={{
                position: "absolute",
                right: 6,
                top: "50%",
                transform: "translateY(-50%)",
                width: 32,
                height: 32,
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: C.cacao,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <EyeIcon hidden={showPassword} />
            </button>
          </div>
          {capsLockOn && (
            <span
              role="status"
              style={{
                fontFamily: FONT_MONO,
                fontSize: 10,
                color: C.gold,
                letterSpacing: 1.5,
                textTransform: "uppercase",
                fontWeight: 700,
              }}
            >
              ⚠ Mayúsculas activadas
            </span>
          )}
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

        <Link
          href="/admin/forgot-password"
          style={{
            margin: "4px 0 0",
            textAlign: "center",
            fontFamily: FONT_MONO,
            fontSize: 11,
            letterSpacing: 1.5,
            color: C.cacao,
            textDecoration: "underline",
            textUnderlineOffset: 3,
          }}
        >
          ¿Olvidaste tu contraseña?
        </Link>

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

const labelStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: 2,
  color: C.mute,
  textTransform: "uppercase",
  fontWeight: 600,
};

const inputStyle: React.CSSProperties = {
  padding: "10px 12px",
  border: `1px solid ${C.sand}`,
  borderRadius: 10,
  background: C.cream,
  color: C.ink,
  fontFamily: FONT_UI,
  fontSize: 14,
  outline: "none",
  width: "100%",
};

function EyeIcon({ hidden }: { hidden: boolean }) {
  // Heroicons outline. We swap to "eye-slash" when the password is
  // visible, since the affordance is "click to hide" at that point.
  return hidden ? (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3.98 8.22A10.5 10.5 0 0 0 1.93 12c1.4 3.45 4.86 6 9.07 6 1.27 0 2.49-.23 3.6-.66M6.6 6.6A10.45 10.45 0 0 1 12 6c4.21 0 7.67 2.55 9.07 6a10.52 10.52 0 0 1-3.07 4.18M9.88 9.88A3 3 0 0 0 12 15a3 3 0 0 0 2.12-.88" />
      <path d="M3 3l18 18" />
    </svg>
  ) : (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M1.93 12C3.33 8.55 6.79 6 12 6s8.67 2.55 10.07 6c-1.4 3.45-4.86 6-10.07 6S3.33 15.45 1.93 12z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}
