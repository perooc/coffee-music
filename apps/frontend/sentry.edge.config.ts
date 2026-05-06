/**
 * Sentry initialisation for the Next edge runtime (middleware running on
 * Vercel Edge). Today the project only has the public table-picker
 * landing on the edge surface; future middleware will inherit this.
 */
import * as Sentry from "@sentry/nextjs";

const dsn =
  process.env.SENTRY_DSN_FRONTEND ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
}
