"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

// Last resort when the root layout itself fails: plain HTML, no app styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "4rem 1rem", textAlign: "center" }}>
        <h1 style={{ fontSize: "1.25rem" }}>Gym CRM couldn&apos;t load</h1>
        <p style={{ color: "#666" }}>The problem has been reported. Please try again.</p>
        <button type="button" onClick={reset} style={{ marginTop: "1rem", padding: "0.5rem 1rem" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
