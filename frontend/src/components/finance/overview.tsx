"use client";

import { ArrowDownIcon, ArrowUpIcon } from "lucide-react";
import { useState } from "react";
import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";

import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { CATEGORY_LABELS, METHOD_LABELS, useFinanceSummary } from "@/lib/finance-queries";
import { compactMoney, formatMoney, monthLabel } from "@/lib/format";
import { cn } from "@/lib/utils";

const chartConfig = {
  revenue: { label: "Revenue", color: "var(--series-1)" },
  expenses: { label: "Expenses", color: "var(--series-2)" },
} satisfies ChartConfig;

function Tile({
  label,
  value,
  previous,
  currency,
  invert,
  hint,
}: {
  label: string;
  value: number;
  previous?: number;
  currency: string;
  invert?: boolean; // for expenses, going up is bad
  hint?: string;
}) {
  const change = previous != null && previous !== 0 ? ((value - previous) / Math.abs(previous)) * 100 : null;
  const good = change == null ? null : invert ? change <= 0 : change >= 0;
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <div className="text-2xl font-semibold tracking-tight tabular-nums">{formatMoney(value, currency)}</div>
        {change != null ? (
          <p className="flex items-center gap-1 text-xs text-muted-foreground">
            {change >= 0 ? <ArrowUpIcon className="size-3" aria-hidden /> : <ArrowDownIcon className="size-3" aria-hidden />}
            <span className={cn(good ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400")}>
              {Math.abs(change).toFixed(0)}%
            </span>
            vs last month
          </p>
        ) : (
          hint && <p className="text-xs text-muted-foreground">{hint}</p>
        )}
      </CardHeader>
    </Card>
  );
}

function Breakdown({ title, rows, currency }: { title: string; rows: [string, number][]; currency: string }) {
  const max = Math.max(...rows.map(([, v]) => v), 1);
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle className="text-sm">{title}</CardTitle>
      </CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nothing yet this month.</p>
        ) : (
          <ul className="grid gap-2">
            {rows.map(([label, value]) => (
              <li key={label} className="grid gap-1 text-sm">
                <div className="flex justify-between gap-2">
                  <span>{label}</span>
                  <span className="tabular-nums">{formatMoney(value, currency)}</span>
                </div>
                <div className="h-1.5 rounded-full bg-muted">
                  <div className="h-full rounded-full bg-foreground/60" style={{ width: `${(value / max) * 100}%` }} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}

export function FinanceOverview() {
  const [months, setMonths] = useState(6);
  const summary = useFinanceSummary(months);

  if (summary.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (summary.isError) return <p className="text-sm text-destructive">{summary.error.message}</p>;
  const s = summary.data;
  const c = s.currency;
  const data = s.months.map((m) => ({ ...m, label: monthLabel(m.month) }));

  return (
    <div className="grid gap-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Tile label={`Revenue · ${monthLabel(s.this_month.month, true)}`} value={s.this_month.revenue} previous={s.last_month.revenue} currency={c} />
        <Tile label="Expenses" value={s.this_month.expenses} previous={s.last_month.expenses} currency={c} invert />
        <Tile label="Profit" value={s.this_month.profit} previous={s.last_month.profit} currency={c} />
        <Tile label="Outstanding dues" value={s.outstanding_dues} currency={c} hint="Owed on memberships" />
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Revenue vs expenses</CardTitle>
          <CardDescription>Payments received and money spent each month</CardDescription>
          <CardAction>
            <div className="flex rounded-lg border p-0.5">
              {[6, 12].map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => setMonths(n)}
                  className={cn("rounded-md px-2.5 py-1 text-xs", months === n ? "bg-muted font-medium" : "text-muted-foreground")}
                >
                  {n} months
                </button>
              ))}
            </div>
          </CardAction>
        </CardHeader>
        <CardContent>
          <ChartContainer config={chartConfig} className="aspect-auto h-64 w-full">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} barGap={2} accessibilityLayer>
              <CartesianGrid vertical={false} strokeOpacity={0.5} />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
              <YAxis width={56} tickLine={false} axisLine={false} tickFormatter={(v: number) => compactMoney(v, c)} />
              <ChartTooltip
                cursor={{ fillOpacity: 0.3 }}
                content={
                  <ChartTooltipContent
                    labelFormatter={(_, payload) => monthLabel(payload?.[0]?.payload?.month ?? "", true)}
                    formatter={(value, name) => (
                      <div className="flex w-full justify-between gap-4">
                        <span className="text-muted-foreground">{chartConfig[name as keyof typeof chartConfig]?.label}</span>
                        <span className="font-medium tabular-nums">{formatMoney(Number(value), c)}</span>
                      </div>
                    )}
                  />
                }
              />
              <ChartLegend
                content={<ChartLegendContent />}
                itemSorter={(item) => (item.dataKey === "revenue" ? 0 : 1)}
              />
              <Bar dataKey="revenue" fill="var(--color-revenue)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
              <Bar dataKey="expenses" fill="var(--color-expenses)" radius={[4, 4, 0, 0]} maxBarSize={28} isAnimationActive={false} />
            </BarChart>
          </ChartContainer>
          <table className="sr-only">
            <caption>Revenue and expenses by month</caption>
            <thead>
              <tr>
                <th>Month</th>
                <th>Revenue</th>
                <th>Expenses</th>
                <th>Profit</th>
              </tr>
            </thead>
            <tbody>
              {s.months.map((m) => (
                <tr key={m.month}>
                  <td>{monthLabel(m.month, true)}</td>
                  <td>{formatMoney(m.revenue, c)}</td>
                  <td>{formatMoney(m.expenses, c)}</td>
                  <td>{formatMoney(m.profit, c)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Breakdown
          title="Payments by method · this month"
          currency={c}
          rows={Object.entries(s.revenue_by_method)
            .map(([k, v]) => [METHOD_LABELS[k as keyof typeof METHOD_LABELS], v] as [string, number])
            .sort((a, b) => b[1] - a[1])}
        />
        <Breakdown
          title="Expenses by category · this month"
          currency={c}
          rows={Object.entries(s.expenses_by_category)
            .map(([k, v]) => [CATEGORY_LABELS[k as keyof typeof CATEGORY_LABELS], v] as [string, number])
            .sort((a, b) => b[1] - a[1])}
        />
      </div>
    </div>
  );
}
