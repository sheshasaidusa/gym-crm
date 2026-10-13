"use client";

import { ScanLineIcon, SearchIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { StatusBadge } from "@/components/members/status-badge";
import { PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounced } from "@/hooks/use-debounced";
import { useCheckIn, useUndoCheckIn, useVisitsOn } from "@/lib/attendance-queries";
import { initials } from "@/lib/format";
import { useMembers } from "@/lib/member-queries";
import { useCan } from "@/lib/queries";

const time = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

/** Front desk: type a name or number, press Enter, done. Built to be used with one hand while talking. */
export default function CheckInPage() {
  const can = useCan();
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const q = useDebounced(query.trim(), 200);
  const results = useMembers({ q: q.length >= 2 ? q : undefined, page_size: 6, sort: "name" });
  const today = useVisitsOn();
  const checkIn = useCheckIn();
  const undo = useUndoCheckIn();

  useEffect(() => input.current?.focus(), []);

  if (can.role && !can.has("attendance")) {
    return <p className="text-sm text-muted-foreground">Check-in is for the front desk, managers and owners.</p>;
  }

  const matches = q.length >= 2 ? (results.data?.items ?? []) : [];

  function submit(memberId: string, name: string) {
    checkIn.mutate(memberId, {
      onSuccess: (r) => {
        if (r.warning) {
          toast.warning(`${name} is in, but: ${r.warning}`, {
            action: { label: "Open member", onClick: () => window.location.assign(`/members/${memberId}`) },
            duration: 8000,
          });
        } else if (r.already) {
          toast.info(`${name} had already checked in today`);
        } else {
          toast.success(`${name} checked in`);
        }
        setQuery("");
        input.current?.focus();
      },
    });
  }

  return (
    <>
      <PageHeader title="Check-in" description="Type a name or phone number and press Enter." />

      <div className="grid items-start gap-6 lg:grid-cols-2">
        <Card>
          <CardContent className="grid gap-4">
            <div className="relative">
              <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={input}
                autoComplete="off"
                inputMode="search"
                placeholder="Name or phone number"
                className="h-11 pl-9 text-base"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && matches[0] && !checkIn.isPending) submit(matches[0].id, matches[0].name);
                }}
              />
            </div>

            {q.length >= 2 && (
              <ul className="divide-y rounded-lg border">
                {results.isPending ? (
                  <li className="p-3">
                    <Skeleton className="h-8 w-full" />
                  </li>
                ) : matches.length === 0 ? (
                  <li className="p-4 text-center text-sm text-muted-foreground">No member matches &ldquo;{q}&rdquo;.</li>
                ) : (
                  matches.map((m, i) => (
                    <li key={m.id} className={`flex items-center gap-3 p-3 ${i === 0 ? "bg-muted/40" : ""}`}>
                      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium">
                        {initials(m.name)}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{m.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{m.phone}</div>
                      </div>
                      <StatusBadge status={m.status} className="hidden sm:inline-flex" />
                      <Button size="sm" disabled={checkIn.isPending} onClick={() => submit(m.id, m.name)}>
                        <ScanLineIcon />
                        Check in
                      </Button>
                    </li>
                  ))
                )}
              </ul>
            )}
            {q.length < 2 && (
              <p className="text-sm text-muted-foreground">
                The first match is highlighted: Enter checks them in. Expired or frozen memberships still get in, with a
                warning so you can offer a renewal.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Today</CardTitle>
            <CardDescription>
              {today.data ? `${today.data.total} visit${today.data.total === 1 ? "" : "s"}` : "Loading"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!today.data ? (
              <Skeleton className="h-32 w-full" />
            ) : today.data.items.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nobody yet today.</p>
            ) : (
              <ul className="divide-y">
                {today.data.items.map((v) => (
                  <li key={v.id} className="flex items-center gap-3 py-2.5">
                    <span className="w-16 shrink-0 text-xs text-muted-foreground tabular-nums">{time(v.checked_in_at)}</span>
                    <Link href={`/members/${v.member_id}`} className="min-w-0 flex-1 truncate text-sm font-medium hover:underline">
                      {v.member_name}
                    </Link>
                    {v.source !== "desk" && <Badge variant="secondary">{v.source === "device" ? "Scanner" : v.source}</Badge>}
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Undo check-in for ${v.member_name}`}
                      disabled={undo.isPending}
                      onClick={() => undo.mutate(v.id)}
                    >
                      <Undo2Icon />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </>
  );
}
