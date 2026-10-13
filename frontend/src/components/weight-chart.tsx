"use client";

import { CartesianGrid, Line, LineChart, XAxis, YAxis } from "recharts";

import { ChartContainer, ChartTooltip, ChartTooltipContent, type ChartConfig } from "@/components/ui/chart";
import { formatDate } from "@/lib/format";

const config = { weight: { label: "Weight", color: "var(--series-1)" } } satisfies ChartConfig;

export function WeightChart({ points }: { points: { date: string; value: number }[] }) {
  const data = points.map((p) => ({ date: p.date, weight: p.value }));
  const values = points.map((p) => p.value);
  const pad = Math.max((Math.max(...values) - Math.min(...values)) * 0.2, 1);

  return (
    <ChartContainer config={config} className="aspect-auto h-36 w-full">
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }} accessibilityLayer>
        <CartesianGrid vertical={false} strokeOpacity={0.5} />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={24}
          tickFormatter={(d: string) => formatDate(d, { year: false })}
        />
        <YAxis
          width={32}
          tickLine={false}
          axisLine={false}
          allowDecimals={false}
          tickCount={4}
          domain={[Math.floor(Math.min(...values) - pad), Math.ceil(Math.max(...values) + pad)]}
        />
        <ChartTooltip
          cursor={{ strokeDasharray: "3 3" }}
          content={
            <ChartTooltipContent
              labelFormatter={(_, payload) => formatDate(payload?.[0]?.payload?.date)}
              formatter={(value) => <span className="font-medium tabular-nums">{String(value)} kg</span>}
            />
          }
        />
        <Line
          dataKey="weight"
          type="monotone"
          stroke="var(--color-weight)"
          strokeWidth={2}
          dot={{ r: 4, strokeWidth: 2, stroke: "var(--card)", fill: "var(--color-weight)" }}
          activeDot={{ r: 6, strokeWidth: 2, stroke: "var(--card)" }}
          isAnimationActive={false}
        />
      </LineChart>
    </ChartContainer>
  );
}
