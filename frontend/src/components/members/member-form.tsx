"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { z } from "zod";

import { ChipSelect } from "@/components/chip-select";
import { TextField } from "@/components/form-fields";
import {
  draftToBody,
  emptyMembershipDraft,
  MembershipFields,
  resolveDraft,
  type MembershipDraft,
} from "@/components/members/membership-fields";
import { SimpleSelect } from "@/components/simple-select";
import { TagInput } from "@/components/tag-input";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  DIET_LABELS,
  EXPERIENCE_LABELS,
  GENDER_LABELS,
  GOAL_LABELS,
  todayIso,
  toOptions,
} from "@/lib/format";
import {
  useCreateMember,
  usePlans,
  useUpdateMember,
  type Member,
  type MemberUpdate,
} from "@/lib/member-queries";
import { ROLE_LABELS, useBranches, useStaff } from "@/lib/queries";

const NONE = "none";

const phoneOk = (v: string) => {
  const digits = v.replace(/\D/g, "");
  return digits.length >= 7 && digits.length <= 15;
};

const schema = z.object({
  name: z.string().trim().min(2, "Enter the member's name").max(120),
  phone: z.string().trim().refine(phoneOk, "Enter a valid phone number"),
  email: z.union([z.literal(""), z.email("Enter a valid email")]),
  dob: z.string(),
  gender: z.string(),
  address: z.string().max(500),
  emergency_contact_name: z.string().max(120),
  emergency_contact_phone: z
    .string()
    .trim()
    .refine((v) => v === "" || phoneOk(v), "Enter a valid phone number"),
  height_cm: z
    .string()
    .refine((v) => v === "" || (Number(v) >= 50 && Number(v) <= 260), "Between 50 and 260 cm"),
  goal: z.string(),
  diet_pref: z.string(),
  experience_level: z.string(),
  medical_notes: z.string().max(2000),
  notes: z.string().max(2000),
  tags: z.array(z.string()),
  trainer_id: z.string(),
  branch_id: z.string(),
  joined_on: z.string(),
});
type Values = z.infer<typeof schema>;

function toValues(m?: Member): Values {
  return {
    name: m?.name ?? "",
    phone: m?.phone ?? "",
    email: m?.email ?? "",
    dob: m?.dob ?? "",
    gender: m?.gender ?? "",
    address: m?.address ?? "",
    emergency_contact_name: m?.emergency_contact_name ?? "",
    emergency_contact_phone: m?.emergency_contact_phone ?? "",
    height_cm: m?.height_cm != null ? String(m.height_cm) : "",
    goal: m?.goal ?? "",
    diet_pref: m?.diet_pref ?? "",
    experience_level: m?.experience_level ?? "",
    medical_notes: m?.medical_notes ?? "",
    notes: m?.notes ?? "",
    tags: m?.tags ?? [],
    trainer_id: m?.trainer?.id ?? NONE,
    branch_id: m?.branch_id ?? NONE,
    joined_on: m?.joined_on ?? todayIso(),
  };
}

/** Form values -> API body ("" becomes null). */
function toBody(v: Values) {
  const orNull = (s: string) => (s.trim() === "" ? null : s.trim());
  return {
    name: v.name,
    phone: v.phone,
    email: orNull(v.email),
    dob: orNull(v.dob),
    gender: orNull(v.gender) as MemberUpdate["gender"],
    address: orNull(v.address),
    emergency_contact_name: orNull(v.emergency_contact_name),
    emergency_contact_phone: orNull(v.emergency_contact_phone),
    height_cm: v.height_cm === "" ? null : Number(v.height_cm),
    goal: orNull(v.goal) as MemberUpdate["goal"],
    diet_pref: orNull(v.diet_pref) as MemberUpdate["diet_pref"],
    experience_level: orNull(v.experience_level) as MemberUpdate["experience_level"],
    medical_notes: orNull(v.medical_notes),
    notes: orNull(v.notes),
    tags: v.tags,
    trainer_id: v.trainer_id === NONE ? null : v.trainer_id,
    branch_id: v.branch_id === NONE ? null : v.branch_id,
    joined_on: orNull(v.joined_on),
  };
}

export function MemberForm({ member }: { member?: Member }) {
  const router = useRouter();
  const isEdit = !!member;
  const create = useCreateMember();
  const update = useUpdateMember(member?.id ?? "");
  const staff = useStaff();
  const branches = useBranches();
  const plans = usePlans();

  const form = useForm<Values>({ resolver: zodResolver(schema), defaultValues: toValues(member) });
  const { errors } = form.formState;

  const [withMembership, setWithMembership] = useState(true);
  const [draft, setDraft] = useState<MembershipDraft>(emptyMembershipDraft(todayIso()));
  const [planError, setPlanError] = useState<string>();
  const hasPlans = (plans.data?.length ?? 0) > 0;
  const addingMembership = !isEdit && withMembership && hasPlans;

  const pending = create.isPending || update.isPending;

  const submit = form.handleSubmit((v) => {
    const body = toBody(v);
    if (isEdit) {
      update.mutate(body, { onSuccess: (m) => router.push(`/members/${m.id}`) });
      return;
    }
    let membership = null;
    if (addingMembership) {
      const plan = plans.data?.find((p) => p.id === draft.plan_id);
      if (!plan) {
        setPlanError("Choose a plan, or switch off “Add a membership now”");
        return;
      }
      if (resolveDraft(draft, plan, true).error) return;
      membership = draftToBody(draft, plan, true);
    }
    create.mutate(
      { ...body, membership },
      { onSuccess: (m) => router.push(`/members/${m.id}`) },
    );
  });

  const trainerOptions = [
    { value: NONE, label: "No trainer" },
    ...(staff.data ?? []).map((s) => ({ value: s.user_id, label: `${s.name} · ${ROLE_LABELS[s.role]}` })),
  ];
  const branchOptions = [
    { value: NONE, label: "No branch" },
    ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name })),
  ];

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-6 lg:grid-cols-[1fr_380px]">
      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>Personal details</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Full name" autoComplete="off" error={errors.name} {...form.register("name")} />
                <TextField
                  label="Phone"
                  type="tel"
                  autoComplete="off"
                  placeholder="+91 98765 43210"
                  error={errors.phone}
                  {...form.register("phone")}
                />
                <TextField label="Email (optional)" type="email" autoComplete="off" error={errors.email} {...form.register("email")} />
                <Field data-invalid={!!errors.dob}>
                  <FieldLabel htmlFor="dob">Date of birth</FieldLabel>
                  <Controller
                    control={form.control}
                    name="dob"
                    render={({ field }) => (
                      <DatePicker id="dob" max={todayIso()} value={field.value ?? ""} onChange={field.onChange} aria-invalid={!!errors.dob} />
                    )}
                  />
                  <FieldError errors={[errors.dob]} />
                </Field>
              </div>
              <Field>
                <FieldLabel>Gender</FieldLabel>
                <Controller
                  control={form.control}
                  name="gender"
                  render={({ field }) => (
                    <ChipSelect options={toOptions(GENDER_LABELS)} value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
              <TextField label="Address" error={errors.address} {...form.register("address")} />
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField
                  label="Emergency contact"
                  placeholder="Name"
                  error={errors.emergency_contact_name}
                  {...form.register("emergency_contact_name")}
                />
                <TextField
                  label="Emergency phone"
                  type="tel"
                  error={errors.emergency_contact_phone}
                  {...form.register("emergency_contact_phone")}
                />
              </div>
            </FieldGroup>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Fitness profile</CardTitle>
            <CardDescription>Used by trainers and for AI workout & diet plans.</CardDescription>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel>Goal</FieldLabel>
                <Controller
                  control={form.control}
                  name="goal"
                  render={({ field }) => (
                    <ChipSelect options={toOptions(GOAL_LABELS)} value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
              <Field>
                <FieldLabel>Diet preference</FieldLabel>
                <Controller
                  control={form.control}
                  name="diet_pref"
                  render={({ field }) => (
                    <ChipSelect options={toOptions(DIET_LABELS)} value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
              <Field>
                <FieldLabel>Experience</FieldLabel>
                <Controller
                  control={form.control}
                  name="experience_level"
                  render={({ field }) => (
                    <ChipSelect options={toOptions(EXPERIENCE_LABELS)} value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
              <TextField
                label="Height (cm)"
                type="number"
                inputMode="decimal"
                className="max-w-32"
                error={errors.height_cm}
                {...form.register("height_cm")}
              />
              <Field>
                <FieldLabel htmlFor="medical_notes">Medical notes & injuries</FieldLabel>
                <Textarea
                  id="medical_notes"
                  rows={3}
                  placeholder="e.g. Lower back pain, avoid heavy deadlifts. Diabetic."
                  {...form.register("medical_notes")}
                />
                <FieldDescription>Trainers see this before planning workouts.</FieldDescription>
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:sticky lg:top-4">
        {!isEdit && (
          <Card>
            <CardHeader>
              <CardTitle>Membership</CardTitle>
              <CardDescription>
                {hasPlans ? "Sell a plan now, or add one later." : "Create a plan first to sell memberships."}
              </CardDescription>
              {hasPlans && (
                <CardAction>
                  <Switch
                    aria-label="Add a membership now"
                    checked={withMembership}
                    onCheckedChange={setWithMembership}
                  />
                </CardAction>
              )}
            </CardHeader>
            {addingMembership && (
              <CardContent>
                <MembershipFields
                  value={draft}
                  onChange={(d) => {
                    setDraft(d);
                    if (d.plan_id) setPlanError(undefined);
                  }}
                  isFirst
                  planError={planError}
                />
              </CardContent>
            )}
            {!hasPlans && !plans.isPending && (
              <CardContent>
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/plans" />}>
                  Go to Plans
                </Button>
              </CardContent>
            )}
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Assignment</CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="trainer_id">Trainer</FieldLabel>
                <Controller
                  control={form.control}
                  name="trainer_id"
                  render={({ field }) => (
                    <SimpleSelect id="trainer_id" options={trainerOptions} value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
              {(branches.data?.length ?? 0) > 1 && (
                <Field>
                  <FieldLabel htmlFor="branch_id">Branch</FieldLabel>
                  <Controller
                    control={form.control}
                    name="branch_id"
                    render={({ field }) => (
                      <SimpleSelect id="branch_id" options={branchOptions} value={field.value} onChange={field.onChange} />
                    )}
                  />
                </Field>
              )}
              <Field data-invalid={!!errors.joined_on}>
                <FieldLabel htmlFor="joined_on">Joined on</FieldLabel>
                <Controller
                  control={form.control}
                  name="joined_on"
                  render={({ field }) => (
                    <DatePicker id="joined_on" value={field.value ?? ""} onChange={field.onChange} aria-invalid={!!errors.joined_on} />
                  )}
                />
                <FieldError errors={[errors.joined_on]} />
              </Field>
              <Field>
                <FieldLabel htmlFor="tags">Tags</FieldLabel>
                <Controller
                  control={form.control}
                  name="tags"
                  render={({ field }) => (
                    <TagInput
                      id="tags"
                      value={field.value}
                      onChange={field.onChange}
                      suggestions={["morning", "evening", "student", "couple", "vip"]}
                    />
                  )}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="notes">Notes</FieldLabel>
                <Textarea id="notes" rows={2} {...form.register("notes")} />
              </Field>
            </FieldGroup>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => (isEdit ? router.push(`/members/${member.id}`) : router.push("/members"))}
          >
            Cancel
          </Button>
          <Button type="submit" disabled={pending}>
            {pending && <Spinner />}
            {isEdit ? "Save changes" : "Add member"}
          </Button>
        </div>
      </div>
    </form>
  );
}
