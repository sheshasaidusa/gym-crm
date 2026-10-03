"use client";

import { SimpleSelect } from "@/components/simple-select";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  durationLabel,
  formatDate,
  formatMoney,
  membershipEnd,
  membershipTotal,
} from "@/lib/format";
import { MethodChips } from "@/components/finance/method-chips";
import { Switch } from "@/components/ui/switch";
import type { PaymentMethod } from "@/lib/finance-queries";
import { usePlans, type Plan } from "@/lib/member-queries";
import { useCurrency } from "@/lib/queries";

export type MembershipDraft = {
  plan_id: string;
  start_date: string;
  price: string; // "" = plan price
  discount: string;
  joining_fee: string; // "" = plan default
  pay_now: boolean; // record a payment along with the membership
  pay_amount: string; // "" = the full total
  pay_method: PaymentMethod;
  pay_reference: string;
};

export const emptyMembershipDraft = (start: string): MembershipDraft => ({
  plan_id: "",
  start_date: start,
  price: "",
  discount: "",
  joining_fee: "",
  pay_now: true,
  pay_amount: "",
  pay_method: "cash",
  pay_reference: "",
});

/** Resolves a draft against its plan: the numbers the API will use. */
export function resolveDraft(draft: MembershipDraft, plan: Plan | undefined, isFirst: boolean) {
  const price = draft.price === "" ? (plan?.price ?? 0) : Number(draft.price);
  const discount = draft.discount === "" ? 0 : Number(draft.discount);
  const joiningFee =
    draft.joining_fee === "" ? (isFirst ? (plan?.joining_fee ?? 0) : 0) : Number(draft.joining_fee);
  const taxPct = plan?.tax_pct ?? 0;
  const total = membershipTotal(price, discount, joiningFee, taxPct);
  const payAmount = draft.pay_amount === "" ? total : Number(draft.pay_amount);
  return {
    price,
    discount,
    joiningFee,
    taxPct,
    total,
    payAmount,
    error:
      discount > price
        ? "Discount can't be more than the price"
        : [price, discount, joiningFee].some((n) => Number.isNaN(n) || n < 0)
          ? "Amounts must be positive numbers"
          : draft.pay_now && (Number.isNaN(payAmount) || payAmount < 0)
            ? "Enter a valid amount received"
            : draft.pay_now && payAmount > total
              ? "Amount received can't be more than the total"
              : null,
  };
}

/** API body for a draft (only overrides that differ from plan defaults are sent). */
export function draftToBody(draft: MembershipDraft, plan: Plan | undefined, isFirst: boolean) {
  const { payAmount } = resolveDraft(draft, plan, isFirst);
  return {
    plan_id: draft.plan_id,
    start_date: draft.start_date || null,
    price: draft.price === "" ? null : Number(draft.price),
    discount: draft.discount === "" ? 0 : Number(draft.discount),
    joining_fee: draft.joining_fee === "" ? null : Number(draft.joining_fee),
    payment:
      draft.pay_now && payAmount > 0
        ? {
            amount: payAmount,
            method: draft.pay_method,
            reference: draft.pay_reference.trim() || null,
          }
        : null,
  };
}

export function MembershipFields({
  value,
  onChange,
  isFirst,
  planError,
}: {
  value: MembershipDraft;
  onChange: (value: MembershipDraft) => void;
  isFirst: boolean;
  planError?: string;
}) {
  const currency = useCurrency();
  const plans = usePlans();
  const plan = plans.data?.find((p) => p.id === value.plan_id);
  const r = resolveDraft(value, plan, isFirst);
  const set = (patch: Partial<MembershipDraft>) => onChange({ ...value, ...patch });

  if (plans.isPending) return <Skeleton className="h-40 w-full" />;
  if (!plans.data?.length) {
    return (
      <p className="text-sm text-muted-foreground">
        No plans yet. Create one on the Plans page first.
      </p>
    );
  }

  return (
    <FieldGroup>
      <Field data-invalid={!!planError}>
        <FieldLabel htmlFor="plan_id">Plan</FieldLabel>
        <SimpleSelect
          id="plan_id"
          placeholder="Choose a plan"
          invalid={!!planError}
          options={plans.data.map((p) => ({
            value: p.id,
            label: `${p.name} · ${formatMoney(p.price, currency)}`,
          }))}
          value={value.plan_id}
          onChange={(plan_id) => set({ plan_id, price: "" })}
        />
        {plan && (
          <FieldDescription>
            {durationLabel(plan.duration_value, plan.duration_unit)}
            {plan.services.length > 0 && ` · ${plan.services.join(", ")}`}
          </FieldDescription>
        )}
        {planError && <FieldError>{planError}</FieldError>}
      </Field>

      <div className="grid grid-cols-2 gap-4">
        <Field>
          <FieldLabel htmlFor="start_date">Starts on</FieldLabel>
          <Input
            id="start_date"
            type="date"
            value={value.start_date}
            onChange={(e) => set({ start_date: e.target.value })}
          />
        </Field>
        <Field>
          <FieldLabel>Ends on</FieldLabel>
          <div className="flex h-8 items-center text-sm">
            {plan && value.start_date
              ? formatDate(membershipEnd(value.start_date, plan.duration_value, plan.duration_unit))
              : "—"}
          </div>
        </Field>
      </div>

      {plan && (
        <>
          <div className="grid grid-cols-3 gap-3">
            <Field>
              <FieldLabel htmlFor="ms_price">Price</FieldLabel>
              <Input
                id="ms_price"
                type="number"
                min={0}
                inputMode="decimal"
                placeholder={String(plan.price)}
                value={value.price}
                onChange={(e) => set({ price: e.target.value })}
              />
            </Field>
            <Field data-invalid={!!r.error}>
              <FieldLabel htmlFor="ms_discount">Discount</FieldLabel>
              <Input
                id="ms_discount"
                type="number"
                min={0}
                inputMode="decimal"
                placeholder="0"
                aria-invalid={!!r.error}
                value={value.discount}
                onChange={(e) => set({ discount: e.target.value })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="ms_joining">Joining fee</FieldLabel>
              <Input
                id="ms_joining"
                type="number"
                min={0}
                inputMode="decimal"
                placeholder={String(isFirst ? plan.joining_fee : 0)}
                value={value.joining_fee}
                onChange={(e) => set({ joining_fee: e.target.value })}
              />
            </Field>
          </div>
          {r.error && <FieldError>{r.error}</FieldError>}

          <dl className="grid gap-1 rounded-lg bg-muted px-3 py-2 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted-foreground">Plan price</dt>
              <dd>{formatMoney(r.price, currency)}</dd>
            </div>
            {r.discount > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Discount</dt>
                <dd>−{formatMoney(r.discount, currency)}</dd>
              </div>
            )}
            {r.joiningFee > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Joining fee</dt>
                <dd>{formatMoney(r.joiningFee, currency)}</dd>
              </div>
            )}
            {r.taxPct > 0 && (
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Tax ({r.taxPct}%)</dt>
                <dd>
                  {formatMoney(r.total - (Math.max(r.price - r.discount, 0) + r.joiningFee), currency)}
                </dd>
              </div>
            )}
            <div className="flex justify-between border-t pt-1 font-medium">
              <dt>Total</dt>
              <dd>{formatMoney(r.total, currency)}</dd>
            </div>
          </dl>

          <div className="grid gap-3 rounded-lg border p-3">
            <label className="flex items-center justify-between gap-2 text-sm font-medium">
              Payment received now
              <Switch
                checked={value.pay_now}
                onCheckedChange={(pay_now) => set({ pay_now })}
              />
            </label>
            {value.pay_now && (
              <>
                <div className="grid grid-cols-2 gap-3">
                  <Field>
                    <FieldLabel htmlFor="ms_pay_amount">Amount</FieldLabel>
                    <Input
                      id="ms_pay_amount"
                      type="number"
                      min={0}
                      inputMode="decimal"
                      placeholder={String(r.total)}
                      value={value.pay_amount}
                      onChange={(e) => set({ pay_amount: e.target.value })}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="ms_pay_ref">Reference (optional)</FieldLabel>
                    <Input
                      id="ms_pay_ref"
                      placeholder="UPI / card txn id"
                      value={value.pay_reference}
                      onChange={(e) => set({ pay_reference: e.target.value })}
                    />
                  </Field>
                </div>
                <MethodChips value={value.pay_method} onChange={(pay_method) => set({ pay_method })} />
                {r.payAmount < r.total && r.payAmount >= 0 && (
                  <FieldDescription>
                    {formatMoney(r.total - r.payAmount, currency)} will show as due.
                  </FieldDescription>
                )}
              </>
            )}
          </div>
        </>
      )}
    </FieldGroup>
  );
}
