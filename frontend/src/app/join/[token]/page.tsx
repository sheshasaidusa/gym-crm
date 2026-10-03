"use client";

import { CheckCircle2Icon, DumbbellIcon } from "lucide-react";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";

type FormInfo = { gym_name: string; brand_color: string; logo_url: string | null };

/** Public enquiry form. Plain fetch: visitors aren't logged in. */
export default function JoinPage() {
  const { token } = useParams<{ token: string }>();
  const [info, setInfo] = useState<FormInfo | null | "missing">(null);
  const [form, setForm] = useState({ name: "", phone: "", email: "", message: "", website: "" });
  const [error, setError] = useState<string>();
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    fetch(`/api/public/lead-forms/${encodeURIComponent(token)}`)
      .then((r) => (r.ok ? r.json() : "missing"))
      .then(setInfo, () => setInfo("missing"));
  }, [token]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const digits = form.phone.replace(/\D/g, "");
    if (form.name.trim().length < 2) return setError("Please enter your name");
    if (digits.length < 7 || digits.length > 15) return setError("Please enter a valid phone number");
    setError(undefined);
    setSending(true);
    try {
      const res = await fetch(`/api/public/lead-forms/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, email: form.email || null, message: form.message || null }),
      });
      if (res.ok) setSent(true);
      else if (res.status === 429) setError("Too many attempts. Please wait a minute and try again.");
      else if (res.status === 422) setError("Please check your phone number and email.");
      else setError("Something went wrong. Please try again.");
    } catch {
      setError("Couldn't send. Check your connection and try again.");
    } finally {
      setSending(false);
    }
  };

  if (info === null) {
    return (
      <main className="mx-auto max-w-md p-4 pt-10">
        <Skeleton className="h-96 w-full rounded-xl" />
      </main>
    );
  }
  if (info === "missing") {
    return (
      <main className="flex min-h-svh items-center justify-center p-6 text-center">
        <div>
          <h1 className="text-lg font-semibold">This form isn&apos;t available</h1>
          <p className="text-sm text-muted-foreground">Please contact the gym directly.</p>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-svh bg-muted/40">
      <header className="px-4 pt-8 pb-16 text-white" style={{ backgroundColor: info.brand_color }}>
        <div className="mx-auto flex max-w-md items-center gap-3">
          {info.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- external gym logo
            <img src={info.logo_url} alt="" className="size-10 rounded-lg bg-white object-contain" />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-lg bg-white/20">
              <DumbbellIcon className="size-5" />
            </div>
          )}
          <span className="font-semibold">{info.gym_name}</span>
        </div>
      </header>
      <div className="mx-auto -mt-10 max-w-md px-4 pb-10">
        <Card>
          {sent ? (
            <CardHeader className="items-center py-8 text-center">
              <CheckCircle2Icon className="mx-auto size-10 text-emerald-600" />
              <CardTitle className="text-xl">Thanks, {form.name.split(" ")[0]}!</CardTitle>
              <CardDescription>We&apos;ve got your details and will call you back soon.</CardDescription>
            </CardHeader>
          ) : (
            <>
              <CardHeader>
                <CardTitle className="text-xl">Interested in joining?</CardTitle>
                <CardDescription>Leave your details and we&apos;ll call you back.</CardDescription>
              </CardHeader>
              <CardContent>
                <form onSubmit={submit} noValidate>
                  <FieldGroup>
                    <Field>
                      <FieldLabel htmlFor="join-name">Your name</FieldLabel>
                      <Input id="join-name" autoComplete="name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="join-phone">Phone number</FieldLabel>
                      <Input id="join-phone" type="tel" autoComplete="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="join-email">Email (optional)</FieldLabel>
                      <Input id="join-email" type="email" autoComplete="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
                    </Field>
                    <Field>
                      <FieldLabel htmlFor="join-message">What are you looking for? (optional)</FieldLabel>
                      <Textarea
                        id="join-message"
                        rows={3}
                        maxLength={1000}
                        placeholder="e.g. Weight loss, personal training, morning batch"
                        value={form.message}
                        onChange={(e) => setForm({ ...form, message: e.target.value })}
                      />
                    </Field>
                    {/* Honeypot: hidden from people, filled in by bots. */}
                    <input
                      type="text"
                      name="website"
                      tabIndex={-1}
                      autoComplete="off"
                      aria-hidden
                      className="absolute -left-[9999px] size-px opacity-0"
                      value={form.website}
                      onChange={(e) => setForm({ ...form, website: e.target.value })}
                    />
                    {error && <FieldError>{error}</FieldError>}
                    <Button type="submit" disabled={sending} className="w-full">
                      {sending && <Spinner />}
                      Request a call back
                    </Button>
                    <p className="text-center text-xs text-muted-foreground">
                      {info.gym_name} will only use your details to contact you about membership.
                    </p>
                  </FieldGroup>
                </form>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </main>
  );
}
