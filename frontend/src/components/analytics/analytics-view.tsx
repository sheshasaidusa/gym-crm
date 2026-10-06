"use client";

import { ArrowDownIcon, ArrowRightIcon, ArrowUpIcon } from "lucide-react";
import Link from "next/link";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Line,
  LineChart,
  XAxis,
  YAxis,
} from "recharts";

import { StatCard } from "@/components/stats/stat-card";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import type { Analytics } from "@/lib/analytics-queries";
import { compactMoney, formatMoney, GOAL_LABELS, monthLabel } from "@/lib/format";
import { SOURCE_LABELS, STAGE_LABELS } from "@/lib/lead-queries";
import { cn } from "@/lib/utils";

// --- Small building blocks ------------------------------------------------------------

function Kpi({
  label,
  value,
  change,
  hint,
}: {
  label: string;
  value: string;
  change?: { text: string; good: boolean | null; up: boolean } | null;
  hint?: string;
}) {
  return (
    <StatCard
      label={label}
      icon={null}
      value={<span className="tabular-nums">{value}</span>}
      footer={
        change ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {change.up ? <ArrowUpIcon className="size-3" aria-hidden /> : <ArrowDownIcon className="size-3" aria-hidden />}
            <span
              className={cn(
                change.good === true && "text-emerald-600 dark:text-emerald-400",
                change.good === false && "text-red-600 dark:text-red-400",
              )}
            >
              {change.text}
            </span>
            vs last month
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">{hint ?? " "}</p>
        )
      }
    />
  );
}

function countChange(now: number, before: number) {
  if (now === before) return null;
  const diff = now - before;
  return { text: `${Math.abs(diff)}`, good: diff > 0, up: diff > 0 };
}

function moneyChange(now: number, before: number) {
  if (!before) return null;
  const change = ((now - before) / Math.abs(before)) * 100;
  return { text: `${Math.abs(change).toFixed(0)}%`, good: change >= 0, up: change >= 0 };
}

const pctText = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);

/** Horizontal bars for "top N" lists, with the value printed. Callers drop rows with no data. */
function BarList({
  rows,
  format = (v) => v.toLocaleString(),
  empty,
}: {
  rows: { label: string; value: number; note?: string }[];
  format?: (v: number) => string;
  empty: string;
}) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">{empty}</p>;
  }
  return (
    <ul className="grid gap-2.5">
      {rows.map((r) => (
        <li key={r.label} className="grid gap-1 text-sm">
          <div className="flex justify-between gap-2">
            <span className="truncate">{r.label}</span>
            <span className="shrink-0 tabular-nums">
              {format(r.value)}
              {r.note && <span className="ml-1.5 text-xs text-muted-foreground">{r.note}</span>}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-[var(--series-1)]"
              style={{ width: `${(r.value / max) * 100}%` }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

function tooltipRow(label: string | undefined, value: string) {
  return (
    <div className="flex w-full justify-between gap-4">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-medium tabular-nums">{value}</span>
    </div>
  );
}

// --- Sections ---------------------------------------------------------------------------

const memberFlowConfig = {
  new: { label: "Joined", color: "var(--series-1)" },
  churned: { label: "Didn't renew", color: "var(--series-2)" },
} satisfies ChartConfig;

const activeConfig = {
  active: { label: "Active members", color: "var(--series-1)" },
} satisfies ChartConfig;

const moneyConfig = {
  revenue: { label: "Revenue", color: "var(--series-1)" },
  expenses: { label: "Expenses", color: "var(--series-2)" },
  profit: { label: "Profit", color: "var(--foreground)" },
} satisfies ChartConfig;

function MembersSection({ data }: { data: Analytics }) {
  const rows = data.members.map((m) => ({ ...m, label: monthLabel(m.month) }));
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Active members</CardTitle>
          <CardDescription>At the end of each month</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={activeConfig} className="aspect-auto h-56 w-full">
            <LineChart data={rows} margin={{ top: 8, right: 12, left: 0, bottom: 0 }} accessibilityLayer>
              <CartesianGrid vertical={false} strokeOpacity={0.5} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => monthLabel(p?.[0]?.payload?.month ?? "", true)}
                    formatter={(v) => tooltipRow("Active members", Number(v).toLocaleString())}
                  />
                }
              />
              <Line
                dataKey="active"
                stroke="var(--color-active)"
                strokeWidth={2}
                dot={{ r: 3 }}
                isAnimationActive={false}
              />
            </LineChart>
          </ChartContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Joined vs didn&apos;t renew</CardTitle>
          <CardDescription>
            New members, and memberships that ended without a renewal
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={memberFlowConfig} className="aspect-auto h-56 w-full">
            <BarChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} accessibilityLayer>
              <CartesianGrid vertical={false} strokeOpacity={0.5} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis width={36} tickLine={false} axisLine={false} allowDecimals={false} />
              <ChartTooltip
                cursor={{ fillOpacity: 0.3 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => {
                      const m = p?.[0]?.payload as (typeof rows)[number] | undefined;
                      if (!m) return "";
                      const rate = m.renewal_rate == null ? "" : ` · ${pctText(m.renewal_rate)} renewed`;
                      return monthLabel(m.month, true) + rate;
                    }}
                    formatter={(v, name) =>
                      tooltipRow(
                        memberFlowConfig[name as keyof typeof memberFlowConfig]?.label,
                        Number(v).toLocaleString(),
                      )
                    }
                  />
                }
              />
              <ChartLegend content={<ChartLegendContent />} itemSorter={(i) => (i.dataKey === "new" ? 0 : 1)} />
              <Bar dataKey="new" fill="var(--color-new)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              <Bar dataKey="churned" fill="var(--color-churned)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
        </CardContent>
      </Card>
      <table className="sr-only">
        <caption>Members by month</caption>
        <thead>
          <tr>
            <th>Month</th>
            <th>Active</th>
            <th>Joined</th>
            <th>Renewed</th>
            <th>Didn&apos;t renew</th>
          </tr>
        </thead>
        <tbody>
          {data.members.map((m) => (
            <tr key={m.month}>
              <td>{monthLabel(m.month, true)}</td>
              <td>{m.active}</td>
              <td>{m.new}</td>
              <td>{m.renewed}</td>
              <td>{m.churned}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function MoneySection({ data }: { data: Analytics }) {
  const c = data.currency;
  const rows = data.finance.map((f) => ({ ...f, label: monthLabel(f.month) }));
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <CardHeader>
          <CardTitle>Revenue, expenses and profit</CardTitle>
          <CardDescription>Payments received and money spent each month</CardDescription>
        </CardHeader>
        <CardContent>
          <ChartContainer config={moneyConfig} className="aspect-auto h-64 w-full">
            <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} accessibilityLayer>
              <CartesianGrid vertical={false} strokeOpacity={0.5} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis width={56} tickLine={false} axisLine={false} tickFormatter={(v: number) => compactMoney(v, c)} />
              <ChartTooltip
                cursor={{ fillOpacity: 0.3 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, p) => monthLabel(p?.[0]?.payload?.month ?? "", true)}
                    formatter={(v, name) =>
                      tooltipRow(moneyConfig[name as keyof typeof moneyConfig]?.label, formatMoney(Number(v), c))
                    }
                  />
                }
              />
              <ChartLegend
                content={<ChartLegendContent />}
                itemSorter={(i) => ["revenue", "expenses", "profit"].indexOf(String(i.dataKey))}
              />
              <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[4, 4, 0, 0]} maxBarSize={24} isAnimationActive={false} />
              <Line dataKey="profit" stroke="var(--color-profit)" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </ComposedChart>
          </ChartContainer>
          <table className="sr-only">
            <caption>Revenue, expenses and profit by month</caption>
            <thead>
              <tr>
                <th>Month</th>
                <th>Revenue</th>
                <th>Expenses</th>
                <th>Profit</th>
              </tr>
            </thead>
            <tbody>
              {data.finance.map((f) => (
                <tr key={f.month}>
                  <td>{monthLabel(f.month, true)}</td>
                  <td>{formatMoney(f.revenue, c)}</td>
                  <td>{formatMoney(f.expenses, c)}</td>
                  <td>{formatMoney(f.profit, c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Revenue by plan</CardTitle>
          <CardDescription>Payments in this period</CardDescription>
        </CardHeader>
        <CardContent>
          <BarList
            rows={data.revenue_by_plan.slice(0, 8).map((p) => ({ label: p.plan, value: p.amount }))}
            format={(v) => formatMoney(v, c)}
            empty="No payments in this period."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function RenewalsSection({ data }: { data: Analytics }) {
  const { upcoming } = data;
  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Card>
        <CardHeader>
          <CardTitle>Up for renewal</CardTitle>
          <CardDescription>Memberships ending in the next 30 days, not yet renewed</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <div className="text-3xl font-semibold tabular-nums">{upcoming.expiring_30_days}</div>
            <p className="text-sm text-muted-foreground">
              {upcoming.expiring_30_days === 1 ? "member" : "members"} ·{" "}
              {formatMoney(upcoming.renewal_value, data.currency)} last time
            </p>
          </div>
          <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/reminders" />}>
            Renewals due
            <ArrowRightIcon />
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Renewal rate by month</CardTitle>
          <CardDescription>Of the memberships that ended, how many renewed</CardDescription>
        </CardHeader>
        <CardContent>
          <BarList
            rows={data.members
              .filter((m) => m.renewal_rate != null)
              .map((m) => ({
                label: monthLabel(m.month, true),
                value: m.renewal_rate ?? 0,
                note: `${m.renewed} of ${m.renewed + m.churned}`,
              }))}
            format={(v) => `${Math.round(v)}%`}
            empty="No memberships ended in this period."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Active members by plan</CardTitle>
          <CardDescription>Right now</CardDescription>
        </CardHeader>
        <CardContent>
          <BarList
            rows={data.active_by_plan.slice(0, 8).map((p) => ({ label: p.plan, value: p.members }))}
            empty="No active members."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function LeadsSection({ data }: { data: Analytics }) {
  const { leads } = data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle>Lead pipeline</CardTitle>
          <CardDescription>
            Where this period&apos;s {leads.total} {leads.total === 1 ? "lead is" : "leads are"} now
            {leads.avg_days_to_convert != null &&
              ` · ${leads.avg_days_to_convert} days to convert on average`}
          </CardDescription>
          <CardAction>
            <Button variant="ghost" size="sm" nativeButton={false} render={<Link href="/leads" />}>
              Leads
              <ArrowRightIcon />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent>
          <BarList
            rows={
              leads.total
                ? leads.by_stage.map((s) => ({ label: STAGE_LABELS[s.stage], value: s.leads }))
                : []
            }
            empty="No leads in this period."
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Conversion by source</CardTitle>
          <CardDescription>Which channels bring members, not just enquiries</CardDescription>
        </CardHeader>
        <CardContent>
          <BarList
            rows={leads.by_source.map((s) => ({
              label: SOURCE_LABELS[s.source],
              value: s.leads ? (s.converted * 100) / s.leads : 0,
              note: `${s.converted} of ${s.leads}`,
            }))}
            format={(v) => `${Math.round(v)}%`}
            empty="No leads in this period."
          />
        </CardContent>
      </Card>
    </div>
  );
}

function signed(v: number | null | undefined, unit: string) {
  if (v == null) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v)}${unit}`;
}

function ProgressSection({ data }: { data: Analytics }) {
  const p = data.checkups;
  const total = data.members.reduce((n, m) => n + m.checkups, 0);
  const stats = [
    { label: "Check-ups logged", value: total.toLocaleString() },
    { label: "Members with 2+ check-ups", value: p.members_tracked.toLocaleString() },
    {
      label: "On track for their goal",
      value: p.members_tracked ? `${Math.round((p.on_track * 100) / p.members_tracked)}%` : "—",
    },
    { label: "Average weight change", value: signed(p.avg_weight_change, " kg") },
    { label: "Average body fat change", value: signed(p.avg_body_fat_change, " pts") },
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>Member progress</CardTitle>
        <CardDescription>
          First vs latest check-up in this period. &ldquo;On track&rdquo; means moving the way the
          member&apos;s goal needs, e.g. weight down for weight loss.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6 lg:grid-cols-2">
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-3 lg:grid-cols-2">
          {stats.map((s) => (
            <div key={s.label}>
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
              <dd className="text-lg font-semibold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>
        <BarList
          rows={p.by_goal.map((g) => ({
            label: g.goal ? GOAL_LABELS[g.goal] : "No goal set",
            value: g.members ? (g.on_track * 100) / g.members : 0,
            note: `${g.on_track} of ${g.members}`,
          }))}
          format={(v) => `${Math.round(v)}% on track`}
          empty="Log at least two check-ups for a member to see progress here."
        />
      </CardContent>
    </Card>
  );
}

// --- Page body ---------------------------------------------------------------------------

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3">
      <h2 className="text-sm font-medium text-muted-foreground">{title}</h2>
      {children}
    </section>
  );
}

export function AnalyticsView({ data }: { data: Analytics }) {
  const k = data.kpis;
  const c = data.currency;
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <Kpi label="Active members" value={k.active_members.toLocaleString()} change={countChange(k.active_members, k.active_last_month)} hint="Same as last month" />
        <Kpi label="New this month" value={k.new_this_month.toLocaleString()} change={countChange(k.new_this_month, k.new_last_month)} hint="Same as last month" />
        <Kpi label="Revenue this month" value={formatMoney(k.revenue_this_month, c)} change={moneyChange(k.revenue_this_month, k.revenue_last_month)} hint="Payments received" />
        <Kpi label="Renewal rate" value={pctText(k.renewal_rate)} hint="Ended memberships that renewed" />
        <Kpi label="Lead conversion" value={pctText(k.lead_conversion_rate)} hint="Leads that became members" />
      </div>

      <Section title="Members">
        <MembersSection data={data} />
      </Section>
      <Section title="Renewals">
        <RenewalsSection data={data} />
      </Section>
      <Section title="Money">
        <MoneySection data={data} />
      </Section>
      <Section title="Leads">
        <LeadsSection data={data} />
      </Section>
      <Section title="Progress">
        <ProgressSection data={data} />
      </Section>
    </div>
  );
}
