"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type SyntheticEvent } from "react";
import { authApi } from "@/lib/api/services";
import { getErrorMessage } from "@/lib/errors";

const C = {
  cream: "#FDF8EC",
  paper: "#FFFDF8",
  sand: "#F1E6D2",
  gold: "#B8894A",
  olive: "#6B7E4A",
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

export default function ResetPasswordPage() {
  // useSearchParams suspends in Next 16, so we wrap the inner form in a
  // Suspense boundary. The fallback is unstyled because it flashes for
  // milliseconds on cold load and we don't want to compete with the form
  // appearing.
  return (
    <Suspense fallback={null}>
      <ResetPasswordForm />
    </Suspense>
  );
}

function ResetPasswordForm() {
  const router = useRouter();
  const params = useSearchParams();
  const email = (params.get("email") ?? "").trim();
  const token = (params.get("token") ?? "").trim();
  const [pwd, setPwd] = useState("");
  const [confirm, setConfirm] = useState("");
  const [showPwd, setShowPwd] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const submit = async (e: SyntheticEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (submitting) return;
    if (!pwd || pwd !== confirm) {
      setError("Las contraseñas no coinciden");
      return;
    }
    if (!email || !token) {
      setError("Enlace inválido. Pide uno nuevo.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await authApi.resetPassword(email, token, pwd);
      setDone(true);
      // Wait a beat so the user reads the confirmation, then push to
      // login. We don't auto-login because the new password is the
      // whole point — making the user type it once after the reset
      // confirms the muscle memory.
      setTimeout(() => router.replace("/admin/login"), 2200);
    } catch (err) {
      const code = (err as { response?: { data?: { code?: string } } })
        ?.response?.data?.code;
      if (code === "AUTH_RESET_INVALID") {
        setError("El enlace expiró o ya se usó. Pide uno nuevo.");
      } else {
        setError(getErrorMessage(err));
      }
    } finally {
      setSubmitting(false);
    }
  };

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
        onSubmit={submit}
        noValidate
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
          <span style={eyebrowStyle}>— Cuenta admin</span>
          <h1
            style={{
              fontFamily: FONT_DISPLAY,
              fontSize: 28,
              color: C.ink,
              margin: "4px 0 0",
              letterSpacing: 1,
              lineHeight: 1.05,
            }}
          >
            Nueva contraseña
          </h1>
          {email && (
            <p
              style={{
                margin: "8px 0 0",
                fontFamily: FONT_MONO,
                fontSize: 11,
                color: C.mute,
                letterSpacing: 0.5,
              }}
            >
              {email}
            </p>
          )}
        </div>

        {done ? (
          <div
            role="status"
            style={{
              padding: "14px 14px",
              border: `1px solid ${C.olive}55`,
              background: `${C.olive}11`,
              borderRadius: 10,
              fontFamily: FONT_UI,
              fontSize: 13,
              color: C.cacao,
              lineHeight: 1.5,
            }}
          >
            ✓ Contraseña actualizada. Te llevamos al login…
          </div>
        ) : (
          <>
            <PasswordField
              id="reset-pwd"
              label="Nueva contraseña"
              value={pwd}
              onChange={setPwd}
              show={showPwd}
              onToggle={() => setShowPwd((v) => !v)}
              autoComplete="new-password"
            />
            <PasswordField
              id="reset-confirm"
              label="Confirmar contraseña"
              value={confirm}
              onChange={setConfirm}
              show={showPwd}
              onToggle={() => setShowPwd((v) => !v)}
              autoComplete="new-password"
            />

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
              disabled={submitting || !pwd || pwd !== confirm}
              style={{
                padding: "14px 20px",
                border: "none",
                borderRadius: 999,
                background:
                  submitting || !pwd || pwd !== confirm
                    ? C.sand
                    : `linear-gradient(135deg, ${C.gold} 0%, #C9944F 100%)`,
                color:
                  submitting || !pwd || pwd !== confirm ? C.mute : C.paper,
                fontFamily: FONT_DISPLAY,
                fontSize: 15,
                letterSpacing: 3,
                textTransform: "uppercase",
                cursor: submitting ? "not-allowed" : "pointer",
              }}
            >
              {submitting ? "Guardando..." : "Guardar contraseña"}
            </button>
          </>
        )}

        <Link
          href="/admin/login"
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
          ← Volver a iniciar sesión
        </Link>
      </form>
    </main>
  );
}

function PasswordField({
  id,
  label,
  value,
  onChange,
  show,
  onToggle,
  autoComplete,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  show: boolean;
  onToggle: () => void;
  autoComplete: string;
}) {
  return (
    <label
      htmlFor={id}
      style={{ display: "flex", flexDirection: "column", gap: 5 }}
    >
      <span style={labelStyle}>{label}</span>
      <div style={{ position: "relative" }}>
        <input
          id={id}
          type={show ? "text" : "password"}
          required
          autoComplete={autoComplete}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Ingresa la contraseña"
          aria-label={label}
          style={{ ...inputStyle, paddingRight: 44 }}
        />
        <button
          type="button"
          onClick={onToggle}
          aria-label={show ? "Ocultar contraseña" : "Mostrar contraseña"}
          aria-pressed={show}
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
          <EyeIcon hidden={show} />
        </button>
      </div>
    </label>
  );
}

const eyebrowStyle: React.CSSProperties = {
  fontFamily: FONT_MONO,
  fontSize: 10,
  letterSpacing: 3,
  color: C.mute,
  textTransform: "uppercase",
  fontWeight: 600,
};

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
