"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";

import { api, unwrap, type Schemas } from "@/lib/api/client";

export type ImportEntity = Schemas["ImportEntity"];
export type ImportJob = Schemas["ImportJobOut"];
export type ImportField = Schemas["FieldOut"];
export type UploadResult = Schemas["UploadOut"];
export type CheckResult = Schemas["CheckOut"];
export type CheckIn = Schemas["CheckIn"];

export const ENTITY_META: Record<ImportEntity, { label: string; text: string }> = {
  plans: { label: "Plans", text: "Your membership packages: name, duration and price." },
  members: {
    label: "Members",
    text: "Profiles, plus their current membership and what they paid.",
  },
  payments: { label: "Payments", text: "Past payments, matched to members by phone number." },
  checkups: { label: "Check-ups", text: "Weight and measurements, matched by phone number." },
  leads: { label: "Leads", text: "Enquiries you're still following up on." },
};

/** The order that avoids "plan doesn't exist" / "no member with this phone" errors. */
export const ENTITY_ORDER: ImportEntity[] = ["plans", "members", "payments", "checkups", "leads"];

export const templateUrl = (entity: ImportEntity) => `/api/imports/templates/${entity}`;
export const problemsUrl = (id: string) => `/api/imports/${id}/problems.csv`;

function onError(error: Error) {
  toast.error(error.message);
}

export function useImportFields() {
  return useQuery({
    queryKey: ["imports", "fields"],
    queryFn: () => unwrap(api.GET("/api/imports/fields")),
    staleTime: Infinity,
  });
}

export function useImports() {
  return useQuery({
    queryKey: ["imports", "list"],
    queryFn: () => unwrap(api.GET("/api/imports")),
  });
}

/** Polls while the import runs in the background. */
export function useImportJob(id: string | null) {
  return useQuery({
    queryKey: ["imports", "job", id],
    queryFn: () =>
      unwrap(api.GET("/api/imports/{job_id}", { params: { path: { job_id: id! } } })),
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.status === "running" ? 1000 : false),
  });
}

export function useUploadImport() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ entity, file }: { entity: ImportEntity; file: File }) =>
      unwrap(
        api.POST("/api/imports", {
          body: { entity, file: file as unknown as string },
          bodySerializer: () => {
            const form = new FormData();
            form.append("entity", entity);
            form.append("file", file);
            return form;
          },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["imports", "list"] }),
    onError,
  });
}

export function useCheckImport(id: string) {
  return useMutation({
    mutationFn: (body: CheckIn) =>
      unwrap(api.POST("/api/imports/{job_id}/check", { params: { path: { job_id: id } }, body })),
    onError,
  });
}

export function useRunImport(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      unwrap(api.POST("/api/imports/{job_id}/run", { params: { path: { job_id: id } } })),
    onSuccess: (job) => {
      qc.setQueryData(["imports", "job", id], job);
      qc.invalidateQueries({ queryKey: ["imports", "list"] });
    },
    onError,
  });
}

/** Imported rows show up everywhere, so refresh it all once a run finishes. */
export function useInvalidateImported() {
  const qc = useQueryClient();
  return () => {
    for (const key of ["members", "plans", "leads", "payments", "finance", "checkups", "imports"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };
}
