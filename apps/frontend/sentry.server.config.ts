/**
 * Sentry initialisation for the Next server runtime (route handlers,
 * Server Components, getServerSideProps). Captures uncaught errors
 * thrown server-side. Reuses the public DSN — Sentry projects are scoped
 * by DSN, so the same project absorbs both client and server events.
 */
import * as Sentry from "@sentry/nextjs";

const dsn =
  process.env.SENTRY_DSN_FRONTEND ?? process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
    tracesSampleRate: 0.1,
  });
}
