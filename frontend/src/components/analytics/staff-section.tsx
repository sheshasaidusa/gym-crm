"use client";

import Link from "next/link";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useStaffAnalytics } from "@/lib/dashboard-queries";
import { formatMoney } from "@/lib/format";
import { useCurrency } from "@/lib/queries";

const pct = (v: number | null | undefined) => (v == null ? "—" : `${Math.round(v)}%`);

/** How each trainer and salesperson is doing. Trainer names open that trainer's dashboard. */
export function StaffSection({ months }: { months: number }) {
  const currency = useCurrency();
  const staff = useStaffAnalytics(months);

  if (staff.isPending) return <Skeleton className="h-48 w-full rounded-xl" />;
  if (staff.isError) return <p className="text-sm text-destructive">{staff.error.message}</p>;
  const { trainers, sales } = staff.data;

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Trainers</CardTitle>
          <CardDescription>Clients, renewals, check-up discipline and results</CardDescription>
        </CardHeader>
        <CardContent>
          {trainers.length === 0 ? (
            <p className="text-sm text-muted-foreground">No trainers yet. Invite some under Settings → Staff.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Trainer</TableHead>
                  <TableHead className="text-right">Clients</TableHead>
                  <TableHead className="text-right">Renewed</TableHead>
                  <TableHead className="text-right">Check-ups on time</TableHead>
                  <TableHead className="text-right">On track</TableHead>
                  <TableHead className="text-right">Avg weight</TableHead>
                  <TableHead className="text-right">Visits / client / wk</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {trainers.map((t) => (
                  <TableRow key={t.user_id}>
                    <TableCell className="font-medium">
                      <Link href={`/?trainer=${t.user_id}`} className="hover:underline">
                        {t.name}
                      </Link>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.active_clients}
                      <span className="text-muted-foreground"> / {t.clients}</span>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.renewal_rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(t.checkup_compliance)}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.members_tracked ? `${t.on_track} of ${t.members_tracked}` : "—"}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {t.avg_weight_change == null ? "—" : `${t.avg_weight_change > 0 ? "+" : ""}${t.avg_weight_change} kg`}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">{t.visits_per_client_week ?? "—"}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Sales</CardTitle>
          <CardDescription>Leads assigned to each person in this period, and what came of them</CardDescription>
        </CardHeader>
        <CardContent>
          {sales.length === 0 ? (
            <p className="text-sm text-muted-foreground">No assigned leads in this period.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="text-right">Leads</TableHead>
                  <TableHead className="text-right">Contacted</TableHead>
                  <TableHead className="text-right">Trials</TableHead>
                  <TableHead className="text-right">Joined</TableHead>
                  <TableHead className="text-right">Conversion</TableHead>
                  <TableHead className="text-right">Revenue</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sales.map((s) => (
                  <TableRow key={s.user_id}>
                    <TableCell className="font-medium">{s.name}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.leads}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.contacted}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.trials}</TableCell>
                    <TableCell className="text-right tabular-nums">{s.converted}</TableCell>
                    <TableCell className="text-right tabular-nums">{pct(s.conversion_rate)}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatMoney(s.revenue, currency)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
