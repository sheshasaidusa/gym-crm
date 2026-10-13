"use client";

import type { Option } from "@/components/simple-select";
import { cn } from "@/lib/utils";

/** Single-choice chips; clicking the selected chip clears it. "" means none. */
export function ChipSelect({
  options,
  value,
  onChange,
  id,
}: {
  options: Option[];
  value: string;
  onChange: (value: string) => void;
  id?: string;
}) {
  return (
    <div id={id} role="radiogroup" className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(on ? "" : o.value)}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors",
              on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Multi-choice chips, in the order they were picked; once `max` are on, the rest are disabled. */
export function MultiChipSelect({
  options,
  value,
  onChange,
  max,
  id,
}: {
  options: Option[];
  value: string[];
  onChange: (value: string[]) => void;
  max?: number;
  id?: string;
}) {
  const full = max !== undefined && value.length >= max;
  return (
    <div id={id} role="group" className="flex flex-wrap gap-1.5">
      {options.map((o) => {
        const on = value.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            disabled={!on && full}
            onClick={() => onChange(on ? value.filter((v) => v !== o.value) : [...value, o.value])}
            className={cn(
              "rounded-full border px-3 py-1 text-sm transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              on ? "border-primary bg-primary text-primary-foreground" : "enabled:hover:bg-muted",
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
