"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type Analytics = Schemas["AnalyticsOut"];

export function useAnalytics(months: number, branchId: string | null) {
  return useQuery({
    queryKey: ["analytics", months, branchId],
    queryFn: () =>
      unwrap(
        api.GET("/api/analytics", {
          params: { query: { months, branch_id: branchId ?? undefined } },
        }),
      ),
    placeholderData: keepPreviousData,
  });
}
