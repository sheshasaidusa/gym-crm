"use client";

import { DumbbellIcon } from "lucide-react";
import { useParams, useRouter } from "next/navigation";
import { useState } from "react";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { mApi, unwrap } from "@/lib/api/client";
import { useQuery } from "@tanstack/react-query";

/** The page a member lands on from the WhatsApp link: set a PIN and they're in. */
export default function ActivatePage() {
  const { token } = useParams<{ token: string }>();
  const router = useRouter();
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const preview = useQuery({
    queryKey: ["m", "activate", token],
    queryFn: () => unwrap(mApi.GET("/api/m/activate/{token}", { params: { path: { token } } })),
    retry: false,
  });

  async function submit() {
    if (pin !== again) {
      setError("The two PINs don't match.");
      return;
    }
    setBusy(true);
    setError(null);
    const { error: body, response } = await mApi.POST("/api/m/activate", { body: { token, pin } });
    setBusy(false);
    if (response.ok) {
      router.replace("/m");
      return;
    }
    const detail = (body as { detail?: string | { msg: string }[] } | undefined)?.detail;
    setError(
      typeof detail === "string"
        ? detail
        : (detail?.[0]?.msg.replace(/^Value error, /, "") ?? "Something went wrong. Please try again."),
    );
  }

  if (preview.isPending) {
    return <Skeleton className="m-6 h-72 rounded-xl" />;
  }
  if (preview.isError) {
    return (
      <main className="flex min-h-svh flex-col items-center justify-center gap-2 p-8 text-center">
        <h1 className="text-lg font-semibold">This link isn&apos;t valid anymore</h1>
        <p className="text-sm text-muted-foreground">
          It may have expired or already been used. Ask your gym to send you a new one.
        </p>
      </main>
    );
  }

  const { gym_name, first_name, brand_color } = preview.data;
  return (
    <main className="flex min-h-svh flex-col justify-center gap-8 px-6 py-10">
      <div className="grid justify-items-center gap-3 text-center">
        <span
          className="flex size-12 items-center justify-center rounded-xl text-white"
          style={{ backgroundColor: brand_color }}
        >
          <DumbbellIcon className="size-6" aria-hidden />
        </span>
        <div>
          <h1 className="text-xl font-semibold">Hi {first_name}</h1>
          <p className="text-sm text-muted-foreground">
            Choose a PIN to open your {gym_name} app. You&apos;ll use it with your phone number to sign in.
          </p>
        </div>
      </div>

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
            <FieldLabel htmlFor="pin">New PIN</FieldLabel>
            <Input
              id="pin"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              placeholder="4 to 6 digits"
              value={pin}
              onChange={(e) => setPin(e.target.value.replace(/\D/g, ""))}
            />
            <FieldDescription>Avoid easy ones like 1234 or 0000.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="again">Repeat PIN</FieldLabel>
            <Input
              id="again"
              type="password"
              inputMode="numeric"
              autoComplete="new-password"
              maxLength={6}
              value={again}
              onChange={(e) => setAgain(e.target.value.replace(/\D/g, ""))}
            />
          </Field>
          <Button type="submit" size="lg" disabled={busy || pin.length < 4 || again.length < 4}>
            {busy && <Spinner />}
            Open my app
          </Button>
        </FieldGroup>
      </form>
    </main>
  );
}
