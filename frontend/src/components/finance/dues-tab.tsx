"use client";

import { MessageCircleIcon, WalletIcon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { RecordPaymentDialog } from "@/components/finance/payment-dialogs";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { useDues, type Due } from "@/lib/finance-queries";
import { formatDate, formatMoney } from "@/lib/format";
import { useCurrency, useMe } from "@/lib/queries";
import { whatsappUrl } from "@/lib/whatsapp";

export function DuesTab() {
  const currency = useCurrency();
  const me = useMe();
  const dues = useDues();
  const [paying, setPaying] = useState<Due | null>(null);

  if (dues.isPending) return <Skeleton className="h-64 w-full rounded-xl" />;
  const items = dues.data?.items ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Outstanding dues</CardTitle>
        <CardDescription>
          {items.length
            ? `${formatMoney(dues.data?.outstanding ?? 0, currency)} owed on ${items.length} membership${items.length === 1 ? "" : "s"} · oldest first`
            : "Everyone has paid in full."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <WalletIcon />
              </EmptyMedia>
              <EmptyTitle>No dues</EmptyTitle>
              <EmptyDescription>Memberships that aren&apos;t fully paid show up here.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <ul className="divide-y">
            {items.map((d) => {
              const message = `Hi ${d.member_name.split(" ")[0]}, a gentle reminder from ${me.data?.gym.name ?? "the gym"}: ${formatMoney(d.balance, currency)} is pending for your ${d.plan_name} membership. Thank you!`;
              return (
                <li key={d.membership_id} className="flex flex-wrap items-center gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <Link href={`/members/${d.member_id}`} className="font-medium hover:underline">
                      {d.member_name}
                    </Link>
                    <div className="text-xs text-muted-foreground">
                      {d.plan_name} · {formatDate(d.start_date, { year: false })} – {formatDate(d.end_date)} · paid{" "}
                      {formatMoney(d.paid, currency)} of {formatMoney(d.total, currency)}
                    </div>
                  </div>
                  <span className="font-medium text-red-600 tabular-nums dark:text-red-400">
                    {formatMoney(d.balance, currency)}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    nativeButton={false}
                    render={<a href={whatsappUrl(d.phone, message)} target="_blank" rel="noreferrer" />}
                  >
                    <MessageCircleIcon />
                    Remind
                  </Button>
                  <Button size="sm" onClick={() => setPaying(d)}>
                    Record payment
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </CardContent>
      {paying && (
        <RecordPaymentDialog
          memberId={paying.member_id}
          memberName={paying.member_name}
          payables={[
            {
              id: paying.membership_id,
              plan_name: paying.plan_name,
              start_date: paying.start_date,
              end_date: paying.end_date,
              balance: paying.balance,
            },
          ]}
          initialMembershipId={paying.membership_id}
          open
          onOpenChange={(o) => !o && setPaying(null)}
        />
      )}
    </Card>
  );
}
