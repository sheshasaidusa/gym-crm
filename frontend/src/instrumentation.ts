import * as Sentry from "@sentry/nextjs";

// Server-side (Node and edge) error reporting. Off unless SENTRY_DSN is set.
export async function register() {
  const dsn = process.env.SENTRY_DSN;
  if (!dsn) return;
  const { DATA_COLLECTION, scrub } = await import("@/lib/sentry-scrub");
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
    dataCollection: DATA_COLLECTION,
    tracesSampleRate: 0,
    beforeSend: scrub,
  });
}

export const onRequestError = Sentry.captureRequestError;
