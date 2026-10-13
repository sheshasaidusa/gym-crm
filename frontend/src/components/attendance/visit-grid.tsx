"use client";

import { addDays, todayIso } from "@/lib/format";
import { cn } from "@/lib/utils";

const WEEKS = 12;

/**
 * The last 12 weeks as a grid, one column per week (Monday on top), a filled square for each
 * day the member came in. Shared by the staff member page and the member app.
 */
export function VisitGrid({ dates, className }: { dates: string[]; className?: string }) {
  const visited = new Set(dates);
  const today = todayIso();
  // Monday of the current week, then step back WEEKS - 1 weeks.
  const weekday = (new Date(`${today}T00:00:00`).getDay() + 6) % 7;
  const start = addDays(today, -weekday - (WEEKS - 1) * 7);

  const columns = Array.from({ length: WEEKS }, (_, w) =>
    Array.from({ length: 7 }, (_, d) => addDays(start, w * 7 + d)),
  );

  return (
    <div className={cn("flex gap-1", className)} role="img" aria-label={`${dates.length} visits in the last 12 weeks`}>
      {columns.map((week, i) => (
        <div key={i} className="grid flex-1 gap-1">
          {week.map((day) => (
            <span
              key={day}
              title={day}
              className={cn(
                "aspect-square rounded-[3px]",
                day > today ? "bg-transparent" : visited.has(day) ? "bg-primary" : "bg-muted",
              )}
            />
          ))}
        </div>
      ))}
    </div>
  );
}
