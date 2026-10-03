"use client";

import { useState } from "react";

import { MethodChips } from "@/components/finance/method-chips";
import { SimpleSelect } from "@/components/simple-select";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useRecordPayment, useVoidPayment, type Payment, type PaymentMethod } from "@/lib/finance-queries";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { useCurrency } from "@/lib/queries";

export type Payable = { id: string; plan_name: string; start_date: string; end_date: string; balance: number };

const OTHER = "none";

export function RecordPaymentDialog({
  memberId,
  memberName,
  payables,
  initialMembershipId,
  open,
  onOpenChange,
  onRecorded,
}: {
  memberId: string;
  memberName: string;
  payables: Payable[]; // memberships with a balance due
  initialMembershipId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRecorded?: (payment: Payment) => void;
}) {
  const currency = useCurrency();
  const record = useRecordPayment(memberId);
  const firstId = initialMembershipId ?? payables[0]?.id ?? OTHER;
  const [membershipId, setMembershipId] = useState(firstId);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<PaymentMethod>("cash");
  const [paidOn, setPaidOn] = useState(todayIso());
  const [reference, setReference] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string>();
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const id = initialMembershipId ?? payables[0]?.id ?? OTHER;
      setMembershipId(id);
      setAmount(String(payables.find((p) => p.id === id)?.balance ?? ""));
      setMethod("cash");
      setPaidOn(todayIso());
      setReference("");
      setNote("");
      setError(undefined);
    }
  }
  const selected = payables.find((p) => p.id === membershipId);

  const submit = () => {
    const n = Number(amount);
    if (!amount || Number.isNaN(n) || n <= 0) return setError("Enter the amount received");
    if (selected && n > selected.balance) return setError(`Only ${formatMoney(selected.balance, currency)} is due`);
    if (!selected && !note.trim()) return setError("Add a note saying what this payment is for");
    setError(undefined);
    record.mutate(
      {
        membership_id: selected?.id ?? null,
        amount: n,
        method,
        paid_on: paidOn,
        reference: reference.trim() || null,
        note: note.trim() || null,
      },
      {
        onSuccess: (p) => {
          onOpenChange(false);
          onRecorded?.(p);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Record payment</DialogTitle>
          <DialogDescription>From {memberName}</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="pay-for">For</FieldLabel>
            <SimpleSelect
              id="pay-for"
              options={[
                ...payables.map((p) => ({
                  value: p.id,
                  label: `${p.plan_name} (${formatDate(p.start_date, { year: false })}) · ${formatMoney(p.balance, currency)} due`,
                })),
                { value: OTHER, label: "Something else (PT, merchandise…)" },
              ]}
              value={membershipId}
              onChange={(v) => {
                setMembershipId(v);
                setAmount(String(payables.find((p) => p.id === v)?.balance ?? ""));
              }}
            />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="pay-amount">Amount ({currency})</FieldLabel>
              <Input id="pay-amount" type="number" min={0} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </Field>
            <Field>
              <FieldLabel htmlFor="pay-date">Date</FieldLabel>
              <Input id="pay-date" type="date" max={todayIso()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </Field>
          </div>
          <Field>
            <FieldLabel>Method</FieldLabel>
            <MethodChips value={method} onChange={setMethod} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pay-ref">Reference (optional)</FieldLabel>
            <Input id="pay-ref" placeholder="UPI / card transaction id" value={reference} onChange={(e) => setReference(e.target.value)} />
          </Field>
          <Field>
            <FieldLabel htmlFor="pay-note">Note {selected ? "(optional)" : ""}</FieldLabel>
            <Textarea id="pay-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </Field>
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={record.isPending}>
            {record.isPending && <Spinner />}
            Record payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function VoidPaymentDialog({
  payment,
  onDone,
}: {
  payment: Payment | null;
  onDone: () => void;
}) {
  const currency = useCurrency();
  const voidPayment = useVoidPayment();
  const [reason, setReason] = useState("");
  const [current, setCurrent] = useState<Payment | null>(null);
  if (payment !== current) {
    setCurrent(payment);
    setReason("");
  }
  return (
    <Dialog open={!!payment} onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Void {payment?.receipt_no}?</DialogTitle>
          <DialogDescription>
            {payment && formatMoney(payment.amount, currency)} from {payment?.member_name} will no
            longer count. The receipt stays in your records, marked void.
          </DialogDescription>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="void-reason">Reason</FieldLabel>
          <Textarea
            id="void-reason"
            rows={2}
            placeholder="e.g. Recorded against the wrong member"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={reason.trim().length < 2 || voidPayment.isPending}
            onClick={() => payment && voidPayment.mutate({ id: payment.id, reason: reason.trim() }, { onSuccess: onDone })}
          >
            {voidPayment.isPending && <Spinner />}
            Void payment
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
