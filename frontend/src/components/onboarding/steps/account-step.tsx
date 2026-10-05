"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import Link from "next/link";
import { useEffect } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { TextField } from "@/components/form-fields";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ApiError } from "@/lib/api/client";
import { useOwnerSignup } from "@/lib/onboarding-queries";
import type { Me } from "@/lib/queries";

import { StepHeader } from "../step-header";
import { WizardFooter } from "../wizard-footer";

const schema = z.object({
  gym_name: z.string().trim().min(2, "Enter your gym's name").max(120),
  name: z.string().trim().min(2, "Enter your name").max(120),
  email: z.email("Enter a valid email"),
  password: z.string().min(8, "Use at least 8 characters").max(128),
});
type Values = z.infer<typeof schema>;

export type AccountSignals = { ownerName: string; emailValid: boolean; passwordValid: boolean };

type Props = {
  me: Me | null;
  gymName: string;
  onGymName: (name: string) => void;
  onSignals: (s: AccountSignals) => void;
  onCreated: () => void;
  onContinue: () => void;
  continuing: boolean;
};

export function AccountStep(props: Props) {
  return props.me ? <AccountCreated {...props} me={props.me} /> : <CreateAccount {...props} />;
}

function CreateAccount({ gymName, onGymName, onSignals, onCreated }: Props) {
  const signup = useOwnerSignup();
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    mode: "onTouched",
    defaultValues: { gym_name: gymName, name: "", email: "", password: "" },
  });
  const [name, email, password, gym] = useWatch({ control: form.control, name: ["name", "email", "password", "gym_name"] });

  // Feed the drawing as the owner types.
  useEffect(() => onGymName(gym ?? ""), [gym, onGymName]);
  useEffect(() => {
    onSignals({
      ownerName: name ?? "",
      emailValid: z.email().safeParse(email).success,
      passwordValid: (password ?? "").length >= 8,
    });
  }, [name, email, password, onSignals]);

  const duplicate = signup.error instanceof ApiError && signup.error.status === 409;
  const submit = form.handleSubmit((v) =>
    signup.mutate(
      { ...v, phone: null },
      {
        onSuccess: onCreated,
        onError: (e) => {
          if (e instanceof ApiError && e.status === 409) {
            form.setError("email", { message: "An account with this email already exists." });
          }
        },
      },
    ),
  );
  const { errors } = form.formState;

  return (
    <>
      <StepHeader title="Create your gym">Start with the basics. Your gym takes shape on the right as you go.</StepHeader>
      <form id="account-form" onSubmit={submit} noValidate className="flex flex-col gap-5">
        {signup.error && !duplicate && (
          <Alert variant="destructive">
            <AlertDescription>{signup.error.message}</AlertDescription>
          </Alert>
        )}
        <TextField label="Gym name" placeholder="Iron Temple" autoComplete="organization" error={errors.gym_name} {...form.register("gym_name")} />
        <TextField label="Your name" autoComplete="name" error={errors.name} {...form.register("name")} />
        <TextField label="Email" type="email" autoComplete="email" error={errors.email} {...form.register("email")} />
        {duplicate && (
          <p className="-mt-3 text-sm text-muted-foreground">
            <Link href="/login" className="text-foreground underline underline-offset-4">
              Log in instead
            </Link>
          </p>
        )}
        <TextField
          label="Password"
          type="password"
          autoComplete="new-password"
          description="At least 8 characters"
          error={errors.password}
          {...form.register("password")}
        />
        <p className="text-sm text-muted-foreground">
          Already have an account?{" "}
          <Link href="/login" className="text-foreground underline underline-offset-4">
            Log in
          </Link>
        </p>
      </form>
      <WizardFooter primary={{ label: "Create gym", form: "account-form", pending: signup.isPending }} />
    </>
  );
}

function AccountCreated({ me, gymName, onGymName, onContinue, continuing }: Props & { me: Me }) {
  const tooShort = gymName.trim().length < 2;
  return (
    <>
      <StepHeader title="Your account">Your account is set up. You can still change the gym&apos;s name.</StepHeader>
      <div className="flex flex-col gap-5">
        <TextField
          label="Gym name"
          name="gym_name"
          value={gymName}
          onChange={(e) => onGymName(e.target.value)}
          error={tooShort ? { type: "min", message: "Enter your gym's name" } : undefined}
        />
        <dl className="divide-y rounded-xl border text-sm">
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground">Owner</dt>
            <dd className="font-medium">{me.user.name}</dd>
          </div>
          <div className="flex justify-between gap-4 px-4 py-3">
            <dt className="text-muted-foreground">Email</dt>
            <dd className="truncate font-medium">{me.user.email}</dd>
          </div>
        </dl>
      </div>
      <WizardFooter primary={{ label: "Continue", onClick: onContinue, pending: continuing, disabled: tooShort }} />
    </>
  );
}
