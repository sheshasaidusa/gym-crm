"use client";

import {
  ArrowRightIcon,
  FootprintsIcon,
  MessageCircleIcon,
  PencilIcon,
  PhoneIcon,
  StickyNoteIcon,
  Trash2Icon,
  UserCheckIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { FollowUpBadge, FollowUpPicker, fromLocalInput } from "@/components/leads/follow-up";
import { LeadDialog } from "@/components/leads/lead-dialog";
import { needsDialog, StageDialog, type PendingMove } from "@/components/leads/stage-dialog";
import {
  draftToBody,
  emptyMembershipDraft,
  MembershipFields,
  resolveDraft,
  type MembershipDraft,
} from "@/components/members/membership-fields";
import { SimpleSelect } from "@/components/simple-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { formatDate, todayIso } from "@/lib/format";
import {
  SOURCE_LABELS,
  STAGES,
  useConvertLead,
  useDeleteLead,
  useLead,
  useLogActivity,
  useMoveLead,
  type LeadDetail,
  type LeadStage,
} from "@/lib/lead-queries";
import { usePlans } from "@/lib/member-queries";
import { useCan } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { whatsappUrl } from "@/lib/whatsapp";

type ActivityKind = LeadDetail["activities"][number]["kind"];

const LOG_KINDS: { value: "note" | "call" | "whatsapp" | "visit"; label: string; icon: LucideIcon }[] = [
  { value: "call", label: "Call", icon: PhoneIcon },
  { value: "whatsapp", label: "WhatsApp", icon: MessageCircleIcon },
  { value: "visit", label: "Visit", icon: FootprintsIcon },
  { value: "note", label: "Note", icon: StickyNoteIcon },
];

const KIND_ICON: Partial<Record<ActivityKind, LucideIcon>> = {
  call: PhoneIcon,
  whatsapp: MessageCircleIcon,
  visit: FootprintsIcon,
  note: StickyNoteIcon,
  stage: ArrowRightIcon,
  converted: UserCheckIcon,
};

function when(iso: string) {
  return new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
}

function ConvertDialog({
  lead,
  open,
  onOpenChange,
}: {
  lead: LeadDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const router = useRouter();
  const plans = usePlans();
  const convert = useConvertLead(lead.id);
  const [withMembership, setWithMembership] = useState(true);
  const [draft, setDraft] = useState<MembershipDraft>(() => ({
    ...emptyMembershipDraft(todayIso()),
    plan_id: lead.interested_plan_id ?? "",
  }));
  const [planError, setPlanError] = useState<string>();
  const hasPlans = (plans.data?.length ?? 0) > 0;

  const submit = () => {
    let membership = null;
    if (withMembership && hasPlans) {
      const plan = plans.data?.find((p) => p.id === draft.plan_id);
      if (!plan) return setPlanError("Choose a plan, or switch off the membership");
      if (resolveDraft(draft, plan, true).error) return;
      membership = draftToBody(draft, plan, true);
    }
    convert.mutate(
      { membership },
      {
        onSuccess: (l) => {
          onOpenChange(false);
          if (l.converted_member_id) router.push(`/members/${l.converted_member_id}`);
        },
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Convert {lead.name} to a member</DialogTitle>
          <DialogDescription>
            Creates the member with their name, phone and email. You can complete their profile
            afterwards.
          </DialogDescription>
        </DialogHeader>
        {hasPlans && (
          <label className="flex items-center justify-between gap-2 text-sm font-medium">
            Sell a membership now
            <Switch checked={withMembership} onCheckedChange={setWithMembership} />
          </label>
        )}
        {withMembership && hasPlans && (
          <MembershipFields
            value={draft}
            onChange={(d) => {
              setDraft(d);
              if (d.plan_id) setPlanError(undefined);
            }}
            isFirst
            planError={planError}
          />
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={convert.isPending}>
            {convert.isPending ? <Spinner /> : <UserCheckIcon />}
            Convert to member
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActivityLogger({ lead }: { lead: LeadDetail }) {
  const logActivity = useLogActivity(lead.id);
  const [kind, setKind] = useState<(typeof LOG_KINDS)[number]["value"]>("call");
  const [content, setContent] = useState("");
  const [followUp, setFollowUp] = useState("");

  const submit = () =>
    logActivity.mutate(
      {
        kind,
        content: content.trim(),
        next_follow_up_at: fromLocalInput(followUp),
        clear_follow_up: !followUp && !!lead.next_follow_up_at,
      },
      {
        onSuccess: () => {
          setContent("");
          setFollowUp("");
        },
      },
    );

  return (
    <div className="grid gap-2 rounded-lg border p-3">
      <div className="flex flex-wrap gap-1">
        {LOG_KINDS.map((k) => (
          <button
            key={k.value}
            type="button"
            aria-pressed={kind === k.value}
            onClick={() => setKind(k.value)}
            className={cn(
              "flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs",
              kind === k.value ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            <k.icon className="size-3" />
            {k.label}
          </button>
        ))}
      </div>
      <Textarea
        aria-label="What happened"
        rows={2}
        placeholder={kind === "call" ? "e.g. Asked about prices, will visit Saturday" : "What happened?"}
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <Field>
        <FieldLabel htmlFor="next-follow-up" className="text-xs">
          Next follow-up {lead.next_follow_up_at && !followUp && "(leave empty to clear)"}
        </FieldLabel>
        <FollowUpPicker id="next-follow-up" value={followUp} onChange={setFollowUp} />
      </Field>
      <Button size="sm" className="w-fit" disabled={!content.trim() || logActivity.isPending} onClick={submit}>
        {logActivity.isPending && <Spinner />}
        Log {LOG_KINDS.find((k) => k.value === kind)?.label.toLowerCase()}
      </Button>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

function LeadBody({ lead, onClose }: { lead: LeadDetail; onClose: () => void }) {
  const can = useCan();
  const plans = usePlans();
  const moveLead = useMoveLead();
  const remove = useDeleteLead();
  const [editOpen, setEditOpen] = useState(false);
  const [convertOpen, setConvertOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState<PendingMove>(null);
  const closed = lead.stage === "converted";
  const plan = plans.data?.find((p) => p.id === lead.interested_plan_id);

  const changeStage = (stage: LeadStage) => {
    if (stage === lead.stage) return;
    if (needsDialog(stage)) setPending({ lead, stage });
    else moveLead.mutate({ id: lead.id, stage });
  };

  return (
    <>
      <SheetHeader className="border-b">
        <SheetTitle className="pr-8 text-lg">{lead.name}</SheetTitle>
        <SheetDescription className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">{SOURCE_LABELS[lead.source]}</Badge>
          <FollowUpBadge iso={closed || lead.stage === "lost" ? null : lead.next_follow_up_at} />
          <span>Added {formatDate(lead.created_at.slice(0, 10), { year: false })}</span>
        </SheetDescription>
        <div className="flex flex-wrap gap-2 pt-2">
          <Button size="sm" variant="outline" nativeButton={false} render={<a href={`tel:${lead.phone}`} />}>
            <PhoneIcon />
            Call
          </Button>
          <Button
            size="sm"
            variant="outline"
            nativeButton={false}
            render={<a href={whatsappUrl(lead.phone)} target="_blank" rel="noreferrer" />}
          >
            <MessageCircleIcon />
            WhatsApp
          </Button>
          {!closed && (
            <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
              <PencilIcon />
              Edit
            </Button>
          )}
          {can.manage && (
            <Button size="sm" variant="ghost" aria-label="Delete lead" onClick={() => setDeleting(true)}>
              <Trash2Icon />
            </Button>
          )}
        </div>
      </SheetHeader>

      <div className="grid gap-5 overflow-y-auto px-4 pb-6">
        {closed ? (
          <div className="flex items-center justify-between gap-2 rounded-lg bg-emerald-500/10 p-3 text-sm">
            <span className="flex items-center gap-2">
              <UserCheckIcon className="size-4 text-emerald-600" />
              Converted {lead.converted_at && formatDate(lead.converted_at.slice(0, 10))}
            </span>
            {lead.converted_member_id && (
              <Button size="sm" variant="outline" nativeButton={false} render={<Link href={`/members/${lead.converted_member_id}`} />}>
                Open member
              </Button>
            )}
          </div>
        ) : (
          <div className="flex flex-wrap items-end gap-2">
            <Field className="min-w-40 flex-1">
              <FieldLabel htmlFor="lead-stage" className="text-xs">
                Stage
              </FieldLabel>
              <SimpleSelect
                id="lead-stage"
                options={STAGES.filter((s) => s.value !== "converted")}
                value={lead.stage}
                onChange={(v) => changeStage(v as LeadStage)}
              />
            </Field>
            {can.role !== "trainer" && (
              <Button onClick={() => setConvertOpen(true)}>
                <UserCheckIcon />
                Convert to member
              </Button>
            )}
          </div>
        )}

        <dl className="divide-y">
          <Detail label="Phone">{lead.phone}</Detail>
          {lead.email && <Detail label="Email">{lead.email}</Detail>}
          {lead.interest && <Detail label="Interested in">{lead.interest}</Detail>}
          {plan && <Detail label="Plan">{plan.name}</Detail>}
          <Detail label="Assigned to">{lead.assigned_to?.name ?? "Unassigned"}</Detail>
          {lead.trial_at && <Detail label="Trial">{when(lead.trial_at)}</Detail>}
          {lead.stage === "lost" && <Detail label="Lost because">{lead.lost_reason}</Detail>}
        </dl>
        {lead.notes && <p className="text-sm whitespace-pre-line text-muted-foreground">{lead.notes}</p>}

        {!closed && <ActivityLogger lead={lead} />}

        <section className="grid gap-2">
          <h3 className="text-sm font-medium">Timeline</h3>
          <ol className="grid gap-3 border-l pl-4">
            {lead.activities.map((a) => {
              const Icon = KIND_ICON[a.kind] ?? StickyNoteIcon;
              return (
                <li key={a.id} className="relative text-sm">
                  <span className="absolute top-0.5 -left-[1.4rem] flex size-5 items-center justify-center rounded-full border bg-background">
                    <Icon className="size-3 text-muted-foreground" />
                  </span>
                  <p className={a.kind === "stage" || a.kind === "created" ? "text-muted-foreground" : ""}>
                    {a.content}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {when(a.created_at)}
                    {a.created_by ? ` · ${a.created_by.name}` : " · website"}
                  </p>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <LeadDialog lead={lead} open={editOpen} onOpenChange={setEditOpen} />
      <ConvertDialog lead={lead} open={convertOpen} onOpenChange={setConvertOpen} />
      <StageDialog move={pending} onDone={() => setPending(null)} />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${lead.name}?`}
        description="The lead and its timeline will be removed permanently."
        confirmLabel="Delete lead"
        pending={remove.isPending}
        onConfirm={() => remove.mutate(lead.id, { onSuccess: onClose })}
      />
    </>
  );
}

export function LeadSheet({ leadId, onClose }: { leadId: string | null; onClose: () => void }) {
  const lead = useLead(leadId);
  return (
    <Sheet open={!!leadId} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full gap-0 sm:max-w-md">
        {lead.data ? (
          <LeadBody key={lead.data.id} lead={lead.data} onClose={onClose} />
        ) : lead.isError ? (
          <SheetHeader>
            <SheetTitle>Lead not found</SheetTitle>
            <SheetDescription>{lead.error.message}</SheetDescription>
          </SheetHeader>
        ) : (
          <div className="grid gap-3 p-4">
            <SheetTitle className="sr-only">Loading lead</SheetTitle>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-40 w-full" />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

