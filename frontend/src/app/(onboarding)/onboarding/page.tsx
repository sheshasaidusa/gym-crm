import type { Metadata } from "next";
import { cookies } from "next/headers";
import { Suspense } from "react";

import { OnboardingWizard } from "@/components/onboarding/onboarding-wizard";

export const metadata: Metadata = { title: "Set up your gym" };

export default async function OnboardingPage() {
  // The session cookies are httpOnly, so only the server can tell whether there is one.
  const jar = await cookies();
  const hasSession = jar.has("access_token") || jar.has("refresh_token");
  return (
    <Suspense>
      <OnboardingWizard hasSession={hasSession} />
    </Suspense>
  );
}
