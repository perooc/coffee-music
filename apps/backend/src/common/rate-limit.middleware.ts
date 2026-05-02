import type { NextFunction, Request, Response } from "express";

type RateLimitRule = {
  windowMs: number;
  max: number;
};

type RuleSet = Record<string, RateLimitRule>;

const rules: RuleSet = {
  "/api/queue": { windowMs: 60_000, max: 15 },
  "/api/orders": { windowMs: 60_000, max: 12 },
  "/api/order-requests": { windowMs: 60_000, max: 12 },
  "/api/music/search": { windowMs: 60_000, max: 20 },
  "/api/auth/login": { windowMs: 60_000, max: 5 },
  "/api/table-sessions/open": { windowMs: 60_000, max: 10 },
  // Ledger mutations: bound how often a single staff/admin can fire them.
  // If multiple admins share an IP (kiosk / shared LAN) we want each user
  // counted separately, so the bucket key prefers user_id when present.
  "/api/bill-adjustments": { windowMs: 60_000, max: 20 },
  "/api/refunds": { windowMs: 60_000, max: 10 },
  // Temporary public table picker: 60 attempts/min by IP. Generous enough
  // that a real customer never hits it (typo retries + auto-refresh of
  // the available list while picking) but still capped so a bot can't
  // spray the bar-code dictionary at line-rate.
  "/api/public/tables": { windowMs: 60_000, max: 60 },
};

type Bucket = number[];

const buckets = new Map<string, Bucket>();

function clientIp(req: Request): string {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string") {
    return forwarded.split(",")[0]?.trim() || "unknown";
  }
  if (Array.isArray(forwarded)) {
    return forwarded[0] ?? "unknown";
  }
  return req.ip || req.socket.remoteAddress || "unknown";
}

/**
 * Best-effort `sub` claim extraction. We do NOT verify the signature here —
 * any forged "sub" simply ends up bucketed against an attacker-controlled
 * key, which is fine for rate limiting. The verification happens later in
 * the JwtGuard. Falling back to IP keeps anonymous traffic limited too.
 */
function extractActorId(req: Request): string | null {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) return null;
  const token = header.slice("Bearer ".length).trim();
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const json = Buffer.from(parts[1], "base64url").toString("utf8");
    const payload = JSON.parse(json) as Record<string, unknown>;
    if (typeof payload.sub === "number" || typeof payload.sub === "string") {
      return String(payload.sub);
    }
    if (typeof payload.session_id === "number") {
      return `session:${payload.session_id}`;
    }
    if (typeof payload.table_id === "number") {
      return `table:${payload.table_id}`;
    }
    return null;
  } catch {
    return null;
  }
}

function findRule(path: string): { rule: RateLimitRule; bucketPath: string } | null {
  if (path.startsWith("/api/auth/login"))
    return { rule: rules["/api/auth/login"], bucketPath: "/api/auth/login" };
  if (path.startsWith("/api/music/search"))
    return { rule: rules["/api/music/search"], bucketPath: "/api/music/search" };
  if (path.startsWith("/api/queue"))
    return { rule: rules["/api/queue"], bucketPath: "/api/queue" };
  if (path.startsWith("/api/orders"))
    return { rule: rules["/api/orders"], bucketPath: "/api/orders" };
  if (path.startsWith("/api/order-requests"))
    return {
      rule: rules["/api/order-requests"],
      bucketPath: "/api/order-requests",
    };
  if (path.startsWith("/api/table-sessions/open"))
    return {
      rule: rules["/api/table-sessions/open"],
      bucketPath: "/api/table-sessions/open",
    };
  if (path.startsWith("/api/public/tables"))
    return {
      rule: rules["/api/public/tables"],
      bucketPath: "/api/public/tables",
    };
  // /api/bill/:sessionId/adjustments — match the action, not the session id.
  if (/^\/api\/bill\/\d+\/adjustments/.test(path))
    return {
      rule: rules["/api/bill-adjustments"],
      bucketPath: "/api/bill-adjustments",
    };
  if (/^\/api\/consumptions\/\d+\/refund/.test(path))
    return { rule: rules["/api/refunds"], bucketPath: "/api/refunds" };
  return null;
}

function rateLimitCode(bucketPath: string): string {
  switch (bucketPath) {
    case "/api/music/search":
      return "SEARCH_RATE_LIMITED";
    case "/api/queue":
      return "QUEUE_RATE_LIMITED";
    case "/api/auth/login":
      return "LOGIN_RATE_LIMITED";
    case "/api/bill-adjustments":
      return "ADJUSTMENT_RATE_LIMITED";
    case "/api/refunds":
      return "REFUND_RATE_LIMITED";
    default:
      return "RATE_LIMITED";
  }
}

export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const path = req.originalUrl?.split("?")[0] ?? req.path;
  const match = findRule(path);
  if (!match) return next();

  const { rule, bucketPath } = match;

  // Prefer per-user buckets when an Authorization header is present so that
  // multiple staff sharing an IP (kiosk / NAT) do not throttle each other.
  // For anonymous requests, fall back to IP.
  const actor = extractActorId(req);
  const subject = actor ? `actor:${actor}` : `ip:${clientIp(req)}`;
  const key = `${bucketPath}:${subject}`;

  const now = Date.now();
  const windowStart = now - rule.windowMs;
  const current = buckets.get(key) ?? [];
  const recent = current.filter((ts) => ts > windowStart);

  if (recent.length >= rule.max) {
    const retryAfterSec = Math.ceil((recent[0] + rule.windowMs - now) / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    res.setHeader("X-RateLimit-Limit", String(rule.max));
    res.setHeader("X-RateLimit-Remaining", "0");
    res.status(429).json({
      statusCode: 429,
      message: "Too many requests",
      code: rateLimitCode(bucketPath),
      retry_after_seconds: retryAfterSec,
    });
    return;
  }

  recent.push(now);
  buckets.set(key, recent);

  res.setHeader("X-RateLimit-Limit", String(rule.max));
  res.setHeader("X-RateLimit-Remaining", String(rule.max - recent.length));

  next();
}
