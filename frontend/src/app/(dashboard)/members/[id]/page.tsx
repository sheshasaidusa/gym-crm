"use client";

import {
  ArrowLeftIcon,
  CalendarPlusIcon,
  CopyIcon,
  HeartPulseIcon,
  LinkIcon,
  MailIcon,
  MessageCircleIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PhoneIcon,
  RefreshCwIcon,
  SnowflakeIcon,
  SunIcon,
  Trash2Icon,
  XCircleIcon,
} from "lucide-react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";
import { toast } from "sonner";

import { AIPlanSection } from "@/components/ai-plans/ai-plan-section";
import { ProgressSection } from "@/components/checkups/progress-section";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { MemberPayments } from "@/components/finance/member-payments";
import { AddMembershipDialog, FreezeDialog } from "@/components/members/membership-dialogs";
import { StatusBadge } from "@/components/members/status-badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ageFrom,
  daysBetween,
  daysLeftLabel,
  DIET_LABELS,
  EXPERIENCE_LABELS,
  formatDate,
  formatMoney,
  GENDER_LABELS,
  GOAL_LABELS,
  initials,
  shortDuration,
  todayIso,
} from "@/lib/format";
import {
  useCancelMembership,
  useDeleteMember,
  useMember,
  useRegeneratePreview,
  useUnfreezeMembership,
  useUpdateMember,
  type Member,
  type Membership,
} from "@/lib/member-queries";
import { useBranches, useCan, useCurrency } from "@/lib/queries";
import { whatsappUrl } from "@/lib/whatsapp";

function canFreeze(m: Membership) {
  const futureFreeze = m.freeze_end != null && m.freeze_end >= todayIso();
  return (
    ["active", "expiring", "upcoming"].includes(m.status) &&
    m.max_freeze_days > m.frozen_days &&
    !futureFreeze
  );
}

function canUnfreeze(m: Membership) {
  return m.status !== "cancelled" && m.freeze_end != null && m.freeze_end >= todayIso();
}

function MembershipMenu({
  m,
  onFreeze,
  onCancel,
}: {
  m: Membership;
  onFreeze: () => void;
  onCancel: () => void;
}) {
  const can = useCan();
  const unfreeze = useUnfreezeMembership();
  const freezable = canFreeze(m);
  const unfreezable = canUnfreeze(m);
  const cancellable = can.manage && !["cancelled", "expired"].includes(m.status);
  if (!freezable && !unfreezable && !cancellable) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button variant="ghost" size="icon-sm" aria-label="Membership actions" />}
      >
        <MoreHorizontalIcon />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-48">
        {freezable && (
          <DropdownMenuItem onClick={onFreeze}>
            <SnowflakeIcon />
            Freeze
          </DropdownMenuItem>
        )}
        {unfreezable && (
          <DropdownMenuItem onClick={() => unfreeze.mutate(m.id)}>
            <SunIcon />
            Unfreeze now
          </DropdownMenuItem>
        )}
        {cancellable && (
          <>
            {(freezable || unfreezable) && <DropdownMenuSeparator />}
            <DropdownMenuItem variant="destructive" onClick={onCancel}>
              <XCircleIcon />
              Cancel membership
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CurrentMembershipCard({
  member,
  onRenew,
  onFreeze,
  onCancel,
}: {
  member: Member;
  onRenew: () => void;
  onFreeze: (m: Membership) => void;
  onCancel: (m: Membership) => void;
}) {
  const can = useCan();
  const currency = useCurrency();
  const current = member.memberships.find((m) => m.id === member.current_membership?.id);
  const upcoming = member.memberships.filter(
    (m) => m.status === "upcoming" && m.id !== current?.id,
  );
  const canSell = can.role !== "trainer";

  if (!current) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-dashed border-border p-5">
        <div>
          <p className="font-medium">No membership yet</p>
          <p className="text-sm text-muted-foreground">{member.name} doesn&apos;t have a membership.</p>
        </div>
        {canSell && (
          <Button onClick={onRenew}>
            <CalendarPlusIcon />
            Add membership
          </Button>
        )}
      </div>
    );
  }

  const today = todayIso();
  const totalDays = daysBetween(current.start_date, current.end_date) + 1;
  const elapsed = Math.min(Math.max(daysBetween(current.start_date, today) + 1, 0), totalDays);
  const pct = Math.round((elapsed / totalDays) * 100);

  return (
    <section aria-label="Current membership" className="overflow-hidden rounded-2xl border border-border/70 bg-background">
      <div className="flex flex-wrap items-start justify-between gap-3 p-4 sm:p-5">
        <div className="grid gap-1">
          <span className="text-xs tracking-wide text-muted-foreground uppercase">Current membership</span>
          <span className="flex flex-wrap items-center gap-2 text-lg font-medium">
            {current.plan_name}
            <StatusBadge status={current.status} />
          </span>
        </div>
        <div className="flex gap-1">
          {canSell && (
            <Button size="sm" variant="outline" onClick={onRenew}>
              <RefreshCwIcon />
              Renew
            </Button>
          )}
          {canSell && (
            <MembershipMenu
              m={current}
              onFreeze={() => onFreeze(current)}
              onCancel={() => onCancel(current)}
            />
          )}
        </div>
      </div>
      <div className="grid gap-1.5 px-4 pb-4 sm:px-5">
          <div className="flex justify-between text-sm">
            <span>{formatDate(current.start_date)}</span>
            <span className="font-medium">
              {current.status === "expired"
                ? "Expired"
                : current.status === "upcoming"
                  ? `Starts in ${daysBetween(today, current.start_date)} days`
                  : daysLeftLabel(current.days_left)}
            </span>
            <span>{formatDate(current.end_date)}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label="Membership elapsed">
            <div
              className={
                current.status === "expired"
                  ? "h-full bg-red-500"
                  : current.status === "expiring"
                    ? "h-full bg-amber-500"
                    : current.status === "frozen"
                      ? "h-full bg-sky-500"
                      : "h-full bg-emerald-500"
              }
              style={{ width: `${pct}%` }}
            />
          </div>
      </div>
      <dl className="grid grid-cols-2 border-t border-border/70 text-sm sm:grid-cols-4 sm:divide-x sm:divide-border/70 [&>div]:p-4">
          <div>
            <dt className="mb-1 text-xs tracking-wide text-muted-foreground uppercase">Duration</dt>
            <dd>{shortDuration(current.duration_value, current.duration_unit)}</dd>
          </div>
          <div>
            <dt className="mb-1 text-xs tracking-wide text-muted-foreground uppercase">Total</dt>
            <dd>
              {formatMoney(current.total, currency)}
              {current.status !== "cancelled" && (
                <span
                  className={
                    current.balance > 0
                      ? "block text-xs text-red-600 dark:text-red-400"
                      : "block text-xs text-emerald-600 dark:text-emerald-400"
                  }
                >
                  {current.balance > 0 ? `${formatMoney(current.balance, currency)} due` : "Paid"}
                </span>
              )}
            </dd>
          </div>
          <div>
            <dt className="mb-1 text-xs tracking-wide text-muted-foreground uppercase">Freeze days</dt>
            <dd>
              {current.frozen_days} / {current.max_freeze_days} used
            </dd>
          </div>
          {current.freeze_start && current.freeze_end && (
            <div>
              <dt className="mb-1 text-xs tracking-wide text-muted-foreground uppercase">Frozen</dt>
              <dd>
                {formatDate(current.freeze_start, { year: false })} –{" "}
                {formatDate(current.freeze_end, { year: false })}
              </dd>
            </div>
          )}
      </dl>
      {upcoming.map((u) => (
          <div key={u.id} className="flex items-center justify-between border-t border-border/70 px-4 py-3 text-sm sm:px-5">
            <span>
              Renewed: <strong>{u.plan_name}</strong> from {formatDate(u.start_date)}
            </span>
            <StatusBadge status="upcoming" />
          </div>
        ))}
    </section>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3 text-sm">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd>{children ?? "—"}</dd>
    </div>
  );
}

export default function MemberPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const can = useCan();
  const currency = useCurrency();
  const branches = useBranches();
  const member = useMember(id);
  const regenerate = useRegeneratePreview(id);
  const updateMember = useUpdateMember(id);
  const remove = useDeleteMember();
  const cancel = useCancelMembership();

  const [renewOpen, setRenewOpen] = useState(false);
  const [freezing, setFreezing] = useState<Membership | null>(null);
  const [cancelling, setCancelling] = useState<Membership | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [regenOpen, setRegenOpen] = useState(false);

  if (member.isPending) {
    return (
      <div className="grid gap-6">
        <Skeleton className="h-16 w-80" />
        <Skeleton className="h-64 w-full rounded-xl" />
      </div>
    );
  }
  if (member.isError) {
    return (
      <div className="grid gap-2">
        <p className="text-sm text-destructive">{member.error.message}</p>
        <Button variant="outline" className="w-fit" nativeButton={false} render={<Link href="/members" />}>
          Back to members
        </Button>
      </div>
    );
  }

  const m = member.data;
  const canEdit = can.role !== "trainer";
  const age = ageFrom(m.dob);
  const branch = branches.data?.find((b) => b.id === m.branch_id);
  const previewText = `Hi ${m.name.split(" ")[0]}, here's your membership and fitness plan: ${m.preview_url}`;

  return (
    <>
      <div className="grid gap-4">
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit text-muted-foreground"
          nativeButton={false}
          render={<Link href="/members" />}
        >
          <ArrowLeftIcon />
          Members
        </Button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-4">
            <Avatar className="size-14">
              <AvatarFallback className="text-lg">{initials(m.name)}</AvatarFallback>
            </Avatar>
            <div className="grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-semibold tracking-tight">{m.name}</h1>
                <StatusBadge status={m.status} />
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
                <a href={`tel:${m.phone}`} className="flex items-center gap-1 hover:text-foreground">
                  <PhoneIcon className="size-3.5" />
                  {m.phone}
                </a>
                {m.email && (
                  <a href={`mailto:${m.email}`} className="flex items-center gap-1 hover:text-foreground">
                    <MailIcon className="size-3.5" />
                    {m.email}
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <Button
              variant="outline"
              nativeButton={false}
              render={<a href={whatsappUrl(m.phone)} target="_blank" rel="noreferrer" />}
            >
              <MessageCircleIcon />
              WhatsApp
            </Button>
            {canEdit && (
              <Button variant="outline" nativeButton={false} render={<Link href={`/members/${m.id}/edit`} />}>
                <PencilIcon />
                Edit
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button variant="outline" size="icon" aria-label="More actions" />}>
                <MoreHorizontalIcon />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                {!m.preview_enabled && (
                  <DropdownMenuGroup>
                    <DropdownMenuLabel className="text-xs text-muted-foreground">
                      Member page is turned off
                    </DropdownMenuLabel>
                  </DropdownMenuGroup>
                )}
                <DropdownMenuItem
                  disabled={!m.preview_enabled}
                  onClick={async () => {
                    await navigator.clipboard.writeText(m.preview_url);
                    toast.success("Preview link copied");
                  }}
                >
                  <CopyIcon />
                  Copy member preview link
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!m.preview_enabled}
                  render={<a href={whatsappUrl(m.phone, previewText)} target="_blank" rel="noreferrer" />}
                >
                  <LinkIcon />
                  Send preview link on WhatsApp
                </DropdownMenuItem>
                {canEdit && (
                  <DropdownMenuItem onClick={() => setRegenOpen(true)}>
                    <RefreshCwIcon />
                    Create a new preview link
                  </DropdownMenuItem>
                )}
                {canEdit && (
                  <DropdownMenuItem
                    onClick={() => updateMember.mutate({ preview_enabled: !m.preview_enabled })}
                  >
                    <LinkIcon />
                    {m.preview_enabled ? "Turn off member page" : "Turn on member page"}
                  </DropdownMenuItem>
                )}
                {can.manage && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onClick={() => setDeleting(true)}>
                      <Trash2Icon />
                      Delete member
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
      </div>

      <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_300px] lg:gap-10">
        <div className="grid min-w-0 gap-6">
          <CurrentMembershipCard
            member={m}
            onRenew={() => setRenewOpen(true)}
            onFreeze={setFreezing}
            onCancel={setCancelling}
          />

          {m.medical_notes && (
            <div className="flex gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <HeartPulseIcon className="mt-0.5 size-4 shrink-0 text-amber-600" />
              <div className="grid gap-1">
                <span className="font-medium">Medical notes</span>
                <p className="whitespace-pre-line text-muted-foreground">{m.medical_notes}</p>
              </div>
            </div>
          )}

          <Tabs defaultValue={canEdit ? "payments" : "plan"} className="gap-5">
            <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b border-border">
              {canEdit && (
                <TabsTrigger value="payments" className="flex-none px-4">
                  Payments
                </TabsTrigger>
              )}
              <TabsTrigger value="plan" className="flex-none px-4">
                AI plan
              </TabsTrigger>
              <TabsTrigger value="progress" className="flex-none px-4">
                Progress
              </TabsTrigger>
              <TabsTrigger value="history" className="flex-none px-4">
                History
                <span className="text-xs text-muted-foreground tabular-nums">{m.memberships.length}</span>
              </TabsTrigger>
            </TabsList>
            {canEdit && (
              <TabsContent value="payments">
                <MemberPayments member={m} />
              </TabsContent>
            )}
            <TabsContent value="plan">
              <AIPlanSection member={m} />
            </TabsContent>
            <TabsContent value="progress">
              <ProgressSection member={m} />
            </TabsContent>
            <TabsContent value="history">
              {m.memberships.length > 0 ? (
                <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="pl-4">Plan</TableHead>
                    <TableHead>Dates</TableHead>
                    <TableHead className="hidden sm:table-cell">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    {canEdit && <TableHead className="w-10" />}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {m.memberships.map((ms) => (
                    <TableRow key={ms.id}>
                      <TableCell className="pl-4 font-medium">{ms.plan_name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {formatDate(ms.start_date, { year: false })} – {formatDate(ms.end_date)}
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">
                        {formatMoney(ms.total, currency)}
                        {ms.discount > 0 && (
                          <span className="text-xs text-muted-foreground">
                            {" "}
                            (−{formatMoney(ms.discount, currency)})
                          </span>
                        )}
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={ms.status} />
                      </TableCell>
                      {canEdit && (
                        <TableCell>
                          <MembershipMenu
                            m={ms}
                            onFreeze={() => setFreezing(ms)}
                            onCancel={() => setCancelling(ms)}
                          />
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
                </div>
              ) : (
                <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">
                  No memberships yet.
                </p>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <aside
          aria-label="Member details"
          className="border-t border-border/70 pt-6 lg:sticky lg:top-20 lg:border-t-0 lg:border-l lg:pt-0 lg:pl-8"
        >
          <h2 className="pb-1 font-medium">Member details</h2>
          <dl className="divide-y divide-border/70">
                <Detail label="Goal">{m.goal ? GOAL_LABELS[m.goal] : null}</Detail>
                <Detail label="Diet">{m.diet_pref ? DIET_LABELS[m.diet_pref] : null}</Detail>
                <Detail label="Experience">
                  {m.experience_level ? EXPERIENCE_LABELS[m.experience_level] : null}
                </Detail>
                <Detail label="Age">{age != null ? `${age} yrs` : null}</Detail>
                <Detail label="Gender">{m.gender ? GENDER_LABELS[m.gender] : null}</Detail>
                <Detail label="Height">{m.height_cm ? `${m.height_cm} cm` : null}</Detail>
                <Detail label="Trainer">{m.trainer?.name ?? null}</Detail>
                {(branches.data?.length ?? 0) > 1 && <Detail label="Branch">{branch?.name ?? null}</Detail>}
                <Detail label="Joined">{formatDate(m.joined_on)}</Detail>
                <Detail label="Emergency">
                  {m.emergency_contact_name || m.emergency_contact_phone ? (
                    <>
                      {m.emergency_contact_name}
                      {m.emergency_contact_phone && (
                        <div className="text-xs text-muted-foreground">{m.emergency_contact_phone}</div>
                      )}
                    </>
                  ) : null}
                </Detail>
                <Detail label="Address">{m.address}</Detail>
          </dl>
              {m.tags.length > 0 && (
                <div className="flex flex-wrap gap-1 pt-3">
                  {m.tags.map((t) => (
                    <Badge key={t} variant="secondary">
                      {t}
                    </Badge>
                  ))}
                </div>
              )}
              {m.notes && <p className="pt-3 text-sm whitespace-pre-line text-muted-foreground">{m.notes}</p>}
        </aside>
      </div>

      <AddMembershipDialog member={m} open={renewOpen} onOpenChange={setRenewOpen} />
      <FreezeDialog
        membership={freezing}
        open={!!freezing}
        onOpenChange={(o) => !o && setFreezing(null)}
      />
      <ConfirmDialog
        open={!!cancelling}
        onOpenChange={(o) => !o && setCancelling(null)}
        title="Cancel this membership?"
        description={`${cancelling?.plan_name} (${formatDate(cancelling?.start_date)} – ${formatDate(cancelling?.end_date)}) will stop counting as active. This can't be undone.`}
        confirmLabel="Cancel membership"
        pending={cancel.isPending}
        onConfirm={() =>
          cancelling && cancel.mutate(cancelling.id, { onSuccess: () => setCancelling(null) })
        }
      />
      <ConfirmDialog
        open={regenOpen}
        onOpenChange={setRegenOpen}
        title="Create a new preview link?"
        description="The current link will stop working. Use this if the link was shared with the wrong person."
        confirmLabel="Create new link"
        pending={regenerate.isPending}
        onConfirm={() => regenerate.mutate(undefined, { onSuccess: () => setRegenOpen(false) })}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${m.name}?`}
        description="This permanently removes the member and their membership history."
        confirmLabel="Delete member"
        pending={remove.isPending}
        onConfirm={() => remove.mutate(m.id, { onSuccess: () => router.replace("/members") })}
      />
    </>
  );
}
