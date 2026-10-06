"use client";

import { ChevronLeftIcon, ChevronRightIcon, HeartPulseIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { CheckupDialog } from "@/components/checkups/checkup-dialog";
import { PageHeader } from "@/components/page-header";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useDueCheckups, type DueCheckUp } from "@/lib/checkup-queries";
import { formatDate, GOAL_LABELS, initials, type Goal } from "@/lib/format";
import { useCan, useMe } from "@/lib/queries";
import { cn } from "@/lib/utils";

export default function CheckupsPage() {
  const me = useMe();
  const can = useCan();
  const [scope, setScope] = useState<"mine" | "all">(can.role === "trainer" ? "mine" : "all");
  const [page, setPage] = useState(1);
  const due = useDueCheckups(scope, page);
  const [logging, setLogging] = useState<DueCheckUp | null>(null);
  const interval = me.data?.gym.checkup_interval_days ?? 7;

  const data = due.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <>
      <PageHeader
        title="Check-ups"
        description={`Members with a running membership who haven't had a check-up in ${interval} days.`}
      />

      <Card>
        <CardHeader>
          <CardTitle>Due for a check-up</CardTitle>
          <CardDescription>
            {data ? `${data.total} member${data.total === 1 ? "" : "s"}` : "Loading…"} · longest
            waiting first
          </CardDescription>
          <div className="flex w-fit rounded-lg border p-0.5 pt-0.5">
            {(
              [
                { value: "mine", label: "My members" },
                { value: "all", label: "All members" },
              ] as const
            ).map((o) => (
              <button
                key={o.value}
                type="button"
                onClick={() => {
                  setScope(o.value);
                  setPage(1);
                }}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs",
                  scope === o.value ? "bg-muted font-medium" : "text-muted-foreground",
                )}
              >
                {o.label}
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {due.isPending ? (
            <Skeleton className="h-48 w-full" />
          ) : !data?.items.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <HeartPulseIcon />
                </EmptyMedia>
                <EmptyTitle>Everyone is up to date</EmptyTitle>
                <EmptyDescription>
                  {scope === "mine"
                    ? "None of your assigned members are due. Switch to All members to help out."
                    : "No members are due for a check-up right now."}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ul className={cn("divide-y", due.isPlaceholderData && "opacity-60")}>
              {data.items.map((d) => (
                <li key={d.member_id} className="flex flex-wrap items-center gap-3 py-3">
                  <Avatar className="size-9">
                    <AvatarFallback className="text-xs">{initials(d.member_name)}</AvatarFallback>
                  </Avatar>
                  <div className="min-w-0 flex-1">
                    <Link href={`/members/${d.member_id}`} className="font-medium hover:underline">
                      {d.member_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {[
                        d.goals.length ? d.goals.map((g) => GOAL_LABELS[g as Goal]).join(", ") : null,
                        d.trainer ? `Trainer: ${d.trainer.name}` : "No trainer",
                        d.last_weight_kg ? `Last weight ${d.last_weight_kg} kg` : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                  <span className="text-xs whitespace-nowrap text-muted-foreground">
                    {d.last_checkup_on
                      ? `Last: ${formatDate(d.last_checkup_on, { year: false })} (${d.days_since} days ago)`
                      : "Never checked in"}
                  </span>
                  <Button size="sm" onClick={() => setLogging(d)}>
                    <PlusIcon />
                    Log check-up
                  </Button>
                </li>
              ))}
            </ul>
          )}
          {data && data.total > data.page_size && (
            <div className="flex items-center justify-end gap-1 border-t pt-2">
              <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeftIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                <ChevronRightIcon />
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {logging && (
        <CheckupDialog
          memberId={logging.member_id}
          memberName={logging.member_name}
          checkup={null}
          open={!!logging}
          onOpenChange={(o) => !o && setLogging(null)}
        />
      )}
    </>
  );
}
