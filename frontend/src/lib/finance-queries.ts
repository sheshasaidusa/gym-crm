"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type Payment = Schemas["PaymentOut"];
export type PaymentMethod = Schemas["PaymentMethod"];
export type Expense = Schemas["ExpenseOut"];
export type ExpenseCategory = Schemas["ExpenseCategory"];
export type Due = Schemas["DueOut"];

export const METHOD_LABELS: Record<PaymentMethod, string> = {
  cash: "Cash",
  upi: "UPI",
  card: "Card",
  bank_transfer: "Bank transfer",
  cheque: "Cheque",
  other: "Other",
};

export const CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  rent: "Rent",
  salaries: "Salaries",
  utilities: "Utilities",
  equipment: "Equipment",
  maintenance: "Maintenance",
  marketing: "Marketing",
  supplies: "Supplies",
  software: "Software",
  taxes: "Taxes & fees",
  other: "Other",
};

export type PaymentFilters = {
  member_id?: string;
  method?: PaymentMethod;
  date_from?: string;
  date_to?: string;
  q?: string;
  page?: number;
  page_size?: number;
};

export type ExpenseFilters = {
  category?: ExpenseCategory;
  date_from?: string;
  date_to?: string;
  page?: number;
};

function onError(error: Error) {
  toast.error(error.message);
}

/** Money changes touch members (paid/balance), dues and the summary. */
function useInvalidateMoney() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["payments", "finance", "expenses", "members"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}

export function usePayments(filters: PaymentFilters, enabled = true) {
  return useQuery({
    queryKey: ["payments", filters],
    queryFn: () => unwrap(api.GET("/api/payments", { params: { query: filters } })),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useRecordPayment(memberId: string) {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (body: Schemas["PaymentIn"]) =>
      unwrap(
        api.POST("/api/members/{member_id}/payments", {
          params: { path: { member_id: memberId } },
          body,
        }),
      ),
    onSuccess: (p) => {
      invalidate();
      toast.success(`Payment recorded · ${p.receipt_no}`);
    },
    onError,
  });
}

export function useVoidPayment() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      unwrap(
        api.POST("/api/payments/{payment_id}/void", {
          params: { path: { payment_id: id } },
          body: { reason },
        }),
      ),
    onSuccess: () => {
      invalidate();
      toast.success("Payment voided");
    },
    onError,
  });
}

export function useReceipt(id: string) {
  return useQuery({
    queryKey: ["payments", "receipt", id],
    queryFn: () =>
      unwrap(api.GET("/api/payments/{payment_id}/receipt", { params: { path: { payment_id: id } } })),
  });
}

export function useDues(memberId?: string) {
  return useQuery({
    queryKey: ["finance", "dues", memberId ?? "all"],
    queryFn: () =>
      unwrap(api.GET("/api/finance/dues", { params: { query: memberId ? { member_id: memberId } : {} } })),
  });
}

export function useFinanceSummary(months: number, enabled = true) {
  return useQuery({
    queryKey: ["finance", "summary", months],
    queryFn: () => unwrap(api.GET("/api/finance/summary", { params: { query: { months } } })),
    enabled,
  });
}

export function useExpenses(filters: ExpenseFilters) {
  return useQuery({
    queryKey: ["expenses", filters],
    queryFn: () => unwrap(api.GET("/api/expenses", { params: { query: { ...filters, page_size: 25 } } })),
    placeholderData: keepPreviousData,
  });
}

export function useSaveExpense() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: async ({
      id,
      file,
      ...body
    }: Schemas["ExpenseIn"] & { id?: string; file?: File | null }) => {
      const saved = id
        ? await unwrap(api.PATCH("/api/expenses/{expense_id}", { params: { path: { expense_id: id } }, body }))
        : await unwrap(api.POST("/api/expenses", { body }));
      if (file) {
        return unwrap(
          api.POST("/api/expenses/{expense_id}/attachment", {
            params: { path: { expense_id: saved.id } },
            body: { file: file as unknown as string },
            bodySerializer: (b) => {
              const form = new FormData();
              form.append("file", (b as unknown as { file: File }).file);
              return form;
            },
          }),
        );
      }
      return saved;
    },
    onSuccess: (_, vars) => {
      invalidate();
      toast.success(vars.id ? "Expense updated" : "Expense added");
    },
    onError,
  });
}

export function useDeleteExpense() {
  const invalidate = useInvalidateMoney();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE("/api/expenses/{expense_id}", { params: { path: { expense_id: id } } })),
    onSuccess: () => {
      invalidate();
      toast.success("Expense deleted");
    },
    onError,
  });
}
