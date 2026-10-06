"use client";

import { ImagePlusIcon, XIcon } from "lucide-react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { DatePicker } from "@/components/ui/date-picker";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useSaveCheckup, useUploadPhoto, type CheckUp } from "@/lib/checkup-queries";
import { todayIso } from "@/lib/format";

type NumKey =
  | "weight_kg"
  | "body_fat_pct"
  | "muscle_mass_kg"
  | "height_cm"
  | "chest_cm"
  | "waist_cm"
  | "hips_cm"
  | "arm_cm"
  | "thigh_cm";

const BODY: { key: NumKey; label: string; unit: string; min: number; max: number }[] = [
  { key: "weight_kg", label: "Weight", unit: "kg", min: 20, max: 350 },
  { key: "body_fat_pct", label: "Body fat", unit: "%", min: 2, max: 75 },
  { key: "muscle_mass_kg", label: "Muscle", unit: "kg", min: 5, max: 200 },
  { key: "height_cm", label: "Height", unit: "cm", min: 50, max: 260 },
];
const MEASUREMENTS: { key: NumKey; label: string; unit: string; min: number; max: number }[] = [
  { key: "chest_cm", label: "Chest", unit: "cm", min: 30, max: 250 },
  { key: "waist_cm", label: "Waist", unit: "cm", min: 30, max: 250 },
  { key: "hips_cm", label: "Hips", unit: "cm", min: 30, max: 250 },
  { key: "arm_cm", label: "Arm", unit: "cm", min: 10, max: 100 },
  { key: "thigh_cm", label: "Thigh", unit: "cm", min: 20, max: 150 },
];
const ALL = [...BODY, ...MEASUREMENTS];
const MAX_PHOTOS = 4;

type Draft = Record<NumKey, string> & { recorded_on: string; notes: string };

function toDraft(c: CheckUp | null, heightCm: number | null | undefined): Draft {
  const v = (n: number | null | undefined) => (n == null ? "" : String(n));
  return {
    recorded_on: c?.recorded_on ?? todayIso(),
    notes: c?.notes ?? "",
    weight_kg: v(c?.weight_kg),
    body_fat_pct: v(c?.body_fat_pct),
    muscle_mass_kg: v(c?.muscle_mass_kg),
    height_cm: v(c ? c.height_cm : heightCm),
    chest_cm: v(c?.chest_cm),
    waist_cm: v(c?.waist_cm),
    hips_cm: v(c?.hips_cm),
    arm_cm: v(c?.arm_cm),
    thigh_cm: v(c?.thigh_cm),
  };
}

function NumberField({
  spec,
  value,
  onChange,
  invalid,
}: {
  spec: (typeof ALL)[number];
  value: string;
  onChange: (v: string) => void;
  invalid: boolean;
}) {
  return (
    <Field data-invalid={invalid}>
      <FieldLabel htmlFor={`cu-${spec.key}`}>
        {spec.label} <span className="font-normal text-muted-foreground">({spec.unit})</span>
      </FieldLabel>
      <Input
        id={`cu-${spec.key}`}
        type="number"
        inputMode="decimal"
        step="0.1"
        min={spec.min}
        max={spec.max}
        aria-invalid={invalid}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </Field>
  );
}

export function CheckupDialog({
  memberId,
  memberName,
  memberHeightCm,
  checkup,
  open,
  onOpenChange,
}: {
  memberId: string;
  memberName: string;
  memberHeightCm?: number | null;
  checkup: CheckUp | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useSaveCheckup(memberId);
  const upload = useUploadPhoto(memberId);
  const [draft, setDraft] = useState<Draft>(() => toDraft(checkup, memberHeightCm));
  const [files, setFiles] = useState<File[]>([]);
  const [error, setError] = useState<string>();
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(toDraft(checkup, memberHeightCm));
      setFiles([]);
      setError(undefined);
    }
  }

  const set = (key: keyof Draft, value: string) => setDraft((d) => ({ ...d, [key]: value }));
  const outOfRange = (spec: (typeof ALL)[number]) => {
    const v = draft[spec.key];
    return v !== "" && (Number.isNaN(Number(v)) || Number(v) < spec.min || Number(v) > spec.max);
  };

  const submit = async () => {
    const bad = ALL.find(outOfRange);
    if (bad) return setError(`${bad.label} should be between ${bad.min} and ${bad.max} ${bad.unit}`);
    const metrics = ALL.filter((s) => s.key !== "height_cm" && draft[s.key] !== "");
    if (!metrics.length) return setError("Enter at least one measurement");
    if (draft.recorded_on > todayIso()) return setError("The date can't be in the future");
    setError(undefined);

    const num = (k: NumKey) => (draft[k] === "" ? null : Number(draft[k]));
    const saved = await save.mutateAsync({
      id: checkup?.id,
      recorded_on: draft.recorded_on,
      notes: draft.notes.trim() || null,
      ...(Object.fromEntries(ALL.map((s) => [s.key, num(s.key)])) as Record<NumKey, number | null>),
    });
    for (const file of files) {
      await upload.mutateAsync({ checkupId: saved.id, file });
    }
    onOpenChange(false);
  };

  const pending = save.isPending || upload.isPending;
  const existingPhotos = checkup?.photos.length ?? 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{checkup ? "Edit check-up" : "Log check-up"}</DialogTitle>
          <DialogDescription>{memberName} · fill in whatever you measured today.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field className="max-w-44">
            <FieldLabel htmlFor="cu-date">Date</FieldLabel>
            <DatePicker
              id="cu-date"
              max={todayIso()}
              value={draft.recorded_on}
              onChange={(v) => set("recorded_on", v)}
            />
          </Field>
          <FieldSet>
            <FieldLegend variant="label">Body</FieldLegend>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {BODY.map((spec) => (
                <NumberField
                  key={spec.key}
                  spec={spec}
                  value={draft[spec.key]}
                  onChange={(v) => set(spec.key, v)}
                  invalid={outOfRange(spec)}
                />
              ))}
            </div>
            <FieldDescription>BMI is worked out from weight and height.</FieldDescription>
          </FieldSet>
          <FieldSet>
            <FieldLegend variant="label">Measurements</FieldLegend>
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-5">
              {MEASUREMENTS.map((spec) => (
                <NumberField
                  key={spec.key}
                  spec={spec}
                  value={draft[spec.key]}
                  onChange={(v) => set(spec.key, v)}
                  invalid={outOfRange(spec)}
                />
              ))}
            </div>
          </FieldSet>
          <Field>
            <FieldLabel htmlFor="cu-notes">Trainer notes</FieldLabel>
            <Textarea
              id="cu-notes"
              rows={2}
              placeholder="Energy, form, diet adherence…"
              value={draft.notes}
              onChange={(e) => set("notes", e.target.value)}
            />
          </Field>
          {existingPhotos < MAX_PHOTOS && (
            <Field>
              <FieldLabel>Progress photos</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                {files.map((f, i) => (
                  <span key={i} className="inline-flex items-center gap-1 rounded-md bg-secondary px-2 py-1 text-xs">
                    {f.name}
                    <button
                      type="button"
                      aria-label={`Remove ${f.name}`}
                      onClick={() => setFiles(files.filter((_, j) => j !== i))}
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))}
                {files.length + existingPhotos < MAX_PHOTOS && (
                  <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-dashed px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted">
                    <ImagePlusIcon className="size-4" />
                    Add photo
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      capture="environment"
                      className="sr-only"
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) setFiles([...files, f]);
                        e.target.value = "";
                      }}
                    />
                  </label>
                )}
              </div>
              <FieldDescription>
                Private to your staff. JPEG, PNG or WebP, up to 8 MB, {MAX_PHOTOS} per check-up.
              </FieldDescription>
            </Field>
          )}
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={pending}>
            {pending && <Spinner />}
            {checkup ? "Save changes" : "Save check-up"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
