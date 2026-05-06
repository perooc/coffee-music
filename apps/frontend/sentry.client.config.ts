/**
 * Sentry initialisation for the browser bundle. Loaded automatically by
 * @sentry/nextjs when this file is in the project root. Only runs when
 * NEXT_PUBLIC_SENTRY_DSN is set; on local dev it stays silent.
 */
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
    // Sample replays of sessions that hit an error to help debug UX
    // issues we can't reproduce locally. Keep at 0 most of the time
    // (replays are heavy) and crank only when investigating.
    replaysOnErrorSampleRate: 0,
    replaysSessionSampleRate: 0,
  });
}
