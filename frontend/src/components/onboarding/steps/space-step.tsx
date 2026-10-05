"use client";

import { MinusIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

import { ChoiceGroup } from "../choice-group";
import type { Draft } from "../draft";
import { FLOORS, SIZES } from "../options";
import { StepHeader } from "../step-header";

type Props = { draft: Draft; change: (patch: Partial<Draft>, feature: string) => void };

export function SpaceStep({ draft, change }: Props) {
  return (
    <>
      <StepHeader title="Your space">Tell us about the building.</StepHeader>
      <div className="flex flex-col gap-6">
        <Field>
          <FieldLabel htmlFor="city">City or area</FieldLabel>
          <Input
            id="city"
            value={draft.city}
            placeholder="e.g. Koregaon Park, Pune"
            autoComplete="address-level2"
            onChange={(e) => change({ city: e.target.value }, "trees")}
          />
        </Field>
        <ChoiceGroup
          label="Size"
          look="card"
          options={SIZES}
          value={draft.size}
          onChange={(size) => change({ size }, "shell")}
        />
        <ChoiceGroup
          label="Floors"
          options={FLOORS.map((n) => ({ value: n, label: n === 1 ? "1 floor" : `${n} floors` }))}
          value={draft.floors}
          onChange={(floors) => change({ floors }, "shell")}
        />
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium" id="staff-label">
              Staff
            </p>
            <p className="text-xs text-muted-foreground">Everyone who works there, trainers included</p>
          </div>
          <div role="group" aria-labelledby="staff-label" className="flex items-center rounded-lg border">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Fewer staff"
              disabled={draft.staff !== null && draft.staff <= 1}
              onClick={() => change({ staff: Math.max(1, (draft.staff ?? 2) - 1) }, "reception")}
            >
              <MinusIcon />
            </Button>
            <output aria-live="polite" className="min-w-10 text-center font-semibold tabular-nums">
              {draft.staff ?? "–"}
            </output>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="More staff"
              disabled={draft.staff !== null && draft.staff >= 99}
              onClick={() => change({ staff: Math.min(99, (draft.staff ?? 0) + 1) }, "reception")}
            >
              <PlusIcon />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
