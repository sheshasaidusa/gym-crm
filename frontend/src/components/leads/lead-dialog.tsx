"use client";

import { useState } from "react";

import { FollowUpPicker, fromLocalInput, toLocalInput } from "@/components/leads/follow-up";
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
import {
  SOURCE_LABELS,
  useCreateLead,
  useUpdateLead,
  type LeadDetail,
  type LeadSource,
} from "@/lib/lead-queries";
import { usePlans } from "@/lib/member-queries";
import { useMe, useStaff } from "@/lib/queries";

const NONE = "none";

type Draft = {
  name: string;
  phone: string;
  email: string;
  source: LeadSource;
  interest: string;
  interested_plan_id: string;
  assigned_to: string;
  follow_up: string;
  notes: string;
};

function toDraft(lead: LeadDetail | null, meId: string | undefined): Draft {
  return {
    name: lead?.name ?? "",
    phone: lead?.phone ?? "",
    email: lead?.email ?? "",
    source: lead?.source ?? "walk_in",
    interest: lead?.interest ?? "",
    interested_plan_id: lead?.interested_plan_id ?? NONE,
    assigned_to: lead ? (lead.assigned_to?.id ?? NONE) : (meId ?? NONE),
    follow_up: toLocalInput(lead?.next_follow_up_at),
    notes: lead?.notes ?? "",
  };
}

export function LeadDialog({
  lead,
  open,
  onOpenChange,
  onCreated,
}: {
  lead: LeadDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated?: (lead: LeadDetail) => void;
}) {
  const me = useMe();
  const staff = useStaff();
  const plans = usePlans();
  const create = useCreateLead();
  const update = useUpdateLead(lead?.id ?? "");
  const [draft, setDraft] = useState(() => toDraft(lead, me.data?.user.id));
  const [error, setError] = useState<string>();
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(toDraft(lead, me.data?.user.id));
      setError(undefined);
    }
  }
  const set = (patch: Partial<Draft>) => setDraft((d) => ({ ...d, ...patch }));

  const submit = () => {
    const digits = draft.phone.replace(/\D/g, "");
    if (draft.name.trim().length < 2) return setError("Enter the lead's name");
    if (digits.length < 7 || digits.length > 15) return setError("Enter a valid phone number");
    setError(undefined);
    const body = {
      name: draft.name,
      phone: draft.phone,
      email: draft.email.trim() || null,
      source: draft.source,
      interest: draft.interest.trim() || null,
      interested_plan_id: draft.interested_plan_id === NONE ? null : draft.interested_plan_id,
      assigned_to: draft.assigned_to === NONE ? null : draft.assigned_to,
      next_follow_up_at: fromLocalInput(draft.follow_up),
      notes: draft.notes.trim() || null,
    };
    if (lead) update.mutate(body, { onSuccess: () => onOpenChange(false) });
    else
      create.mutate(body, {
        onSuccess: (created) => {
          onOpenChange(false);
          onCreated?.(created);
        },
      });
  };
  const pending = create.isPending || update.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{lead ? "Edit lead" : "Add lead"}</DialogTitle>
          <DialogDescription>
            {lead ? "Update the enquiry details." : "Someone interested in joining? Capture them here."}
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="lead-name">Name</FieldLabel>
              <Input id="lead-name" value={draft.name} onChange={(e) => set({ name: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="lead-phone">Phone</FieldLabel>
              <Input id="lead-phone" type="tel" value={draft.phone} onChange={(e) => set({ phone: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="lead-email">Email (optional)</FieldLabel>
              <Input id="lead-email" type="email" value={draft.email} onChange={(e) => set({ email: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="lead-source">Source</FieldLabel>
              <SimpleSelect
                id="lead-source"
                options={Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))}
                value={draft.source}
                onChange={(v) => set({ source: v as LeadSource })}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="lead-interest">Interested in</FieldLabel>
            <Input
              id="lead-interest"
              placeholder="e.g. Weight loss, personal training, mornings"
              value={draft.interest}
              onChange={(e) => set({ interest: e.target.value })}
            />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="lead-plan">Plan they asked about</FieldLabel>
              <SimpleSelect
                id="lead-plan"
                options={[
                  { value: NONE, label: "Not sure yet" },
                  ...(plans.data ?? []).map((p) => ({ value: p.id, label: p.name })),
                ]}
                value={draft.interested_plan_id}
                onChange={(v) => set({ interested_plan_id: v })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="lead-assigned">Assigned to</FieldLabel>
              <SimpleSelect
                id="lead-assigned"
                options={[
                  { value: NONE, label: "Unassigned" },
                  ...(staff.data ?? []).map((s) => ({ value: s.user_id, label: s.name })),
                ]}
                value={draft.assigned_to}
                onChange={(v) => set({ assigned_to: v })}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="lead-follow-up">Next follow-up</FieldLabel>
            <FollowUpPicker id="lead-follow-up" value={draft.follow_up} onChange={(v) => set({ follow_up: v })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="lead-notes">Notes</FieldLabel>
            <Textarea id="lead-notes" rows={2} value={draft.notes} onChange={(e) => set({ notes: e.target.value })} />
          </Field>
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Spinner />}
            {lead ? "Save" : "Add lead"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
