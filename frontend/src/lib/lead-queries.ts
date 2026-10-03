"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type Lead = Schemas["LeadOut"];
export type LeadDetail = Schemas["LeadDetail"];
export type LeadStage = Schemas["LeadStage"];
export type LeadSource = Schemas["LeadSource"];
export type LeadInput = Schemas["LeadIn"];

export const STAGES: { value: LeadStage; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "trial_booked", label: "Trial booked" },
  { value: "trial_done", label: "Trial done" },
  { value: "converted", label: "Converted" },
  { value: "lost", label: "Lost" },
];
export const OPEN_STAGES: LeadStage[] = ["new", "contacted", "trial_booked", "trial_done"];
export const STAGE_LABELS = Object.fromEntries(STAGES.map((s) => [s.value, s.label])) as Record<
  LeadStage,
  string
>;

export const SOURCE_LABELS: Record<LeadSource, string> = {
  walk_in: "Walk-in",
  phone_call: "Phone call",
  instagram: "Instagram",
  facebook: "Facebook",
  google: "Google",
  referral: "Referral",
  website: "Website",
  other: "Other",
};

export type LeadFilters = {
  q?: string;
  source?: LeadSource;
  assigned?: string;
  due?: boolean;
  include_closed?: boolean;
};

const keys = {
  all: ["leads"] as const,
  list: (f: LeadFilters) => ["leads", "list", f] as const,
  stats: ["leads", "stats"] as const,
  detail: (id: string) => ["leads", "detail", id] as const,
  form: ["leads", "form"] as const,
};

function onError(error: Error) {
  toast.error(error.message);
}

export function useLeads(filters: LeadFilters) {
  return useQuery({
    queryKey: keys.list(filters),
    queryFn: () => unwrap(api.GET("/api/leads", { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });
}

export function useLeadStats(enabled = true) {
  return useQuery({
    queryKey: keys.stats,
    queryFn: () => unwrap(api.GET("/api/leads/stats")),
    enabled,
    refetchInterval: 120_000,
  });
}

export function useLead(id: string | null) {
  return useQuery({
    queryKey: keys.detail(id ?? ""),
    queryFn: () => unwrap(api.GET("/api/leads/{lead_id}", { params: { path: { lead_id: id! } } })),
    enabled: !!id,
  });
}

/** Store the fresh lead and refresh lists/stats (and members after a conversion). */
function useSaved() {
  const qc = useQueryClient();
  return (lead: LeadDetail) => {
    qc.setQueryData(keys.detail(lead.id), lead);
    qc.invalidateQueries({ queryKey: keys.all, predicate: (q) => q.queryKey[1] !== "detail" });
    if (lead.stage === "converted") qc.invalidateQueries({ queryKey: ["members"] });
  };
}

export function useCreateLead() {
  const saved = useSaved();
  return useMutation({
    mutationFn: (body: LeadInput) => unwrap(api.POST("/api/leads", { body })),
    onSuccess: (lead) => {
      saved(lead);
      toast.success(`${lead.name} added`);
    },
    onError,
  });
}

export function useUpdateLead(id: string) {
  const saved = useSaved();
  return useMutation({
    mutationFn: (body: Schemas["LeadUpdate"]) =>
      unwrap(api.PATCH("/api/leads/{lead_id}", { params: { path: { lead_id: id } }, body })),
    onSuccess: saved,
    onError,
  });
}

/** Optimistic: the card moves columns immediately and snaps back if the API refuses. */
export function useMoveLead() {
  const qc = useQueryClient();
  const saved = useSaved();
  return useMutation({
    mutationFn: ({ id, ...body }: Schemas["StageIn"] & { id: string }) =>
      unwrap(api.POST("/api/leads/{lead_id}/stage", { params: { path: { lead_id: id } }, body })),
    onMutate: async ({ id, stage }) => {
      await qc.cancelQueries({ queryKey: ["leads", "list"] });
      const previous = qc.getQueriesData<Lead[]>({ queryKey: ["leads", "list"] });
      qc.setQueriesData<Lead[]>({ queryKey: ["leads", "list"] }, (old) =>
        old?.map((l) => (l.id === id ? { ...l, stage } : l)),
      );
      return { previous };
    },
    onError: (error, _vars, context) => {
      context?.previous.forEach(([key, data]) => qc.setQueryData(key, data));
      onError(error);
    },
    onSuccess: saved,
  });
}

export function useLogActivity(id: string) {
  const saved = useSaved();
  return useMutation({
    mutationFn: (body: Schemas["ActivityIn"]) =>
      unwrap(api.POST("/api/leads/{lead_id}/activities", { params: { path: { lead_id: id } }, body })),
    onSuccess: (lead) => {
      saved(lead);
      toast.success("Logged");
    },
    onError,
  });
}

export function useConvertLead(id: string) {
  const saved = useSaved();
  return useMutation({
    mutationFn: (body: Schemas["ConvertIn"]) =>
      unwrap(api.POST("/api/leads/{lead_id}/convert", { params: { path: { lead_id: id } }, body })),
    onSuccess: (lead) => {
      saved(lead);
      toast.success(`${lead.name} is now a member`);
    },
    onError,
  });
}

export function useDeleteLead() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE("/api/leads/{lead_id}", { params: { path: { lead_id: id } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.all });
      toast.success("Lead deleted");
    },
    onError,
  });
}

export function useLeadForm(enabled: boolean) {
  return useQuery({
    queryKey: keys.form,
    queryFn: () => unwrap(api.GET("/api/leads/form-settings")),
    enabled,
  });
}

export function useSetLeadForm() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (query: { enabled: boolean; new_link?: boolean }) =>
      unwrap(api.POST("/api/leads/form-settings", { params: { query } })),
    onSuccess: (s) => {
      qc.setQueryData(keys.form, s);
      toast.success(s.enabled ? "Enquiry form is live" : "Enquiry form turned off");
    },
    onError,
  });
}
