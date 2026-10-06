"use client";

import { XIcon } from "lucide-react";
import { useState } from "react";

import { cn } from "@/lib/utils";

/** Chips input: type and press Enter or comma to add; Backspace on empty removes the last. */
export function TagInput({
  value,
  onChange,
  placeholder = "Type and press Enter",
  id,
  suggestions = [],
  className,
}: {
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  id?: string;
  suggestions?: string[];
  className?: string;
}) {
  const [draft, setDraft] = useState("");

  const add = (raw: string) => {
    const tag = raw.trim();
    if (tag && !value.some((v) => v.toLowerCase() === tag.toLowerCase())) {
      onChange([...value, tag]);
    }
    setDraft("");
  };

  const unused = suggestions.filter((s) => !value.some((v) => v.toLowerCase() === s.toLowerCase()));

  return (
    <div className="grid gap-2">
      <div
        className={cn(
          "flex min-h-9 w-full flex-wrap items-center gap-1 rounded-[12px] border border-[color:var(--input-border)] bg-muted px-1.5 py-1 shadow-raised-control text-sm focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 dark:bg-input/30",
          className,
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-md bg-secondary px-1.5 py-0.5 text-xs text-secondary-foreground"
          >
            {tag}
            <button
              type="button"
              aria-label={`Remove ${tag}`}
              className="rounded-sm opacity-60 hover:opacity-100"
              onClick={() => onChange(value.filter((v) => v !== tag))}
            >
              <XIcon className="size-3" />
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          placeholder={value.length ? "" : placeholder}
          className="h-6 min-w-24 flex-1 bg-transparent px-1 outline-none placeholder:text-muted-foreground"
          onChange={(e) => {
            const v = e.target.value;
            if (v.endsWith(",")) add(v.slice(0, -1));
            else setDraft(v);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add(draft);
            } else if (e.key === "Backspace" && !draft && value.length) {
              onChange(value.slice(0, -1));
            }
          }}
          onBlur={() => draft && add(draft)}
        />
      </div>
      {unused.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {unused.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => add(s)}
              className="rounded-md border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              + {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
