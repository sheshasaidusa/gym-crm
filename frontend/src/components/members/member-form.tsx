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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { DatePicker } from "@/components/ui/date-picker";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  DIET_LABELS,
  EXPERIENCE_LABELS,
  formatDate,
  formatMoney,
  GENDER_LABELS,
  GOAL_LABELS,
  initials,
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
import { ROLE_LABELS, useBranches, useCurrency, useStaff } from "@/lib/queries";

const NONE = "none";

type Tab = "membership" | "personal" | "fitness" | "notes";
// Fields that live inside each tab, so a failed submit can jump to the right one.
const TAB_FIELDS = {
  personal: ["email", "dob", "gender", "address", "emergency_contact_name", "emergency_contact_phone"],
  fitness: ["goal", "diet_pref", "experience_level", "height_cm", "medical_notes"],
  notes: ["notes", "tags"],
} as const;
const PANEL = "rounded-2xl border border-border/70 bg-background p-5 sm:p-6";

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
  const currency = useCurrency();
  const [tab, setTab] = useState<Tab>(isEdit ? "personal" : "membership");
  const tabHasError = (t: keyof typeof TAB_FIELDS) => TAB_FIELDS[t].some((f) => f in errors);

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
        setTab("membership");
        return;
      }
      if (resolveDraft(draft, plan, true).error) return;
      membership = draftToBody(draft, plan, true);
    }
    create.mutate(
      { ...body, membership },
      { onSuccess: (m) => router.push(`/members/${m.id}`) },
    );
  }, (errs) => {
    // Show the tab holding the first invalid field; essentials are always on screen.
    const hit = (Object.keys(TAB_FIELDS) as (keyof typeof TAB_FIELDS)[]).find((t) => TAB_FIELDS[t].some((f) => f in errs));
    if (hit) setTab(hit);
  });

  const trainerOptions = [
    { value: NONE, label: "No trainer" },
    ...(staff.data ?? []).map((s) => ({ value: s.user_id, label: `${s.name} · ${ROLE_LABELS[s.role]}` })),
  ];
  const branchOptions = [
    { value: NONE, label: "No branch" },
    ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name })),
  ];

  const [name, phone, trainerId, joinedOn, goal, tags] = form.watch(["name", "phone", "trainer_id", "joined_on", "goal", "tags"]);
  const plan = plans.data?.find((p) => p.id === draft.plan_id);
  const trainer = staff.data?.find((s) => s.user_id === trainerId);

  return (
    <form onSubmit={submit} noValidate className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="grid min-w-0 gap-6">
        <section aria-labelledby="essentials" className={PANEL}>
          <h2 id="essentials" className="mb-4 text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Essentials
          </h2>
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
          </div>
        </section>

        <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)} className="gap-4">
          <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b border-border">
            {!isEdit && (
              <TabsTrigger value="membership" className="flex-none px-4">
                Membership
              </TabsTrigger>
            )}
            <TabsTrigger value="personal" className="flex-none px-4">
              Personal
              {tabHasError("personal") && <ErrorDot />}
            </TabsTrigger>
            <TabsTrigger value="fitness" className="flex-none px-4">
              Fitness & health
              {tabHasError("fitness") && <ErrorDot />}
            </TabsTrigger>
            <TabsTrigger value="notes" className="flex-none px-4">
              Notes & tags
            </TabsTrigger>
          </TabsList>

          {!isEdit && (
            <TabsContent value="membership" keepMounted className={PANEL}>
              <div className="mb-4 flex items-start justify-between gap-4">
                <div>
                  <p className="font-medium">Sell a membership</p>
                  <p className="text-muted-foreground">
                    {hasPlans
                      ? "Start their first plan now, or add one later from their profile."
                      : "Create a plan first to sell memberships."}
                  </p>
                </div>
                {hasPlans && (
                  <Switch aria-label="Add a membership now" checked={withMembership} onCheckedChange={setWithMembership} />
                )}
              </div>
              {addingMembership && (
                <MembershipFields
                  value={draft}
                  onChange={(d) => {
                    setDraft(d);
                    if (d.plan_id) setPlanError(undefined);
                  }}
                  isFirst
                  planError={planError}
                />
              )}
              {!hasPlans && !plans.isPending && (
                <Button variant="outline" size="sm" nativeButton={false} render={<Link href="/plans" />}>
                  Go to Plans
                </Button>
              )}
            </TabsContent>
          )}

          <TabsContent value="personal" keepMounted className={PANEL}>
            <FieldGroup>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Email" type="email" autoComplete="off" error={errors.email} {...form.register("email")} />
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
          </TabsContent>

          <TabsContent value="fitness" keepMounted className={PANEL}>
            <p className="mb-4 text-muted-foreground">Used by trainers and for AI workout & diet plans.</p>
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
              <div className="grid gap-4 sm:grid-cols-2">
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
              </div>
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
          </TabsContent>

          <TabsContent value="notes" keepMounted className={PANEL}>
            <FieldGroup>
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
                <Textarea id="notes" rows={4} {...form.register("notes")} />
              </Field>
            </FieldGroup>
          </TabsContent>
        </Tabs>
      </div>

      <aside aria-label="Summary" className="flex flex-col rounded-2xl border border-border/70 bg-background lg:sticky lg:top-20">
        <div className="flex items-center gap-3 border-b border-border/70 p-5">
          <span
            aria-hidden
            className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
          >
            {name.trim() ? initials(name) : "?"}
          </span>
          <div className="min-w-0">
            <p className="truncate font-medium">{name.trim() || (isEdit ? member.name : "New member")}</p>
            <p className="truncate text-xs text-muted-foreground">{phone.trim() || "No phone yet"}</p>
          </div>
        </div>
        <dl className="divide-y divide-border/70 px-5 text-sm">
          {!isEdit && (
            <SummaryRow label="Plan">
              {addingMembership && plan ? `${plan.name} · ${plan.duration_value} ${plan.duration_unit}` : "No membership"}
            </SummaryRow>
          )}
          {addingMembership && plan && (
            <SummaryRow label="Total due">
              <span className="font-medium tabular-nums">{formatMoney(resolveDraft(draft, plan, true).total, currency)}</span>
            </SummaryRow>
          )}
          <SummaryRow label="Trainer">{trainer?.name ?? "Not assigned"}</SummaryRow>
          <SummaryRow label="Joined">{joinedOn ? formatDate(joinedOn) : "—"}</SummaryRow>
          <SummaryRow label="Goal">{goal ? GOAL_LABELS[goal as keyof typeof GOAL_LABELS] : "—"}</SummaryRow>
          {tags.length > 0 && (
            <SummaryRow label="Tags">
              <span className="flex flex-wrap gap-1">
                {tags.map((t) => (
                  <span key={t} className="rounded-full border px-2 py-0.5 text-xs">
                    {t}
                  </span>
                ))}
              </span>
            </SummaryRow>
          )}
        </dl>
        <div className="mt-auto grid gap-2 border-t border-border/70 p-5">
          <Button type="submit" disabled={pending} className="w-full">
            {pending && <Spinner />}
            {isEdit ? "Save changes" : "Add member"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={() => (isEdit ? router.push(`/members/${member.id}`) : router.push("/members"))}
          >
            Cancel
          </Button>
        </div>
      </aside>
    </form>
  );
}

function SummaryRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1 py-3">
      <dt className="text-xs tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="min-w-0 truncate">{children}</dd>
    </div>
  );
}

function ErrorDot() {
  return <span aria-label="has errors" className="size-1.5 rounded-full bg-destructive" />;
}
