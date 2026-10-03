import * as Sentry from "@sentry/nextjs";

import { DATA_COLLECTION, scrub } from "@/lib/sentry-scrub";

// Browser error reporting. Off unless NEXT_PUBLIC_SENTRY_DSN is set at build time.
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

Sentry.init({
  dsn,
  enabled: !!dsn,
  environment: process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  dataCollection: DATA_COLLECTION,
  tracesSampleRate: 0,
  beforeSend: scrub,
});

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
