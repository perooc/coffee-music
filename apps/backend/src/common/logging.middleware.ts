import type { NextFunction, Request, Response } from "express";
import { randomUUID } from "node:crypto";

type LogPayload = Record<string, unknown>;

function log(payload: LogPayload) {
  console.log(JSON.stringify(payload));
}

export function loggingMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const requestId =
    (req.headers["x-request-id"] as string | undefined) ?? randomUUID();

  res.setHeader("X-Request-Id", requestId);

  const startedAt = Date.now();
  const method = req.method;
  const path = req.originalUrl?.split("?")[0] ?? req.path;
  const ip =
    (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
    req.ip ??
    req.socket.remoteAddress ??
    "unknown";
  const userAgent = req.headers["user-agent"];

  res.on("finish", () => {
    log({
      level: "info",
      message: "http_request",
      request_id: requestId,
      method,
      path,
      status: res.statusCode,
      duration_ms: Date.now() - startedAt,
      ip,
      user_agent: userAgent,
    });
  });

  res.on("close", () => {
    if (res.writableEnded) return;
    log({
      level: "warn",
      message: "http_request_aborted",
      request_id: requestId,
      method,
      path,
      status: res.statusCode,
      duration_ms: Date.now() - startedAt,
      ip,
      user_agent: userAgent,
    });
  });

  next();
}
