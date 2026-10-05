"use client";

import { useMutation, useQueryClient } from "@tanstack/react-query";

import { api, ApiError, unwrap, type Schemas } from "@/lib/api/client";
import { keys, toMe, type Me } from "@/lib/queries";

export type Profile = Schemas["GymProfile"];

/** Puts a fresh copy of the gym into the cached session, so guards see the new state at once. */
function useStoreGym() {
  const qc = useQueryClient();
  return (gym: Schemas["GymOut"]) => {
    qc.setQueryData<Me>(keys.me, (me) => (me ? { ...me, gym } : me));
    qc.setQueryData(keys.gym, gym);
  };
}

export function useOwnerSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["SignupIn"]) => unwrap(api.POST("/api/auth/signup", { body })),
    onSuccess: (auth) => {
      qc.clear();
      qc.setQueryData(keys.me, toMe(auth));
    },
  });
}

export function useSaveProfile() {
  const store = useStoreGym();
  return useMutation({
    // One at a time, so an older save can never land after a newer one.
    scope: { id: "onboarding-profile" },
    mutationFn: (body: Profile) => unwrap(api.PATCH("/api/gym/profile", { body })),
    onSuccess: store,
  });
}

export function useRenameGym() {
  const store = useStoreGym();
  return useMutation({
    mutationFn: (name: string) => unwrap(api.PATCH("/api/gym", { body: { name } })),
    onSuccess: store,
  });
}

export function useCompleteOnboarding() {
  const store = useStoreGym();
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/gym/onboarding/complete")),
    onSuccess: store,
  });
}

export type InviteResult =
  | { email: string; status: "sent"; url: string }
  | { email: string; status: "exists" }
  | { email: string; status: "failed"; error: string };

/**
 * Creates invites one by one. Emails that already have a pending invite are reused, so running
 * it again after a failure never creates duplicates.
 */
export async function sendTeamInvites(team: { email: string; role: Schemas["Role"] }[]): Promise<InviteResult[]> {
  const pending = await unwrap(api.GET("/api/invites"));
  const results: InviteResult[] = [];
  for (const member of team) {
    const email = member.email.toLowerCase();
    const existing = pending.find((i) => i.email.toLowerCase() === email);
    if (existing) {
      results.push({ email, status: "sent", url: existing.url });
      continue;
    }
    try {
      const inv = await unwrap(api.POST("/api/invites", { body: { email, role: member.role } }));
      results.push({ email, status: "sent", url: inv.url });
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) results.push({ email, status: "exists" });
      else results.push({ email, status: "failed", error: e instanceof Error ? e.message : "Could not create the invite" });
    }
  }
  return results;
}
