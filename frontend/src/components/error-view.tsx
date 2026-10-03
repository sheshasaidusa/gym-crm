"use client";

import * as Sentry from "@sentry/nextjs";
import { RotateCcwIcon } from "lucide-react";
import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/button";

/** Shown when a page crashes. The error is reported; the user gets a way forward. */
export function ErrorView({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-4 py-16 text-center">
      <h1 className="text-xl font-semibold">Something went wrong on this page</h1>
      <p className="text-sm text-muted-foreground">
        It&apos;s been reported. Try again, and if it keeps happening, go back to the dashboard.
      </p>
      {error.digest && <p className="font-mono text-xs text-muted-foreground">Reference: {error.digest}</p>}
      <div className="flex gap-2">
        <Button onClick={reset}>
          <RotateCcwIcon />
          Try again
        </Button>
        <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
          Dashboard
        </Button>
      </div>
    </div>
  );
}
