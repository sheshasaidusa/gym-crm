"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type Plan = Schemas["PlanOut"];
export type PlanInput = Schemas["PlanIn"];
export type Member = Schemas["MemberOut"];
export type MemberListItem = Schemas["MemberListItem"];
export type MemberInput = Schemas["MemberIn"];
export type MemberUpdate = Schemas["MemberUpdate"];
export type Membership = Schemas["MembershipOut"];
export type MembershipInput = Schemas["MembershipIn"];
export type MemberCounts = Schemas["MemberCounts"];

export type MemberFilters = {
  q?: string;
  status?: "active" | "expiring" | "frozen" | "upcoming" | "expired" | "none";
  branch_id?: string;
  trainer_id?: string;
  tag?: string;
  sort?: "newest" | "name" | "ending";
  page?: number;
  page_size?: number;
};

const keys = {
  plans: (archived: boolean) => ["plans", { archived }] as const,
  allPlans: ["plans"] as const,
  members: ["members"] as const,
  memberList: (f: MemberFilters) => ["members", "list", f] as const,
  memberCounts: (f: Omit<MemberFilters, "status" | "page" | "sort">) =>
    ["members", "counts", f] as const,
  member: (id: string) => ["members", "detail", id] as const,
};

function onError(error: Error) {
  toast.error(error.message);
}

// --- Plans ------------------------------------------------------------------

export function usePlans(includeArchived = false) {
  return useQuery({
    queryKey: keys.plans(includeArchived),
    queryFn: () =>
      unwrap(api.GET("/api/plans", { params: { query: { include_archived: includeArchived } } })),
  });
}

export function useSavePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Schemas["PlanUpdate"] & { id?: string }) =>
      id
        ? unwrap(api.PATCH("/api/plans/{plan_id}", { params: { path: { plan_id: id } }, body }))
        : unwrap(api.POST("/api/plans", { body: body as PlanInput })),
    onSuccess: (plan, vars) => {
      qc.invalidateQueries({ queryKey: keys.allPlans });
      const archivedChange = vars.is_active !== undefined && Object.keys(vars).length <= 2;
      toast.success(
        archivedChange
          ? plan.is_active
            ? "Plan restored"
            : "Plan archived"
          : vars.id
            ? "Plan updated"
            : "Plan created",
      );
    },
    onError,
  });
}

export function useDeletePlan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE("/api/plans/{plan_id}", { params: { path: { plan_id: id } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.allPlans });
      toast.success("Plan deleted");
    },
    onError,
  });
}

// --- Members ----------------------------------------------------------------

export function useMembers(filters: MemberFilters) {
  return useQuery({
    queryKey: keys.memberList(filters),
    queryFn: () => unwrap(api.GET("/api/members", { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });
}

export function useMemberCounts(filters: Omit<MemberFilters, "status" | "page" | "sort">) {
  return useQuery({
    queryKey: keys.memberCounts(filters),
    queryFn: () => unwrap(api.GET("/api/members/counts", { params: { query: filters } })),
    placeholderData: keepPreviousData,
  });
}

export function useMember(id: string) {
  return useQuery({
    queryKey: keys.member(id),
    queryFn: () =>
      unwrap(api.GET("/api/members/{member_id}", { params: { path: { member_id: id } } })),
  });
}

/** After any member change: store the fresh member and refresh lists/plans. */
function useMemberSaved() {
  const qc = useQueryClient();
  return (member: Member) => {
    qc.setQueryData(keys.member(member.id), member);
    qc.invalidateQueries({ queryKey: keys.members, predicate: (q) => q.queryKey[1] !== "detail" });
    qc.invalidateQueries({ queryKey: keys.allPlans });
  };
}

export function useCreateMember() {
  const saved = useMemberSaved();
  return useMutation({
    mutationFn: (body: MemberInput) => unwrap(api.POST("/api/members", { body })),
    onSuccess: (member) => {
      saved(member);
      toast.success(`${member.name} added`);
    },
    onError,
  });
}

export function useUpdateMember(id: string) {
  const saved = useMemberSaved();
  return useMutation({
    mutationFn: (body: MemberUpdate) =>
      unwrap(api.PATCH("/api/members/{member_id}", { params: { path: { member_id: id } }, body })),
    onSuccess: (member) => {
      saved(member);
      toast.success("Member updated");
    },
    onError,
  });
}

/** Give several members the same trainer (or none) in one go. */
export function useAssignTrainer() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["AssignTrainerIn"]) => unwrap(api.POST("/api/members/assign-trainer", { body })),
    onSuccess: ({ updated }) => {
      qc.invalidateQueries({ queryKey: keys.members });
      toast.success(`${updated} member${updated === 1 ? "" : "s"} updated`);
    },
    onError,
  });
}

const appAccessKey = (id: string) => ["members", id, "app-access"] as const;

/** Whether a member has opened the member app, and whether a link is waiting. */
export function useAppAccess(memberId: string) {
  return useQuery({
    queryKey: appAccessKey(memberId),
    queryFn: () =>
      unwrap(api.GET("/api/members/{member_id}/app-access", { params: { path: { member_id: memberId } } })),
  });
}

/** A fresh activation link. It resets the member's PIN, so only make one when you mean to. */
export function useSendAppLink(memberId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/members/{member_id}/app-access/link", {
          params: { path: { member_id: memberId } },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: appAccessKey(memberId) }),
    onError,
  });
}

export function useDisableAppAccess(memberId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.DELETE("/api/members/{member_id}/app-access", { params: { path: { member_id: memberId } } }),
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: appAccessKey(memberId) });
      toast.success("App access turned off");
    },
    onError,
  });
}

export function useDeleteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE("/api/members/{member_id}", { params: { path: { member_id: id } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.members });
      qc.invalidateQueries({ queryKey: keys.allPlans });
      toast.success("Member deleted");
    },
    onError,
  });
}

export function useRegeneratePreview(id: string) {
  const saved = useMemberSaved();
  return useMutation({
    mutationFn: () =>
      unwrap(
        api.POST("/api/members/{member_id}/preview-link", {
          params: { path: { member_id: id } },
        }),
      ),
    onSuccess: (member) => {
      saved(member);
      toast.success("New link created. The old link no longer works.");
    },
    onError,
  });
}

// --- Memberships ------------------------------------------------------------

export function useAddMembership(memberId: string) {
  const saved = useMemberSaved();
  return useMutation({
    mutationFn: (body: MembershipInput) =>
      unwrap(
        api.POST("/api/members/{member_id}/memberships", {
          params: { path: { member_id: memberId } },
          body,
        }),
      ),
    onSuccess: (member) => {
      saved(member);
      toast.success("Membership added");
    },
    onError,
  });
}

export function useFreezeMembership() {
  const saved = useMemberSaved();
  return useMutation({
    mutationFn: ({ id, ...body }: Schemas["FreezeIn"] & { id: string }) =>
      unwrap(
        api.POST("/api/memberships/{membership_id}/freeze", {
          params: { path: { membership_id: id } },
          body,
        }),
      ),
    onSuccess: (member) => {
      saved(member);
      toast.success("Membership frozen");
    },
    onError,
  });
}

export function useUnfreezeMembership() {
  const saved = useMemberSaved();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST("/api/memberships/{membership_id}/unfreeze", {
          params: { path: { membership_id: id } },
        }),
      ),
    onSuccess: (member) => {
      saved(member);
      toast.success("Membership unfrozen");
    },
    onError,
  });
}

export function useCancelMembership() {
  const saved = useMemberSaved();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(
        api.POST("/api/memberships/{membership_id}/cancel", {
          params: { path: { membership_id: id } },
        }),
      ),
    onSuccess: (member) => {
      saved(member);
      toast.success("Membership cancelled");
    },
    onError,
  });
}
