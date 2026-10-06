"use client";

import { SearchIcon } from "lucide-react";
import { useState } from "react";

import { SimpleSelect } from "@/components/simple-select";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useDebounced } from "@/hooks/use-debounced";
import { AUDIT_TYPES, useAuditLog, type AuditEntry } from "@/lib/audit-queries";
import { cn } from "@/lib/utils";

const ALL = "all";

function dayLabel(d: Date) {
  const today = new Date();
  const yesterday = new Date();
  yesterday.setDate(today.getDate() - 1);
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === yesterday.toDateString()) return "Yesterday";
  return d.toLocaleDateString("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: d.getFullYear() === today.getFullYear() ? undefined : "numeric",
  });
}

/** Groups entries (newest first) under day headings. */
function byDay(items: AuditEntry[]) {
  const groups: { label: string; items: AuditEntry[] }[] = [];
  for (const item of items) {
    const label = dayLabel(new Date(item.created_at));
    const last = groups.at(-1);
    if (last?.label === label) last.items.push(item);
    else groups.push({ label, items: [item] });
  }
  return groups;
}

export function ActivityLog() {
  const [type, setType] = useState(ALL);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const q = useDebounced(search.trim(), 300);
  const log = useAuditLog({ target_type: type === ALL ? undefined : type, q: q || undefined, page });
  const data = log.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <Card variant="flat">
      <CardHeader>
        <CardTitle>Activity</CardTitle>
        <CardDescription>
          Who changed what, newest first: members, money, plans, staff and settings. Only owners can
          see this, and entries can&apos;t be edited or deleted.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-48 flex-1">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Search, e.g. a member's name"
              className="pl-8"
              aria-label="Search activity"
            />
          </div>
          <SimpleSelect
            className="w-44"
            options={[{ value: ALL, label: "Everything" }, ...AUDIT_TYPES]}
            value={type}
            onChange={(v) => {
              setType(v || ALL);
              setPage(1);
            }}
          />
        </div>

        {log.isPending ? (
          <div className="space-y-2">
            {Array.from({ length: 6 }, (_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : log.isError ? (
          <p className="text-sm text-destructive">{log.error.message}</p>
        ) : data!.items.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {q || type !== ALL ? "Nothing matches." : "Nothing has happened yet."}
          </p>
        ) : (
          <div className={cn("space-y-5", log.isPlaceholderData && "opacity-60")}>
            {byDay(data!.items).map((group) => (
              <section key={group.label}>
                <h3 className="mb-1 text-xs font-medium text-muted-foreground">{group.label}</h3>
                <ul className="divide-y">
                  {group.items.map((e) => (
                    <li key={e.id} className="flex gap-3 py-2.5 text-sm">
                      <time
                        dateTime={e.created_at}
                        className="w-12 shrink-0 pt-px text-xs text-muted-foreground tabular-nums"
                      >
                        {new Date(e.created_at).toLocaleTimeString("en-GB", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                      <div className="min-w-0">
                        <p className="break-words">{e.summary}</p>
                        <p className="text-xs text-muted-foreground">{e.actor_name}</p>
                      </div>
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="text-muted-foreground">
              Page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Newer
              </Button>
              <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Older
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
