import type { NextFunction, Request, Response } from "express";

type RateLimitRule = {
  windowMs: number;
  max: number;
};

type RuleSet = Record<string, RateLimitRule>;

const rules: RuleSet = {
  "/api/queue": { windowMs: 60_000, max: 15 },
  "/api/orders": { windowMs: 60_000, max: 12 },
  "/api/music/search": { windowMs: 60_000, max: 20 },
};

type Bucket = number[];

const buckets = new Map<string, Bucket>();

function getClientKey(req: Request) {
  const forwarded = req.headers["x-forwarded-for"];
  const ip =
    typeof forwarded === "string"
      ? forwarded.split(",")[0]?.trim()
      : Array.isArray(forwarded)
        ? forwarded[0]
        : req.ip || req.socket.remoteAddress || "unknown";

  const path = req.originalUrl?.split("?")[0] ?? req.path;
  return { ip, path };
}

function findRule(path: string): RateLimitRule | null {
  if (path.startsWith("/api/music/search")) return rules["/api/music/search"];
  if (path.startsWith("/api/queue")) return rules["/api/queue"];
  if (path.startsWith("/api/orders")) return rules["/api/orders"];
  return null;
}

export function rateLimitMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const { ip, path } = getClientKey(req);
  const rule = findRule(path);

  if (!rule) return next();

  const now = Date.now();
  const key = `${path}:${ip}`;
  const windowStart = now - rule.windowMs;
  const current = buckets.get(key) ?? [];
  const recent = current.filter((ts) => ts > windowStart);

  if (recent.length >= rule.max) {
    const retryAfterSec = Math.ceil((recent[0] + rule.windowMs - now) / 1000);
    res.setHeader("Retry-After", String(retryAfterSec));
    res.setHeader("X-RateLimit-Limit", String(rule.max));
    res.setHeader("X-RateLimit-Remaining", "0");
    res.status(429).json({
      message: "Too many requests",
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
