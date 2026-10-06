"use client";

import { DownloadIcon, FileUpIcon } from "lucide-react";
import Link from "next/link";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const EXPORTS = [
  { entity: "members", title: "Members", text: "Profiles with their current plan, status and balance due." },
  { entity: "memberships", title: "Memberships", text: "Every membership sold, with totals, paid and balance." },
  { entity: "payments", title: "Payments", text: "All receipts, including voided ones and why." },
  { entity: "expenses", title: "Expenses", text: "Everything spent, by category and branch." },
  { entity: "plans", title: "Plans", text: "Your membership plans and prices." },
  { entity: "leads", title: "Leads", text: "Every enquiry with its source and stage." },
  { entity: "checkups", title: "Check-ups", text: "Weight and measurements for every member." },
] as const;

export function DataSettings() {
  return (
    <div className="grid gap-8 [&>*+*]:border-t [&>*+*]:border-border/70 [&>*+*]:pt-8">
      <Card variant="flat">
        <CardHeader>
          <CardTitle>Export your data</CardTitle>
          <CardDescription>
            CSV files that open in Excel or Google Sheets, for backups or your accountant. Members and
            plans use the same columns as the import, so they can be imported again.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="divide-y rounded-lg border">
            {EXPORTS.map((e) => (
              <li key={e.entity} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium">{e.title}</p>
                  <p className="text-xs text-muted-foreground">{e.text}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  nativeButton={false}
                  render={<a href={`/api/exports/${e.entity}.csv`} download />}
                >
                  <DownloadIcon />
                  CSV
                </Button>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      <Card size="sm" variant="flat">
        <CardHeader>
          <CardTitle>Bring data in</CardTitle>
          <CardDescription>Import members, plans, payments, check-ups and leads from spreadsheets.</CardDescription>
          <CardAction>
            <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/import" />}>
              <FileUpIcon />
              Import data
            </Button>
          </CardAction>
        </CardHeader>
      </Card>
    </div>
  );
}
