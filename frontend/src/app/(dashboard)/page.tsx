"use client";

import {
  AlarmClockIcon,
  ArrowRightIcon,
  CalendarClockIcon,
  CheckCircle2Icon,
  CircleIcon,
  PlusIcon,
  UserCheckIcon,
  UserXIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";

import { StatusBadge } from "@/components/members/status-badge";
import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { daysLeftLabel, formatDate, initials } from "@/lib/format";
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

function Stat({
  label,
  value,
  icon: Icon,
  href,
  hint,
}: {
  label: string;
  value: number | undefined;
  icon: LucideIcon;
  href: string;
  hint: string;
}) {
  return (
    <Link href={href} className="rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50">
      <Card size="sm" className="h-full transition-colors hover:bg-muted/50">
        <CardHeader>
          <CardDescription className="flex items-center gap-2">
            <Icon className="size-4" />
            {label}
          </CardDescription>
          <div className="text-3xl font-semibold tracking-tight tabular-nums">
            {value === undefined ? <Skeleton className="h-9 w-12" /> : value}
          </div>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardHeader>
      </Card>
    </Link>
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
    <Card>
      <CardHeader>
        <CardTitle>Renewals due</CardTitle>
        <CardDescription>Memberships ending in the next 7 days</CardDescription>
        <CardAction>
          <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/members?status=expiring&sort=ending" />}>
            View all
            <ArrowRightIcon />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {expiring.isPending ? (
          <Skeleton className="h-32 w-full" />
        ) : !expiring.data?.items.length ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No memberships ending this week.
          </p>
        ) : (
          <ul className="divide-y">
            {expiring.data.items.map((m) => (
              <li key={m.id}>
                <Link href={`/members/${m.id}`} className="flex items-center gap-3 py-2.5 hover:opacity-80">
                  <Avatar className="size-8">
                    <AvatarFallback className="text-xs">{initials(m.name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{m.name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {m.current_membership?.plan_name} · ends {formatDate(m.current_membership?.end_date, { year: false })}
                    </div>
                  </div>
                  <StatusBadge status="expiring" className="hidden sm:inline-flex" />
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {daysLeftLabel(m.current_membership?.days_left)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const me = useMe();
  const can = useCan();
  const counts = useMemberCounts({});
  const firstName = me.data?.user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "Welcome"}
        description={`Here's what's happening at ${me.data?.gym.name ?? "your gym"}.`}
      >
        {can.role !== "trainer" && (
          <Button nativeButton={false} render={<Link href="/members/new" />}>
            <PlusIcon />
            Add member
          </Button>
        )}
      </PageHeader>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="Active members" value={counts.data?.active} icon={UserCheckIcon} href="/members?status=active" hint="Includes those expiring soon" />
        <Stat label="Expiring soon" value={counts.data?.expiring} icon={AlarmClockIcon} href="/members?status=expiring&sort=ending" hint="Ending in 7 days" />
        <Stat label="Expired" value={counts.data?.expired} icon={UserXIcon} href="/members?status=expired" hint="Need a renewal" />
        <Stat label="Starting soon" value={counts.data?.upcoming} icon={CalendarClockIcon} href="/members?status=upcoming" hint="Upcoming start dates" />
      </div>

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <RenewalsDue />
        {can.manage && <SetupChecklist />}
      </div>
    </>
  );
}
