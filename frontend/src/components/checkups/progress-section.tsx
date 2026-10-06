"use client";

import {
  ArrowDownIcon,
  ArrowUpIcon,
  ImagePlusIcon,
  MinusIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  Trash2Icon,
} from "lucide-react";
import { useRef, useState } from "react";
import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { CheckupDialog } from "@/components/checkups/checkup-dialog";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  useDeleteCheckup,
  useDeletePhoto,
  useMemberCheckups,
  useUploadPhoto,
  type CheckUp,
} from "@/lib/checkup-queries";
import { daysBetween, formatDate, todayIso } from "@/lib/format";
import type { Member } from "@/lib/member-queries";
import { useCan, useMe } from "@/lib/queries";

type MetricKey =
  | "weight_kg"
  | "body_fat_pct"
  | "bmi"
  | "muscle_mass_kg"
  | "waist_cm"
  | "chest_cm"
  | "hips_cm"
  | "arm_cm"
  | "thigh_cm";

const METRICS: { key: MetricKey; label: string; unit: string; chart?: boolean }[] = [
  { key: "weight_kg", label: "Weight", unit: "kg", chart: true },
  { key: "body_fat_pct", label: "Body fat", unit: "%", chart: true },
  { key: "bmi", label: "BMI", unit: "" },
  { key: "muscle_mass_kg", label: "Muscle mass", unit: "kg", chart: true },
  { key: "waist_cm", label: "Waist", unit: "cm", chart: true },
  { key: "chest_cm", label: "Chest", unit: "cm" },
  { key: "hips_cm", label: "Hips", unit: "cm" },
  { key: "arm_cm", label: "Arm", unit: "cm" },
  { key: "thigh_cm", label: "Thigh", unit: "cm" },
];

const fmt = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

/** Latest value and the change since the first check-up that recorded this metric. */
function trend(checkups: CheckUp[], key: MetricKey) {
  const points = checkups.filter((c) => c[key] != null).sort((a, b) => a.recorded_on.localeCompare(b.recorded_on));
  if (!points.length) return null;
  const first = points[0];
  const last = points[points.length - 1];
  return {
    latest: last[key] as number,
    change: points.length > 1 ? (last[key] as number) - (first[key] as number) : null,
    since: first.recorded_on,
    points,
  };
}

function StatTile({ label, unit, t }: { label: string; unit: string; t: NonNullable<ReturnType<typeof trend>> }) {
  const Icon = t.change == null || Math.abs(t.change) < 0.05 ? MinusIcon : t.change > 0 ? ArrowUpIcon : ArrowDownIcon;
  return (
    <div className="p-4">
      <div className="mb-1 text-xs tracking-wide text-muted-foreground uppercase">{label}</div>
      <div className="text-2xl font-semibold tracking-tight tabular-nums">
        {fmt(t.latest)}
        {unit && <span className="ml-0.5 text-sm font-normal text-muted-foreground">{unit}</span>}
      </div>
      {t.change != null && (
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <Icon className="size-3" aria-hidden />
          <span>
            {t.change > 0 ? "+" : t.change < 0 ? "−" : ""}
            {fmt(Math.abs(t.change))}
            {unit} since {formatDate(t.since, { year: false })}
          </span>
        </div>
      )}
    </div>
  );
}

function MetricChart({ label, unit, t, metric }: { label: string; unit: string; t: NonNullable<ReturnType<typeof trend>>; metric: MetricKey }) {
  const config = { [metric]: { label, color: "var(--series-1)" } } satisfies ChartConfig;
  const data = t.points.map((c) => ({ date: c.recorded_on, [metric]: c[metric] }));
  const values = t.points.map((c) => c[metric] as number);
  const pad = Math.max((Math.max(...values) - Math.min(...values)) * 0.2, 1);

  return (
    <div className="grid gap-2">
      <div className="text-sm font-medium">
        {label} {unit && <span className="font-normal text-muted-foreground">({unit})</span>}
      </div>
      <ChartContainer config={config} className="aspect-auto h-40 w-full">
        <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
          <CartesianGrid vertical={false} strokeOpacity={0.5} />
          <XAxis
            dataKey="date"
            tickLine={false}
            axisLine={false}
            tickMargin={8}
            minTickGap={24}
            tickFormatter={(d: string) => formatDate(d, { year: false })}
          />
          <YAxis
            width={36}
            allowDecimals={false}
            tickCount={4}
            tickLine={false}
            axisLine={false}
            domain={[Math.floor(Math.min(...values) - pad), Math.ceil(Math.max(...values) + pad)]}
            tickFormatter={(v: number) => fmt(v)}
          />
          <ChartTooltip
            cursor={{ strokeDasharray: "3 3" }}
            content={
              <ChartTooltipContent
                labelFormatter={(_, payload) => formatDate(payload?.[0]?.payload?.date)}
                formatter={(value) => (
                  <span className="font-medium text-foreground tabular-nums">
                    {fmt(Number(value))} {unit}
                  </span>
                )}
                hideIndicator={false}
              />
            }
          />
          <Line
            dataKey={metric}
            type="monotone"
            stroke={`var(--color-${metric})`}
            strokeWidth={2}
            dot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: `var(--color-${metric})` }}
            activeDot={{ r: 6, strokeWidth: 2, stroke: "var(--card)" }}
            isAnimationActive={false}
          />
        </LineChart>
      </ChartContainer>
    </div>
  );
}

const COLUMNS: MetricKey[] = ["weight_kg", "body_fat_pct", "waist_cm"];

function CheckupRow({
  c,
  member,
  canEdit,
  onEdit,
  onDelete,
  onOpenPhoto,
}: {
  c: CheckUp;
  member: Member;
  canEdit: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onOpenPhoto: (url: string) => void;
}) {
  const upload = useUploadPhoto(member.id);
  const deletePhoto = useDeletePhoto(member.id);
  const other = METRICS.filter((m) => !COLUMNS.includes(m.key) && c[m.key] != null);
  // Lives outside the menu so it survives the menu closing while the picker is open.
  const fileInput = useRef<HTMLInputElement>(null);
  const value = (key: MetricKey) => {
    const m = METRICS.find((x) => x.key === key)!;
    return c[key] != null ? `${fmt(c[key] as number)}${m.unit === "%" ? "%" : ` ${m.unit}`}` : "—";
  };

  return (
    <TableRow className="align-top">
      <TableCell className="pl-4 whitespace-normal">
        <input
          ref={fileInput}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="sr-only"
          tabIndex={-1}
          aria-hidden
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) upload.mutate({ checkupId: c.id, file });
            e.target.value = "";
          }}
        />
        <div className="font-medium">{formatDate(c.recorded_on)}</div>
        {c.recorded_by && <div className="text-xs text-muted-foreground">by {c.recorded_by.name}</div>}
        {c.notes && <p className="mt-1 max-w-64 text-xs whitespace-pre-line text-muted-foreground">{c.notes}</p>}
      </TableCell>
      {COLUMNS.map((k) => (
        <TableCell key={k} className="text-right tabular-nums">
          {value(k)}
        </TableCell>
      ))}
      <TableCell className="hidden text-xs whitespace-normal text-muted-foreground lg:table-cell">
        {other.length
          ? other.map((m) => `${m.label} ${fmt(c[m.key] as number)}${m.unit}`).join(" · ")
          : "—"}
      </TableCell>
      <TableCell>
        {c.photos.length > 0 ? (
          <div className="flex gap-1">
            {c.photos.map((p) => (
              <div key={p.id} className="group relative">
                <button
                  type="button"
                  onClick={() => onOpenPhoto(p.url)}
                  className="block overflow-hidden rounded-md border"
                  aria-label="Open photo"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image */}
                  <img src={p.url} alt={`Progress photo, ${formatDate(c.recorded_on)}`} className="size-9 object-cover" loading="lazy" />
                </button>
                {canEdit && (
                  <button
                    type="button"
                    aria-label="Delete photo"
                    onClick={() => deletePhoto.mutate(p.id)}
                    className="absolute -top-1.5 -right-1.5 hidden rounded-full bg-background p-0.5 shadow ring-1 ring-border group-hover:block focus-visible:block"
                  >
                    <Trash2Icon className="size-3" />
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </TableCell>
      <TableCell className="pr-2">
        {canEdit && (
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Check-up actions" />}>
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-40">
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon />
                Edit
              </DropdownMenuItem>
              {c.photos.length < 4 && (
                <DropdownMenuItem onClick={() => fileInput.current?.click()}>
                  <ImagePlusIcon />
                  Add photo
                </DropdownMenuItem>
              )}
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TableCell>
    </TableRow>
  );
}

export function ProgressSection({ member }: { member: Member }) {
  const me = useMe();
  const can = useCan();
  const checkups = useMemberCheckups(member.id);
  const remove = useDeleteCheckup(member.id);
  const [editing, setEditing] = useState<CheckUp | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<CheckUp | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);

  const open = (c: CheckUp | null) => {
    setEditing(c);
    setDialogOpen(true);
  };
  const rows = checkups.data ?? [];
  const tiles = METRICS.slice(0, 4)
    .map((m) => ({ ...m, t: trend(rows, m.key) }))
    .filter((m) => m.t);
  const charts = METRICS.filter((m) => m.chart)
    .map((m) => ({ ...m, t: trend(rows, m.key) }))
    .filter((m) => (m.t?.points.length ?? 0) >= 2);
  const daysSince = member.last_checkup_on ? daysBetween(member.last_checkup_on, todayIso()) : null;
  const interval = me.data?.gym.checkup_interval_days ?? 7;
  const canEditRow = (c: CheckUp) => can.manage || c.recorded_by?.id === me.data?.user.id;

  return (
    <div className="grid gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {daysSince == null
            ? "No check-ups yet."
            : daysSince === 0
              ? "Last check-up today."
              : `Last check-up ${daysSince} day${daysSince === 1 ? "" : "s"} ago${daysSince >= interval ? " · due now" : ""}.`}
        </p>
        <Button size="sm" onClick={() => open(null)}>
          <PlusIcon />
          Log check-up
        </Button>
      </div>
        {checkups.isPending ? (
          <Skeleton className="h-40 w-full rounded-2xl" />
        ) : rows.length === 0 ? (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            Log a first check-up to start tracking weight, body fat and measurements.
          </p>
        ) : (
          <>
            {tiles.length > 0 && (
              <div className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border/70 bg-background sm:grid-cols-4 sm:divide-x sm:divide-border/70">
                {tiles.map((m) => (
                  <StatTile key={m.key} label={m.label} unit={m.unit} t={m.t!} />
                ))}
              </div>
            )}
            {charts.length > 0 && (
              <div className="grid gap-6 sm:grid-cols-2">
                {charts.map((m) => (
                  <MetricChart key={m.key} metric={m.key} label={m.label} unit={m.unit} t={m.t!} />
                ))}
              </div>
            )}
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Check-up</TableHead>
                    <TableHead className="text-right">Weight</TableHead>
                    <TableHead className="text-right">Body fat</TableHead>
                    <TableHead className="text-right">Waist</TableHead>
                    <TableHead className="hidden lg:table-cell">Other</TableHead>
                    <TableHead>Photos</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                {rows.map((c) => (
                  <CheckupRow
                    key={c.id}
                    c={c}
                    member={member}
                    canEdit={canEditRow(c)}
                    onEdit={() => open(c)}
                    onDelete={() => setDeleting(c)}
                    onOpenPhoto={setPhoto}
                  />
                ))}
                </TableBody>
              </Table>
            </div>
          </>
        )}

      <CheckupDialog
        memberId={member.id}
        memberName={member.name}
        memberHeightCm={member.height_cm}
        checkup={editing}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this check-up?"
        description={`The ${formatDate(deleting?.recorded_on)} check-up and its photos will be removed.`}
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
      <Dialog open={!!photo} onOpenChange={(o) => !o && setPhoto(null)}>
        <DialogContent className="sm:max-w-2xl">
          <DialogTitle className="sr-only">Progress photo</DialogTitle>
          {photo && (
            // eslint-disable-next-line @next/next/no-img-element -- private, auth-checked image
            <img src={photo} alt="Progress photo" className="max-h-[75svh] w-full rounded-lg object-contain" />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
