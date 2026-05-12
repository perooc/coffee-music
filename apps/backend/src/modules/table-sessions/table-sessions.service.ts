import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import {
  OrderRequestStatus,
  OrderStatus,
  Prisma,
  SessionVoidReason,
  TableSession,
  TableSessionStatus,
} from "@prisma/client";
import { PrismaService } from "../../database/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { TableProjectionService } from "../table-projection/table-projection.service";

type Tx = Prisma.TransactionClient;

const NON_CLOSED = [
  TableSessionStatus.open,
  TableSessionStatus.ordering,
  TableSessionStatus.closing,
];

const ACTIVE_ORDER_STATUSES = [
  OrderStatus.accepted,
  OrderStatus.preparing,
  OrderStatus.ready,
];

@Injectable()
export class TableSessionsService {
  private readonly logger = new Logger(TableSessionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly projection: TableProjectionService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async open(
    tableId: number,
    options: { customName?: string | null; openedBy?: "customer" | "staff" } = {},
  ): Promise<TableSession> {
    const table = await this.prisma.table.findUnique({ where: { id: tableId } });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found`);
    }

    // Multi-device sharing: when several phones at the same table reach
    // the entry view (one scans, the other types the bar code, etc.), we
    // want them all to JOIN the existing session — not each open their
    // own and auto-close the previous one. The shared session is what
    // makes the queue, the bill, and the orders feel collaborative.
    const result = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.tableSession.findFirst({
        where: { table_id: tableId, status: { in: NON_CLOSED } },
      });
      if (existing) {
        this.logger.log(
          `open(): joining existing session ${existing.id} on table ${tableId}`,
        );
        return { session: existing, isNew: false };
      }
      const created = await this.createAndProject(tableId, tx, {
        customName: options.customName ?? null,
        openedBy: options.openedBy ?? "customer",
      });
      return { session: created, isNew: true };
    });

    // Only broadcast `opened` for genuinely new sessions. Joining an
    // existing session is silent — there's no state change for other
    // listeners; the joining client will hydrate via the regular
    // session_token path.
    if (result.isNew) {
      this.realtime.emitTableSessionOpened(
        result.session.id,
        this.serialize(result.session),
      );
      const snapshot = await this.projection.snapshotForBroadcast(tableId);
      if (snapshot) this.realtime.emitTableUpdated(snapshot);
    }
    return result.session;
  }

  private async createAndProject(
    tableId: number,
    tx: Tx,
    options: { customName: string | null; openedBy: "customer" | "staff" } = {
      customName: null,
      openedBy: "customer",
    },
  ): Promise<TableSession> {
    const session = await tx.tableSession.create({
      data: {
        table_id: tableId,
        status: TableSessionStatus.open,
        custom_name: options.customName,
        opened_by: options.openedBy,
      },
    });
    await this.projection.onSessionOpened(tableId, session.id, tx);
    return session;
  }

  async close(sessionId: number): Promise<TableSession> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    if (session.status === TableSessionStatus.closed) {
      return session;
    }
    // Política: el `close` plano solo cierra sesiones YA pagadas o
    // sesiones SIN consumo (mesa que se abrió y se fue sin pedir nada).
    // Antes este endpoint cerraba sin verificar nada, lo que producía
    // sesiones "limbo" (closed + paid=null + consumo>0) que ensuciaban
    // auditorías. Hoy hay tres rutas explícitas:
    //   - markPaid: cierra y registra cobro (flujo normal con consumo).
    //   - voidSession: cierra sin cobro CON razón obligatoria (hubo
    //     consumo que no se cobró).
    //   - close: solo para sesiones ya pagadas o sin consumo.
    const consumption = Number(session.total_consumption);
    if (session.paid_at == null && consumption > 0) {
      throw new BadRequestException({
        message:
          "Session not paid. Use /mark-paid to cobrar y cerrar, or /void with a reason if no charge will be made.",
        code: "SESSION_VOID_REQUIRED",
      });
    }

    const closed = await this.prisma.$transaction(async (tx) => {
      const activeOrders = await tx.order.count({
        where: {
          table_session: {
            table_id: session.table_id,
          },
          status: { in: ACTIVE_ORDER_STATUSES },
        },
      });

      if (activeOrders > 0) {
        throw new BadRequestException({
          message: "Cannot close session while there are active orders",
          code: "TABLE_SESSION_HAS_ACTIVE_ORDERS",
          active_orders: activeOrders,
        });
      }

      const updated = await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          status: TableSessionStatus.closed,
          closed_at: new Date(),
        },
      });
      await this.projection.onSessionClosed(session.table_id, tx);
      return updated;
    });

    this.realtime.emitTableSessionClosed(closed.id, this.serialize(closed));
    const snapshot = await this.projection.snapshotForBroadcast(
      session.table_id,
    );
    if (snapshot) this.realtime.emitTableUpdated(snapshot);
    return closed;
  }

  async getCurrentForTable(tableId: number): Promise<TableSession | null> {
    const table = await this.prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, current_session_id: true },
    });
    if (!table) {
      throw new NotFoundException(`Table ${tableId} not found`);
    }
    if (!table.current_session_id) return null;
    return this.prisma.tableSession.findUnique({
      where: { id: table.current_session_id },
    });
  }

  async getById(sessionId: number): Promise<TableSession> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    return session;
  }

  // ─── Payment flow (Phase post-H) ────────────────────────────────────────

  /**
   * Customer asks for the bill. Allowed only when:
   *   - the session exists and is not closed
   *   - paid_at is null (already paid? nothing to ask)
   *   - payment_requested_at is null (already pending? idempotent on UI but
   *     we surface a conflict so race conditions are visible)
   *   - there are NO active or pending orders/requests — anything mid-flight
   *     would mean the customer hasn't received what they ordered yet.
   *
   * Sets `payment_requested_at`. Emits a session+staff update so the admin
   * sees the toast and badge immediately.
   */
  async requestPayment(sessionId: number): Promise<TableSession> {
    const session = await this.requireSessionExists(sessionId);

    if (session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed",
        code: "TABLE_SESSION_CLOSED",
      });
    }
    if (session.paid_at) {
      throw new ConflictException({
        message: "Session is already paid",
        code: "TABLE_SESSION_ALREADY_PAID",
      });
    }
    if (session.payment_requested_at) {
      throw new ConflictException({
        message: "Payment was already requested",
        code: "TABLE_SESSION_PAYMENT_ALREADY_REQUESTED",
      });
    }

    const inFlight = await this.countInFlightOrders(sessionId);
    if (inFlight > 0) {
      throw new BadRequestException({
        message:
          "Cannot request payment while there are pending or active orders",
        code: "TABLE_SESSION_HAS_PENDING_OR_ACTIVE_ORDERS",
        in_flight: inFlight,
      });
    }

    const updated = await this.prisma.tableSession.update({
      where: { id: sessionId },
      data: { payment_requested_at: new Date() },
    });
    this.realtime.emitTableSessionUpdated(
      sessionId,
      this.serialize(updated),
    );
    return updated;
  }

  /**
   * Customer changes their mind before the admin processed the payment.
   * Forbidden once paid — at that point the bill is closed, the customer
   * cannot un-pay it.
   */
  async cancelPaymentRequest(sessionId: number): Promise<TableSession> {
    const session = await this.requireSessionExists(sessionId);
    if (session.paid_at) {
      throw new ConflictException({
        message: "Cannot cancel: payment already processed",
        code: "TABLE_SESSION_ALREADY_PAID",
      });
    }
    if (!session.payment_requested_at) {
      // Idempotent return — nothing to cancel.
      return session;
    }
    const updated = await this.prisma.tableSession.update({
      where: { id: sessionId },
      data: { payment_requested_at: null },
    });
    this.realtime.emitTableSessionUpdated(
      sessionId,
      this.serialize(updated),
    );
    return updated;
  }

  /**
   * Admin marks the bill as paid AND closes the session in a single
   * transaction. The table is reset; the next customer must scan the QR
   * to open a brand new session — no "paid but still open" intermediate
   * state exists.
   *
   * Blocks if there are active orders (preserves the `close()` safety):
   * staff shouldn't close while drinks are still being prepared.
   */
  /**
   * Cierra una sesión SIN registrar cobro. Caso de uso real en bar:
   *   - Cliente se fue sin pagar.
   *   - Mesa abierta por error.
   *   - Cortesía de la casa.
   *
   * Trazabilidad: queda `voided_at`, `void_reason` (enum predefinido) y
   * `voided_by` (admin email/id) para auditoría. Las consumptions del
   * tipo `product` que ya se entregaron NO se reversan — siguen siendo
   * inventario que el bar ya entregó (costo real), pero NO contó como
   * revenue del día porque sales-insights filtra por created_at de la
   * Consumption, no por estado de la sesión. El void NO afecta el
   * dashboard de ventas — solo da visibilidad de "fugas" en reportes
   * dedicados.
   *
   * No reversible (decisión de producto): si el operador se equivoca y
   * voidea una sesión que sí debía cobrarse, hay que registrar un
   * movimiento manual aparte. Esto previene que alguien "deshaga" voids
   * para ocultar pérdidas.
   */
  async voidSession(
    sessionId: number,
    opts: {
      reason: SessionVoidReason;
      otherDetail?: string;
      voidedBy: string;
    },
  ): Promise<TableSession> {
    const session = await this.requireSessionExists(sessionId);

    if (session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is already closed",
        code: "TABLE_SESSION_CLOSED",
      });
    }
    if (session.paid_at != null) {
      throw new BadRequestException({
        message: "Session has been paid; use /close instead of /void",
        code: "TABLE_SESSION_ALREADY_PAID",
      });
    }
    if (session.voided_at != null) {
      throw new BadRequestException({
        message: "Session is already voided",
        code: "TABLE_SESSION_ALREADY_VOID",
      });
    }
    // `other` requiere texto: forzamos al operador a explicar el motivo
    // para que después tenga sentido en reportes. Para los enums fijos
    // el otherDetail se ignora silenciosamente (no contamina la BD).
    const detail =
      opts.reason === "other" ? (opts.otherDetail?.trim() ?? "") : null;
    if (opts.reason === "other" && (!detail || detail.length < 3)) {
      throw new BadRequestException({
        message: '"other" reason requires a free-text detail (min 3 chars)',
        code: "SESSION_VOID_DETAIL_REQUIRED",
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      // No verificamos active orders: el void existe precisamente para
      // limpiar sesiones "rotas". Si hay órdenes activas, las dejamos
      // pero la sesión se cierra — futuras consultas las verán huérfanas
      // por table_session_id pero la sesión ya no es operable.
      const now = new Date();
      const updated = await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          status: TableSessionStatus.void,
          closed_at: now,
          voided_at: now,
          void_reason: opts.reason,
          void_other_detail: detail,
          voided_by: opts.voidedBy,
          payment_requested_at: null,
        },
      });
      await this.projection.onSessionClosed(session.table_id, tx);
      return updated;
    });

    this.realtime.emitTableSessionClosed(result.id, this.serialize(result));
    const snapshot = await this.projection.snapshotForBroadcast(
      session.table_id,
    );
    if (snapshot) this.realtime.emitTableUpdated(snapshot);
    return result;
  }

  async markPaid(sessionId: number): Promise<TableSession> {
    const session = await this.requireSessionExists(sessionId);
    if (session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: "Session is closed",
        code: "TABLE_SESSION_CLOSED",
      });
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const activeOrders = await tx.order.count({
        where: {
          table_session_id: sessionId,
          status: { in: ACTIVE_ORDER_STATUSES },
        },
      });
      if (activeOrders > 0) {
        throw new BadRequestException({
          message: "Cannot close session while there are active orders",
          code: "TABLE_SESSION_HAS_ACTIVE_ORDERS",
          active_orders: activeOrders,
        });
      }

      const now = new Date();
      const updated = await tx.tableSession.update({
        where: { id: sessionId },
        data: {
          paid_at: now,
          closed_at: now,
          status: TableSessionStatus.closed,
          payment_requested_at: null,
        },
      });
      await this.projection.onSessionClosed(session.table_id, tx);
      return updated;
    });

    this.realtime.emitTableSessionClosed(result.id, this.serialize(result));
    const snapshot = await this.projection.snapshotForBroadcast(session.table_id);
    if (snapshot) this.realtime.emitTableUpdated(snapshot);
    return result;
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private async requireSessionExists(sessionId: number): Promise<TableSession> {
    const session = await this.prisma.tableSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new NotFoundException(`TableSession ${sessionId} not found`);
    }
    return session;
  }

  /**
   * Counts orders that are not yet delivered/cancelled AND order-requests
   * that are not yet accepted/rejected/cancelled. Either kind blocks the
   * payment-request action: from the customer's point of view, "I have
   * something pending the bar".
   */
  private async countInFlightOrders(sessionId: number): Promise<number> {
    const [activeOrders, pendingRequests] = await Promise.all([
      this.prisma.order.count({
        where: {
          table_session_id: sessionId,
          status: { in: ACTIVE_ORDER_STATUSES },
        },
      }),
      this.prisma.orderRequest.count({
        where: {
          table_session_id: sessionId,
          status: OrderRequestStatus.pending,
        },
      }),
    ]);
    return activeOrders + pendingRequests;
  }

  async requireOpenForTable(tableId: number): Promise<TableSession> {
    const session = await this.getCurrentForTable(tableId);
    if (!session || session.status === TableSessionStatus.closed) {
      throw new BadRequestException({
        message: `Table ${tableId} has no open session`,
        code: "TABLE_SESSION_NOT_OPEN",
      });
    }
    return session;
  }

  serialize(session: TableSession) {
    return {
      ...session,
      total_consumption: Number(session.total_consumption),
    };
  }

  /**
   * Slim read of a Table for callers that only need the audit-grade
   * metadata (number, kind). Lives here so we don't force TableSessions
   * callers to import TablesService — the lookup is trivial and the
   * coupling pays off in keeping the audit log tight.
   */
  async getTableForAudit(tableId: number) {
    return this.prisma.table.findUnique({
      where: { id: tableId },
      select: { id: true, number: true, kind: true },
    });
  }
}
