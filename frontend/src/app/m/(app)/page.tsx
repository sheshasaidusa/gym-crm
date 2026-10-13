"use client";

import { CalendarCheckIcon, ChevronRightIcon, HeartPulseIcon, MessageCircleIcon, PhoneIcon } from "lucide-react";
import Link from "next/link";

import { VisitGrid } from "@/components/attendance/visit-grid";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate, STATUS_META, todayIso } from "@/lib/format";
import { useMemberAttendance, useMemberMe } from "@/lib/member-app-queries";
import { membershipLine } from "@/lib/membership-line";
import { whatsappUrl } from "@/lib/whatsapp";

export default function MemberHome() {
  const me = useMemberMe();
  const visits = useMemberAttendance();
  if (me.isPending) return <Skeleton className="h-64 w-full rounded-xl" />;
  if (me.isError) return <p className="text-sm text-destructive">{me.error.message}</p>;

  const d = me.data;
  const m = d.membership;
  const due = !!d.next_checkup_on && d.next_checkup_on <= todayIso();

  return (
    <div className="grid gap-4">
      <h1 className="text-2xl font-semibold">Hi {d.first_name} 👋</h1>

      <Card>
        <CardHeader>
          <CardDescription className="flex items-center gap-2">
            <CalendarCheckIcon className="size-4" aria-hidden />
            Membership
          </CardDescription>
          {m ? (
            <>
              <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                {m.plan_name}
                <span
                  className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-medium ${STATUS_META[m.status].className}`}
                >
                  {STATUS_META[m.status].label}
                </span>
              </CardTitle>
              <p className="text-sm text-muted-foreground">{membershipLine(m)}</p>
              {m.renewal_starts && (
                <p className="text-sm text-muted-foreground">
                  Renewed. Your next period starts {formatDate(m.renewal_starts)}.
                </p>
              )}
            </>
          ) : (
            <CardTitle className="text-base">No active membership</CardTitle>
          )}
        </CardHeader>
        {d.gym.phone && (
          <CardContent className="border-t pt-4">
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={`tel:${d.gym.phone.replace(/\s/g, "")}`} />}>
              <PhoneIcon />
              Call the gym
            </Button>
          </CardContent>
        )}
      </Card>

      <Card>
        <CardHeader>
          <CardDescription>Your trainer</CardDescription>
          <CardTitle className="text-lg">{d.trainer_name ?? "Not assigned yet"}</CardTitle>
          {!d.trainer_name && (
            <p className="text-sm text-muted-foreground">Ask at the front desk and we&apos;ll match you with someone.</p>
          )}
        </CardHeader>
        {d.trainer_phone && (
          <CardContent className="flex gap-2 border-t pt-4">
            <Button variant="outline" size="sm" nativeButton={false} render={<a href={`tel:${d.trainer_phone}`} />}>
              <PhoneIcon />
              Call
            </Button>
            <Button
              variant="outline"
              size="sm"
              nativeButton={false}
              render={<a href={whatsappUrl(d.trainer_phone)} target="_blank" rel="noreferrer" />}
            >
              <MessageCircleIcon />
              WhatsApp
            </Button>
          </CardContent>
        )}
      </Card>

      {visits.data && (visits.data.dates.length > 0 || visits.data.last_visit) && (
        <Card>
          <CardHeader>
            <CardDescription>Your visits</CardDescription>
            <CardTitle className="text-lg">
              {visits.data.visits_30d} in the last 30 days
              {visits.data.streak_weeks > 1 && (
                <span className="ml-2 text-sm font-normal text-muted-foreground">
                  · {visits.data.streak_weeks} week streak 🔥
                </span>
              )}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <VisitGrid dates={visits.data.dates} />
          </CardContent>
        </Card>
      )}

      <Link href="/m/progress" className="block">
        <Card className="transition-colors hover:bg-muted/40">
          <CardContent className="flex items-center gap-3">
            <HeartPulseIcon className="size-5 text-primary" aria-hidden />
            <div className="flex-1">
              <div className="font-medium">{due ? "Check-up due" : "Next check-up"}</div>
              <div className="text-sm text-muted-foreground">
                {due ? "Ask your trainer for a quick check-up." : formatDate(d.next_checkup_on)}
              </div>
            </div>
            <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
          </CardContent>
        </Card>
      </Link>

      <Link href="/m/plan" className="block">
        <Card className="transition-colors hover:bg-muted/40">
          <CardContent className="flex items-center gap-3">
            <div className="flex-1">
              <div className="font-medium">Workout &amp; diet plan</div>
              <div className="text-sm text-muted-foreground">
                {d.has_plan ? "Open your plan" : "Your trainer is preparing it"}
              </div>
            </div>
            <ChevronRightIcon className="size-4 text-muted-foreground" aria-hidden />
          </CardContent>
        </Card>
      </Link>
    </div>
  );
}
