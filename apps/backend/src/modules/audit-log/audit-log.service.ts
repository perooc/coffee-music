import { Injectable, Logger } from "@nestjs/common";
import { AuditEventKind as DbAuditEventKind, Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";

/**
 * Auditoría centralizada. Append-only por contrato del servicio (no
 * exponemos update/delete). Cada acción sensible llama `record(...)`
 * con un `kind` enumerado y un payload tipado por kind, y el servicio
 * arma el `summary` para la UI.
 *
 * Compatibilidad con el feed viejo: `list()` también merge-ea entradas
 * derivadas de InventoryMovement (las que sí tienen `created_by`) para
 * que los movimientos anteriores a la introducción de esta tabla sigan
 * apareciendo. Las nuevas acciones que afecten inventario también
 * escriben en `AuditLog`, así que tras unos días de tráfico podemos
 * dejar de leer la tabla vieja.
 */

export type AuditEventKind = DbAuditEventKind;

export interface AuditEvent {
  id: string;
  kind: AuditEventKind;
  created_at: string;
  actor_id: number | null;
  actor_label: string | null;
  summary: string;
  metadata: Record<string, unknown>;
  ip: string | null;
}

// ─── Tipos de payload por kind ─────────────────────────────────────────────
// El llamador pasa estos shape; el service decide cómo armar summary +
// metadata. Tipar acá previene "metí un dato mal escrito" silencioso.

type RecordInput =
  | {
      kind: "login_success";
      actor_id: number;
      actor_label: string;
      ip?: string | null;
    }
  | {
      kind: "login_failed";
      attempted_email: string;
      ip?: string | null;
      consecutive_failures: number;
    }
  | {
      kind: "login_locked";
      attempted_email: string;
      ip?: string | null;
      consecutive_failures: number;
      lockout_minutes: number;
    }
  | {
      kind: "password_reset_requested";
      attempted_email: string;
      user_existed: boolean;
      ip?: string | null;
    }
  | {
      kind: "password_reset_completed";
      actor_id: number;
      actor_label: string;
      ip?: string | null;
    }
  | {
      kind: "access_code_rotated";
      actor_id: number | null;
      actor_label: string;
      new_code: string;
    }
  | {
      kind: "session_opened_by_admin";
      actor_id: number;
      actor_label: string;
      session_id: number;
      table_id: number;
      table_number: number;
      custom_name: string | null;
      table_kind: string;
    }
  | {
      kind: "walkin_account_opened";
      actor_id: number;
      actor_label: string;
      session_id: number;
      table_id: number;
      custom_name: string;
    }
  | {
      kind: "session_marked_paid";
      actor_id: number;
      actor_label: string;
      session_id: number;
      table_id: number;
      total: number;
    }
  | {
      kind: "session_closed";
      actor_id: number;
      actor_label: string;
      session_id: number;
      table_id: number;
    }
  | {
      kind: "session_voided";
      actor_id: number;
      actor_label: string;
      session_id: number;
      table_id: number;
      reason: string;
      other_detail: string | null;
      total_voided: number;
    }
  | {
      kind: "session_partial_payment";
      actor_id: number;
      actor_label: string;
      session_id: number;
      table_id: number;
      amount: number;
    }
  | {
      kind: "product_created";
      actor_id: number;
      actor_label: string;
      product_id: number;
      product_name: string;
    }
  | {
      kind: "product_updated";
      actor_id: number;
      actor_label: string;
      product_id: number;
      product_name: string;
      changes: Record<string, { from: unknown; to: unknown }>;
    }
  | {
      kind: "product_activated" | "product_deactivated";
      actor_id: number;
      actor_label: string;
      product_id: number;
      product_name: string;
    }
  | {
      kind: "inventory_movement";
      actor_id: number;
      actor_label: string;
      product_id: number;
      product_name: string;
      movement_type: "restock" | "adjustment" | "waste" | "correction";
      quantity: number;
      reason: string | null;
    }
  | {
      kind: "bill_adjustment";
      actor_id: number;
      actor_label: string;
      session_id: number;
      table_id: number;
      adjustment_type: "adjustment" | "discount" | "refund";
      amount: number;
      description: string;
      reason: string | null;
    };

@Injectable()
export class AuditLogService {
  private readonly logger = new Logger(AuditLogService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Insert one row. Best-effort: if the write fails (e.g. transient DB
   * blip) we log and swallow. The audit log should never break the
   * surrounding business action — losing one audit entry is better
   * than failing the operation that triggered it.
   */
  async record(input: RecordInput): Promise<void> {
    try {
      const { summary, metadata } = this.materialize(input);
      const actorId =
        "actor_id" in input && typeof input.actor_id === "number"
          ? input.actor_id
          : null;
      const actorLabel =
        "actor_label" in input && typeof input.actor_label === "string"
          ? input.actor_label
          : null;
      const ip =
        "ip" in input && typeof input.ip === "string" ? input.ip : null;
      await this.prisma.auditLog.create({
        data: {
          kind: input.kind,
          actor_id: actorId,
          actor_label: actorLabel,
          summary,
          metadata: metadata as unknown as Prisma.InputJsonValue,
          ip,
        },
      });
    } catch (err) {
      this.logger.error(
        `audit record failed kind=${input.kind} err=${String(err)}`,
      );
    }
  }

  async list(limit = 100): Promise<AuditEvent[]> {
    const safeLimit = Math.min(Math.max(1, limit), 500);
    const rows = await this.prisma.auditLog.findMany({
      orderBy: { created_at: "desc" },
      take: safeLimit,
    });
    return rows.map((r) => ({
      id: `audit:${r.id}`,
      kind: r.kind,
      created_at: r.created_at.toISOString(),
      actor_id: r.actor_id,
      actor_label: r.actor_label,
      summary: r.summary,
      metadata: (r.metadata as Record<string, unknown> | null) ?? {},
      ip: r.ip,
    }));
  }

  // ─── Internals ───────────────────────────────────────────────────────────

  private materialize(input: RecordInput): {
    summary: string;
    metadata: Record<string, unknown>;
  } {
    switch (input.kind) {
      case "login_success":
        return {
          summary: `Login exitoso: ${input.actor_label}`,
          metadata: {},
        };
      case "login_failed":
        return {
          summary: `Intento de login fallido: ${input.attempted_email} (${input.consecutive_failures} consecutivos)`,
          metadata: {
            attempted_email: input.attempted_email,
            consecutive_failures: input.consecutive_failures,
          },
        };
      case "login_locked":
        return {
          summary: `Cuenta bloqueada por ${input.lockout_minutes} min: ${input.attempted_email}`,
          metadata: {
            attempted_email: input.attempted_email,
            consecutive_failures: input.consecutive_failures,
            lockout_minutes: input.lockout_minutes,
          },
        };
      case "password_reset_requested":
        return {
          summary: `Solicitud de reset de contraseña para ${input.attempted_email}${input.user_existed ? "" : " (email no registrado)"}`,
          metadata: {
            attempted_email: input.attempted_email,
            user_existed: input.user_existed,
          },
        };
      case "password_reset_completed":
        return {
          summary: `Contraseña restablecida: ${input.actor_label}`,
          metadata: {},
        };
      case "access_code_rotated":
        return {
          summary: `Código del bar rotado a ${input.new_code}`,
          metadata: { new_code: input.new_code },
        };
      case "session_opened_by_admin":
        return {
          summary:
            input.custom_name && input.custom_name.length > 0
              ? `Sesión abierta por admin: ${input.custom_name} (mesa ${input.table_number})`
              : `Sesión abierta por admin en mesa ${input.table_number}`,
          metadata: {
            session_id: input.session_id,
            table_id: input.table_id,
            table_number: input.table_number,
            custom_name: input.custom_name,
            table_kind: input.table_kind,
          },
        };
      case "walkin_account_opened":
        return {
          summary: `Cuenta sin mesa abierta: ${input.custom_name}`,
          metadata: {
            session_id: input.session_id,
            table_id: input.table_id,
            custom_name: input.custom_name,
          },
        };
      case "session_marked_paid":
        return {
          summary: `Cuenta cobrada y cerrada: sesión #${input.session_id} (${formatCop(input.total)})`,
          metadata: {
            session_id: input.session_id,
            table_id: input.table_id,
            total: input.total,
          },
        };
      case "session_closed":
        return {
          summary: `Cuenta cerrada sin cobro: sesión #${input.session_id}`,
          metadata: {
            session_id: input.session_id,
            table_id: input.table_id,
          },
        };
      case "session_voided":
        return {
          summary: `Cuenta anulada (${input.reason}): sesión #${input.session_id} — ${formatCop(input.total_voided)} sin cobrar${input.other_detail ? ` — ${input.other_detail}` : ""}`,
          metadata: {
            session_id: input.session_id,
            table_id: input.table_id,
            reason: input.reason,
            other_detail: input.other_detail,
            total_voided: input.total_voided,
          },
        };
      case "session_partial_payment":
        return {
          summary: `Pago parcial registrado: sesión #${input.session_id} — ${formatCop(input.amount)}`,
          metadata: {
            session_id: input.session_id,
            table_id: input.table_id,
            amount: input.amount,
          },
        };
      case "product_created":
        return {
          summary: `Producto creado: ${input.product_name}`,
          metadata: { product_id: input.product_id },
        };
      case "product_updated": {
        const changeKeys = Object.keys(input.changes);
        return {
          summary: `Producto editado: ${input.product_name}${changeKeys.length ? ` (${changeKeys.join(", ")})` : ""}`,
          metadata: {
            product_id: input.product_id,
            changes: input.changes,
          },
        };
      }
      case "product_activated":
        return {
          summary: `Producto activado: ${input.product_name}`,
          metadata: { product_id: input.product_id },
        };
      case "product_deactivated":
        return {
          summary: `Producto desactivado: ${input.product_name}`,
          metadata: { product_id: input.product_id },
        };
      case "inventory_movement": {
        const sign = input.quantity > 0 ? "+" : "";
        const label =
          input.movement_type === "restock"
            ? "Reposición"
            : input.movement_type === "waste"
              ? "Merma"
              : input.movement_type === "correction"
                ? "Corrección"
                : "Ajuste";
        return {
          summary: `${label} de stock en ${input.product_name} (${sign}${input.quantity})${input.reason ? ` — ${input.reason}` : ""}`,
          metadata: {
            product_id: input.product_id,
            movement_type: input.movement_type,
            quantity: input.quantity,
            reason: input.reason,
          },
        };
      }
      case "bill_adjustment": {
        const label =
          input.adjustment_type === "refund"
            ? "Reembolso"
            : input.adjustment_type === "discount"
              ? "Descuento"
              : "Ajuste";
        return {
          summary: `${label} "${input.description}" (${formatCop(input.amount)})${input.reason ? ` — ${input.reason}` : ""}`,
          metadata: {
            session_id: input.session_id,
            table_id: input.table_id,
            adjustment_type: input.adjustment_type,
            amount: input.amount,
            description: input.description,
            reason: input.reason,
          },
        };
      }
    }
  }
}

function formatCop(n: number) {
  return new Intl.NumberFormat("es-CO", {
    style: "currency",
    currency: "COP",
    maximumFractionDigits: 0,
  }).format(n);
}
