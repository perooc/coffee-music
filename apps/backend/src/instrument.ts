/**
 * Sentry instrumentation. MUST be imported at the very top of main.ts —
 * before any other application code — so the SDK can monkey-patch
 * Node's HTTP/Express/etc. internals before they're constructed.
 *
 * Behaviour:
 *   - SENTRY_DSN_BACKEND in env → enabled in production-like envs.
 *   - DSN missing → silently no-op. We don't want to fail boot just
 *     because someone forgot to wire up monitoring.
 *   - tracesSampleRate is 0.1 by default; high enough to spot-check
 *     latency spikes without the bill spiraling. Override via
 *     SENTRY_TRACES_SAMPLE_RATE.
 */
import * as Sentry from "@sentry/nestjs";
import { nodeProfilingIntegration } from "@sentry/profiling-node";

const dsn = process.env.SENTRY_DSN_BACKEND;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV ?? "development",
    integrations: [nodeProfilingIntegration()],
    tracesSampleRate: parseFloat(
      process.env.SENTRY_TRACES_SAMPLE_RATE ?? "0.1",
    ),
    profilesSampleRate: parseFloat(
      process.env.SENTRY_PROFILES_SAMPLE_RATE ?? "0.1",
    ),
    // Ignore the noisy ones: socket transient errors and 4xx-class
    // ValidationPipe rejections that Nest already returns to clients.
    ignoreErrors: [
      "BadRequestException",
      "UnauthorizedException",
      "ForbiddenException",
      "NotFoundException",
      "ConflictException",
    ],
  });
}
