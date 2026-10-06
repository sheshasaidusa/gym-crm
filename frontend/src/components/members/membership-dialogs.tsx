"use client";

import { useState } from "react";

import {
  draftToBody,
  emptyMembershipDraft,
  MembershipFields,
  resolveDraft,
  type MembershipDraft,
} from "@/components/members/membership-fields";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Spinner } from "@/components/ui/spinner";
import { addDays, formatDate, todayIso } from "@/lib/format";
import {
  useAddMembership,
  useFreezeMembership,
  usePlans,
  type Member,
  type Membership,
} from "@/lib/member-queries";

/** Renewals default to the day after the last running/upcoming membership ends. */
export function defaultStartDate(member: Member) {
  const today = todayIso();
  const lastEnd = member.memberships
    .filter((m) => m.status !== "cancelled" && m.end_date >= today)
    .map((m) => m.end_date)
    .sort()
    .at(-1);
  return lastEnd ? addDays(lastEnd, 1) : today;
}

export function AddMembershipDialog({
  member,
  open,
  onOpenChange,
}: {
  member: Member;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const add = useAddMembership(member.id);
  const plans = usePlans();
  const isFirst = !member.memberships.some((m) => m.status !== "cancelled");
  const [draft, setDraft] = useState<MembershipDraft>(() =>
    emptyMembershipDraft(defaultStartDate(member)),
  );
  const [planError, setPlanError] = useState<string>();

  // Reset the form each time the dialog opens, pre-filling the member's last plan
  // if it's still on sale.
  const lastPlanId = member.memberships.find((m) => m.status !== "cancelled")?.plan_id;
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      const stillSold = plans.data?.some((p) => p.id === lastPlanId);
      setDraft({
        ...emptyMembershipDraft(defaultStartDate(member)),
        plan_id: stillSold && lastPlanId ? lastPlanId : "",
      });
      setPlanError(undefined);
    }
  }

  const submit = () => {
    const plan = plans.data?.find((p) => p.id === draft.plan_id);
    if (!plan) return setPlanError("Choose a plan");
    if (resolveDraft(draft, plan, isFirst).error) return;
    add.mutate(draftToBody(draft, plan, isFirst), { onSuccess: () => onOpenChange(false) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isFirst ? "Add membership" : "Renew membership"}</DialogTitle>
          <DialogDescription>For {member.name}</DialogDescription>
        </DialogHeader>
        <MembershipFields
          value={draft}
          onChange={(d) => {
            setDraft(d);
            if (d.plan_id) setPlanError(undefined);
          }}
          isFirst={isFirst}
          planError={planError}
        />
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={add.isPending}>
            {add.isPending && <Spinner />}
            {isFirst ? "Add membership" : "Renew"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function FreezeDialog({
  membership,
  open,
  onOpenChange,
}: {
  membership: Membership | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const freeze = useFreezeMembership();
  const [days, setDays] = useState("7");
  const [start, setStart] = useState(todayIso());
  const [wasOpen, setWasOpen] = useState(open);

  const remaining = membership ? membership.max_freeze_days - membership.frozen_days : 0;
  const minStart =
    membership && membership.start_date > todayIso() ? membership.start_date : todayIso();
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDays(String(Math.min(7, remaining)));
      setStart(minStart);
    }
  }

  if (!membership) return null;
  const n = Number(days);
  const valid = Number.isInteger(n) && n >= 1 && n <= remaining;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Freeze membership</DialogTitle>
          <DialogDescription>
            The membership pauses and its end date moves out by the same number of days.{" "}
            {remaining} of {membership.max_freeze_days} freeze days left.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-4">
            <Field data-invalid={!valid}>
              <FieldLabel htmlFor="freeze_days">Days</FieldLabel>
              <Input
                id="freeze_days"
                type="number"
                min={1}
                max={remaining}
                value={days}
                aria-invalid={!valid}
                onChange={(e) => setDays(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="freeze_start">From</FieldLabel>
              <DatePicker
                id="freeze_start"
                min={minStart}
                max={membership.end_date}
                value={start}
                onChange={setStart}
              />
            </Field>
          </div>
          {valid && (
            <FieldDescription>
              Paused {formatDate(start)} – {formatDate(addDays(start, n - 1))}. New end date:{" "}
              <strong className="text-foreground">{formatDate(addDays(membership.end_date, n))}</strong>
            </FieldDescription>
          )}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={!valid || freeze.isPending}
            onClick={() =>
              freeze.mutate(
                { id: membership.id, days: n, start_date: start },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {freeze.isPending && <Spinner />}
            Freeze
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
