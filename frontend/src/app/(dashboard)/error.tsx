"use client";

import { ErrorView } from "@/components/error-view";

// Keeps the sidebar and header when a dashboard page crashes.
export default function DashboardError(props: { error: Error & { digest?: string }; reset: () => void }) {
  return <ErrorView {...props} />;
}
