"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { WeightChart } from "@/components/weight-chart";
import { formatDate } from "@/lib/format";
import { useMemberCheckups, useMemberMe, type MemberCheckUp } from "@/lib/member-app-queries";

function Tile({ value, label }: { value: string; label: string }) {
  return (
    <div className="rounded-lg border p-2 text-center">
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

const MEASURES: { key: keyof MemberCheckUp; label: string; unit: string }[] = [
  { key: "weight_kg", label: "Weight", unit: "kg" },
  { key: "body_fat_pct", label: "Body fat", unit: "%" },
  { key: "muscle_mass_kg", label: "Muscle", unit: "kg" },
  { key: "bmi", label: "BMI", unit: "" },
  { key: "waist_cm", label: "Waist", unit: "cm" },
  { key: "chest_cm", label: "Chest", unit: "cm" },
  { key: "hips_cm", label: "Hips", unit: "cm" },
  { key: "arm_cm", label: "Arm", unit: "cm" },
  { key: "thigh_cm", label: "Thigh", unit: "cm" },
];

function CheckUpCard({ c }: { c: MemberCheckUp }) {
  const shown = MEASURES.filter((m) => c[m.key] != null);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-base">{formatDate(c.recorded_on)}</CardTitle>
      </CardHeader>
      <CardContent className="grid gap-3">
        <dl className="grid grid-cols-3 gap-2 text-sm">
          {shown.map((m) => (
            <div key={m.key}>
              <dt className="text-xs text-muted-foreground">{m.label}</dt>
              <dd className="tabular-nums">
                {String(c[m.key])}
                {m.unit && ` ${m.unit}`}
              </dd>
            </div>
          ))}
        </dl>
        {c.notes && <p className="text-sm text-muted-foreground">{c.notes}</p>}
        {c.photos.length > 0 && (
          <div className="flex gap-2 overflow-x-auto">
            {c.photos.map((url) => (
              <a key={url} href={url} target="_blank" rel="noreferrer" className="shrink-0">
                {/* eslint-disable-next-line @next/next/no-img-element -- authenticated same-origin photo */}
                <img src={url} alt="Check-up photo" className="size-20 rounded-lg border object-cover" />
              </a>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function MemberProgressPage() {
  const me = useMemberMe();
  const history = useMemberCheckups();
  if (me.isPending || history.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (me.isError || history.isError) {
    return <p className="text-sm text-destructive">{(me.error ?? history.error)?.message}</p>;
  }

  const p = me.data.progress;
  const change = p?.weight_change_kg;
  return (
    <div className="grid gap-4">
      {p ? (
        <Card>
          <CardHeader>
            <CardTitle>Your progress</CardTitle>
            <CardDescription>
              {p.checkups} check-up{p.checkups === 1 ? "" : "s"} since {formatDate(p.first_date)}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="grid grid-cols-3 gap-2">
              {p.weight_kg != null && (
                <Tile
                  value={`${p.weight_kg} kg`}
                  label={change != null ? `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)} kg` : "Weight"}
                />
              )}
              {p.body_fat_pct != null && <Tile value={`${p.body_fat_pct}%`} label="Body fat" />}
              {p.waist_cm != null && <Tile value={`${p.waist_cm} cm`} label="Waist" />}
            </div>
            {p.weight_series.length >= 2 && (
              <div>
                <div className="mb-1 text-sm font-medium">
                  Weight <span className="font-normal text-muted-foreground">(kg)</span>
                </div>
                <WeightChart points={p.weight_series} />
              </div>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>No check-ups yet</CardTitle>
            <CardDescription>
              Ask your trainer for a check-up. Your measurements and photos will show up here.
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {history.data.length > 0 && (
        <section className="grid gap-3">
          <h2 className="text-sm font-medium text-muted-foreground">History</h2>
          {history.data.map((c) => (
            <CheckUpCard key={c.id} c={c} />
          ))}
        </section>
      )}
    </div>
  );
}
