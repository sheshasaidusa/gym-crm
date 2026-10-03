import type { Schemas } from "@/lib/api/client";

export type DurationUnit = Schemas["DurationUnit"];
export type Status = Schemas["Status"];
export type Goal = Schemas["Goal"];
export type DietPref = Schemas["DietPref"];
export type ExperienceLevel = Schemas["ExperienceLevel"];
export type Gender = Schemas["Gender"];

export function formatMoney(amount: number, currency = "INR") {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, {
      style: "currency",
      currency,
      maximumFractionDigits: amount % 1 === 0 ? 0 : 2,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

/** Formats an ISO date (YYYY-MM-DD) without time zone shifts. */
export function formatDate(iso: string | null | undefined, opts?: { year?: boolean }) {
  if (!iso) return "—";
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    ...(opts?.year === false ? {} : { year: "numeric" }),
  });
}

/** Today as YYYY-MM-DD in the browser's local time. */
export function todayIso() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const UNIT_LABELS: Record<DurationUnit, [string, string]> = {
  day: ["day", "days"],
  week: ["week", "weeks"],
  month: ["month", "months"],
  year: ["year", "years"],
};

export function durationLabel(value: number, unit: DurationUnit) {
  if (unit === "month" && value === 3) return "Quarterly (3 months)";
  if (unit === "month" && value === 6) return "Half-yearly (6 months)";
  if (unit === "month" && value === 1) return "Monthly";
  if (unit === "year" && value === 1) return "Yearly";
  const [one, many] = UNIT_LABELS[unit];
  return `${value} ${value === 1 ? one : many}`;
}

export function shortDuration(value: number, unit: DurationUnit) {
  const [one, many] = UNIT_LABELS[unit];
  return `${value} ${value === 1 ? one : many}`;
}

export const STATUS_META: Record<
  Status,
  { label: string; className: string }
> = {
  active: {
    label: "Active",
    className: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  },
  expiring: {
    label: "Expiring soon",
    className: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  },
  frozen: { label: "Frozen", className: "bg-sky-500/15 text-sky-700 dark:text-sky-400" },
  upcoming: {
    label: "Upcoming",
    className: "bg-violet-500/15 text-violet-700 dark:text-violet-400",
  },
  expired: { label: "Expired", className: "bg-red-500/15 text-red-700 dark:text-red-400" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground line-through" },
  none: { label: "No plan", className: "bg-muted text-muted-foreground" },
};

export const GOAL_LABELS: Record<Goal, string> = {
  weight_loss: "Weight loss",
  muscle_gain: "Muscle gain",
  general_fitness: "General fitness",
  strength: "Strength",
  endurance: "Endurance",
  flexibility: "Flexibility",
  sports: "Sports performance",
  rehab: "Rehab / recovery",
};

export const DIET_LABELS: Record<DietPref, string> = {
  veg: "Vegetarian",
  non_veg: "Non-vegetarian",
  eggetarian: "Eggetarian",
  vegan: "Vegan",
};

export const EXPERIENCE_LABELS: Record<ExperienceLevel, string> = {
  beginner: "Beginner",
  intermediate: "Intermediate",
  advanced: "Advanced",
};

export const GENDER_LABELS: Record<Gender, string> = {
  male: "Male",
  female: "Female",
  other: "Other",
};

export function toOptions<T extends string>(labels: Record<T, string>) {
  return (Object.keys(labels) as T[]).map((value) => ({ value, label: labels[value] }));
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

export function ageFrom(dob: string | null | undefined) {
  if (!dob) return null;
  const [y, m, d] = dob.split("-").map(Number);
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < m || (now.getMonth() + 1 === m && now.getDate() < d)) age--;
  return age;
}

export function daysLeftLabel(daysLeft: number | null | undefined) {
  if (daysLeft == null) return null;
  if (daysLeft === 0) return "Ends today";
  if (daysLeft === 1) return "1 day left";
  return `${daysLeft} days left`;
}

// --- Date math (mirrors backend app/core/dates.py) ---------------------------

function parseIso(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function toIso(d: Date) {
  return d.toISOString().slice(0, 10);
}

export function addDays(iso: string, days: number) {
  const d = parseIso(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return toIso(d);
}

/** Inclusive last day of a membership; same rule as the API (preview only). */
export function membershipEnd(startIso: string, value: number, unit: DurationUnit) {
  if (unit === "day") return addDays(startIso, value - 1);
  if (unit === "week") return addDays(startIso, value * 7 - 1);
  const months = unit === "year" ? value * 12 : value;
  const start = parseIso(startIso);
  const total = start.getUTCMonth() + months;
  const year = start.getUTCFullYear() + Math.floor(total / 12);
  const month = ((total % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const clamped = start.getUTCDate() > lastDay;
  const target = toIso(new Date(Date.UTC(year, month, Math.min(start.getUTCDate(), lastDay))));
  return clamped ? target : addDays(target, -1);
}

export function daysBetween(fromIso: string, toIsoDate: string) {
  return Math.round((parseIso(toIsoDate).getTime() - parseIso(fromIso).getTime()) / 86_400_000);
}

export function membershipTotal(price: number, discount: number, joiningFee: number, taxPct: number) {
  const subtotal = Math.max(price - discount, 0) + joiningFee;
  return Math.round(subtotal * (1 + taxPct / 100) * 100) / 100;
}

/** "2026-10" -> "Oct", or "October 2026" when long. */
export function monthLabel(key: string, long = false) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-GB", {
    month: long ? "long" : "short",
    year: long ? "numeric" : undefined,
  });
}

/** Short money for chart axes: ₹1.2L, ₹45K. */
export function compactMoney(n: number, currency = "INR") {
  try {
    return new Intl.NumberFormat(currency === "INR" ? "en-IN" : undefined, {
      style: "currency",
      currency,
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(n);
  } catch {
    return String(n);
  }
}
