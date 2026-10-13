"use client";

import { ArrowLeftIcon, CalendarClockIcon, CheckIcon, MessageCircleIcon, PhoneIcon, XIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { SimpleSelect } from "@/components/simple-select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Calendar, CalendarDayButton } from "@/components/ui/calendar";
import { Skeleton } from "@/components/ui/skeleton";
import { initials } from "@/lib/format";
import { SOURCE_LABELS, useLeads, useMoveLead, type Lead } from "@/lib/lead-queries";
import { useStaff } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { whatsappUrl } from "@/lib/whatsapp";

type Range = "today" | "week" | "all";
const ANYONE = "any";
const UNASSIGNED = "none";

const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const dayKey = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

function dayHeading(d: Date, today: Date) {
  const diff = Math.round((startOfDay(d).getTime() - today.getTime()) / 86_400_000);
  const date = d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
  if (diff === 0) return `Today · ${date}`;
  if (diff === 1) return `Tomorrow · ${date}`;
  return date;
}

const time = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

function TrialRow({ lead, missed }: { lead: Lead; missed?: boolean }) {
  const move = useMoveLead();
  const at = new Date(lead.trial_at!);
  return (
    <li className="grid grid-cols-[72px_minmax(0,1fr)] items-center gap-x-4 gap-y-2 py-3 md:grid-cols-[88px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,0.9fr)_auto]">
      <div className={cn("tabular-nums", missed ? "text-red-600 dark:text-red-400" : "font-medium")}>
        {missed ? at.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : time(at)}
        {missed && <div className="text-xs">{time(at)}</div>}
      </div>
      <Link href={`/leads?lead=${lead.id}`} className="min-w-0 hover:underline">
        <div className="truncate font-medium" title={lead.name}>
          {lead.name}
        </div>
        <div className="flex items-center gap-1 text-xs text-muted-foreground">
          <PhoneIcon className="size-3" />
          {lead.phone}
          <span aria-hidden>·</span>
          {SOURCE_LABELS[lead.source]}
        </div>
      </Link>
      <p className="col-start-2 truncate text-sm text-muted-foreground md:col-start-auto" title={lead.interest ?? undefined}>
        {lead.interest ?? "—"}
      </p>
      <div className="col-start-2 flex min-w-0 items-center gap-2 text-sm md:col-start-auto">
        {lead.assigned_to ? (
          <>
            <Avatar className="size-5 shrink-0">
              <AvatarFallback className="text-[9px]">{initials(lead.assigned_to.name)}</AvatarFallback>
            </Avatar>
            <span className="truncate">{lead.assigned_to.name}</span>
          </>
        ) : (
          <span className="text-muted-foreground">Unassigned</span>
        )}
      </div>
      <div className="col-start-2 flex gap-1.5 md:col-start-auto md:justify-end">
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`WhatsApp ${lead.name}`}
          nativeButton={false}
          render={
            <a
              href={whatsappUrl(lead.phone, `Hi ${lead.name.split(" ")[0]}, reminder about your trial session at ${time(at)}.`)}
              target="_blank"
              rel="noreferrer"
            />
          }
        >
          <MessageCircleIcon />
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={move.isPending}
          onClick={() => move.mutate({ id: lead.id, stage: "trial_done" })}
        >
          <CheckIcon />
          Mark done
        </Button>
      </div>
    </li>
  );
}

/** Month grid with the number of booked trials on each day; picking a day filters the list. */
function TrialCalendar({
  counts,
  selected,
  onSelect,
}: {
  counts: Map<string, number>;
  selected: Date | undefined;
  onSelect: (d: Date | undefined) => void;
}) {
  const [month, setMonth] = useState(new Date());
  const inMonth = [...counts.entries()].reduce((sum, [k, n]) => {
    const [y, m] = k.split("-").map(Number);
    return y === month.getFullYear() && m === month.getMonth() ? sum + n : sum;
  }, 0);

  return (
    <div className="rounded-2xl border border-border/70 bg-background p-3">
      <Calendar
        mode="single"
        month={month}
        onMonthChange={setMonth}
        selected={selected}
        onSelect={(d) => onSelect(d && selected && dayKey(d) === dayKey(selected) ? undefined : d)}
        showOutsideDays={false}
        className="w-full p-0 [--cell-size:--spacing(10)]"
        classNames={{ root: "w-full" }}
        components={{
          DayButton: (p) => {
            const n = counts.get(dayKey(p.day.date)) ?? 0;
            return (
              <CalendarDayButton {...p}>
                {p.children}
                {n > 0 && (
                  <span
                    role="img"
                    aria-label={`${n} trial${n === 1 ? "" : "s"}`}
                    title={`${n} trial${n === 1 ? "" : "s"}`}
                    className={cn(
                      "absolute bottom-1.5 left-1/2 size-1.5 -translate-x-1/2 rounded-full",
                      p.modifiers.selected ? "bg-primary-foreground" : "bg-primary",
                    )}
                  />
                )}
              </CalendarDayButton>
            );
          },
        }}
      />
      <p className="mt-3 border-t border-border/70 pt-3 text-center text-xs text-muted-foreground">
        {inMonth === 0
          ? `No trials booked in ${month.toLocaleDateString("en-GB", { month: "long" })}`
          : `${inMonth} trial${inMonth === 1 ? "" : "s"} booked in ${month.toLocaleDateString("en-GB", { month: "long" })}`}
      </p>
    </div>
  );
}

export default function TrialsPage() {
  const leads = useLeads({});
  const staff = useStaff();
  const [range, setRange] = useState<Range>("week");
  const [taker, setTaker] = useState(ANYONE);
  const [day, setDay] = useState<Date | undefined>(undefined);

  const now = new Date();
  const today = startOfDay(now);
  const end = range === "today" ? addDays(today, 1) : range === "week" ? addDays(today, 7) : null;

  const booked = (leads.data ?? [])
    .filter((l) => l.stage === "trial_booked" && l.trial_at)
    .filter((l) =>
      taker === ANYONE ? true : taker === UNASSIGNED ? !l.assigned_to : l.assigned_to?.id === taker,
    )
    .sort((a, b) => a.trial_at!.localeCompare(b.trial_at!));
  // Booked but the time has passed: someone needs to mark it done or reschedule.
  // Trials per day (for the calendar), whoever is taking them is respected but not the range.
  const counts = new Map<string, number>();
  for (const l of booked) {
    const k = dayKey(new Date(l.trial_at!));
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  const missed = day ? [] : booked.filter((l) => new Date(l.trial_at!) < today);
  const upcoming = day
    ? booked.filter((l) => dayKey(new Date(l.trial_at!)) === dayKey(day))
    : booked.filter((l) => {
        const t = new Date(l.trial_at!);
        return t >= today && (!end || t < end);
      });

  const groups = new Map<string, { date: Date; items: Lead[] }>();
  for (const l of upcoming) {
    const d = new Date(l.trial_at!);
    const k = dayKey(d);
    if (!groups.has(k)) groups.set(k, { date: d, items: [] });
    groups.get(k)!.items.push(l);
  }

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="-ml-2 w-fit text-muted-foreground"
        nativeButton={false}
        render={<Link href="/leads" />}
      >
        <ArrowLeftIcon />
        Leads
      </Button>
      <PageHeader
        title="Scheduled trials"
        description={
          leads.data
            ? `${upcoming.length} trial${upcoming.length === 1 ? "" : "s"} ${
                day ? `on ${dayHeading(day, today)}` : range === "today" ? "today" : range === "week" ? "in the next 7 days" : "coming up"
              }${missed.length ? ` · ${missed.length} past and not updated` : ""}`
            : "Trial sessions booked from leads."
        }
      >
        <div className="flex h-9 items-center rounded-full bg-foreground/[0.06] p-1 dark:bg-muted">
          {(
            [
              { value: "today", label: "Today" },
              { value: "week", label: "This week" },
              { value: "all", label: "All" },
            ] as const
          ).map((o) => (
            <button
              key={o.value}
              type="button"
              aria-pressed={!day && range === o.value}
              onClick={() => {
                setRange(o.value);
                setDay(undefined);
              }}
              className={cn(
                "h-full rounded-full px-3 text-sm font-medium transition-colors",
                !day && range === o.value
                  ? "bg-white text-foreground shadow-raised-control dark:bg-input/30 dark:shadow-none"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {o.label}
            </button>
          ))}
        </div>
        <SimpleSelect
          id="trial-taker"
          className="w-44"
          value={taker}
          onChange={setTaker}
          options={[
            { value: ANYONE, label: "Anyone taking it" },
            { value: UNASSIGNED, label: "Unassigned" },
            ...(staff.data ?? []).map((s) => ({ value: s.user_id, label: s.name })),
          ]}
        />
      </PageHeader>

      {leads.isPending ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <div className="grid items-start gap-8 lg:grid-cols-[340px_minmax(0,1fr)]">
        <div className="lg:sticky lg:top-20">
          <TrialCalendar counts={counts} selected={day} onSelect={setDay} />
        </div>
        <div className="grid gap-8">
          {day && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-muted-foreground">Showing</span>
              <button
                type="button"
                onClick={() => setDay(undefined)}
                className="inline-flex h-7 items-center gap-1.5 rounded-full border px-3 hover:bg-muted"
              >
                {dayHeading(day, today)}
                <XIcon className="size-3.5 text-muted-foreground" />
              </button>
            </div>
          )}
          {missed.length > 0 && (
            <section>
              <h2 className="mb-1 flex items-center gap-2 text-sm font-medium text-red-600 dark:text-red-400">
                Past, not updated
                <span className="rounded-full bg-red-500/10 px-1.5 text-xs tabular-nums">{missed.length}</span>
              </h2>
              <p className="mb-2 text-xs text-muted-foreground">Mark them done, or open the lead to reschedule or close it.</p>
              <ul className="divide-y divide-border/70 border-y border-border/70">
                {missed.map((l) => (
                  <TrialRow key={l.id} lead={l} missed />
                ))}
              </ul>
            </section>
          )}

          {groups.size === 0 ? (
            <div className="grid justify-items-center gap-2 rounded-2xl border border-dashed p-10 text-center">
              <CalendarClockIcon className="size-6 text-muted-foreground" />
              <p className="font-medium">
                No trials {day ? `on ${dayHeading(day, today)}` : range === "today" ? "today" : range === "week" ? "this week" : "coming up"}
              </p>
              <p className="text-sm text-muted-foreground">
                Move a lead to “Trial booked” on the Leads board and pick a date and time.
              </p>
            </div>
          ) : (
            [...groups.values()].map(({ date, items }) => (
              <section key={dayKey(date)}>
                <h2 className="mb-1 flex items-center gap-2 text-sm font-medium">
                  {dayHeading(date, today)}
                  <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{items.length}</span>
                </h2>
                <ul className="divide-y divide-border/70 border-y border-border/70">
                  {items.map((l) => (
                    <TrialRow key={l.id} lead={l} />
                  ))}
                </ul>
              </section>
            ))
          )}
        </div>
        </div>
      )}
    </>
  );
}
