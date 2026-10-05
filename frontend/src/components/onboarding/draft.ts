import type { Profile } from "@/lib/onboarding-queries";

import type { BlueprintInput, Facility, Hours, Size, Speciality, TeamRole, Zone } from "./blueprint/types";

export type TeamMember = { name: string; email: string; role: TeamRole; speciality: Speciality };

/** Everything the owner has answered so far. The password never lives here. */
export type Draft = {
  gymName: string;
  city: string;
  size: Size | null;
  floors: 1 | 2 | 3 | null;
  staff: number | null;
  zones: Zone[];
  facilities: Facility[];
  hours: Hours | null;
  team: TeamMember[];
  skipped: (2 | 3 | 4)[];
};

export const STEPS = ["account", "space", "equipment", "team", "done"] as const;
export type StepName = (typeof STEPS)[number];
export const stepNumber = (s: StepName) => STEPS.indexOf(s) + 1;
export const STEP_LABELS: Record<Exclude<StepName, "done">, string> = {
  account: "Account",
  space: "Space",
  equipment: "Equipment",
  team: "Team",
};

export const emptyDraft = (gymName = ""): Draft => ({
  gymName,
  city: "",
  size: null,
  floors: null,
  staff: null,
  zones: [],
  facilities: [],
  hours: null,
  team: [],
  skipped: [],
});

export function draftFromProfile(gymName: string, p: Profile | null | undefined): Draft {
  if (!p) return emptyDraft(gymName);
  return {
    gymName,
    city: p.city ?? "",
    size: p.size ?? null,
    floors: (p.floors as Draft["floors"]) ?? null,
    staff: p.staff_count ?? null,
    zones: p.zones ?? [],
    facilities: p.facilities ?? [],
    hours: p.hours ?? null,
    team: (p.trainers ?? []).map((t) => ({
      name: t.name,
      email: t.email,
      role: t.role ?? "trainer",
      speciality: t.speciality ?? "general",
    })),
    skipped: (p.skipped_steps ?? []) as Draft["skipped"],
  };
}

export function profileFromDraft(d: Draft): Profile {
  return {
    city: d.city.trim() || null,
    size: d.size,
    floors: d.floors,
    staff_count: d.staff,
    zones: d.zones,
    facilities: d.facilities,
    hours: d.hours,
    trainers: d.team,
    skipped_steps: d.skipped,
  };
}

export function blueprintInput(d: Draft): BlueprintInput {
  return {
    gymName: d.gymName,
    city: d.city,
    size: d.size,
    floors: d.floors,
    staff: d.staff,
    zones: d.zones,
    facilities: d.facilities,
    hours: d.hours,
    trainers: d.team.map((t) => ({ name: t.name, speciality: t.speciality, role: t.role })),
  };
}
