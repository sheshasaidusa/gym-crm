"use client";

import { ArrowRightIcon, CheckCircle2Icon, CircleIcon } from "lucide-react";
import Link from "next/link";

import {
  countChange,
  Kpi,
  moneyChange,
  MoneySection,
  pctText,
} from "@/components/analytics/analytics-view";
import { StaffSection } from "@/components/analytics/staff-section";
import { BoardCard, PersonLine } from "@/components/dashboards/parts";
import { StatusBadge } from "@/components/members/status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics } from "@/lib/analytics-queries";
import { daysLeftLabel, formatDate, formatMoney } from "@/lib/format";
import { useMemberCounts, useMembers, usePlans } from "@/lib/member-queries";
import { useBranches, useCan, useMe, useStaff } from "@/lib/queries";

function Step({ done, title, href, cta }: { done: boolean; title: string; href: string; cta: string }) {
  return (
    <li className="flex items-center gap-3 py-3">
      {done ? (
        <CheckCircle2Icon className="size-5 shrink-0 text-primary" />
      ) : (
        <CircleIcon className="size-5 shrink-0 text-muted-foreground" />
      )}
      <span className={done ? "flex-1 text-muted-foreground line-through" : "flex-1"}>{title}</span>
      {!done && (
        <Button variant="outline" size="sm" nativeButton={false} render={<Link href={href} />}>
          {cta}
          <ArrowRightIcon />
        </Button>
      )}
    </li>
  );
}

function SetupChecklist() {
  const me = useMe();
  const branches = useBranches();
  const staff = useStaff();
  const plans = usePlans();
  const counts = useMemberCounts({});

  if (me.isPending || branches.isPending || staff.isPending || plans.isPending || counts.isPending) {
    return <Skeleton className="h-48 w-full rounded-xl" />;
  }
  const steps = [
    { done: !!me.data?.gym.phone, title: "Add your gym's contact number", href: "/settings", cta: "Gym details" },
    { done: (plans.data?.length ?? 0) > 0, title: "Create your membership plans", href: "/plans", cta: "Plans" },
    { done: (counts.data?.all ?? 0) > 0, title: "Add your members, or import them from a spreadsheet", href: "/import", cta: "Import" },
    { done: (staff.data?.length ?? 0) > 1, title: "Invite your trainers and front desk", href: "/settings?tab=staff", cta: "Invite staff" },
  ];
  const remaining = steps.filter((s) => !s.done).length;
  if (remaining === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Get your gym set up</CardTitle>
        <CardDescription>
          {remaining} of {steps.length} steps left
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="divide-y">
          {steps.map((s) => (
            <Step key={s.title} {...s} />
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function RenewalsDue() {
  const expiring = useMembers({ status: "expiring", sort: "ending", page_size: 6 });

  return (
    <BoardCard
      title="Renewals due"
      description="Memberships ending in the next 7 days"
      href="/members?status=expiring&sort=ending"
      loading={expiring.isPending}
      empty={expiring.data && !expiring.data.items.length ? "No memberships ending this week." : undefined}
    >
      <ul className="divide-y">
        {expiring.data?.items.map((m) => (
          <PersonLine
            key={m.id}
            href={`/members/${m.id}`}
            name={m.name}
            detail={`${m.current_membership?.plan_name} · ends ${formatDate(m.current_membership?.end_date, { year: false })}`}
            right={
              <span className="flex items-center gap-2">
                <StatusBadge status="expiring" className="hidden sm:inline-flex" />
                {daysLeftLabel(m.current_membership?.days_left)}
              </span>
            }
          />
        ))}
      </ul>
    </BoardCard>
  );
}

/** The owner's view: money and growth first, then how the team is doing, then what needs attention. */
export function OwnerDashboard() {
  const can = useCan();
  const analytics = useAnalytics(6, null);
  const a = analytics.data;
  const k = a?.kpis;
  const c = a?.currency ?? "INR";

  return (
    <>
      {k ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <Kpi label="Active members" value={k.active_members.toLocaleString()} change={countChange(k.active_members, k.active_last_month)} hint="Same as last month" />
          <Kpi label="New this month" value={k.new_this_month.toLocaleString()} change={countChange(k.new_this_month, k.new_last_month)} hint="Same as last month" />
          <Kpi label="Revenue this month" value={formatMoney(k.revenue_this_month, c)} change={moneyChange(k.revenue_this_month, k.revenue_last_month)} hint="Payments received" />
          <Kpi label="Renewal rate" value={pctText(k.renewal_rate)} hint="Ended memberships that renewed" />
          <Kpi label="Lead conversion" value={pctText(k.lead_conversion_rate)} hint="Leads that became members" />
        </div>
      ) : (
        <Skeleton className="h-28 w-full rounded-xl" />
      )}

      {a?.absent_14_days != null && a.absent_14_days > 0 && (
        <Link
          href="/members?status=active"
          className="flex items-center justify-between gap-3 rounded-xl border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm hover:bg-amber-500/10"
        >
          <span>
            <strong className="tabular-nums">{a.absent_14_days}</strong> active member{a.absent_14_days === 1 ? " hasn't" : "s haven't"} visited in
            14 days. They are the ones most likely not to renew.
          </span>
          <ArrowRightIcon className="size-4 shrink-0" />
        </Link>
      )}

      {a ? <MoneySection data={a} /> : <Skeleton className="h-72 w-full rounded-xl" />}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">Team, last 3 months</h2>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/analytics" />}>
            Full analytics
            <ArrowRightIcon />
          </Button>
        </div>
        <StaffSection months={3} />
      </section>

      <div className="grid items-stretch gap-6 lg:grid-cols-2">
        <RenewalsDue />
        {can.manage && <SetupChecklist />}
      </div>
    </>
  );
}
