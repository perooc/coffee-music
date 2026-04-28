import { describe, it, expect, beforeEach, vi } from "vitest";
import { Prisma } from "@prisma/client";
import { TableSessionsService } from "../src/modules/table-sessions/table-sessions.service";

function makeDeps() {
  const tableFindUnique = vi.fn();
  const sessionCreate = vi.fn();
  const sessionUpdate = vi.fn();
  const sessionUpdateMany = vi.fn().mockResolvedValue({ count: 1 });
  const sessionFindUnique = vi.fn();
  const tableUpdate = vi.fn().mockResolvedValue({});

  const orderCount = vi.fn().mockResolvedValue(0);

  const tx = {
    tableSession: {
      create: sessionCreate,
      update: sessionUpdate,
      updateMany: sessionUpdateMany,
    },
    table: { update: tableUpdate },
    order: { count: orderCount },
  };

  const prisma = {
    table: { findUnique: tableFindUnique },
    tableSession: {
      findUnique: sessionFindUnique,
      create: sessionCreate,
      update: sessionUpdate,
    },
    $transaction: (fn: any) => fn(tx),
  } as any;

  const projection = {
    onSessionOpened: vi.fn().mockResolvedValue(undefined),
    onSessionClosed: vi.fn().mockResolvedValue(undefined),
  } as any;

  const realtime = {
    emitTableSessionOpened: vi.fn(),
    emitTableSessionClosed: vi.fn(),
    emitTableUpdated: vi.fn(),
  } as any;

  const svc = new TableSessionsService(prisma, projection, realtime);

  return {
    svc,
    prisma,
    projection,
    realtime,
    tableFindUnique,
    sessionCreate,
    sessionUpdate,
    sessionUpdateMany,
    sessionFindUnique,
    tableUpdate,
  };
}

describe("TableSessionsService.open", () => {
  let d: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    d = makeDeps();
  });

  it("happy path: creates session and projects table", async () => {
    d.tableFindUnique.mockResolvedValue({ id: 1 });
    d.sessionCreate.mockResolvedValue({
      id: 10,
      table_id: 1,
      status: "open",
      total_consumption: 0,
    });

    const session = await d.svc.open(1);

    expect(session.id).toBe(10);
    expect(d.projection.onSessionOpened).toHaveBeenCalledWith(1, 10, expect.anything());
    expect(d.realtime.emitTableSessionOpened).toHaveBeenCalled();
    expect(d.realtime.emitTableUpdated).toHaveBeenCalledWith({ id: 1 });
  });

  it("throws NotFound when table does not exist", async () => {
    d.tableFindUnique.mockResolvedValue(null);
    await expect(d.svc.open(99)).rejects.toThrowError(/Table 99 not found/);
  });

  it("fail-safe: on P2002 closes prior session and retries", async () => {
    d.tableFindUnique.mockResolvedValue({ id: 1 });
    const conflict = new Prisma.PrismaClientKnownRequestError("unique", {
      code: "P2002",
      clientVersion: "test",
    });
    // First create throws P2002, second succeeds
    d.sessionCreate
      .mockRejectedValueOnce(conflict)
      .mockResolvedValueOnce({
        id: 11,
        table_id: 1,
        status: "open",
        total_consumption: 0,
      });

    const session = await d.svc.open(1);

    expect(session.id).toBe(11);
    expect(d.sessionUpdateMany).toHaveBeenCalledWith({
      where: {
        table_id: 1,
        status: { in: ["open", "ordering", "closing"] },
      },
      data: expect.objectContaining({ status: "closed" }),
    });
    expect(d.sessionCreate).toHaveBeenCalledTimes(2);
  });

  it("non-P2002 errors bubble up", async () => {
    d.tableFindUnique.mockResolvedValue({ id: 1 });
    d.sessionCreate.mockRejectedValue(new Error("boom"));
    await expect(d.svc.open(1)).rejects.toThrowError("boom");
  });
});

describe("TableSessionsService.close", () => {
  let d: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    d = makeDeps();
  });

  it("closes an open session and projects table", async () => {
    d.sessionFindUnique.mockResolvedValue({
      id: 10,
      table_id: 1,
      status: "open",
      total_consumption: 0,
    });
    d.sessionUpdate.mockResolvedValue({
      id: 10,
      table_id: 1,
      status: "closed",
      total_consumption: 0,
    });

    const session = await d.svc.close(10);

    expect(session.status).toBe("closed");
    expect(d.projection.onSessionClosed).toHaveBeenCalledWith(1, expect.anything());
    expect(d.realtime.emitTableSessionClosed).toHaveBeenCalled();
  });

  it("is idempotent when session already closed", async () => {
    d.sessionFindUnique.mockResolvedValue({
      id: 10,
      table_id: 1,
      status: "closed",
      total_consumption: 0,
    });

    const session = await d.svc.close(10);

    expect(session.status).toBe("closed");
    expect(d.sessionUpdate).not.toHaveBeenCalled();
    expect(d.projection.onSessionClosed).not.toHaveBeenCalled();
    expect(d.realtime.emitTableSessionClosed).not.toHaveBeenCalled();
  });

  it("throws NotFound when session missing", async () => {
    d.sessionFindUnique.mockResolvedValue(null);
    await expect(d.svc.close(123)).rejects.toThrowError(/TableSession 123/);
  });
});

describe("TableSessionsService.getCurrentForTable", () => {
  let d: ReturnType<typeof makeDeps>;

  beforeEach(() => {
    d = makeDeps();
  });

  it("returns null when table has no current_session_id", async () => {
    d.tableFindUnique.mockResolvedValue({ id: 1, current_session_id: null });
    const s = await d.svc.getCurrentForTable(1);
    expect(s).toBeNull();
  });

  it("returns the session when current_session_id is set", async () => {
    d.tableFindUnique.mockResolvedValue({ id: 1, current_session_id: 42 });
    d.sessionFindUnique.mockResolvedValue({ id: 42, table_id: 1, status: "open" });
    const s = await d.svc.getCurrentForTable(1);
    expect(s?.id).toBe(42);
  });
});
