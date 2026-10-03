"use client";

import { BanIcon, MoreHorizontalIcon, PlusIcon, ReceiptIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RecordPaymentDialog, VoidPaymentDialog, type Payable } from "@/components/finance/payment-dialogs";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { METHOD_LABELS, usePayments, type Payment } from "@/lib/finance-queries";
import { formatDate, formatMoney } from "@/lib/format";
import type { Member } from "@/lib/member-queries";
import { useCan, useCurrency } from "@/lib/queries";
import { cn } from "@/lib/utils";

/** Member page: what's owed, payment history, record/void, receipts. */
export function MemberPayments({ member }: { member: Member }) {
  const can = useCan();
  const currency = useCurrency();
  const payments = usePayments({ member_id: member.id, page_size: 50 });
  const [recordOpen, setRecordOpen] = useState(false);
  const [voiding, setVoiding] = useState<Payment | null>(null);

  const payables: Payable[] = member.memberships
    .filter((m) => m.status !== "cancelled" && m.balance > 0)
    .map((m) => ({ id: m.id, plan_name: m.plan_name, start_date: m.start_date, end_date: m.end_date, balance: m.balance }))
    // Oldest first, so the default is the membership that has been owed longest.
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
  const due = payables.reduce((s, p) => s + p.balance, 0);
  const items = payments.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Payments</CardTitle>
        <CardDescription>
          {due > 0 ? (
            <span className="font-medium text-red-600 dark:text-red-400">{formatMoney(due, currency)} due</span>
          ) : (
            "Nothing due"
          )}
          {payments.data && payments.data.amount_total > 0 && ` · ${formatMoney(payments.data.amount_total, currency)} paid in total`}
        </CardDescription>
        <CardAction>
          <Button size="sm" variant={due > 0 ? "default" : "outline"} onClick={() => setRecordOpen(true)}>
            <PlusIcon />
            Record payment
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {payments.isPending ? (
          <Skeleton className="h-16 w-full" />
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">No payments recorded yet.</p>
        ) : (
          <ul className="divide-y">
            {items.map((p) => (
              <li key={p.id} className={cn("flex flex-wrap items-center gap-3 py-2.5 text-sm", p.voided_at && "opacity-60")}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={cn("font-medium tabular-nums", p.voided_at && "line-through")}>
                      {formatMoney(p.amount, currency)}
                    </span>
                    <span className="text-muted-foreground">{METHOD_LABELS[p.method]}</span>
                    {p.voided_at && (
                      <span className="rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-700 dark:text-red-400" title={p.void_reason ?? undefined}>
                        Void
                      </span>
                    )}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {formatDate(p.paid_on)} · {p.receipt_no}
                    {p.plan_name ? ` · ${p.plan_name}` : p.note ? ` · ${p.note}` : ""}
                  </div>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  nativeButton={false}
                  render={<Link href={`/receipts/${p.id}`} target="_blank" />}
                >
                  <ReceiptIcon />
                  Receipt
                </Button>
                {can.manage && !p.voided_at && (
                  <DropdownMenu>
                    <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Payment actions" />}>
                      <MoreHorizontalIcon />
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="min-w-40">
                      <DropdownMenuItem variant="destructive" onClick={() => setVoiding(p)}>
                        <BanIcon />
                        Void payment
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </li>
            ))}
          </ul>
        )}
      </CardContent>
      <RecordPaymentDialog
        memberId={member.id}
        memberName={member.name}
        payables={payables}
        open={recordOpen}
        onOpenChange={setRecordOpen}
      />
      <VoidPaymentDialog payment={voiding} onDone={() => setVoiding(null)} />
    </Card>
  );
}
