"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type TrainerBoard = Schemas["TrainerDashboard"];
export type DeskBoard = Schemas["DeskDashboard"];
export type SalesBoard = Schemas["SalesDashboard"];
export type StaffAnalytics = Schemas["StaffAnalytics"];

// Dashboards are glanced at all day, so they refresh when the tab regains focus and every few minutes.
const REFRESH = { staleTime: 60_000, refetchInterval: 5 * 60_000 };

/** A trainer's own board; owners and managers pass `trainerId` to look at someone else's. */
export function useTrainerBoard(trainerId?: string | null, enabled = true) {
  return useQuery({
    queryKey: ["dashboard", "trainer", trainerId ?? "me"],
    queryFn: () =>
      unwrap(api.GET("/api/dashboard/trainer", { params: { query: { trainer_id: trainerId ?? undefined } } })),
    placeholderData: keepPreviousData,
    enabled,
    ...REFRESH,
  });
}

export function useDeskBoard(enabled = true) {
  return useQuery({
    queryKey: ["dashboard", "desk"],
    queryFn: () => unwrap(api.GET("/api/dashboard/desk")),
    enabled,
    ...REFRESH,
  });
}

export function useSalesBoard(enabled = true) {
  return useQuery({
    queryKey: ["dashboard", "sales"],
    queryFn: () => unwrap(api.GET("/api/dashboard/sales")),
    enabled,
    ...REFRESH,
  });
}

export function useStaffAnalytics(months: number, enabled = true) {
  return useQuery({
    queryKey: ["analytics", "staff", months],
    queryFn: () => unwrap(api.GET("/api/analytics/staff", { params: { query: { months } } })),
    placeholderData: keepPreviousData,
    enabled,
  });
}
