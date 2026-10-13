"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type CheckInResult = Schemas["CheckInOut"];
export type VisitHistory = Schemas["VisitHistory"];
export type Device = Schemas["DeviceOut"];

const keys = {
  day: (date?: string) => ["attendance", "day", date ?? "today"] as const,
  member: (id: string) => ["attendance", "member", id] as const,
  devices: ["devices"] as const,
};

function onError(error: Error) {
  toast.error(error.message);
}

/** Who has come in on a day (default today), latest first. */
export function useVisitsOn(date?: string) {
  return useQuery({
    queryKey: keys.day(date),
    queryFn: () => unwrap(api.GET("/api/attendance", { params: { query: { date } } })),
    refetchInterval: 60_000,
  });
}

/** Check a member in now. Safe to repeat: they only count once a day. */
export function useCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      unwrap(api.POST("/api/attendance", { body: { member_id: memberId } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["attendance"] }),
    onError,
  });
}

export function useUndoCheckIn() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (visitId: string) =>
      unwrap(api.DELETE("/api/attendance/{visit_id}", { params: { path: { visit_id: visitId } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["attendance"] });
      toast.success("Check-in undone");
    },
    onError,
  });
}

export function useMemberAttendance(memberId: string) {
  return useQuery({
    queryKey: keys.member(memberId),
    queryFn: () =>
      unwrap(api.GET("/api/members/{member_id}/attendance", { params: { path: { member_id: memberId } } })),
  });
}

// --- Devices ---------------------------------------------------------------------------

export function useDevices(enabled = true) {
  return useQuery({ queryKey: keys.devices, queryFn: () => unwrap(api.GET("/api/devices")), enabled });
}

export function useCreateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Schemas["DeviceIn"]) => unwrap(api.POST("/api/devices", { body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.devices }),
    onError,
  });
}

export function useRotateDeviceKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.POST("/api/devices/{device_id}/rotate-key", { params: { path: { device_id: id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.devices }),
    onError,
  });
}

export function useUpdateDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: Schemas["DeviceUpdate"] & { id: string }) =>
      unwrap(api.PATCH("/api/devices/{device_id}", { params: { path: { device_id: id } }, body })),
    onSuccess: () => qc.invalidateQueries({ queryKey: keys.devices }),
    onError,
  });
}

export function useDeleteDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      unwrap(api.DELETE("/api/devices/{device_id}", { params: { path: { device_id: id } } })),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: keys.devices });
      toast.success("Device removed");
    },
    onError,
  });
}
