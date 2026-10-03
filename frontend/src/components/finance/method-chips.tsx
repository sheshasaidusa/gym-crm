"use client";

import { METHOD_LABELS, type PaymentMethod } from "@/lib/finance-queries";
import { cn } from "@/lib/utils";

const COMMON: PaymentMethod[] = ["cash", "upi", "card", "bank_transfer", "cheque", "other"];

export function MethodChips({
  value,
  onChange,
}: {
  value: PaymentMethod;
  onChange: (value: PaymentMethod) => void;
}) {
  return (
    <div role="radiogroup" aria-label="Payment method" className="flex flex-wrap gap-1.5">
      {COMMON.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={value === m}
          onClick={() => onChange(m)}
          className={cn(
            "rounded-full border px-3 py-1 text-sm transition-colors",
            value === m ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
          )}
        >
          {METHOD_LABELS[m]}
        </button>
      ))}
    </div>
  );
}
