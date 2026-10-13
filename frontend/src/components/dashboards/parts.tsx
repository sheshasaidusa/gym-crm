"use client";

import { ArrowRightIcon, MessageCircleIcon, type LucideIcon } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { StatCard } from "@/components/stats/stat-card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { initials } from "@/lib/format";
import { whatsappUrl } from "@/lib/whatsapp";
import { cn } from "@/lib/utils";

/** A stat tile that links to the list behind the number. `value` undefined shows a placeholder. */
export function BoardStat({
  label,
  value,
  icon: Icon,
  href,
  hint,
  tone,
}: {
  label: string;
  value: ReactNode | undefined;
  icon: LucideIcon;
  href?: string;
  hint: string;
  tone?: "bad";
}) {
  const card = (
    <StatCard
      label={label}
      icon={<Icon className="size-3.5" />}
      value={
        value === undefined ? (
          <span className="inline-block h-8 w-12 animate-pulse rounded-lg bg-muted" />
        ) : (
          <span className={cn("tabular-nums", tone === "bad" && "text-red-600 dark:text-red-400")}>{value}</span>
        )
      }
      footer={<p className="text-xs text-muted-foreground">{hint}</p>}
    />
  );
  if (!href) return card;
  return (
    <Link
      href={href}
      className="block rounded-xl outline-none transition-opacity hover:opacity-90 focus-visible:ring-3 focus-visible:ring-ring/50"
    >
      {card}
    </Link>
  );
}

export function BoardCard({
  title,
  description,
  href,
  hrefLabel = "View all",
  loading,
  empty,
  children,
  className,
}: {
  title: string;
  description?: string;
  href?: string;
  hrefLabel?: string;
  loading?: boolean;
  /** Shown instead of children when there is nothing to list. */
  empty?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <Card className={cn("h-full", className)}>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {href && (
          <CardAction>
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href={href} />}>
              {hrefLabel}
              <ArrowRightIcon />
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        {loading ? (
          <Skeleton className="h-32 w-full" />
        ) : empty ? (
          <p className="my-auto py-6 text-center text-sm text-muted-foreground">{empty}</p>
        ) : (
          children
        )}
      </CardContent>
    </Card>
  );
}

/** One person in a list: avatar, name, a line of detail, something on the right, and a WhatsApp nudge. */
export function PersonLine({
  href,
  name,
  detail,
  right,
  phone,
  message,
}: {
  href: string;
  name: string;
  detail?: ReactNode;
  right?: ReactNode;
  /** With `message`, adds a WhatsApp button. */
  phone?: string;
  message?: string;
}) {
  return (
    <li className="flex items-center gap-1">
      <Link href={href} className="flex min-w-0 flex-1 items-center gap-3 py-2.5 hover:opacity-80">
        <Avatar className="size-8">
          <AvatarFallback className="text-xs">{initials(name)}</AvatarFallback>
        </Avatar>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium">{name}</div>
          {detail && <div className="truncate text-xs text-muted-foreground">{detail}</div>}
        </div>
        {right && <span className="text-xs whitespace-nowrap text-muted-foreground">{right}</span>}
      </Link>
      {phone && message && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`WhatsApp ${name}`}
          nativeButton={false}
          render={<a href={whatsappUrl(phone, message)} target="_blank" rel="noreferrer" />}
        >
          <MessageCircleIcon />
        </Button>
      )}
    </li>
  );
}

/** Horizontal bars with the count printed, for pipeline stages and the like. */
export function Bars({ rows }: { rows: { label: string; value: number }[] }) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid gap-1 text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums">{r.value}</span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div className="h-full rounded-full bg-[var(--series-1)]" style={{ width: `${(r.value / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}
