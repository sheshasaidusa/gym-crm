"use client";

import {
  CalendarIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  CircleDotIcon,
  ClipboardListIcon,
  DumbbellIcon,
  PhoneIcon,
  PlusIcon,
  SearchIcon,
  UserIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useDebounced } from "@/hooks/use-debounced";
import { MemberQuickView } from "@/components/members/member-quick-view";
import { StatusBadge } from "@/components/members/status-badge";
import { PageHeader } from "@/components/page-header";
import { SimpleSelect } from "@/components/simple-select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  TableSurface,
} from "@/components/ui/table";
import { daysLeftLabel, formatDate, initials } from "@/lib/format";
import { useMemberCounts, useMembers, useUpdateMember, type MemberFilters } from "@/lib/member-queries";
import { ROLE_LABELS, useBranches, useCan, useStaff } from "@/lib/queries";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;

const UNASSIGNED = "none";

/** Trainer column: shows who's assigned, and lets staff reassign right from the table. */
function TrainerCell({
  memberId,
  trainer,
  canEdit,
}: {
  memberId: string;
  trainer: { id: string; name: string } | null;
  canEdit: boolean;
}) {
  const staff = useStaff();
  const update = useUpdateMember(memberId);
  const label = (
    <span className="flex min-w-0 items-center gap-2">
      {trainer ? (
        <Avatar className="size-5 shrink-0">
          <AvatarFallback className="text-[9px]">{initials(trainer.name)}</AvatarFallback>
        </Avatar>
      ) : (
        <span className="flex size-5 shrink-0 items-center justify-center rounded-full border border-dashed text-muted-foreground">
          <UserIcon className="size-3" />
        </span>
      )}
      <span className={cn("truncate", !trainer && "text-muted-foreground")}>{trainer?.name ?? "Unassigned"}</span>
    </span>
  );
  if (!canEdit) return label;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={`Trainer: ${trainer?.name ?? "unassigned"}. Change`}
        disabled={update.isPending}
        className="-mx-1.5 flex w-[calc(100%+0.75rem)] min-w-0 items-center rounded-lg px-1.5 py-1 text-left outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40 aria-expanded:bg-muted"
      >
        {label}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-(--anchor-width) min-w-0">
        <DropdownMenuRadioGroup
          value={trainer?.id ?? UNASSIGNED}
          onValueChange={(v) => {
            const next = v === UNASSIGNED ? null : String(v);
            if (next !== (trainer?.id ?? null)) update.mutate({ trainer_id: next });
          }}
        >
          <DropdownMenuRadioItem value={UNASSIGNED}>Unassigned</DropdownMenuRadioItem>
          {(staff.data ?? []).map((s) => (
            <DropdownMenuRadioItem key={s.user_id} value={s.user_id}>
              <span className="truncate">{s.name}</span>
              <span className="ml-auto pr-5 text-xs text-muted-foreground">{ROLE_LABELS[s.role]}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ColumnTitle({ icon: Icon, children }: { icon: LucideIcon; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate">{children}</span>
    </span>
  );
}
const ALL = "all";

const STATUS_TABS = [
  { value: ALL, label: "All" },
  { value: "active", label: "Active" },
  { value: "expiring", label: "Expiring soon" },
  { value: "expired", label: "Expired" },
  { value: "frozen", label: "Frozen" },
  { value: "upcoming", label: "Upcoming" },
  { value: "none", label: "No plan" },
] as const;

const SORTS = [
  { value: "newest", label: "Newest first" },
  { value: "name", label: "Name A–Z" },
  { value: "ending", label: "Ending soonest" },
];

function MembersView() {
  const router = useRouter();
  const [preview, setPreview] = useState<number | null>(null);
  const pathname = usePathname();
  const params = useSearchParams();
  const can = useCan();
  const staff = useStaff();
  const branches = useBranches();

  const status = (params.get("status") ?? ALL) as (typeof STATUS_TABS)[number]["value"];
  const sort = (params.get("sort") ?? "newest") as MemberFilters["sort"];
  const page = Math.max(1, Number(params.get("page") ?? 1));
  const trainerId = params.get("trainer") ?? ALL;
  const branchId = params.get("branch") ?? ALL;
  const [search, setSearch] = useState(params.get("q") ?? "");
  const q = useDebounced(search.trim(), 300);

  const setParams = (patch: Record<string, string | null>, resetPage = true) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === ALL) next.delete(k);
      else next.set(k, v);
    }
    if (resetPage) next.delete("page");
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  // Push the debounced search into the URL.
  useEffect(() => {
    if ((params.get("q") ?? "") !== q) setParams({ q });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const shared = {
    q: q || undefined,
    trainer_id: trainerId === ALL ? undefined : trainerId,
    branch_id: branchId === ALL ? undefined : branchId,
  };
  const counts = useMemberCounts(shared);
  const members = useMembers({
    ...shared,
    status: status === ALL ? undefined : status,
    sort,
    page,
    page_size: PAGE_SIZE,
  });

  const total = members.data?.total ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const countFor = (key: (typeof STATUS_TABS)[number]["value"]) => counts.data?.[key];
  const filtering = !!(q || shared.trainer_id || shared.branch_id || status !== ALL);

  return (
    <>
      <PageHeader title="Members" description="Everyone who trains at your gym.">
        {can.role !== "trainer" && (
          <Button nativeButton={false} render={<Link href="/members/new" />}>
            <PlusIcon />
            Add member
          </Button>
        )}
      </PageHeader>

      <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1">
        {STATUS_TABS.map((t) => (
          <button
            key={t.value}
            type="button"
            onClick={() => setParams({ status: t.value })}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-sm transition-colors",
              status === t.value
                ? "border-primary bg-primary text-primary-foreground"
                : "hover:bg-muted",
            )}
          >
            {t.label}
            {countFor(t.value) !== undefined && (
              <span className={cn("tabular-nums", status === t.value ? "opacity-80" : "text-muted-foreground")}>
                {countFor(t.value)}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            aria-label="Search members"
            placeholder="Search name, phone or email"
            className="pl-8"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <SimpleSelect
          className="w-auto min-w-40"
          options={[
            { value: ALL, label: "All trainers" },
            ...(staff.data ?? []).map((s) => ({ value: s.user_id, label: s.name })),
          ]}
          value={trainerId}
          onChange={(v) => setParams({ trainer: v })}
        />
        {(branches.data?.length ?? 0) > 1 && (
          <SimpleSelect
            className="w-auto min-w-36"
            options={[
              { value: ALL, label: "All branches" },
              ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name })),
            ]}
            value={branchId}
            onChange={(v) => setParams({ branch: v })}
          />
        )}
        <SimpleSelect
          className="w-auto min-w-36"
          options={SORTS}
          value={sort ?? "newest"}
          onChange={(v) => setParams({ sort: v === "newest" ? null : v })}
        />
      </div>

      {members.isPending ? (
        <Skeleton className="h-96 w-full rounded-xl" />
      ) : total === 0 ? (
        <Empty className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <UsersIcon />
            </EmptyMedia>
            <EmptyTitle>{filtering ? "No matching members" : "No members yet"}</EmptyTitle>
            <EmptyDescription>
              {filtering
                ? "Try a different search or filter."
                : "Add your first member to start tracking memberships."}
            </EmptyDescription>
          </EmptyHeader>
          {!filtering && can.role !== "trainer" && (
            <EmptyContent>
              <Button nativeButton={false} render={<Link href="/members/new" />}>
                <PlusIcon />
                Add member
              </Button>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <TableSurface className="rounded-2xl border-border/70">
          <Table className={cn("table-fixed", members.isPlaceholderData && "opacity-60")}>
            <colgroup>
              <col className="w-[26%]" />
              <col className="hidden w-[13%] xl:table-column" />
              <col className="w-[13%]" />
              <col className="hidden w-[24%] md:table-column" />
              <col className="hidden w-[13%] lg:table-column" />
              <col className="hidden w-[11%] lg:table-column" />
            </colgroup>
            <TableHeader>
              <TableRow className="[&>th]:h-11 [&>th]:border-r [&>th]:border-border/70 [&>th]:px-3 [&>th]:font-normal [&>th:last-child]:border-r-0">
                <TableHead className="pl-4">
                  <ColumnTitle icon={UserIcon}>Member</ColumnTitle>
                </TableHead>
                <TableHead className="hidden xl:table-cell">
                  <ColumnTitle icon={PhoneIcon}>Phone</ColumnTitle>
                </TableHead>
                <TableHead>
                  <ColumnTitle icon={CircleDotIcon}>Status</ColumnTitle>
                </TableHead>
                <TableHead className="hidden md:table-cell">
                  <ColumnTitle icon={ClipboardListIcon}>Plan</ColumnTitle>
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  <ColumnTitle icon={DumbbellIcon}>Trainer</ColumnTitle>
                </TableHead>
                <TableHead className="hidden lg:table-cell">
                  <ColumnTitle icon={CalendarIcon}>Joined</ColumnTitle>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data?.items.map((m, i) => {
                const cm = m.current_membership;
                return (
                  <TableRow
                    key={m.id}
                    className="cursor-pointer border-b border-border/70 [&>td]:h-12 [&>td]:border-r [&>td]:border-border/70 [&>td]:px-3 [&>td]:py-0 [&>td:last-child]:border-r-0"
                    // Opens the quick view; ⌘/Ctrl-click goes straight to the full profile.
                    onClick={(e) => (e.metaKey || e.ctrlKey ? router.push(`/members/${m.id}`) : setPreview(i))}
                  >
                    <TableCell className="pl-4">
                      <Link
                        href={`/members/${m.id}`}
                        className="flex min-w-0 items-center gap-2.5 outline-none"
                        onClick={(e) => {
                          if (e.metaKey || e.ctrlKey) return e.stopPropagation();
                          e.preventDefault();
                        }}
                      >
                        <Avatar className="size-6 shrink-0">
                          <AvatarFallback className="text-[10px]">{initials(m.name)}</AvatarFallback>
                        </Avatar>
                        <span className="truncate font-medium" title={m.name}>
                          {m.name}
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden truncate text-muted-foreground tabular-nums xl:table-cell">{m.phone}</TableCell>
                    <TableCell>
                      <StatusBadge status={m.status} />
                    </TableCell>
                    <TableCell className="hidden md:table-cell">
                      {cm ? (
                        <div className="flex min-w-0 items-baseline gap-2">
                          <span className="truncate" title={cm.plan_name}>
                            {cm.plan_name}
                          </span>
                          <span className="shrink-0 text-xs text-muted-foreground">
                            {cm.status === "expired"
                              ? `ended ${formatDate(cm.end_date, { year: false })}`
                              : cm.status === "upcoming"
                                ? `starts ${formatDate(cm.start_date, { year: false })}`
                                : daysLeftLabel(cm.days_left)}
                          </span>
                        </div>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell" onClick={(e) => e.stopPropagation()}>
                      <TrainerCell memberId={m.id} trainer={m.trainer} canEdit={can.role !== "trainer"} />
                    </TableCell>
                    <TableCell className="hidden truncate text-muted-foreground lg:table-cell">
                      {formatDate(m.joined_on)}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between px-4 py-2 text-xs text-muted-foreground">
            <span>
              {total} member{total === 1 ? "" : "s"}
              {pages > 1 && ` · showing ${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)}`}
            </span>
            {pages > 1 && (
              <div className="flex items-center gap-1">
                <span className="mr-1">
                  Page {page} of {pages}
                </span>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Previous page"
                  disabled={page <= 1}
                  onClick={() => setParams({ page: String(page - 1) }, false)}
                >
                  <ChevronLeftIcon />
                </Button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Next page"
                  disabled={page >= pages}
                  onClick={() => setParams({ page: String(page + 1) }, false)}
                >
                  <ChevronRightIcon />
                </Button>
              </div>
            )}
          </div>
        </TableSurface>
      )}
      {members.data && (
        <MemberQuickView
          ids={members.data.items.map((m) => m.id)}
          index={preview}
          onIndexChange={setPreview}
        />
      )}
    </>
  );
}

export default function MembersPage() {
  return (
    <Suspense>
      <MembersView />
    </Suspense>
  );
}
