"use client";

import { BellIcon } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useNotifications,
} from "@/lib/reminder-queries";
import { cn } from "@/lib/utils";

function timeAgo(iso: string) {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function NotificationBell() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const notifications = useNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const unread = notifications.data?.unread ?? 0;
  const items = notifications.data?.items ?? [];

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            variant="outline"
            size="icon-sm"
            className="relative size-9 rounded-full p-0"
            aria-label={unread ? `Notifications (${unread} unread)` : "Notifications"}
          />
        }
      >
        <BellIcon />
        {unread > 0 && (
          <span className="absolute -top-1 -right-1 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] leading-4 font-semibold text-primary-foreground">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-sm font-medium">Notifications</span>
          {unread > 0 && (
            <Button variant="ghost" size="xs" onClick={() => markAll.mutate()}>
              Mark all read
            </Button>
          )}
        </div>
        {items.length === 0 ? (
          <p className="px-3 py-8 text-center text-sm text-muted-foreground">
            You&apos;re all caught up.
          </p>
        ) : (
          <ul className="max-h-96 divide-y overflow-y-auto">
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={cn(
                    "flex w-full gap-2 px-3 py-2.5 text-left hover:bg-muted",
                    !n.read_at && "bg-muted/50",
                  )}
                  onClick={() => {
                    if (!n.read_at) markRead.mutate(n.id);
                    setOpen(false);
                    if (n.link) router.push(n.link);
                  }}
                >
                  <span
                    className={cn(
                      "mt-1.5 size-2 shrink-0 rounded-full",
                      n.read_at ? "bg-transparent" : "bg-red-500",
                    )}
                  />
                  <span className="grid gap-0.5">
                    <span className="text-sm font-medium">{n.title}</span>
                    {n.body && <span className="text-xs text-muted-foreground">{n.body}</span>}
                    <span className="text-xs text-muted-foreground">{timeAgo(n.created_at)}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </PopoverContent>
    </Popover>
  );
}
