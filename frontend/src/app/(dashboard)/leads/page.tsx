"use client";

import {
  CopyIcon,
  GlobeIcon,
  KanbanSquareIcon,
  ListIcon,
  MagnetIcon,
  PlusIcon,
  RefreshCwIcon,
  SearchIcon,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { toast } from "sonner";

import { useDebounced } from "@/hooks/use-debounced";
import { FollowUpBadge } from "@/components/leads/follow-up";
import { LeadBoard } from "@/components/leads/lead-board";
import { LeadDialog } from "@/components/leads/lead-dialog";
import { LeadSheet } from "@/components/leads/lead-sheet";
import { PageHeader } from "@/components/page-header";
import { SimpleSelect } from "@/components/simple-select";
import { Button } from "@/components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  SOURCE_LABELS,
  STAGE_LABELS,
  useLeadForm,
  useLeads,
  useLeadStats,
  useSetLeadForm,
  type LeadSource,
} from "@/lib/lead-queries";
import { useCan } from "@/lib/queries";
import { cn } from "@/lib/utils";

const ALL = "all";

function WebsiteFormDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const form = useLeadForm(open);
  const set = useSetLeadForm();
  const url = form.data?.url;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Website enquiry form</DialogTitle>
          <DialogDescription>
            A simple form people can fill in to enquire. Enquiries land here as Website leads and
            your team gets notified. Link to it from your website, Instagram bio or Google profile.
          </DialogDescription>
        </DialogHeader>
        <label className="flex items-center justify-between gap-2 text-sm font-medium">
          Form is {form.data?.enabled ? "live" : "off"}
          <Switch
            checked={!!form.data?.enabled}
            disabled={form.isPending || set.isPending}
            onCheckedChange={(enabled) => set.mutate({ enabled })}
          />
        </label>
        {url && (
          <div className="grid gap-2">
            <div className="flex gap-2">
              <Input readOnly value={url} onFocus={(e) => e.currentTarget.select()} />
              <Button
                variant="outline"
                size="icon"
                aria-label="Copy form link"
                onClick={async () => {
                  await navigator.clipboard.writeText(url);
                  toast.success("Form link copied");
                }}
              >
                <CopyIcon />
              </Button>
            </div>
            <Button
              variant="ghost"
              size="sm"
              className="w-fit"
              onClick={() => set.mutate({ enabled: true, new_link: true })}
            >
              <RefreshCwIcon />
              Get a new link (the old one stops working)
            </Button>
          </div>
        )}
        <DialogFooter>
          {url && (
            <Button variant="outline" nativeButton={false} render={<a href={url} target="_blank" rel="noreferrer" />}>
              Open form
            </Button>
          )}
          <Button onClick={() => onOpenChange(false)}>Done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, hint }: { label: string; value: string | number | undefined; hint?: string }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value ?? "–"}</CardTitle>
        {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
      </CardHeader>
    </Card>
  );
}

function LeadsView() {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const can = useCan();
  const [search, setSearch] = useState("");
  const q = useDebounced(search.trim(), 300);
  const [view, setView] = useState<"board" | "list">("board");
  const [addOpen, setAddOpen] = useState(false);
  const [formOpen, setFormOpen] = useState(false);

  const assigned = params.get("assigned") ?? ALL;
  const source = (params.get("source") ?? ALL) as LeadSource | typeof ALL;
  const due = params.get("due") === "1";
  const openLeadId = params.get("lead");

  const setParam = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === ALL || v === "") next.delete(k);
      else next.set(k, v);
    }
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  const stats = useLeadStats();
  const leads = useLeads({
    q: q || undefined,
    assigned: assigned === ALL ? undefined : assigned,
    source: source === ALL ? undefined : source,
    due: due || undefined,
    include_closed: view === "board" ? true : undefined,
  });
  const visible = (leads.data ?? []).filter((l) => l.stage !== "converted");
  const filtering = !!(q || assigned !== ALL || source !== ALL || due);
  const rate = stats.data?.conversion_rate_90_days;

  return (
    <>
      <PageHeader title="Leads" description="Enquiries from first contact to joining.">
        {can.manage && (
          <Button variant="outline" onClick={() => setFormOpen(true)}>
            <GlobeIcon />
            Website form
          </Button>
        )}
        <Button onClick={() => setAddOpen(true)}>
          <PlusIcon />
          Add lead
        </Button>
      </PageHeader>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open leads" value={stats.data?.open} />
        <Stat label="Follow-ups due" value={stats.data?.follow_ups_due} hint="Today or overdue" />
        <Stat label="New (30 days)" value={stats.data?.new_last_30_days} />
        <Stat
          label="Conversion (90 days)"
          value={rate == null ? undefined : `${Math.round(rate * 100)}%`}
          hint={`${stats.data?.converted_last_30_days ?? 0} joined in the last 30 days`}
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search leads"
            placeholder="Search name, phone or interest"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <SimpleSelect
          className="w-auto min-w-36"
          options={[
            { value: ALL, label: "Everyone's leads" },
            { value: "me", label: "My leads" },
            { value: "none", label: "Unassigned" },
          ]}
          value={assigned}
          onChange={(v) => setParam({ assigned: v })}
        />
        <SimpleSelect
          className="w-auto min-w-32"
          options={[{ value: ALL, label: "All sources" }, ...Object.entries(SOURCE_LABELS).map(([value, label]) => ({ value, label }))]}
          value={source}
          onChange={(v) => setParam({ source: v })}
        />
        <button
          type="button"
          aria-pressed={due}
          onClick={() => setParam({ due: due ? null : "1" })}
          className={cn(
            "rounded-lg border px-3 text-sm",
            due ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          Follow-ups due
        </button>
        <div className="flex rounded-lg border p-0.5">
          {(
            [
              { v: "board", icon: KanbanSquareIcon, label: "Board" },
              { v: "list", icon: ListIcon, label: "List" },
            ] as const
          ).map((o) => (
            <button
              key={o.v}
              type="button"
              aria-label={`${o.label} view`}
              aria-pressed={view === o.v}
              onClick={() => setView(o.v)}
              className={cn("rounded-md px-2 py-1", view === o.v ? "bg-muted" : "text-muted-foreground")}
            >
              <o.icon className="size-4" />
            </button>
          ))}
        </div>
      </div>

      {leads.isPending ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : visible.length === 0 && !filtering ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MagnetIcon />
            </EmptyMedia>
            <EmptyTitle>No leads yet</EmptyTitle>
            <EmptyDescription>
              Add walk-ins and phone enquiries, or turn on the website form to collect them
              automatically.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <Button onClick={() => setAddOpen(true)}>
              <PlusIcon />
              Add lead
            </Button>
          </EmptyContent>
        </Empty>
      ) : view === "board" ? (
        <LeadBoard leads={visible} onOpen={(id) => setParam({ lead: id })} />
      ) : (
        <Card className="py-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Lead</TableHead>
                <TableHead>Stage</TableHead>
                <TableHead className="hidden md:table-cell">Source</TableHead>
                <TableHead>Follow-up</TableHead>
                <TableHead className="hidden lg:table-cell">Assigned</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No matching leads.
                  </TableCell>
                </TableRow>
              ) : (
                visible.map((l) => (
                  <TableRow key={l.id} className="cursor-pointer" onClick={() => setParam({ lead: l.id })}>
                    <TableCell className="pl-4">
                      <div className="font-medium">{l.name}</div>
                      <div className="text-xs text-muted-foreground">{l.interest ?? l.phone}</div>
                    </TableCell>
                    <TableCell>{STAGE_LABELS[l.stage]}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{SOURCE_LABELS[l.source]}</TableCell>
                    <TableCell>
                      <FollowUpBadge iso={l.next_follow_up_at} />
                    </TableCell>
                    <TableCell className="hidden text-muted-foreground lg:table-cell">
                      {l.assigned_to?.name ?? "—"}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </Card>
      )}

      <LeadDialog lead={null} open={addOpen} onOpenChange={setAddOpen} onCreated={(l) => setParam({ lead: l.id })} />
      <WebsiteFormDialog open={formOpen} onOpenChange={setFormOpen} />
      <LeadSheet leadId={openLeadId} onClose={() => setParam({ lead: null })} />
    </>
  );
}

export default function LeadsPage() {
  return (
    <Suspense>
      <LeadsView />
    </Suspense>
  );
}
