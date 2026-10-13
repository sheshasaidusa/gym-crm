"use client";

import { DumbbellIcon } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { mApi } from "@/lib/api/client";

type GymChoice = { gym_id: string; name: string };

/** Only allow same-site relative redirects after login. */
function safeNext(next: string | null): string {
  return next && next.startsWith("/m") && !next.startsWith("//") ? next : "/m";
}

function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [phone, setPhone] = useState("");
  const [pin, setPin] = useState("");
  const [gyms, setGyms] = useState<GymChoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(gymId?: string) {
    setBusy(true);
    setError(null);
    const { error: body, response } = await mApi.POST("/api/m/auth/login", {
      body: { phone, pin, gym_id: gymId ?? null },
    });
    setBusy(false);
    if (response.ok) {
      router.replace(next);
      return;
    }
    const detail = body as { detail?: string; gyms?: GymChoice[] } | undefined;
    if (response.status === 409 && detail?.gyms) {
      setGyms(detail.gyms);
      return;
    }
    setError(
      response.status === 422
        ? "Enter your phone number and your 4 to 6 digit PIN."
        : (detail?.detail ?? "Something went wrong. Please try again."),
    );
  }

  return (
    <main className="flex min-h-svh flex-col justify-center gap-8 px-6 py-10">
      <div className="grid justify-items-center gap-3 text-center">
        <span className="flex size-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <DumbbellIcon className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Welcome back</h1>
          <p className="text-sm text-muted-foreground">Sign in to see your plan and progress</p>
        </div>
      </div>

      {gyms ? (
        <div className="grid gap-3">
          <p className="text-center text-sm">This number is a member of more than one gym. Which one?</p>
          {gyms.map((g) => (
            <Button key={g.gym_id} variant="outline" size="lg" disabled={busy} onClick={() => submit(g.gym_id)}>
              {g.name}
            </Button>
          ))}
        </div>
      ) : (
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <FieldGroup>
            {error && (
              <Alert variant="destructive">
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            )}
            <Field>
              <FieldLabel htmlFor="phone">Phone number</FieldLabel>
              <Input
                id="phone"
                type="tel"
                inputMode="tel"
                autoComplete="tel"
                placeholder="98765 43210"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="pin">PIN</FieldLabel>
              <Input
                id="pin"
                type="password"
                inputMode="numeric"
                autoComplete="current-password"
                maxLength={6}
                placeholder="••••"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
              />
            </Field>
            <Button type="submit" size="lg" disabled={busy || phone.length < 7 || pin.length < 4}>
              {busy && <Spinner />}
              Sign in
            </Button>
          </FieldGroup>
        </form>
      )}

      <p className="text-center text-xs text-muted-foreground">
        First time, or forgot your PIN? Ask your gym to send you a new link.
      </p>
    </main>
  );
}

export default function MemberLoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
