import type { Schemas } from "@/lib/api/client";

import type { Facility, Hours, Size, Speciality, TeamRole, Zone } from "./blueprint/types";

export const SIZES: { value: Size; label: string; hint: string }[] = [
  { value: "small", label: "Small", hint: "Up to 2,000 sq ft" },
  { value: "medium", label: "Medium", hint: "2,000–5,000 sq ft" },
  { value: "large", label: "Large", hint: "5,000+ sq ft" },
];
export const FLOORS = [1, 2, 3] as const;
export const ZONES: { value: Zone; label: string }[] = [
  { value: "cardio", label: "Cardio" },
  { value: "weights", label: "Free weights" },
  { value: "machines", label: "Machines" },
  { value: "functional", label: "Functional" },
  { value: "studio", label: "Yoga studio" },
];
export const FACILITIES: { value: Facility; label: string }[] = [
  { value: "lockers", label: "Lockers" },
  { value: "showers", label: "Showers" },
  { value: "parking", label: "Parking" },
];
export const HOURS: { value: Hours; label: string }[] = [
  { value: "standard", label: "6 am – 10 pm" },
  { value: "early", label: "5 am – 11 pm" },
  { value: "24_7", label: "Open 24/7" },
];
export const TEAM_ROLES: { value: TeamRole; label: string }[] = [
  { value: "trainer", label: "Trainer" },
  { value: "front_desk", label: "Front desk" },
  { value: "manager", label: "Manager" },
];
export const SPECIALITIES: { value: Speciality; label: string }[] = [
  { value: "weights", label: "Strength" },
  { value: "cardio", label: "Cardio" },
  { value: "machines", label: "Machines" },
  { value: "functional", label: "Functional" },
  { value: "studio", label: "Yoga" },
  { value: "general", label: "General" },
];

// The drawing's ids must stay in step with the API's. These fail to compile if they drift.
type Profile = Schemas["GymProfile"];
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const check = <T extends true>() => undefined as unknown as T;
check<Same<Size, NonNullable<Profile["size"]>>>();
check<Same<Zone, NonNullable<Profile["zones"]>[number]>>();
check<Same<Facility, NonNullable<Profile["facilities"]>[number]>>();
check<Same<Hours, NonNullable<Profile["hours"]>>>();
check<Same<Speciality, NonNullable<Schemas["TrainerDraft"]["speciality"]>>>();
check<Same<TeamRole, NonNullable<Schemas["TrainerDraft"]["role"]>>>();
