"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { SessionSummary, WorkoutProgressView } from "@/components/workouts/workout-progress";
import { useMemberWorkouts } from "@/lib/workout-queries";

/** Staff view of what a member logged in the app: progress, records and recent sessions. */
export function MemberWorkouts({ memberId }: { memberId: string }) {
  const workouts = useMemberWorkouts(memberId);
  if (workouts.isPending) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (workouts.isError) return <p className="text-sm text-destructive">{workouts.error.message}</p>;

  const { sessions, progress } = workouts.data;
  if (sessions.length === 0) {
    return (
      <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
        Nothing logged yet. Members log workouts in their app once you send them the link.
      </p>
    );
  }
  return (
    <div className="grid gap-5 rounded-2xl border border-border/70 p-5">
      <WorkoutProgressView progress={progress} />
      <ul className="divide-y rounded-lg border">
        {sessions.slice(0, 10).map((s) => (
          <li key={s.id} className="p-3">
            <SessionSummary session={s} />
          </li>
        ))}
      </ul>
    </div>
  );
}
