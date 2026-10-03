"use client";

import { BanIcon, ChevronLeftIcon, ChevronRightIcon, ReceiptIcon, SearchIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";

import { VoidPaymentDialog } from "@/components/finance/payment-dialogs";
import { SimpleSelect } from "@/components/simple-select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { METHOD_LABELS, usePayments, type Payment, type PaymentMethod } from "@/lib/finance-queries";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { useCan, useCurrency } from "@/lib/queries";
import { cn } from "@/lib/utils";

const ALL = "all";

function monthRange(offset: number) {
  const d = new Date();
  const first = new Date(d.getFullYear(), d.getMonth() + offset, 1);
  const last = new Date(d.getFullYear(), d.getMonth() + offset + 1, 0);
  const iso = (x: Date) =>
    `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
  return { date_from: iso(first), date_to: offset === 0 ? todayIso() : iso(last) };
}

export const PERIODS = [
  { value: "this_month", label: "This month", range: () => monthRange(0) },
  { value: "last_month", label: "Last month", range: () => monthRange(-1) },
  { value: "all", label: "All time", range: () => ({}) },
] as const;

export function PaymentsTab() {
  const can = useCan();
  const currency = useCurrency();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [method, setMethod] = useState<string>(ALL);
  const [period, setPeriod] = useState<string>("this_month");
  const [page, setPage] = useState(1);
  const [voiding, setVoiding] = useState<Payment | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQ(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const range = PERIODS.find((p) => p.value === period)?.range() ?? {};
  const payments = usePayments({
    ...range,
    q: q || undefined,
    method: method === ALL ? undefined : (method as PaymentMethod),
    page,
    page_size: 25,
  });
  const data = payments.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search payments"
            placeholder="Search member or receipt no."
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <SimpleSelect
          className="w-auto min-w-36"
          options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setPage(1);
          }}
        />
        <SimpleSelect
          className="w-auto min-w-36"
          options={[{ value: ALL, label: "All methods" }, ...Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label }))]}
          value={method}
          onChange={(v) => {
            setMethod(v);
            setPage(1);
          }}
        />
      </div>

      {payments.isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <Card className="py-0">
          <Table className={cn(payments.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Member</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="hidden md:table-cell">Method</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead className="hidden lg:table-cell">Receipt</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={6} className="py-8 text-center text-muted-foreground">
                    No payments in this period.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((p) => (
                  <TableRow key={p.id} className={cn(p.voided_at && "opacity-60")}>
                    <TableCell className="pl-4">
                      <Link href={`/members/${p.member_id}`} className="font-medium hover:underline">
                        {p.member_name}
                      </Link>
                      <div className="text-xs text-muted-foreground">{p.plan_name ?? p.note ?? "—"}</div>
                    </TableCell>
                    <TableCell className="tabular-nums">
                      <span className={cn(p.voided_at && "line-through")}>{formatMoney(p.amount, currency)}</span>
                      {p.voided_at && (
                        <span className="ml-1 text-xs text-red-600 dark:text-red-400" title={p.void_reason ?? undefined}>
                          void
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{METHOD_LABELS[p.method]}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(p.paid_on, { year: false })}</TableCell>
                    <TableCell className="hidden font-mono text-xs text-muted-foreground lg:table-cell">{p.receipt_no}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Receipt ${p.receipt_no}`}
                        nativeButton={false}
                        render={<Link href={`/receipts/${p.id}`} target="_blank" />}
                      >
                        <ReceiptIcon />
                      </Button>
                      {can.manage && !p.voided_at && (
                        <Button variant="ghost" size="icon-sm" aria-label={`Void ${p.receipt_no}`} onClick={() => setVoiding(p)}>
                          <BanIcon />
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
            <span>
              {data?.total ?? 0} payments · <strong className="text-foreground">{formatMoney(data?.amount_total ?? 0, currency)}</strong> received
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeftIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </Card>
      )}
      <VoidPaymentDialog payment={voiding} onDone={() => setVoiding(null)} />
    </div>
  );
}
