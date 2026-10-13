"use client";

import { VisitGrid } from "@/components/attendance/visit-grid";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemberAttendance } from "@/lib/attendance-queries";
import { daysBetween, formatDate, todayIso } from "@/lib/format";

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-2xl font-medium tabular-nums">{value}</dd>
    </div>
  );
}

/** Staff view of one member's visits: the last 12 weeks, how often, and how long since. */
export function MemberAttendance({ memberId }: { memberId: string }) {
  const visits = useMemberAttendance(memberId);
  if (visits.isPending) return <Skeleton className="h-40 w-full rounded-xl" />;
  if (visits.isError) return <p className="text-sm text-destructive">{visits.error.message}</p>;

  const v = visits.data;
  const since = v.last_visit ? daysBetween(v.last_visit, todayIso()) : null;
  return (
    <div className="grid gap-5 rounded-2xl border border-border/70 p-5">
      <dl className="grid grid-cols-3 gap-4">
        <Stat label="Visits, last 30 days" value={String(v.visits_30d)} />
        <Stat label="Week streak" value={v.streak_weeks ? `${v.streak_weeks} wk` : "0"} />
        <Stat
          label="Last visit"
          value={since == null ? "Never" : since === 0 ? "Today" : since === 1 ? "Yesterday" : `${since} days ago`}
        />
      </dl>
      <VisitGrid dates={v.dates} />
      <p className="text-xs text-muted-foreground">
        {v.last_visit ? `Last came on ${formatDate(v.last_visit)}. ` : ""}Each square is a day, newest week on the right.
      </p>
    </div>
  );
}
