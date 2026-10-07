"use client";

import {
  ChevronLeftIcon,
  ChevronRightIcon,
  HeartPulseIcon,
  MailIcon,
  PhoneIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useRef } from "react";

import { StatusBadge } from "@/components/members/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  ageFrom,
  daysBetween,
  DIET_LABELS,
  EXPERIENCE_LABELS,
  formatDate,
  formatMoney,
  GENDER_LABELS,
  GOAL_LABELS,
  initials,
  todayIso,
} from "@/lib/format";
import { useMember, type Member } from "@/lib/member-queries";
import { useCurrency } from "@/lib/queries";

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 border-b border-border/70 py-3 last:border-b-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 text-sm break-words">{children ?? "—"}</dd>
    </div>
  );
}

function Stat({ label, value, tone }: { label: string; value: React.ReactNode; tone?: "bad" | "good" }) {
  return (
    <div className="grid gap-1 px-3 py-3 text-center">
      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd
        className={
          tone === "bad"
            ? "text-lg font-medium text-red-600 tabular-nums dark:text-red-400"
            : tone === "good"
              ? "text-lg font-medium text-emerald-600 tabular-nums dark:text-emerald-400"
              : "text-lg font-medium tabular-nums"
        }
      >
        {value}
      </dd>
    </div>
  );
}

function Body({ m }: { m: Member }) {
  const currency = useCurrency();
  const current = m.memberships.find((x) => x.id === m.current_membership?.id);
  const due = m.memberships.filter((x) => x.status !== "cancelled").reduce((s, x) => s + x.balance, 0);
  const paid = m.memberships.reduce((s, x) => s + x.paid, 0);
  const sinceCheckup = m.last_checkup_on ? daysBetween(m.last_checkup_on, todayIso()) : null;
  const age = ageFrom(m.dob);
  const others = m.memberships.filter((x) => x.id !== current?.id);

  return (
    <>
      {/* Who */}
      <div className="grid gap-4 border-b border-border/70 px-5 pb-5">
        <div className="flex min-w-0 items-center gap-3">
          <Avatar className="size-12 shrink-0">
            <AvatarFallback className="bg-primary/15 font-semibold text-primary">{initials(m.name)}</AvatarFallback>
          </Avatar>
          <div className="grid min-w-0 gap-1.5">
            <SheetTitle className="truncate text-base" title={m.name}>
              {m.name}
            </SheetTitle>
            <div className="flex flex-wrap gap-1.5">
              <StatusBadge status={m.status} />
              {m.trainer && <Pill>{m.trainer.name}</Pill>}
              {m.goal && <Pill>{GOAL_LABELS[m.goal]}</Pill>}
              {m.tags.map((t) => (
                <Pill key={t}>#{t}</Pill>
              ))}
            </div>
          </div>
        </div>
        <dl className="grid grid-cols-2 divide-border/70 rounded-2xl border border-border/70 sm:grid-cols-4 sm:divide-x">
          <Stat
            label="Days left"
            value={current ? (current.status === "expired" ? "Expired" : (current.days_left ?? "—")) : "—"}
            tone={current?.status === "expired" ? "bad" : undefined}
          />
          <Stat label="Due" value={formatMoney(due, currency)} tone={due > 0 ? "bad" : "good"} />
          <Stat label="Paid total" value={formatMoney(paid, currency)} />
          <Stat
            label="Last check-up"
            value={sinceCheckup == null ? "Never" : sinceCheckup === 0 ? "Today" : `${sinceCheckup}d ago`}
          />
        </dl>
      </div>

      {/* Details | memberships */}
      <div className="grid min-h-0 flex-1 md:grid-cols-[260px_1fr]">
        <div className="overflow-y-auto border-border/70 px-5 py-4 md:border-r">
          <h3 className="text-xs tracking-wide text-muted-foreground uppercase">Contact</h3>
          <dl>
            <Row label="Phone">
              <a href={`tel:${m.phone}`} className="flex items-center gap-1.5 hover:underline">
                <PhoneIcon className="size-3.5 text-muted-foreground" />
                {m.phone}
              </a>
            </Row>
            <Row label="Email">
              {m.email ? (
                <a href={`mailto:${m.email}`} className="flex items-start gap-1.5 break-all hover:underline">
                  <MailIcon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                  {m.email}
                </a>
              ) : null}
            </Row>
            <Row label="Emergency">
              {m.emergency_contact_name || m.emergency_contact_phone
                ? [m.emergency_contact_name, m.emergency_contact_phone].filter(Boolean).join(" · ")
                : null}
            </Row>
            <Row label="Joined">{formatDate(m.joined_on)}</Row>
          </dl>
          <h3 className="mt-5 text-xs tracking-wide text-muted-foreground uppercase">Profile</h3>
          <dl>
            <Row label="Age · gender">
              {[age != null ? `${age} yrs` : null, m.gender ? GENDER_LABELS[m.gender] : null].filter(Boolean).join(" · ") || null}
            </Row>
            <Row label="Diet">{m.diet_pref ? DIET_LABELS[m.diet_pref] : null}</Row>
            <Row label="Experience">{m.experience_level ? EXPERIENCE_LABELS[m.experience_level] : null}</Row>
            <Row label="Height">{m.height_cm ? `${m.height_cm} cm` : null}</Row>
          </dl>
        </div>

        <div className="grid content-start gap-4 overflow-y-auto px-5 py-4">
          {m.medical_notes && (
            <div className="flex gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3 text-sm">
              <HeartPulseIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <p className="line-clamp-3 text-muted-foreground" title={m.medical_notes}>
                {m.medical_notes}
              </p>
            </div>
          )}
          {!current && (
            <p className="rounded-2xl border border-dashed p-5 text-center text-sm text-muted-foreground">No membership yet.</p>
          )}
          {m.memberships.length > 0 && (
            <div className="grid gap-2">
              <h3 className="flex items-center gap-2 text-sm font-medium">
                Memberships
                <span className="rounded-full bg-muted px-1.5 text-xs text-muted-foreground tabular-nums">{m.memberships.length}</span>
              </h3>
              {[...(current ? [current] : []), ...others].map((x) => (
                <article key={x.id} className="overflow-hidden rounded-xl border border-border/70">
                  <div className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="truncate text-sm font-medium" title={x.plan_name}>
                        {x.plan_name}
                      </span>
                      {x.id === current?.id && <span className="shrink-0 text-xs text-muted-foreground">Current</span>}
                    </span>
                    <StatusBadge status={x.status} />
                  </div>
                  <dl className="grid grid-cols-3 divide-x divide-border/70 border-t border-border/70 text-sm [&>div]:px-3 [&>div]:py-2">
                    <div>
                      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">From</dt>
                      <dd className="tabular-nums">{formatDate(x.start_date, { year: false })}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">To</dt>
                      <dd className="tabular-nums">{formatDate(x.end_date, { year: false })}</dd>
                    </div>
                    <div>
                      <dt className="text-[11px] tracking-wide text-muted-foreground uppercase">
                        {x.balance > 0 && x.status !== "cancelled" ? "Due" : "Total"}
                      </dt>
                      <dd className="tabular-nums">
                        {formatMoney(x.balance > 0 && x.status !== "cancelled" ? x.balance : x.total, currency)}
                      </dd>
                    </div>
                  </dl>
                </article>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex h-5 items-center rounded-full border px-2 text-xs whitespace-nowrap text-muted-foreground">
      {children}
    </span>
  );
}

function Loaded({ id }: { id: string }) {
  const member = useMember(id);
  if (member.isPending)
    return (
      <div className="grid gap-4 px-5">
        <Skeleton className="h-12 w-64" />
        <Skeleton className="h-20 w-full rounded-2xl" />
        <Skeleton className="h-64 w-full rounded-2xl" />
      </div>
    );
  if (member.isError) return <p className="px-5 text-sm text-destructive">{member.error.message}</p>;
  return <Body m={member.data} />;
}

/** Floating member preview over the members list, with previous / next through the current page. */
export function MemberQuickView({
  ids,
  index,
  onIndexChange,
}: {
  ids: string[];
  index: number | null;
  onIndexChange: (i: number | null) => void;
}) {
  // Keep showing the last member while the panel animates closed.
  const last = useRef<number | null>(null);
  if (index != null) last.current = index;
  const shown = index ?? last.current;
  const id = shown != null ? ids[shown] : undefined;
  const open = index != null;

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
      if (e.key === "ArrowLeft" && index! > 0) onIndexChange(index! - 1);
      if (e.key === "ArrowRight" && index! < ids.length - 1) onIndexChange(index! + 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, index, ids.length, onIndexChange]);

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onIndexChange(null)}>
      <SheetContent
        side="right"
        showCloseButton={false}
        className="gap-0 overflow-hidden rounded-2xl border data-[side=right]:inset-y-3 data-[side=right]:right-3 data-[side=right]:h-auto data-[side=right]:w-[calc(100%-1.5rem)] data-[side=right]:sm:max-w-3xl"
      >
        <div className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-full"
              aria-label="Previous member"
              disabled={shown == null || shown <= 0}
              onClick={() => shown != null && onIndexChange(shown - 1)}
            >
              <ChevronLeftIcon />
            </Button>
            <span className="text-sm text-muted-foreground tabular-nums">
              {shown != null ? shown + 1 : "–"} / {ids.length}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-full"
              aria-label="Next member"
              disabled={shown == null || shown >= ids.length - 1}
              onClick={() => shown != null && onIndexChange(shown + 1)}
            >
              <ChevronRightIcon />
            </Button>
          </div>
          <div className="flex items-center gap-2">
            {id && (
              <Button variant="outline" size="sm" nativeButton={false} render={<Link href={`/members/${id}`} />}>
                View full profile
              </Button>
            )}
            <SheetClose render={<Button variant="outline" size="icon-sm" className="rounded-full" aria-label="Close" />}>
              <XIcon />
            </SheetClose>
          </div>
        </div>
        <div className="flex min-h-0 flex-1 flex-col pt-1">{id && <Loaded key={id} id={id} />}</div>
      </SheetContent>
    </Sheet>
  );
}
