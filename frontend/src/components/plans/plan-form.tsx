"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { TextField } from "@/components/form-fields";
import { SimpleSelect } from "@/components/simple-select";
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { durationLabel, formatMoney, type DurationUnit } from "@/lib/format";
import { useSavePlan, type Plan } from "@/lib/member-queries";
import { useCurrency } from "@/lib/queries";
import { cn } from "@/lib/utils";

const UNITS: { value: DurationUnit; label: string }[] = [
  { value: "day", label: "Days" },
  { value: "week", label: "Weeks" },
  { value: "month", label: "Months" },
  { value: "year", label: "Years" },
];

const PRESETS: { label: string; value: number; unit: DurationUnit }[] = [
  { label: "Monthly", value: 1, unit: "month" },
  { label: "Quarterly", value: 3, unit: "month" },
  { label: "Half-yearly", value: 6, unit: "month" },
  { label: "Yearly", value: 1, unit: "year" },
];

const SERVICE_SUGGESTIONS = ["Gym floor", "Cardio", "Personal training", "Diet plan", "Locker", "Steam", "Group classes"];

const money = z.coerce.number<string | number>().min(0, "Can't be negative").max(10_000_000);

const schema = z.object({
  name: z.string().trim().min(2, "Give the plan a name").max(120),
  duration_value: z.coerce
    .number<string | number>()
    .int("Whole numbers only")
    .min(1, "At least 1")
    .max(1000),
  duration_unit: z.enum(["day", "week", "month", "year"]),
  price: money,
  joining_fee: money,
  tax_pct: z.coerce.number<string | number>().min(0).max(100, "Max 100%"),
  max_freeze_days: z.coerce.number<string | number>().int().min(0).max(365),
  services: z.array(z.string()),
  description: z.string().max(2000),
});
type FormIn = z.input<typeof schema>;
type FormOut = z.output<typeof schema>;

function defaults(plan: Plan | null): FormIn {
  return {
    name: plan?.name ?? "",
    duration_value: plan?.duration_value ?? 1,
    duration_unit: plan?.duration_unit ?? "month",
    price: plan?.price ?? "",
    joining_fee: plan?.joining_fee ?? 0,
    tax_pct: plan?.tax_pct ?? 0,
    max_freeze_days: plan?.max_freeze_days ?? 0,
    services: plan?.services ?? [],
    description: plan?.description ?? "",
  };
}

/** Create/edit form laid out for a side panel: scrolling fields, pinned footer. */
export function PlanForm({ plan, onDone }: { plan: Plan | null; onDone: () => void }) {
  const currency = useCurrency();
  const save = useSavePlan();
  const form = useForm<FormIn, unknown, FormOut>({
    resolver: zodResolver(schema),
    values: defaults(plan),
  });
  const { errors } = form.formState;
  const [value, unit, price, tax] = useWatch({
    control: form.control,
    name: ["duration_value", "duration_unit", "price", "tax_pct"],
  });
  const priceWithTax = Number(price || 0) * (1 + Number(tax || 0) / 100);

  const submit = form.handleSubmit((v) =>
    save.mutate(
      { id: plan?.id, ...v, description: v.description || null },
      { onSuccess: onDone },
    ),
  );

  return (
        <form onSubmit={submit} noValidate className="flex min-h-0 flex-1 flex-col">
          <div className="flex-1 overflow-y-auto p-5">
          <FieldGroup>
            <TextField
              label="Plan name"
              placeholder="e.g. Quarterly – Gym + Cardio"
              error={errors.name}
              {...form.register("name")}
            />

            <Field data-invalid={!!errors.duration_value}>
              <FieldLabel htmlFor="duration_value">Duration</FieldLabel>
              <div className="flex flex-wrap gap-1.5">
                {PRESETS.map((p) => {
                  const on = Number(value) === p.value && unit === p.unit;
                  return (
                    <button
                      key={p.label}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        form.setValue("duration_value", p.value, { shouldDirty: true });
                        form.setValue("duration_unit", p.unit, { shouldDirty: true });
                      }}
                      className={cn(
                        "rounded-full border px-3 py-1 text-xs transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                      )}
                    >
                      {p.label}
                    </button>
                  );
                })}
              </div>
              <div className="flex gap-2">
                <TextField
                  aria-label="Duration amount"
                  id="duration_value"
                  type="number"
                  min={1}
                  className="w-24"
                  error={errors.duration_value}
                  {...form.register("duration_value")}
                />
                <Controller
                  control={form.control}
                  name="duration_unit"
                  render={({ field }) => (
                    <SimpleSelect
                      options={UNITS}
                      value={field.value}
                      onChange={field.onChange}
                      className="w-32"
                    />
                  )}
                />
              </div>
            </Field>

            <div className="grid grid-cols-2 gap-4">
              <TextField
                label={`Price (${currency})`}
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                error={errors.price}
                {...form.register("price")}
              />
              <TextField
                label="Joining fee"
                type="number"
                min={0}
                step="0.01"
                inputMode="decimal"
                description="First membership only"
                error={errors.joining_fee}
                {...form.register("joining_fee")}
              />
              <TextField
                label="Tax %"
                type="number"
                min={0}
                max={100}
                step="0.01"
                inputMode="decimal"
                error={errors.tax_pct}
                {...form.register("tax_pct")}
              />
            </div>

            <TextField
              label="Freeze days allowed"
              type="number"
              min={0}
              description="How many days a member can pause this membership. 0 = no freezing."
              error={errors.max_freeze_days}
              {...form.register("max_freeze_days")}
            />

            <Field>
              <FieldLabel htmlFor="services">What&apos;s included</FieldLabel>
              <Controller
                control={form.control}
                name="services"
                render={({ field }) => (
                  <TagInput
                    id="services"
                    value={field.value}
                    onChange={field.onChange}
                    suggestions={SERVICE_SUGGESTIONS}
                  />
                )}
              />
            </Field>

            <Field>
              <FieldLabel htmlFor="description">Description (optional)</FieldLabel>
              <Textarea id="description" rows={2} {...form.register("description")} />
            </Field>

            {Number(price) > 0 && Number(value) > 0 && (
              <FieldDescription className="rounded-lg bg-muted px-3 py-2 text-foreground">
                {durationLabel(Number(value), unit)} ·{" "}
                <strong>{formatMoney(priceWithTax, currency)}</strong>
                {Number(tax) > 0 ? " incl. tax" : ""}
              </FieldDescription>
            )}
          </FieldGroup>
          </div>

          <div className="flex justify-end gap-2 border-t border-border/70 p-5">
            <Button type="button" variant="ghost" onClick={onDone}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {plan ? "Save changes" : "Create plan"}
            </Button>
          </div>
        </form>
  );
}
