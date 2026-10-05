"use client";

// TEMPORARY: scripted preview of the onboarding drawing. Removed before the feature ships.
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";

import { BlueprintPanel } from "@/components/onboarding/blueprint/blueprint-panel";
import { computeProgress } from "@/components/onboarding/blueprint/progress";
import type { BlueprintInput, Feature } from "@/components/onboarding/blueprint/types";

const EMPTY: BlueprintInput = {
  gymName: "", city: "", size: null, floors: null, staff: null, zones: [], facilities: [], hours: null, trainers: [],
};
const FULL: BlueprintInput = {
  gymName: "Iron Temple", city: "Koregaon Park, Pune", size: "large", floors: 2, staff: 6,
  zones: ["cardio", "weights", "machines", "functional", "studio"], facilities: ["lockers", "showers", "parking"], hours: "early",
  trainers: [
    { name: "Aarav", speciality: "weights" }, { name: "Meera", speciality: "studio" }, { name: "Kabir", speciality: "cardio" },
  ],
};

type Step = { at: number; label: string; feature: Feature; apply: (i: BlueprintInput) => BlueprintInput };
const NAME = "Iron Temple";
const script: Step[] = [
  ...[...NAME].map((_, n): Step => ({ at: 900 + n * 140, label: "Typing the gym name", feature: "sign", apply: (i) => ({ ...i, gymName: NAME.slice(0, n + 1) }) })),
  { at: 3000, label: "Size: large", feature: "shell", apply: (i) => ({ ...i, size: "large" }) },
  { at: 3900, label: "Floors: 2", feature: "shell", apply: (i) => ({ ...i, floors: 2 }) },
  { at: 4800, label: "City", feature: "trees", apply: (i) => ({ ...i, city: "Koregaon Park, Pune" }) },
  { at: 5600, label: "Staff: 6", feature: "reception", apply: (i) => ({ ...i, staff: 6 }) },
  { at: 6600, label: "Cardio", feature: "cardio", apply: (i) => ({ ...i, zones: ["cardio"] }) },
  { at: 7300, label: "Free weights", feature: "weights", apply: (i) => ({ ...i, zones: [...i.zones, "weights"] }) },
  { at: 8000, label: "Machines", feature: "machines", apply: (i) => ({ ...i, zones: [...i.zones, "machines"] }) },
  { at: 8700, label: "Functional", feature: "functional", apply: (i) => ({ ...i, zones: [...i.zones, "functional"] }) },
  { at: 9400, label: "Yoga studio", feature: "studio", apply: (i) => ({ ...i, zones: [...i.zones, "studio"] }) },
  { at: 10300, label: "Lockers", feature: "lockers", apply: (i) => ({ ...i, facilities: ["lockers"] }) },
  { at: 11000, label: "Showers", feature: "showers", apply: (i) => ({ ...i, facilities: [...i.facilities, "showers"] }) },
  { at: 11700, label: "Parking", feature: "parking", apply: (i) => ({ ...i, facilities: [...i.facilities, "parking"] }) },
  { at: 12500, label: "Hours: 5 am to 11 pm", feature: "clock", apply: (i) => ({ ...i, hours: "early" }) },
  { at: 13600, label: "Trainer: Aarav", feature: "trainers", apply: (i) => ({ ...i, trainers: [FULL.trainers[0]] }) },
  { at: 14400, label: "Trainer: Meera", feature: "trainers", apply: (i) => ({ ...i, trainers: FULL.trainers.slice(0, 2) }) },
  { at: 15200, label: "Trainer: Kabir", feature: "trainers", apply: (i) => ({ ...i, trainers: FULL.trainers }) },
];

function Demo() {
  const params = useSearchParams();
  const fixed = params.get("static");
  const [input, setInput] = useState<BlueprintInput>(
    fixed === "bare"
      ? { ...EMPTY, gymName: "Iron Temple", size: "large", floors: 2, staff: 3 }
      : fixed === "facilities"
        ? { ...EMPTY, gymName: "Iron Temple", size: "medium", floors: 1, staff: 2, zones: ["cardio", "weights"], facilities: ["lockers", "showers"], trainers: [{ name: "Aarav", speciality: "weights" }, { name: "Riya", speciality: "general", role: "front_desk" }] }
        : fixed
          ? FULL
          : EMPTY,
  );
  const [label, setLabel] = useState("Waiting for the owner...");
  const [pulse, setPulse] = useState<{ feature: Feature; nonce: number }>();
  const [finished, setFinished] = useState(!!fixed);

  useEffect(() => {
    if (fixed) return;
    const timers = script.map((s, n) =>
      window.setTimeout(() => {
        setInput(s.apply);
        setLabel(s.label);
        setPulse({ feature: s.feature, nonce: n + 1 });
      }, s.at),
    );
    timers.push(window.setTimeout(() => { setFinished(true); setLabel("Setup complete"); }, 16400));
    return () => timers.forEach(window.clearTimeout);
  }, [fixed]);

  const progress = finished
    ? 1
    : computeProgress({ input, ownerName: input.gymName ? "Rohan" : "", emailValid: !!input.gymName, passwordValid: !!input.gymName, passedEquipment: input.hours !== null, passedTrainers: input.trainers.length > 0 });

  return (
    <div className="flex h-svh w-full">
      <div className="flex w-[600px] flex-none flex-col justify-center gap-3 p-16">
        <p className="text-sm text-muted-foreground">Scripted preview</p>
        <p className="text-3xl font-semibold tracking-tight">{label}</p>
      </div>
      <BlueprintPanel input={input} progress={progress} pulse={pulse} className="h-svh flex-1 border-l" />
    </div>
  );
}

export default function Page() {
  return (
    <Suspense>
      <Demo />
    </Suspense>
  );
}
