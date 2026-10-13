"use client";

import { TrophyIcon } from "lucide-react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatDate } from "@/lib/format";
import type { WorkoutOut, WorkoutProgress } from "@/lib/workout-queries";

const config = { volume: { label: "Volume", color: "var(--series-1)" } } satisfies ChartConfig;

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border p-2 text-center">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

/** Sessions, streak, weekly volume and personal records. Used in the member app and on the staff member page. */
export function WorkoutProgressView({ progress }: { progress: WorkoutProgress }) {
  const data = progress.weeks.map((w) => ({ week: w.week_start, volume: Math.round(w.volume_kg), sessions: w.sessions }));
  const hasVolume = data.some((d) => d.volume > 0);

  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Workouts" value={String(progress.sessions_total)} />
        <Stat label="Last 30 days" value={String(progress.sessions_30d)} />
        <Stat label="Week streak" value={String(progress.streak_weeks)} />
      </div>

      {hasVolume && (
        <div>
          <div className="mb-1 text-sm font-medium">
            Weekly volume <span className="font-normal text-muted-foreground">(kg lifted: reps × weight)</span>
          </div>
          <ChartContainer config={config} className="aspect-auto h-36 w-full">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
              <CartesianGrid vertical={false} strokeOpacity={0.5} />
              <XAxis
                dataKey="week"
                tickLine={false}
                axisLine={false}
                tickMargin={8}
                minTickGap={20}
                tickFormatter={(d: string) => formatDate(d, { year: false })}
              />
              <YAxis width={40} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip
                cursor={{ fillOpacity: 0.3 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => `Week of ${formatDate(p?.[0]?.payload?.week)}`}
                    formatter={(v) => <span className="font-medium tabular-nums">{Number(v).toLocaleString()} kg</span>}
                  />
                }
              />
              <Bar dataKey="volume" fill="var(--color-volume)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </div>
      )}

      {progress.records.length > 0 && (
        <div>
          <div className="mb-2 flex items-center gap-2 text-sm font-medium">
            <TrophyIcon className="size-4 text-amber-500" aria-hidden />
            Personal records
          </div>
          <ul className="divide-y rounded-lg border text-sm">
            {progress.records.map((r) => (
              <li key={r.exercise} className="flex items-center justify-between gap-3 px-3 py-2">
                <span className="min-w-0 flex-1 truncate">{r.exercise}</span>
                <span className="shrink-0 font-medium tabular-nums">
                  {r.weight_kg != null ? `${r.weight_kg} kg × ${r.reps}` : `${r.reps} reps`}
                </span>
                <span className="w-14 shrink-0 text-right text-xs text-muted-foreground">
                  {formatDate(r.performed_on, { year: false })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/** Recent sessions as plain rows (read-only; the member app adds a delete button around it). */
export function SessionSummary({ session }: { session: WorkoutOut }) {
  const sets = session.entries.reduce((n, e) => n + e.sets.length, 0);
  return (
    <div className="grid gap-1 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-medium">{session.day_label ?? "Workout"}</span>
        <span className="text-xs text-muted-foreground">{formatDate(session.performed_on)}</span>
      </div>
      <div className="text-xs text-muted-foreground">
        {session.entries.length} exercise{session.entries.length === 1 ? "" : "s"} · {sets} sets
        {session.volume_kg > 0 && ` · ${Math.round(session.volume_kg).toLocaleString()} kg`}
        {session.duration_min != null && ` · ${session.duration_min} min`}
      </div>
      <div className="truncate text-xs text-muted-foreground">{session.entries.map((e) => e.exercise).join(", ")}</div>
    </div>
  );
}
