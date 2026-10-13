"use client";

import { useQuery } from "@tanstack/react-query";

import { mApi, unwrap, type Schemas } from "@/lib/api/client";

export type MemberMe = Schemas["MemberMe"];
export type MemberCheckUp = Schemas["MemberCheckUp"];

/** What a gym member sees in their own app. All of it comes from /api/m/*, signed in with phone + PIN. */
export function useMemberMe() {
  return useQuery({
    queryKey: ["m", "me"],
    queryFn: () => unwrap(mApi.GET("/api/m/me")),
    staleTime: 60_000,
  });
}

export function useMemberPlan() {
  return useQuery({ queryKey: ["m", "plan"], queryFn: () => unwrap(mApi.GET("/api/m/plan")) });
}

export function useMemberCheckups() {
  return useQuery({
    queryKey: ["m", "checkups"],
    queryFn: () => unwrap(mApi.GET("/api/m/checkups")),
  });
}
