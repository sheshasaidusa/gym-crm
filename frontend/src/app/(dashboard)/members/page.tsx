"use client";

import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, SearchIcon, UsersIcon } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { useDebounced } from "@/hooks/use-debounced";
import { StatusBadge } from "@/components/members/status-badge";
import { PageHeader } from "@/components/page-header";
import { SimpleSelect } from "@/components/simple-select";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
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
} from "@/components/ui/table";
import { daysLeftLabel, formatDate, initials } from "@/lib/format";
import { useMemberCounts, useMembers, type MemberFilters } from "@/lib/member-queries";
import { useBranches, useCan, useStaff } from "@/lib/queries";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 25;
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
        <Card className="py-0">
          <Table className={cn(members.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Member</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">Plan</TableHead>
                <TableHead className="hidden lg:table-cell">Trainer</TableHead>
                <TableHead className="hidden lg:table-cell">Joined</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.data?.items.map((m) => (
                <TableRow
                  key={m.id}
                  className="cursor-pointer"
                  onClick={() => router.push(`/members/${m.id}`)}
                >
                  <TableCell className="pl-4">
                    <Link
                      href={`/members/${m.id}`}
                      className="flex items-center gap-3 outline-none"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Avatar className="size-8">
                        <AvatarFallback className="text-xs">{initials(m.name)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{m.name}</div>
                        <div className="truncate text-xs text-muted-foreground">{m.phone}</div>
                      </div>
                    </Link>
                  </TableCell>
                  <TableCell>
                    <StatusBadge status={m.status} />
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {m.current_membership ? (
                      <div className="min-w-0">
                        <div className="truncate">{m.current_membership.plan_name}</div>
                        <div className="text-xs text-muted-foreground">
                          {m.current_membership.status === "expired"
                            ? `Ended ${formatDate(m.current_membership.end_date)}`
                            : m.current_membership.status === "upcoming"
                              ? `Starts ${formatDate(m.current_membership.start_date)}`
                              : `Ends ${formatDate(m.current_membership.end_date)} · ${daysLeftLabel(m.current_membership.days_left)}`}
                        </div>
                      </div>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {m.trainer?.name ?? "—"}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground lg:table-cell">
                    {formatDate(m.joined_on)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
            <span>
              {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {total}
            </span>
            <div className="flex gap-1">
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
          </div>
        </Card>
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
