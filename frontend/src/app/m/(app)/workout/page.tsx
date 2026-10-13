"use client";

import { PlusIcon, Trash2Icon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { toast } from "sonner";

import { SimpleSelect } from "@/components/simple-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  useLogWorkout,
  useMyWorkouts,
  useWorkoutTemplate,
  type WorkoutProgress,
} from "@/lib/workout-queries";

type SetRow = { reps: string; weight: string };
type EntryRow = { exercise: string; from_plan: boolean; target?: string | null; notes?: string | null; sets: SetRow[] };

const toRows = (sets: { reps: number; weight_kg?: number | null }[]): SetRow[] =>
  sets.map((s) => ({ reps: s.reps ? String(s.reps) : "", weight: s.weight_kg ? String(s.weight_kg) : "" }));

/** Heaviest weight per exercise from before this session, to spot a new personal record. */
function recordsBefore(progress: WorkoutProgress | undefined) {
  return new Map((progress?.records ?? []).map((r) => [r.exercise.toLowerCase(), r.weight_kg ?? 0]));
}

export default function WorkoutLogPage() {
  const router = useRouter();
  const history = useMyWorkouts();
  const [day, setDay] = useState<string | undefined>(undefined);
  const template = useWorkoutTemplate(day);
  const log = useLogWorkout();

  const [entries, setEntries] = useState<EntryRow[]>([]);
  const [dayLabel, setDayLabel] = useState<string | null>(null);
  const [duration, setDuration] = useState("");
  const [notes, setNotes] = useState("");
  const [seeded, setSeeded] = useState<string | null>(null);

  // Fill the form from the plan day once, and again whenever they pick another day.
  const t = template.data;
  const seedKey = t ? `${t.plan_id}:${t.day_label}` : null;
  useEffect(() => {
    if (!t || seedKey === seeded) return;
    setSeeded(seedKey);
    setDayLabel(t.day_label);
    setEntries(t.entries.map((e) => ({ ...e, sets: toRows(e.sets) })));
  }, [t, seedKey, seeded]);

  const patch = (i: number, fn: (e: EntryRow) => EntryRow) =>
    setEntries((all) => all.map((e, k) => (k === i ? fn(e) : e)));

  function save() {
    const body = entries
      .map((e) => ({
        exercise: e.exercise.trim(),
        from_plan: e.from_plan,
        sets: e.sets
          .filter((s) => s.reps !== "" && Number(s.reps) >= 0)
          .map((s) => ({ reps: Math.round(Number(s.reps)), weight_kg: s.weight === "" ? null : Number(s.weight) })),
      }))
      .filter((e) => e.exercise && e.sets.length > 0);
    if (body.length === 0) {
      toast.error("Add the reps for at least one set.");
      return;
    }
    const before = recordsBefore(history.data?.progress);
    const records = body.filter((e) => {
      const best = Math.max(...e.sets.map((s) => s.weight_kg ?? 0));
      return best > 0 && best > (before.get(e.exercise.toLowerCase()) ?? 0);
    });
    log.mutate(
      {
        day_label: dayLabel,
        duration_min: duration === "" ? null : Math.round(Number(duration)),
        notes: notes.trim() || null,
        entries: body,
      },
      {
        onSuccess: () => {
          // A first-ever lift isn't much of a "record"; celebrate only when there was something to beat.
          const beaten = records.filter((e) => before.has(e.exercise.toLowerCase()));
          toast.success(
            beaten.length
              ? `New personal record: ${beaten[0].exercise} ${Math.max(...beaten[0].sets.map((s) => s.weight_kg ?? 0))} kg 🎉`
              : "Workout saved. Nice work!",
          );
          router.push("/m/progress");
        },
      },
    );
  }

  if (template.isPending || history.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (template.isError) return <p className="text-sm text-destructive">{template.error.message}</p>;

  return (
    <div className="grid gap-4">
      <div>
        <h1 className="text-xl font-semibold">Log a workout</h1>
        <p className="text-sm text-muted-foreground">
          {t?.days.length ? "Today's exercises are filled in from your plan. Add what you lifted." : "Add the exercises you did."}
        </p>
      </div>

      {t && t.days.length > 1 && (
        <SimpleSelect
          options={t.days.map((d) => ({ value: d, label: d }))}
          value={dayLabel ?? t.days[0]}
          onChange={(d) => setDay(d)}
        />
      )}

      {entries.map((e, i) => (
        <Card key={i} size="sm">
          <CardHeader>
            {e.from_plan ? (
              <>
                <CardTitle className="text-base">{e.exercise}</CardTitle>
                {e.target && <CardDescription>{e.target}</CardDescription>}
              </>
            ) : (
              <Input
                aria-label="Exercise name"
                placeholder="Exercise"
                value={e.exercise}
                onChange={(ev) => patch(i, (x) => ({ ...x, exercise: ev.target.value }))}
              />
            )}
          </CardHeader>
          <CardContent className="grid gap-2">
            <div className="grid grid-cols-[2rem_1fr_1fr_2rem] items-center gap-2 text-xs text-muted-foreground">
              <span>Set</span>
              <span>Reps</span>
              <span>kg</span>
              <span />
            </div>
            {e.sets.map((s, k) => (
              <div key={k} className="grid grid-cols-[2rem_1fr_1fr_2rem] items-center gap-2">
                <span className="text-sm text-muted-foreground tabular-nums">{k + 1}</span>
                <Input
                  aria-label={`Set ${k + 1} reps`}
                  inputMode="numeric"
                  value={s.reps}
                  onChange={(ev) =>
                    patch(i, (x) => ({
                      ...x,
                      sets: x.sets.map((r, j) => (j === k ? { ...r, reps: ev.target.value.replace(/\D/g, "") } : r)),
                    }))
                  }
                />
                <Input
                  aria-label={`Set ${k + 1} weight in kilograms`}
                  inputMode="decimal"
                  placeholder="Body"
                  value={s.weight}
                  onChange={(ev) =>
                    patch(i, (x) => ({
                      ...x,
                      sets: x.sets.map((r, j) => (j === k ? { ...r, weight: ev.target.value.replace(/[^\d.]/g, "") } : r)),
                    }))
                  }
                />
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Remove set ${k + 1}`}
                  disabled={e.sets.length === 1}
                  onClick={() => patch(i, (x) => ({ ...x, sets: x.sets.filter((_, j) => j !== k) }))}
                >
                  <Trash2Icon />
                </Button>
              </div>
            ))}
            <div className="flex justify-between pt-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={() =>
                  patch(i, (x) => ({ ...x, sets: [...x.sets, { reps: x.sets.at(-1)?.reps ?? "", weight: x.sets.at(-1)?.weight ?? "" }] }))
                }
              >
                <PlusIcon />
                Add set
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setEntries((all) => all.filter((_, k) => k !== i))}>
                Remove exercise
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Button
        variant="outline"
        onClick={() => setEntries((all) => [...all, { exercise: "", from_plan: false, sets: [{ reps: "", weight: "" }] }])}
      >
        <PlusIcon />
        Add an exercise
      </Button>

      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <Input
          aria-label="Minutes"
          inputMode="numeric"
          placeholder="Minutes"
          value={duration}
          onChange={(ev) => setDuration(ev.target.value.replace(/\D/g, ""))}
        />
        <Textarea
          aria-label="Notes"
          placeholder="How did it feel? (optional)"
          rows={1}
          maxLength={500}
          value={notes}
          onChange={(ev) => setNotes(ev.target.value)}
        />
      </div>

      <Button size="lg" onClick={save} disabled={log.isPending}>
        {log.isPending && <Spinner />}
        Save workout
      </Button>
    </div>
  );
}
