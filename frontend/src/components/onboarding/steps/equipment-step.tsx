"use client";

import { ChoiceGroup } from "../choice-group";
import type { Draft } from "../draft";
import { FACILITIES, HOURS, ZONES } from "../options";
import { StepHeader } from "../step-header";

type Props = { draft: Draft; change: (patch: Partial<Draft>, feature: string) => void };

export function EquipmentStep({ draft, change }: Props) {
  return (
    <>
      <StepHeader title="Equipment & facilities">Pick everything you have. You can add more later.</StepHeader>
      <div className="flex flex-col gap-6">
        <ChoiceGroup multiple label="Training zones" options={ZONES} value={draft.zones} onChange={(zones, z) => change({ zones }, z)} />
        <ChoiceGroup
          multiple
          label="Facilities"
          options={FACILITIES}
          value={draft.facilities}
          onChange={(facilities, f) => change({ facilities }, f)}
        />
        <ChoiceGroup label="Opening hours" options={HOURS} value={draft.hours} onChange={(hours) => change({ hours }, "clock")} />
      </div>
    </>
  );
}
