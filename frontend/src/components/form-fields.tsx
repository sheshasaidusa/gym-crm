"use client";

import { EyeIcon, EyeOffIcon } from "lucide-react";
import { useState } from "react";
import type { FieldError as RHFFieldError } from "react-hook-form";

import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";

type TextFieldProps = React.ComponentProps<"input"> & {
  label?: string;
  error?: RHFFieldError;
  description?: string;
};

/** Label + input + error message, wired for react-hook-form's register(). */
export function TextField({ label, error, description, id, name, ...props }: TextFieldProps) {
  const inputId = id ?? name;
  const [shown, setShown] = useState(false);
  const isPassword = props.type === "password";
  return (
    <Field data-invalid={!!error}>
      {label && <FieldLabel htmlFor={inputId}>{label}</FieldLabel>}
      {isPassword ? (
        <div className="relative">
          <Input
            id={inputId}
            name={name}
            aria-invalid={!!error}
            {...props}
            type={shown ? "text" : "password"}
            className={`pr-10 ${props.className ?? ""}`}
          />
          <button
            type="button"
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            onClick={() => setShown((v) => !v)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-[12px] text-muted-foreground outline-none hover:text-foreground focus-visible:text-foreground"
          >
            {shown ? <EyeOffIcon className="size-4" /> : <EyeIcon className="size-4" />}
          </button>
        </div>
      ) : (
        <Input id={inputId} name={name} aria-invalid={!!error} {...props} />
      )}
      {description && !error && <FieldDescription>{description}</FieldDescription>}
      <FieldError errors={[error]} />
    </Field>
  );
}
