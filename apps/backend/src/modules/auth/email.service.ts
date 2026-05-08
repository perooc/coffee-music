import { Injectable, Logger } from "@nestjs/common";
import { Resend } from "resend";

/**
 * Thin wrapper around Resend. We isolate it behind a service so the rest
 * of the app doesn't import the SDK directly — that way we can swap to
 * SES/SendGrid in the future without touching call sites.
 *
 * Behaviour:
 *   - RESEND_API_KEY missing → calls become no-ops with a warning. We
 *     don't fail the surrounding request (e.g. password reset) because
 *     the operator can't recover the user via email anyway, and the
 *     log makes the misconfig obvious.
 *   - The "from" address defaults to Resend's onboarding sandbox, which
 *     works without DNS setup. For production, set EMAIL_FROM to a
 *     verified sender like noreply@crown490.com.
 */
@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly resend: Resend | null;
  private readonly from: string;
  private readonly securityNotifyTo: string;
  private readonly resetAuditBcc: string | null;

  constructor() {
    const key = process.env.RESEND_API_KEY;
    this.resend = key ? new Resend(key) : null;
    this.from = process.env.EMAIL_FROM ?? "Crown Bar <onboarding@resend.dev>";
    this.securityNotifyTo =
      process.env.SECURITY_NOTIFY_EMAIL ?? "caenpes2003@gmail.com";
    // Optional BCC for password reset emails — silent audit copy to the
    // owner inbox so we know when someone triggers a reset.
    this.resetAuditBcc = process.env.RESET_AUDIT_BCC ?? null;
    if (!key) {
      this.logger.warn(
        "RESEND_API_KEY is not set — outbound emails will be skipped.",
      );
    }
  }

  async sendPasswordReset(to: string, name: string, resetUrl: string) {
    return this.send({
      to,
      bcc: this.resetAuditBcc ?? undefined,
      subject: "Recupera tu contraseña — Crown Bar 4.90",
      html: passwordResetHtml(name, resetUrl),
    });
  }

  async sendFailedLoginAlert(opts: {
    email: string;
    failedAttempts: number;
    locked: boolean;
    ip: string | null;
  }) {
    return this.send({
      to: this.securityNotifyTo,
      subject: locked(opts.locked) + "Intentos fallidos en login admin",
      html: failedLoginHtml(opts),
    });
  }

  private async send({
    to,
    bcc,
    subject,
    html,
  }: {
    to: string;
    bcc?: string;
    subject: string;
    html: string;
  }) {
    if (!this.resend) {
      this.logger.warn(`[email skipped] to=${to} subject="${subject}"`);
      return { skipped: true as const };
    }
    try {
      const res = await this.resend.emails.send({
        from: this.from,
        to,
        ...(bcc ? { bcc } : {}),
        subject,
        html,
      });
      if (res.error) {
        this.logger.error(`Resend error: ${res.error.message}`);
        return { skipped: true as const };
      }
      return { sent: true as const, id: res.data?.id ?? null };
    } catch (err) {
      this.logger.error(`Email send failed: ${String(err)}`);
      return { skipped: true as const };
    }
  }
}

function locked(locked: boolean) {
  return locked ? "🔒 [Cuenta bloqueada] " : "";
}

function passwordResetHtml(name: string, resetUrl: string) {
  return `
<!doctype html>
<html lang="es">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#FDF8EC; padding:40px 16px; color:#2B1D14;">
    <div style="max-width:520px; margin:0 auto; background:#FFFDF8; border:1px solid #F1E6D2; border-radius:14px; padding:28px 24px;">
      <div style="font-size:11px; letter-spacing:3px; color:#A89883; text-transform:uppercase; font-weight:700;">— Crown Bar 4.90</div>
      <h1 style="font-size:22px; margin:8px 0 4px; color:#2B1D14; letter-spacing:1px;">Recupera tu contraseña</h1>
      <p style="font-size:14px; color:#6B4E2E; line-height:1.6; margin:14px 0 20px;">
        Hola${name ? " " + name : ""}, recibimos una solicitud para restablecer la contraseña de tu cuenta admin. Haz click en el botón para elegir una nueva. El enlace expira en 1 hora.
      </p>
      <a href="${resetUrl}" style="display:inline-block; padding:12px 22px; background:#6B7E4A; color:#FFFDF8; text-decoration:none; border-radius:999px; font-weight:600; letter-spacing:1.5px;">Restablecer contraseña</a>
      <p style="font-size:12px; color:#A89883; margin:22px 0 0; line-height:1.5;">
        Si no fuiste tú, ignora este email. Tu contraseña actual sigue funcionando hasta que termines este flujo.
      </p>
      <p style="font-size:11px; color:#A89883; margin:18px 0 0; word-break:break-all;">
        Si el botón no funciona, copia esta URL en tu navegador:<br>
        <span style="color:#6B4E2E;">${resetUrl}</span>
      </p>
    </div>
  </body>
</html>`;
}

function failedLoginHtml(opts: {
  email: string;
  failedAttempts: number;
  locked: boolean;
  ip: string | null;
}) {
  const tone = opts.locked ? "#8B2635" : "#B8894A";
  const banner = opts.locked
    ? "Cuenta bloqueada por demasiados intentos"
    : "Intento fallido detectado";
  return `
<!doctype html>
<html lang="es">
  <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background:#FDF8EC; padding:40px 16px; color:#2B1D14;">
    <div style="max-width:520px; margin:0 auto; background:#FFFDF8; border:1px solid #F1E6D2; border-radius:14px; padding:24px;">
      <div style="font-size:11px; letter-spacing:3px; color:${tone}; text-transform:uppercase; font-weight:700;">— Seguridad</div>
      <h1 style="font-size:20px; margin:8px 0 12px; color:${tone}; letter-spacing:0.5px;">${banner}</h1>
      <p style="font-size:14px; color:#6B4E2E; line-height:1.6; margin:0 0 14px;">
        Alguien intentó iniciar sesión en el panel admin con la cuenta <strong>${opts.email}</strong> y falló.
      </p>
      <ul style="font-size:13px; color:#6B4E2E; line-height:1.7; padding-left:18px;">
        <li>Intentos fallidos consecutivos: <strong>${opts.failedAttempts}</strong></li>
        ${opts.locked ? `<li><strong style="color:${tone};">La cuenta queda bloqueada por 20 minutos.</strong></li>` : ""}
        ${opts.ip ? `<li>IP: <span style="color:#A89883;">${opts.ip}</span></li>` : ""}
      </ul>
      <p style="font-size:12px; color:#A89883; margin:18px 0 0; line-height:1.5;">
        Si olvidaste la contraseña, puedes usar el enlace "¿Olvidaste tu contraseña?" en la pantalla de login. Si no, considera cambiar la contraseña preventivamente.
      </p>
    </div>
  </body>
</html>`;
}
