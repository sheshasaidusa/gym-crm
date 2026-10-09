"use client";

import { ArrowLeftIcon, CalendarClockIcon, CheckIcon, MessageCircleIcon, PhoneIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { PageHeader } from "@/components/page-header";
import { SimpleSelect } from "@/components/simple-select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
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

export default function TrialsPage() {
  const leads = useLeads({});
  const staff = useStaff();
  const [range, setRange] = useState<Range>("week");
  const [taker, setTaker] = useState(ANYONE);

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
  const missed = booked.filter((l) => new Date(l.trial_at!) < today);
  const upcoming = booked.filter((l) => {
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
                range === "today" ? "today" : range === "week" ? "in the next 7 days" : "coming up"
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
              aria-pressed={range === o.value}
              onClick={() => setRange(o.value)}
              className={cn(
                "h-full rounded-full px-3 text-sm font-medium transition-colors",
                range === o.value
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
        <div className="grid gap-8">
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
              <p className="font-medium">No trials {range === "today" ? "today" : range === "week" ? "this week" : "coming up"}</p>
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
      )}
    </>
  );
}
