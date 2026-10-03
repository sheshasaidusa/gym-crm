"use client";

import { DumbbellIcon, MessageCircleIcon, PrinterIcon } from "lucide-react";
import { useParams } from "next/navigation";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { METHOD_LABELS, useReceipt } from "@/lib/finance-queries";
import { formatDate, formatMoney } from "@/lib/format";
import { whatsappUrl } from "@/lib/whatsapp";

function Row({ label, children, strong }: { label: string; children: React.ReactNode; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-4 py-1.5 ${strong ? "font-semibold" : ""}`}>
      <dt className={strong ? "" : "text-neutral-500"}>{label}</dt>
      <dd className="text-right tabular-nums">{children}</dd>
    </div>
  );
}

export default function ReceiptPage() {
  const { id } = useParams<{ id: string }>();
  const receipt = useReceipt(id);

  if (receipt.isPending) {
    return (
      <main className="mx-auto max-w-lg p-6">
        <Skeleton className="h-[600px] w-full" />
      </main>
    );
  }
  if (receipt.isError) {
    return <main className="p-6 text-sm text-destructive">{receipt.error.message}</main>;
  }

  const { payment: p, gym, membership: ms } = receipt.data;
  const money = (n: number) => formatMoney(n, gym.currency);
  const shareText = `${gym.name} – payment receipt ${p.receipt_no}\nReceived ${money(p.amount)} from ${p.member_name} on ${formatDate(p.paid_on)} (${METHOD_LABELS[p.method]}).${ms ? `\n${ms.plan_name}: ${money(ms.balance)} remaining.` : ""}\nThank you!`;

  return (
    // A receipt is a document: always light, regardless of the app theme.
    <main className="min-h-svh bg-neutral-100 py-6 text-neutral-900 print:bg-white print:py-0">
      <div className="mx-auto mb-4 flex max-w-lg justify-end gap-2 px-4 print:hidden">
        <Button
          variant="outline"
          className="bg-white text-neutral-900"
          nativeButton={false}
          render={<a href={whatsappUrl(receipt.data.member_phone, shareText)} target="_blank" rel="noreferrer" />}
        >
          <MessageCircleIcon />
          Send on WhatsApp
        </Button>
        <Button onClick={() => window.print()}>
          <PrinterIcon />
          Print / Save PDF
        </Button>
      </div>

      <article className="mx-auto max-w-lg bg-white p-8 shadow-sm print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-start justify-between gap-4 border-b pb-5">
          <div className="flex items-center gap-3">
            {gym.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element -- gym logo
              <img src={gym.logo_url} alt="" className="size-12 object-contain" />
            ) : (
              <div
                className="flex size-12 items-center justify-center rounded-lg text-white"
                style={{ backgroundColor: gym.brand_color }}
              >
                <DumbbellIcon className="size-6" />
              </div>
            )}
            <div>
              <div className="text-lg font-semibold">{gym.name}</div>
              {gym.address && <div className="text-xs text-neutral-500">{gym.address}</div>}
              {gym.phone && <div className="text-xs text-neutral-500">{gym.phone}</div>}
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs tracking-wide text-neutral-500 uppercase">Receipt</div>
            <div className="font-mono font-semibold">{p.receipt_no}</div>
            <div className="text-xs text-neutral-500">{formatDate(p.paid_on)}</div>
          </div>
        </header>

        {p.voided_at && (
          <div className="mt-4 rounded-md border-2 border-red-600 p-2 text-center font-semibold text-red-600">
            VOID{p.void_reason ? ` – ${p.void_reason}` : ""}
          </div>
        )}

        <section className="mt-5 text-sm">
          <div className="text-xs tracking-wide text-neutral-500 uppercase">Received from</div>
          <div className="font-medium">{p.member_name}</div>
          <div className="text-neutral-500">{receipt.data.member_phone}</div>
        </section>

        <dl className="mt-5 divide-y border-y text-sm">
          <Row label="For">{ms ? ms.plan_name : (p.note ?? "Payment")}</Row>
          {ms && (
            <Row label="Membership period">
              {formatDate(ms.start_date)} – {formatDate(ms.end_date)}
            </Row>
          )}
          <Row label="Payment method">
            {METHOD_LABELS[p.method]}
            {p.reference && <span className="block text-xs text-neutral-500">Ref: {p.reference}</span>}
          </Row>
          <Row label="Amount received" strong>
            {money(p.amount)}
          </Row>
        </dl>

        {ms && (
          <dl className="mt-4 text-sm">
            <Row label="Membership total">{money(ms.total)}</Row>
            <Row label="Paid so far">{money(ms.paid)}</Row>
            <Row label="Balance due" strong>
              {money(ms.balance)}
            </Row>
          </dl>
        )}

        {p.note && ms && <p className="mt-4 text-sm text-neutral-500">Note: {p.note}</p>}

        <footer className="mt-8 border-t pt-4 text-center text-xs text-neutral-500">
          {p.recorded_by && <div>Received by {p.recorded_by.name}</div>}
          <div>Thank you for training with {gym.name}.</div>
        </footer>
      </article>
    </main>
  );
}
