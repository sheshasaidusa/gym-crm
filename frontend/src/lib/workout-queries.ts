"use client";

import { keepPreviousData, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, mApi, unwrap, type Schemas } from "@/lib/api/client";

export type WorkoutHistory = Schemas["WorkoutHistory"];
export type WorkoutOut = Schemas["WorkoutOut"];
export type WorkoutIn = Schemas["WorkoutIn"];
export type WorkoutTemplate = Schemas["WorkoutTemplate"];
export type WorkoutProgress = Schemas["WorkoutProgress"];

function onError(error: Error) {
  toast.error(error.message);
}

// --- The member's own log (signed in with phone + PIN) ----------------------------------------

export function useMyWorkouts() {
  return useQuery({ queryKey: ["m", "workouts"], queryFn: () => unwrap(mApi.GET("/api/m/workouts")) });
}

/** A day of the published plan as a session to fill in; `day` picks another day. */
export function useWorkoutTemplate(day?: string) {
  return useQuery({
    queryKey: ["m", "workouts", "template", day ?? "next"],
    queryFn: () =>
      unwrap(mApi.GET("/api/m/workouts/template", { params: { query: { day } } })),
    placeholderData: keepPreviousData,
  });
}

export function useLogWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: WorkoutIn) => unwrap(mApi.POST("/api/m/workouts", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["m", "workouts"] }),
    onError,
  });
}

export function useDeleteWorkout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(mApi.DELETE("/api/m/workouts/{session_id}", { params: { path: { session_id: id } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["m", "workouts"] });
      toast.success("Workout deleted");
    },
    onError,
  });
}

// --- Staff: one member's log -----------------------------------------------------------------

export function useMemberWorkouts(memberId: string) {
  return useQuery({
    queryKey: ["members", memberId, "workouts"],
    queryFn: () =>
      unwrap(api.GET("/api/members/{member_id}/workouts", { params: { path: { member_id: memberId } } })),
  });
}
