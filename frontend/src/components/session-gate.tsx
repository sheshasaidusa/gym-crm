"use client";

import { useRouter } from "next/navigation";
import { useEffect, useSyncExternalStore } from "react";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMe } from "@/lib/queries";

const noopSubscribe = () => () => {};

/** false during SSR and hydration, true afterwards. */
function useIsClient() {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

/**
 * Dashboard UI depends on who is logged in (role, gym), which the server doesn't know.
 * Rendering it only on the client, once the session has loaded, avoids hydration
 * mismatches and lets every page assume the session exists.
 */
export function SessionGate({ children }: { children: React.ReactNode }) {
  const isClient = useIsClient();
  const me = useMe();
  const router = useRouter();
  // New owners finish setting up their gym before they see the dashboard.
  const needsOnboarding = me.data?.role === "owner" && !me.data.gym.onboarding_completed_at;
  useEffect(() => {
    if (needsOnboarding) router.replace("/onboarding");
  }, [needsOnboarding, router]);

  if (!isClient || me.isPending || needsOnboarding) {
    return (
      <div className="flex min-h-svh items-center justify-center">
        <Spinner className="size-6 text-muted-foreground" />
      </div>
    );
  }
  if (me.isError) {
    return (
      <div className="flex min-h-svh flex-col items-center justify-center gap-3 text-sm">
        <p className="text-muted-foreground">{me.error.message}</p>
        <Button variant="outline" onClick={() => me.refetch()}>
          Try again
        </Button>
      </div>
    );
  }
  return children;
}
