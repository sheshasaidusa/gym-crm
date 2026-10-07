"use client";

import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  CheckIcon,
  ClipboardListIcon,
  MoreHorizontalIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  SnowflakeIcon,
  Trash2Icon,
  UsersIcon,
  XIcon,
} from "lucide-react";
import Link from "next/link";
import { useRef, useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { PageHeader } from "@/components/page-header";
import { PlanForm } from "@/components/plans/plan-form";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { durationLabel, formatMoney } from "@/lib/format";
import { useDeletePlan, usePlans, useSavePlan, type Plan } from "@/lib/member-queries";
import { useCan, useCurrency } from "@/lib/queries";

const DAYS_PER: Record<Plan["duration_unit"], number> = { day: 1, week: 7, month: 30.44, year: 365.25 };
const planDays = (p: Plan) => p.duration_value * DAYS_PER[p.duration_unit];
const SERVICES_SHOWN = 4;

/** "/ month", "/ 3 months", "/ 7 days" for the price suffix. */
function perLabel(plan: Plan) {
  const unit = plan.duration_unit;
  return plan.duration_value === 1 ? `/ ${unit}` : `/ ${plan.duration_value} ${unit}s`;
}

function matches(plan: Plan, q: string) {
  const text = [plan.name, plan.description, durationLabel(plan.duration_value, plan.duration_unit), ...plan.services]
    .join(" ")
    .toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((word) => text.includes(word));
}

function PlanCard({
  plan,
  canManage,
  onEdit,
  onDelete,
  onDetails,
}: {
  plan: Plan;
  canManage: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onDetails: () => void;
}) {
  const currency = useCurrency();
  const save = useSavePlan();
  const extra = plan.services.length - SERVICES_SHOWN;

  return (
    <article className="flex flex-col gap-5 rounded-2xl border border-border/70 bg-background p-5">
      <div className="flex items-start justify-between gap-2">
        <h3 className="line-clamp-2 min-h-[2lh] text-sm text-muted-foreground" title={plan.name}>
          {plan.name}
        </h3>
        {canManage && (
          <DropdownMenu>
            <DropdownMenuTrigger
              render={<Button variant="ghost" size="icon-sm" aria-label="Plan actions" className="-mt-1 -mr-2 shrink-0" />}
            >
              <MoreHorizontalIcon />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onEdit}>
                <PencilIcon />
                Edit
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => save.mutate({ id: plan.id, is_active: !plan.is_active })}>
                {plan.is_active ? <ArchiveIcon /> : <ArchiveRestoreIcon />}
                {plan.is_active ? "Archive" : "Restore"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" onClick={onDelete}>
                <Trash2Icon />
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="flex items-baseline gap-2">
        <span className="text-4xl font-medium tracking-tight tabular-nums">{formatMoney(plan.price, currency)}</span>
        <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">{perLabel(plan)}</span>
      </div>

      {plan.services.length > 0 && (
        <ul className="flex flex-wrap gap-1.5">
          {plan.services.slice(0, SERVICES_SHOWN).map((s) => (
            <li key={s} className="flex h-7 items-center gap-1.5 rounded-full border px-3 text-sm">
              <CheckIcon className="size-3.5 text-muted-foreground" />
              {s}
            </li>
          ))}
          {extra > 0 && (
            <li>
              <button
                type="button"
                onClick={onDetails}
                className="h-7 rounded-full border border-dashed px-3 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                +{extra} more
              </button>
            </li>
          )}
        </ul>
      )}

      <Button variant="outline" className="mt-auto w-full" onClick={onDetails}>
        See details
      </Button>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/70 pt-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <UsersIcon className="size-3.5" />
          {plan.active_members} active
        </span>
        <span className="flex items-center gap-1.5">
          <SnowflakeIcon className="size-3.5" />
          {plan.max_freeze_days > 0 ? `${plan.max_freeze_days} freeze days` : "No freezing"}
        </span>
      </div>
    </article>
  );
}

type Panel = { mode: "view" | "edit"; plan: Plan } | { mode: "new" } | null;

function PlanDetails({ p }: { p: Plan }) {
  const currency = useCurrency();
  const tax = (p.price * p.tax_pct) / 100;
  const months = planDays(p) / DAYS_PER.month;
  const rows: [string, string][] = [
    ["Duration", durationLabel(p.duration_value, p.duration_unit)],
    ["Price", formatMoney(p.price, currency)],
  ];
  if (p.tax_pct > 0) rows.push([`Tax (${p.tax_pct}%)`, formatMoney(tax, currency)], ["Total", formatMoney(p.price + tax, currency)]);
  rows.push(["Joining fee", p.joining_fee > 0 ? `${formatMoney(p.joining_fee, currency)}, first membership only` : "None"]);
  if (months > 1.5) rows.push(["Per month", `≈ ${formatMoney(Math.round(p.price / months), currency)}`]);
  rows.push(
    ["Freezing", p.max_freeze_days > 0 ? `Up to ${p.max_freeze_days} days` : "Not allowed"],
    ["Active members", String(p.active_members)],
    ["Status", p.is_active ? "On sale" : "Archived"],
  );

  return (
    <div className="flex-1 overflow-y-auto p-5">
      <h4 className="mb-3 text-xs tracking-wide text-muted-foreground uppercase">Includes</h4>
      {p.services.length ? (
        <ul className="flex flex-wrap gap-1.5">
          {p.services.map((s) => (
            <li key={s} className="flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm">
              <CheckIcon className="size-3.5 text-muted-foreground" />
              {s}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted-foreground">No services listed.</p>
      )}

      <h4 className="mt-7 mb-1 text-xs tracking-wide text-muted-foreground uppercase">Pricing & rules</h4>
      <dl className="divide-y divide-border/70 text-sm">
        {rows.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 py-2.5">
            <dt className="text-muted-foreground">{k}</dt>
            <dd className="text-right tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

/** Floating right-hand panel: plan details, or the plan form when editing or creating. */
function PlanPanel({ panel, onChange }: { panel: Panel; onChange: (p: Panel) => void }) {
  const currency = useCurrency();
  const can = useCan();
  // Keep the last content on screen while the panel animates closed.
  const last = useRef<Panel>(null);
  if (panel) last.current = panel;
  const shown = panel ?? last.current;
  const plan = shown && shown.mode !== "new" ? shown.plan : null;

  return (
    <Sheet open={!!panel} onOpenChange={(o) => !o && onChange(null)}>
      <SheetContent
        side="right"
        className="gap-0 overflow-hidden rounded-2xl border data-[side=right]:inset-y-3 data-[side=right]:right-3 data-[side=right]:h-auto data-[side=right]:w-[calc(100%-1.5rem)] data-[side=right]:sm:max-w-md"
      >
        {shown && (
          <>
            <SheetHeader className="gap-1 border-b border-border/70 p-5 pr-12">
              {shown.mode === "view" && plan ? (
                <>
                  <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">
                    {durationLabel(plan.duration_value, plan.duration_unit)}
                  </span>
                  <SheetTitle className="text-base leading-snug">{plan.name}</SheetTitle>
                  <div className="flex items-baseline gap-2 pt-1">
                    <span className="text-3xl font-medium tracking-tight tabular-nums">{formatMoney(plan.price, currency)}</span>
                    <span className="font-mono text-xs tracking-wide text-muted-foreground uppercase">{perLabel(plan)}</span>
                  </div>
                  {plan.description && <SheetDescription>{plan.description}</SheetDescription>}
                </>
              ) : (
                <>
                  <SheetTitle className="text-base">{plan ? "Edit plan" : "New plan"}</SheetTitle>
                  <SheetDescription>
                    {plan
                      ? "Changes apply to new sales. Existing memberships keep their terms."
                      : "Create any duration and price you like."}
                  </SheetDescription>
                </>
              )}
            </SheetHeader>

            {shown.mode === "view" && plan ? (
              <>
                <PlanDetails p={plan} />
                {can.manage && (
                  <SheetFooter className="border-t border-border/70 p-5">
                    <Button variant="outline" className="w-full" onClick={() => onChange({ mode: "edit", plan })}>
                      <PencilIcon />
                      Edit plan
                    </Button>
                  </SheetFooter>
                )}
              </>
            ) : (
              <PlanForm
                key={plan?.id ?? "new"}
                plan={plan}
                // Editing returns to the details; a new plan just closes.
                onDone={() => onChange(plan ? { mode: "view", plan } : null)}
              />
            )}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Always-open search field with a clear button. */
function PlanSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="relative w-full sm:w-60">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        type="search"
        aria-label="Search plans"
        placeholder="Search plans or services"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => e.key === "Escape" && onChange("")}
        className="px-9 [&::-webkit-search-cancel-button]:hidden"
      />
      {value && (
        <button
          type="button"
          aria-label="Clear search"
          onClick={() => onChange("")}
          className="absolute top-1/2 right-2.5 -translate-y-1/2 text-muted-foreground hover:text-foreground"
        >
          <XIcon className="size-4" />
        </button>
      )}
    </div>
  );
}

export function PlansView({ archived }: { archived: boolean }) {
  const can = useCan();
  // The API returns archived plans alongside active ones; each page keeps its own half.
  const plans = usePlans(archived);
  const remove = useDeletePlan();
  const [deleting, setDeleting] = useState<Plan | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [query, setQuery] = useState("");

  // Show the freshest copy of the open plan, so details update right after an edit is saved.
  const live: Panel =
    panel && panel.mode !== "new"
      ? { ...panel, plan: plans.data?.find((p) => p.id === panel.plan.id) ?? panel.plan }
      : panel;
  const mine = (plans.data ?? []).filter((p) => p.is_active === !archived);
  // Shortest to longest, cheaper first, so plans read left to right like a price ladder.
  const sorted = mine.filter((p) => matches(p, query.trim())).sort((a, b) => planDays(a) - planDays(b) || a.price - b.price);


  return (
    <>
      {archived && (
        <Button
          variant="ghost"
          size="sm"
          className="-ml-2 w-fit text-muted-foreground"
          nativeButton={false}
          render={<Link href="/plans" />}
        >
          <ArrowLeftIcon />
          Plans
        </Button>
      )}
      <PageHeader
        title={archived ? "Archived plans" : "Plans"}
        description={
          archived
            ? "Plans no longer on sale. Members already on them keep their membership."
            : "Membership plans your gym sells. Any duration, any price."
        }
      >
        <PlanSearch value={query} onChange={setQuery} />
        {!archived && (
          <Button variant="outline" nativeButton={false} render={<Link href="/plans/archived" />}>
            <ArchiveIcon />
            Archived plans
          </Button>
        )}
        {can.manage && !archived && (
          <Button onClick={() => setPanel({ mode: "new" })}>
            <PlusIcon />
            New plan
          </Button>
        )}
      </PageHeader>

      {plans.isPending ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-80 rounded-2xl" />
          ))}
        </div>
      ) : sorted.length ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {sorted.map((plan) => (
            <PlanCard
              key={plan.id}
              plan={plan}
              canManage={can.manage}
              onDetails={() => setPanel({ mode: "view", plan })}
              onEdit={() => setPanel({ mode: "edit", plan })}
              onDelete={() => setDeleting(plan)}
            />
          ))}
        </div>
      ) : mine.length ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No plans match “{query.trim()}”.
        </p>
      ) : archived ? (
        <p className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          No archived plans. Archive a plan from its ⋯ menu to stop selling it.
        </p>
      ) : (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ClipboardListIcon />
            </EmptyMedia>
            <EmptyTitle>No plans yet</EmptyTitle>
            <EmptyDescription>Create your first membership plan: monthly, quarterly, yearly or anything custom.</EmptyDescription>
          </EmptyHeader>
          {can.manage && (
            <EmptyContent>
              <Button onClick={() => setPanel({ mode: "new" })}>
                <PlusIcon />
                Create a plan
              </Button>
            </EmptyContent>
          )}
        </Empty>
      )}

      <PlanPanel panel={live} onChange={setPanel} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Plans that have been sold can't be deleted, only archived."
        confirmLabel="Delete plan"
        pending={remove.isPending}
        onConfirm={() =>
          deleting &&
          remove.mutate(deleting.id, {
            onSuccess: () => setDeleting(null),
            onError: () => setDeleting(null),
          })
        }
      />
    </>
  );
}
