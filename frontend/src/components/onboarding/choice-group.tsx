"use client";

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

const PRESSED = "data-[pressed]:border-primary data-[pressed]:bg-primary data-[pressed]:text-primary-foreground";

type Option<T extends string | number> = { value: T; label: string; hint?: string };

type Props<T extends string | number> = {
  label: string;
  options: readonly Option<T>[];
  /** Cards suit choices with a hint line; pills suit short labels. */
  look?: "pill" | "card";
  className?: string;
} & (
  | { multiple: true; value: readonly T[]; onChange: (value: T[], changed: T) => void }
  | { multiple?: false; value: T | null; onChange: (value: T, changed: T) => void }
);

/** A labelled group of toggle buttons (shadcn ToggleGroup) for one- or many-of choices. */
export function ChoiceGroup<T extends string | number>(props: Props<T>) {
  const { label, options, look = "pill", className } = props;
  const selected = props.multiple ? props.value.map(String) : props.value === null ? [] : [String(props.value)];
  const byKey = new Map(options.map((o) => [String(o.value), o.value]));

  return (
    <fieldset className={cn("flex min-w-0 flex-col gap-2", className)}>
      <legend className="mb-2 text-sm font-medium">{label}</legend>
      <ToggleGroup
        multiple={props.multiple}
        value={selected}
        onValueChange={(next: string[]) => {
          const added = next.find((k) => !selected.includes(k));
          const removed = selected.find((k) => !next.includes(k));
          const changedKey = added ?? removed;
          if (changedKey === undefined) return;
          const changed = byKey.get(changedKey) as T;
          if (props.multiple) props.onChange(next.map((k) => byKey.get(k) as T), changed);
          else if (added !== undefined) props.onChange(changed, changed);
        }}
        variant="outline"
        spacing={2}
        className={cn("w-full flex-wrap", look === "card" && "grid grid-cols-3")}
      >
        {options.map((o) => (
          <ToggleGroupItem
            key={String(o.value)}
            value={String(o.value)}
            className={cn(
              PRESSED,
              look === "pill" ? "h-9 rounded-full px-4" : "h-auto flex-col items-start gap-0.5 rounded-xl px-3 py-2.5 text-left",
            )}
          >
            <span>{o.label}</span>
            {o.hint && <span className="text-xs font-normal opacity-75">{o.hint}</span>}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </fieldset>
  );
}
