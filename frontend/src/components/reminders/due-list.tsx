"use client";

import {
  BellOffIcon,
  CheckIcon,
  ChevronDownIcon,
  MailCheckIcon,
  MailIcon,
  MailWarningIcon,
  MailXIcon,
  MessageCircleIcon,
  SendIcon,
  TriangleAlertIcon,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { DatePicker } from "@/components/ui/date-picker";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { addDays, formatDate, initials, todayIso } from "@/lib/format";
import { useCan } from "@/lib/queries";
import {
  useDueReminders,
  useLogWhatsApp,
  useRunReminders,
  type DueReminder,
  type ReminderKind,
} from "@/lib/reminder-queries";
import { cn } from "@/lib/utils";
import { whatsappUrl } from "@/lib/whatsapp";

const GROUPS: { kind: ReminderKind; title: string }[] = [
  { kind: "on_day", title: "Ending today" },
  { kind: "before", title: "Ending soon" },
  { kind: "after", title: "Recently expired" },
];

function whenLabel(r: DueReminder) {
  if (r.offset_days === 0) return "Ends today";
  const n = Math.abs(r.offset_days);
  const d = `${n} day${n === 1 ? "" : "s"}`;
  return r.offset_days > 0 ? `Ends in ${d}` : `Ended ${d} ago`;
}

function EmailChip({ r }: { r: DueReminder }) {
  const base = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs whitespace-nowrap";
  if (!r.email) {
    return (
      <span className={cn(base, "bg-muted text-muted-foreground")}>
        <MailXIcon className="size-3" />
        No email
      </span>
    );
  }
  if (r.email_status === "sent") {
    return (
      <span className={cn(base, "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400")}>
        <MailCheckIcon className="size-3" />
        Emailed
      </span>
    );
  }
  if (r.email_status === "failed") {
    return (
      <span
        title={r.email_error ?? undefined}
        className={cn(base, "bg-red-500/15 text-red-700 dark:text-red-400")}
      >
        <MailWarningIcon className="size-3" />
        Email failed
      </span>
    );
  }
  return (
    <span className={cn(base, "bg-muted text-muted-foreground")}>
      <MailIcon className="size-3" />
      Email queued
    </span>
  );
}

function ReminderRow({ r, canSend }: { r: DueReminder; canSend: boolean }) {
  const logWhatsApp = useLogWhatsApp();
  const [open, setOpen] = useState(false);

  const sendWhatsApp = () => {
    window.open(whatsappUrl(r.phone, r.body), "_blank", "noopener,noreferrer");
    logWhatsApp.mutate({ membership_id: r.membership_id, offset_days: r.offset_days });
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="flex flex-wrap items-center gap-3 py-3">
        <Avatar className="size-9">
          <AvatarFallback className="text-xs">{initials(r.member_name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <Link href={`/members/${r.member_id}`} className="font-medium hover:underline">
            {r.member_name}
          </Link>
          <div className="text-xs text-muted-foreground">
            {r.plan_name} · {whenLabel(r)} ({formatDate(r.end_date, { year: false })})
          </div>
        </div>
        <EmailChip r={r} />
        <div className="flex items-center gap-1">
          <CollapsibleTrigger
            render={<Button variant="ghost" size="sm" aria-label="Show message" />}
          >
            Message
            <ChevronDownIcon className={cn("transition-transform", open && "rotate-180")} />
          </CollapsibleTrigger>
          {canSend &&
            (r.whatsapp_sent_at ? (
              <Button variant="outline" size="sm" onClick={sendWhatsApp} title="Send again">
                <CheckIcon className="text-emerald-600" />
                WhatsApp sent
              </Button>
            ) : (
              <Button size="sm" onClick={sendWhatsApp}>
                <MessageCircleIcon />
                WhatsApp
              </Button>
            ))}
        </div>
      </div>
      <CollapsibleContent>
        <div className="mb-3 rounded-lg bg-muted p-3 text-sm">
          <div className="mb-1 font-medium">{r.subject}</div>
          <p className="whitespace-pre-line text-muted-foreground">{r.body}</p>
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export function DueList() {
  const can = useCan();
  const today = todayIso();
  const [day, setDay] = useState(today);
  const due = useDueReminders(day === today ? undefined : day);
  const run = useRunReminders();
  const isToday = day === today;

  const items = due.data?.items ?? [];
  const emailed = items.filter((i) => i.email_status === "sent").length;
  const handled = items.filter((i) => i.email_status === "sent" || i.whatsapp_sent_at).length;

  return (
    <div className="grid gap-4">
      {due.data?.email_provider === "console" && (
        <Alert>
          <TriangleAlertIcon />
          <AlertTitle>Email is in test mode</AlertTitle>
          <AlertDescription>
            Reminder emails are written to the server log instead of being delivered. Set
            EMAIL_PROVIDER to smtp or resend on the server to send real emails. WhatsApp
            reminders work now.
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{isToday ? "Due today" : `Due on ${formatDate(day)}`}</CardTitle>
          <CardDescription>
            {due.isPending
              ? "Loading…"
              : items.length === 0
                ? "No reminders for this day."
                : `${items.length} member${items.length === 1 ? "" : "s"} · ${emailed} emailed · ${handled} reminded`}
          </CardDescription>
          <div className="flex flex-wrap items-center gap-2 pt-2">
            <div className="flex rounded-lg border p-0.5">
              {[
                { label: "Today", value: today },
                { label: "Tomorrow", value: addDays(today, 1) },
              ].map((o) => (
                <button
                  key={o.label}
                  type="button"
                  onClick={() => setDay(o.value)}
                  className={cn(
                    "rounded-md px-2.5 py-1 text-xs",
                    day === o.value ? "bg-muted font-medium" : "text-muted-foreground",
                  )}
                >
                  {o.label}
                </button>
              ))}
            </div>
            <DatePicker
              aria-label="Pick a day"
              className="h-8 w-40"
              value={day}
              onChange={setDay}
            />
            {can.manage && isToday && items.length > 0 && (
              <Button size="sm" onClick={() => run.mutate()} disabled={run.isPending}>
                {run.isPending ? <Spinner /> : <SendIcon />}
                Send emails now
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent>
          {due.isPending ? (
            <Skeleton className="h-40 w-full" />
          ) : items.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BellOffIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing due</EmptyTitle>
                <EmptyDescription>
                  Members appear here on the days you chose in reminder settings.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className={cn("grid gap-4", due.isPlaceholderData && "opacity-60")}>
              {GROUPS.map((g) => {
                const group = items.filter((i) => i.kind === g.kind);
                if (!group.length) return null;
                return (
                  <section key={g.kind}>
                    <h3 className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
                      {g.title} · {group.length}
                    </h3>
                    <div className="divide-y">
                      {group.map((r) => (
                        <ReminderRow
                          key={`${r.membership_id}:${r.offset_days}`}
                          r={r}
                          canSend={isToday}
                        />
                      ))}
                    </div>
                  </section>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
