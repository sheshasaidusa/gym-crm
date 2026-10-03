"use client";

import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

/** "2026-10-02T10:00" (local, for datetime-local inputs) from an ISO timestamp. */
export function toLocalInput(iso: string | null | undefined) {
  if (!iso) return "";
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** ISO timestamp from a datetime-local value (interpreted in the browser's time zone). */
export function fromLocalInput(value: string) {
  return value ? new Date(value).toISOString() : null;
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export function followUpState(iso: string | null | undefined): "overdue" | "today" | "later" | null {
  if (!iso) return null;
  const at = new Date(iso);
  const today = startOfDay(new Date());
  const tomorrow = new Date(today.getTime() + 86_400_000);
  if (at.getTime() < Date.now()) return "overdue";
  if (at < tomorrow) return "today";
  return "later";
}

export function followUpLabel(iso: string | null | undefined) {
  if (!iso) return null;
  const at = new Date(iso);
  const time = at.toLocaleTimeString("en-GB", { hour: "numeric", minute: "2-digit" });
  const state = followUpState(iso);
  const days = Math.round((startOfDay(new Date()).getTime() - startOfDay(at).getTime()) / 86_400_000);
  if (state === "overdue") {
    if (days === 0) return `Overdue · ${time}`;
    return days === 1 ? "Overdue · yesterday" : `Overdue · ${days} days`;
  }
  if (state === "today") return `Today ${time}`;
  if (days === -1) return `Tomorrow ${time}`;
  return at.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

export function FollowUpBadge({ iso, className }: { iso: string | null | undefined; className?: string }) {
  const state = followUpState(iso);
  if (!state) return null;
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs whitespace-nowrap",
        state === "overdue" && "bg-red-500/15 text-red-700 dark:text-red-400",
        state === "today" && "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        state === "later" && "bg-muted text-muted-foreground",
        className,
      )}
    >
      {followUpLabel(iso)}
    </span>
  );
}

function at(daysFromToday: number, hour: number) {
  const d = new Date();
  d.setDate(d.getDate() + daysFromToday);
  d.setHours(hour, 0, 0, 0);
  return toLocalInput(d.toISOString());
}

/** datetime-local input with quick presets. Value is the local input string. */
export function FollowUpPicker({
  value,
  onChange,
  id,
}: {
  value: string;
  onChange: (v: string) => void;
  id?: string;
}) {
  const presets = [
    { label: "In 2 hours", value: toLocalInput(new Date(Date.now() + 2 * 3600_000).toISOString()) },
    { label: "Tomorrow 10am", value: at(1, 10) },
    { label: "In 3 days", value: at(3, 10) },
    { label: "Next week", value: at(7, 10) },
  ];
  return (
    <div className="grid gap-2">
      <Input id={id} type="datetime-local" value={value} onChange={(e) => onChange(e.target.value)} />
      <div className="flex flex-wrap gap-1">
        {presets.map((p) => (
          <button
            key={p.label}
            type="button"
            onClick={() => onChange(p.value)}
            className="rounded-md border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            {p.label}
          </button>
        ))}
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            className="rounded-md px-1.5 py-0.5 text-xs text-muted-foreground hover:text-foreground"
          >
            Clear
          </button>
        )}
      </div>
    </div>
  );
}
