"use client";

import { BanIcon, MoreHorizontalIcon, PlusIcon, ReceiptIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RecordPaymentDialog, VoidPaymentDialog, type Payable } from "@/components/finance/payment-dialogs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {due > 0 ? (
            <span className="font-medium text-red-600 dark:text-red-400">{formatMoney(due, currency)} due</span>
          ) : (
            "Nothing due"
          )}
          {payments.data && payments.data.amount_total > 0 && ` · ${formatMoney(payments.data.amount_total, currency)} paid in total`}
        </p>
        <Button size="sm" variant={due > 0 ? "default" : "outline"} onClick={() => setRecordOpen(true)}>
          <PlusIcon />
          Record payment
        </Button>
      </div>

      {payments.isPending ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : items.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
          No payments recorded yet.
        </p>
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Date</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Method</TableHead>
                <TableHead className="hidden md:table-cell">For</TableHead>
                <TableHead className="hidden sm:table-cell">Receipt</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((p) => (
                <TableRow key={p.id} className={cn(p.voided_at && "text-muted-foreground")}>
                  <TableCell className="pl-4">{formatDate(p.paid_on)}</TableCell>
                  <TableCell className="text-right">
                    <span className={cn("font-medium tabular-nums", p.voided_at && "line-through")}>
                      {formatMoney(p.amount, currency)}
                    </span>
                    {p.voided_at && (
                      <span
                        className="ml-2 rounded-full bg-red-500/15 px-2 py-0.5 text-xs text-red-700 dark:text-red-400"
                        title={p.void_reason ?? undefined}
                      >
                        Void
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{METHOD_LABELS[p.method]}</TableCell>
                  <TableCell className="hidden max-w-48 truncate text-muted-foreground md:table-cell">
                    {p.plan_name ?? p.note ?? "—"}
                  </TableCell>
                  <TableCell className="hidden font-mono text-xs text-muted-foreground sm:table-cell">{p.receipt_no}</TableCell>
                  <TableCell className="pr-2">
                    <div className="flex justify-end gap-1">
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Receipt ${p.receipt_no}`}
                        title="Open receipt"
                        nativeButton={false}
                        render={<Link href={`/receipts/${p.id}`} target="_blank" />}
                      >
                        <ReceiptIcon />
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
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <RecordPaymentDialog
        memberId={member.id}
        memberName={member.name}
        payables={payables}
        open={recordOpen}
        onOpenChange={setRecordOpen}
      />
      <VoidPaymentDialog payment={voiding} onDone={() => setVoiding(null)} />
    </div>
  );
}
