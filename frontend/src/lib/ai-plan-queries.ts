"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type AIPlan = Schemas["AIPlanOut"];
export type PlanContent = Schemas["PlanContent"];
export type GenerateInput = Schemas["GenerateIn"];

const keys = {
  status: ["ai", "status"] as const,
  forMember: (memberId: string) => ["ai-plans", "member", memberId] as const,
  plan: (id: string) => ["ai-plans", "plan", id] as const,
};

function onError(error: Error) {
  toast.error(error.message);
}

export function useAIStatus() {
  return useQuery({ queryKey: keys.status, queryFn: () => unwrap(api.GET("/api/ai/status")) });
}

/** Polls every 3s while a version is generating. */
export function useMemberPlans(memberId: string) {
  return useQuery({
    queryKey: keys.forMember(memberId),
    queryFn: () =>
      unwrap(
        api.GET("/api/members/{member_id}/ai-plans", { params: { path: { member_id: memberId } } }),
      ),
    refetchInterval: (q) => (q.state.data?.some((p) => p.status === "generating") ? 3000 : false),
  });
}

export function useAIPlan(id: string) {
  return useQuery({
    queryKey: keys.plan(id),
    queryFn: () => unwrap(api.GET("/api/ai-plans/{plan_id}", { params: { path: { plan_id: id } } })),
    refetchInterval: (q) => (q.state.data?.status === "generating" ? 3000 : false),
  });
}

function useSaved() {
  const qc = useQueryClient();
  return (plan: AIPlan) => {
    qc.setQueryData(keys.plan(plan.id), plan);
    qc.invalidateQueries({ queryKey: keys.forMember(plan.member_id) });
    qc.invalidateQueries({ queryKey: keys.status });
  };
}

export function useGeneratePlan(memberId: string) {
  const saved = useSaved();
  return useMutation({
    mutationFn: (body: GenerateInput) =>
      unwrap(
        api.POST("/api/members/{member_id}/ai-plans", {
          params: { path: { member_id: memberId } },
          body,
        }),
      ),
    onSuccess: (plan) => {
      saved(plan);
      toast.success("Generating the plan. This usually takes under a minute.");
    },
    onError,
  });
}

/** A hand-written draft: blank, or a copy of one of this member's plans. No AI needed. */
export function useCreateManualPlan(memberId: string) {
  const saved = useSaved();
  return useMutation({
    mutationFn: (body: { title?: string | null; copy_from_plan_id?: string | null }) =>
      unwrap(
        api.POST("/api/members/{member_id}/ai-plans/manual", {
          params: { path: { member_id: memberId } },
          body,
        }),
      ),
    onSuccess: saved,
    onError,
  });
}

export function useUpdatePlan(id: string) {
  const saved = useSaved();
  return useMutation({
    mutationFn: (body: Schemas["AIPlanUpdate"]) =>
      unwrap(api.PATCH("/api/ai-plans/{plan_id}", { params: { path: { plan_id: id } }, body })),
    onSuccess: (plan) => {
      saved(plan);
      toast.success("Plan saved");
    },
    onError,
  });
}

export function usePublishPlan() {
  const saved = useSaved();
  return useMutation({
    mutationFn: ({ id, publish }: { id: string; publish: boolean }) =>
      unwrap(
        publish
          ? api.POST("/api/ai-plans/{plan_id}/publish", { params: { path: { plan_id: id } } })
          : api.POST("/api/ai-plans/{plan_id}/unpublish", { params: { path: { plan_id: id } } }),
      ),
    onSuccess: (plan) => {
      saved(plan);
      toast.success(
        plan.status === "published" ? "Published. The member can see it now." : "Unpublished",
      );
    },
    onError,
  });
}

export function useDeletePlan(memberId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE("/api/ai-plans/{plan_id}", { params: { path: { plan_id: id } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.forMember(memberId) });
      toast.success("Plan deleted");
    },
    onError,
  });
}
