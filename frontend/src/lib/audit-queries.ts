"use client";

import { keepPreviousData, useQuery } from "@tanstack/react-query";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type AuditEntry = Schemas["AuditOut"];

export type AuditFilters = {
  target_type?: string;
  q?: string;
  page?: number;
};

export const AUDIT_TYPES: { value: string; label: string }[] = [
  { value: "member", label: "Members" },
  { value: "membership", label: "Memberships" },
  { value: "payment", label: "Payments" },
  { value: "expense", label: "Expenses" },
  { value: "plan", label: "Plans" },
  { value: "lead", label: "Leads" },
  { value: "checkup", label: "Check-ups" },
  { value: "ai_plan", label: "AI plans" },
  { value: "staff", label: "Staff" },
  { value: "branch", label: "Branches" },
  { value: "gym", label: "Gym settings" },
  { value: "reminders", label: "Reminders" },
  { value: "import", label: "Imports" },
  { value: "export", label: "Exports" },
];

export function useAuditLog(filters: AuditFilters) {
  return useQuery({
    queryKey: ["audit", filters],
    queryFn: () =>
      unwrap(api.GET("/api/audit", { params: { query: { ...filters, page_size: 50 } } })),
    placeholderData: keepPreviousData,
  });
}
