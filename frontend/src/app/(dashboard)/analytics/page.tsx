"use client";

import { AnalyticsView } from "@/components/analytics/analytics-view";
import { PageHeader } from "@/components/page-header";
import { SimpleSelect } from "@/components/simple-select";
import { Skeleton } from "@/components/ui/skeleton";
import { useAnalytics } from "@/lib/analytics-queries";
import { formatDate } from "@/lib/format";
import { useBranches, useCan } from "@/lib/queries";
import { cn } from "@/lib/utils";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

const PERIODS = [3, 6, 12];
const ALL = "all";

function AnalyticsPageBody() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const months = PERIODS.includes(Number(params.get("months"))) ? Number(params.get("months")) : 6;
  const branchId = params.get("branch");
  const branches = useBranches();
  const analytics = useAnalytics(months, branchId);

  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    router.replace(`${pathname}?${next}`, { scroll: false });
  };

  const branchOptions = [
    { value: ALL, label: "All branches" },
    ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name })),
  ];

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description={
          analytics.data
            ? `${formatDate(analytics.data.period_start)} to today`
            : "How your gym is doing"
        }
      >
        {(branches.data?.length ?? 0) > 1 && (
          <SimpleSelect
            className="w-40"
            options={branchOptions}
            value={branchId ?? ALL}
            onChange={(v) => setParam("branch", v === ALL ? null : v)}
          />
        )}
        <div className="flex rounded-lg border p-0.5" role="radiogroup" aria-label="Period">
          {PERIODS.map((n) => (
            <button
              key={n}
              type="button"
              role="radio"
              aria-checked={months === n}
              onClick={() => setParam("months", n === 6 ? null : String(n))}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs",
                months === n ? "bg-muted font-medium" : "text-muted-foreground",
              )}
            >
              {n} months
            </button>
          ))}
        </div>
      </PageHeader>

      {branchId && (
        <p className="text-xs text-muted-foreground">
          Leads aren&apos;t tied to a branch, so they show for the whole gym. Expenses without a
          branch are left out.
        </p>
      )}

      {analytics.isPending ? (
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      ) : analytics.isError ? (
        <p className="text-sm text-destructive">{analytics.error.message}</p>
      ) : (
        <div className={cn("transition-opacity", analytics.isPlaceholderData && "opacity-60")}>
          <AnalyticsView data={analytics.data} />
        </div>
      )}
    </div>
  );
}

export default function AnalyticsPage() {
  const can = useCan();
  if (can.role && !can.manage) {
    return (
      <p className="text-sm text-muted-foreground">Analytics are for owners and managers.</p>
    );
  }
  return (
    <Suspense>
      <AnalyticsPageBody />
    </Suspense>
  );
}
