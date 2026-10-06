"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { TextField } from "@/components/form-fields";
import { SimpleSelect } from "@/components/simple-select";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Field,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { useCan, useGym, useUpdateGym, type Gym } from "@/lib/queries";

const TIMEZONES = [
  "Asia/Kolkata",
  "Asia/Dubai",
  "Asia/Singapore",
  "Asia/Kathmandu",
  "Asia/Dhaka",
  "Europe/London",
  "Europe/Berlin",
  "America/New_York",
  "America/Chicago",
  "America/Los_Angeles",
  "Australia/Sydney",
  "UTC",
];

const CURRENCIES = ["INR", "USD", "EUR", "GBP", "AED", "SGD", "AUD", "CAD"];

const schema = z.object({
  name: z.string().trim().min(2, "Enter your gym's name").max(120),
  phone: z.string().trim().max(30),
  brand_color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #16a34a"),
  timezone: z.string().min(1),
  currency: z.string().length(3),
  checkup_interval_days: z.coerce.number<string | number>().int().min(1, "At least 1 day").max(90),
});
type Values = z.input<typeof schema>;
type Output = z.output<typeof schema>;

function toValues(gym: Gym): Values {
  return {
    name: gym.name,
    phone: gym.phone ?? "",
    brand_color: gym.brand_color,
    timezone: gym.timezone,
    currency: gym.currency,
    checkup_interval_days: gym.checkup_interval_days,
  };
}

export function GeneralSettings() {
  const gym = useGym();
  const can = useCan();
  const update = useUpdateGym();
  const form = useForm<Values, unknown, Output>({ resolver: zodResolver(schema) });

  useEffect(() => {
    if (gym.data) form.reset(toValues(gym.data));
  }, [gym.data, form]);

  if (gym.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (gym.isError) return <p className="text-sm text-destructive">{gym.error.message}</p>;

  const readOnly = !can.own;
  const { errors, isDirty } = form.formState;
  const timezones = TIMEZONES.includes(gym.data.timezone)
    ? TIMEZONES
    : [gym.data.timezone, ...TIMEZONES];

  return (
    <form
      onSubmit={form.handleSubmit((v) => update.mutate({ ...v, phone: v.phone || null }))}
      noValidate
    >
      <Card variant="flat">
        <CardHeader>
          <CardTitle>Gym details</CardTitle>
          <CardDescription>
            {readOnly
              ? "Only the gym owner can change these settings."
              : "Shown to members on their preview page and in reminders."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <fieldset disabled={readOnly} className="contents">
            <FieldGroup>
              <div className="grid gap-6 sm:grid-cols-2">
                <TextField label="Gym name" error={errors.name} {...form.register("name")} />
                <TextField
                  label="Contact number"
                  type="tel"
                  error={errors.phone}
                  {...form.register("phone")}
                />
                <TextField
                  label="Check-up every (days)"
                  type="number"
                  min={1}
                  max={90}
                  description="Members show as due for a check-up after this many days."
                  error={errors.checkup_interval_days}
                  {...form.register("checkup_interval_days")}
                />
                <Field data-invalid={!!errors.timezone}>
                  <FieldLabel htmlFor="timezone">Time zone</FieldLabel>
                  <Controller
                    control={form.control}
                    name="timezone"
                    render={({ field }) => (
                      <SimpleSelect
                        id="timezone"
                        disabled={readOnly}
                        options={timezones.map((t) => ({ value: t, label: t.replace("_", " ") }))}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="currency">Currency</FieldLabel>
                  <Controller
                    control={form.control}
                    name="currency"
                    render={({ field }) => (
                      <SimpleSelect
                        id="currency"
                        disabled={readOnly}
                        options={CURRENCIES.map((c) => ({ value: c, label: c }))}
                        value={field.value}
                        onChange={field.onChange}
                      />
                    )}
                  />
                </Field>
                <Field data-invalid={!!errors.brand_color}>
                  <FieldLabel htmlFor="brand_color">Brand colour</FieldLabel>
                  <div className="flex items-center gap-2">
                    <Controller
                      control={form.control}
                      name="brand_color"
                      render={({ field }) => (
                        <input
                          type="color"
                          aria-label="Pick brand colour"
                          className="h-8 w-10 cursor-pointer rounded-md border bg-transparent p-0.5"
                          value={field.value ?? "#16a34a"}
                          onChange={field.onChange}
                        />
                      )}
                    />
                    <Input
                      id="brand_color"
                      className="font-mono"
                      aria-invalid={!!errors.brand_color}
                      {...form.register("brand_color")}
                    />
                  </div>
                  <FieldError errors={[errors.brand_color]} />
                </Field>
              </div>

              <p className="text-sm text-muted-foreground">
                Membership reminder timing and messages are in{" "}
                <Link href="/reminders?tab=settings" className="text-foreground underline underline-offset-4">
                  Reminders → Settings
                </Link>
                .
              </p>
            </FieldGroup>
          </fieldset>
        </CardContent>
        {!readOnly && (
          <CardFooter className="justify-end gap-2 border-t pt-4">
            <Button
              type="button"
              variant="ghost"
              disabled={!isDirty || update.isPending}
              onClick={() => form.reset(toValues(gym.data))}
            >
              Discard
            </Button>
            <Button type="submit" disabled={!isDirty || update.isPending}>
              {update.isPending && <Spinner />}
              Save changes
            </Button>
          </CardFooter>
        )}
      </Card>
    </form>
  );
}
