"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type Me = Schemas["MeOut"];
export type Gym = Schemas["GymOut"];
export type Branch = Schemas["BranchOut"];
export type Staff = Schemas["StaffOut"];
export type Invite = Schemas["InviteOut"];
export type Role = Schemas["Role"];

export const ROLE_LABELS: Record<Role, string> = {
  owner: "Owner",
  manager: "Manager",
  trainer: "Trainer",
  front_desk: "Front desk",
};

export const keys = {
  me: ["me"] as const,
  gym: ["gym"] as const,
  branches: ["branches"] as const,
  staff: ["staff"] as const,
  invites: ["invites"] as const,
};

function onError(error: Error) {
  toast.error(error.message);
}

// --- Session ----------------------------------------------------------------

export function useMe(enabled = true) {
  return useQuery({ queryKey: keys.me, queryFn: () => unwrap(api.GET("/api/auth/me")), enabled });
}

export function useCan() {
  const role = useMe().data?.role;
  return {
    role,
    manage: role === "owner" || role === "manager",
    own: role === "owner",
  };
}

export function useLogout() {
  return useMutation({
    mutationFn: () => unwrap(api.POST("/api/auth/logout")),
    // A full page load drops all cached data. (Clearing the cache first would trigger
    // refetches that 401 and redirect with a ?next= back to this page.)
    onSettled: () => window.location.replace("/login"),
  });
}

export function useSwitchGym() {
  return useMutation({
    mutationFn: (gym_id: string) =>
      unwrap(api.POST("/api/auth/switch-gym", { body: { gym_id } })),
    // Full reload so no cached data from the previous gym survives.
    onSuccess: () => window.location.assign("/"),
    onError,
  });
}

// --- Gym settings -----------------------------------------------------------

export function useGym() {
  return useQuery({ queryKey: keys.gym, queryFn: () => unwrap(api.GET("/api/gym")) });
}

export function useUpdateGym() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["GymUpdate"]) => unwrap(api.PATCH("/api/gym", { body })),
    onSuccess: (gym) => {
      qc.setQueryData(keys.gym, gym);
      qc.invalidateQueries({ queryKey: keys.me });
      toast.success("Gym settings saved");
    },
    onError,
  });
}

// --- Branches ---------------------------------------------------------------

export function useBranches() {
  return useQuery({ queryKey: keys.branches, queryFn: () => unwrap(api.GET("/api/branches")) });
}

export function useSaveBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Schemas["BranchIn"] & { id?: string }) =>
      id
        ? unwrap(api.PATCH("/api/branches/{branch_id}", { params: { path: { branch_id: id } }, body }))
        : unwrap(api.POST("/api/branches", { body })),
    onSuccess: (_, vars) => {
      qc.invalidateQueries({ queryKey: keys.branches });
      toast.success(vars.id ? "Branch updated" : "Branch added");
    },
    onError,
  });
}

export function useDeleteBranch() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE("/api/branches/{branch_id}", { params: { path: { branch_id: id } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.branches });
      toast.success("Branch deleted");
    },
    onError,
  });
}

// --- Staff & invites --------------------------------------------------------

export function useStaff(enabled = true) {
  return useQuery({ queryKey: keys.staff, queryFn: () => unwrap(api.GET("/api/staff")), enabled });
}

export function useUpdateStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Schemas["StaffUpdate"] & { id: string }) =>
      unwrap(api.PATCH("/api/staff/{staff_id}", { params: { path: { staff_id: id } }, body })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.staff });
      toast.success("Staff member updated");
    },
    onError,
  });
}

export function useRemoveStaff() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE("/api/staff/{staff_id}", { params: { path: { staff_id: id } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.staff });
      toast.success("Staff member removed");
    },
    onError,
  });
}

export function useInvites(enabled: boolean) {
  return useQuery({
    queryKey: keys.invites,
    queryFn: () => unwrap(api.GET("/api/invites")),
    enabled,
  });
}

export function useCreateInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["InviteIn"]) => unwrap(api.POST("/api/invites", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.invites }),
    onError,
  });
}

export function useRevokeInvite() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE("/api/invites/{invite_id}", { params: { path: { invite_id: id } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.invites });
      toast.success("Invite revoked");
    },
    onError,
  });
}

/** The session part of a login/signup response, without the raw tokens. */
export function toMe({ user, gym, role, gyms }: Schemas["AuthOut"]): Me {
  return { user, gym, role, gyms };
}

/** The current gym's currency code, for formatting money. */
export function useCurrency() {
  return useMe().data?.gym.currency ?? "INR";
}
