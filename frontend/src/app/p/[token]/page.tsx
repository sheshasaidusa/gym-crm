import { CalendarCheckIcon, DumbbellIcon, PhoneIcon, UserRoundIcon } from "lucide-react";
import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { PlanView } from "@/components/plan-view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import type { components } from "@/lib/api/schema";
import { formatDate, STATUS_META } from "@/lib/format";
import { membershipLine } from "@/lib/membership-line";

import { WeightChart } from "@/components/weight-chart";

type PageData = components["schemas"]["PublicMemberPage"];

export const metadata: Metadata = {
  title: "Your membership",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const BACKEND = process.env.BACKEND_URL ?? "http://localhost:8000";

async function load(token: string): Promise<PageData | "rate-limited" | null> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for") ?? h.get("x-real-ip");
  const res = await fetch(`${BACKEND}/api/public/members/${encodeURIComponent(token)}`, {
    cache: "no-store",
    // Pass the visitor's address through so the API rate-limits per visitor, not per web server.
    headers: forwarded ? { "x-forwarded-for": forwarded } : {},
  });
  if (res.status === 429) return "rate-limited";
  if (!res.ok) return null;
  return res.json();
}

export default async function MemberPreviewPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const data = await load(token);
  if (data === "rate-limited") {
    return (
      <main className="flex min-h-svh items-center justify-center p-6 text-center text-sm text-muted-foreground">
        Too many requests. Please try again in a minute.
      </main>
    );
  }
  if (!data) notFound();

  const { gym, membership, progress, plan } = data;
  const change = progress?.weight_change_kg;

  return (
    <main className="min-h-svh bg-muted/40 pb-10">
      <header className="px-4 pt-8 pb-16 text-white" style={{ backgroundColor: gym.brand_color }}>
        <div className="mx-auto flex max-w-lg items-center gap-3">
          {gym.logo_url ? (
            // eslint-disable-next-line @next/next/no-img-element -- external gym logo
            <img src={gym.logo_url} alt="" className="size-10 rounded-lg bg-white object-contain" />
          ) : (
            <div className="flex size-10 items-center justify-center rounded-lg bg-white/20">
              <DumbbellIcon className="size-5" />
            </div>
          )}
          <span className="font-semibold">{gym.name}</span>
        </div>
        <div className="mx-auto mt-6 max-w-lg">
          <h1 className="text-2xl font-semibold">Hi {data.first_name} 👋</h1>
          <p className="text-sm opacity-90">Your membership, plan and progress in one place.</p>
        </div>
      </header>

      <div className="mx-auto -mt-10 grid max-w-lg gap-4 px-4">
        <Card>
          <CardHeader>
            <CardDescription className="flex items-center gap-2">
              <CalendarCheckIcon className="size-4" />
              Membership
            </CardDescription>
            {membership ? (
              <>
                <CardTitle className="flex flex-wrap items-center gap-2 text-lg">
                  {membership.plan_name}
                  <span
                    className={`inline-flex h-5 items-center rounded-full px-2 text-xs font-medium ${STATUS_META[membership.status].className}`}
                  >
                    {STATUS_META[membership.status].label}
                  </span>
                </CardTitle>
                <p className="text-sm text-muted-foreground">{membershipLine(membership)}</p>
                {membership.renewal_starts && (
                  <p className="text-sm text-muted-foreground">
                    Renewed – next period starts {formatDate(membership.renewal_starts)}.
                  </p>
                )}
              </>
            ) : (
              <CardTitle className="text-base">No active membership</CardTitle>
            )}
          </CardHeader>
          {(data.trainer_name || gym.phone) && (
            <CardContent className="flex flex-wrap items-center justify-between gap-3 border-t pt-4 text-sm">
              {data.trainer_name && (
                <span className="flex items-center gap-2">
                  <UserRoundIcon className="size-4 text-muted-foreground" />
                  Your trainer: <strong>{data.trainer_name}</strong>
                </span>
              )}
              {gym.phone && (
                <a
                  href={`tel:${gym.phone.replace(/\s/g, "")}`}
                  className="inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 font-medium hover:bg-muted"
                >
                  <PhoneIcon className="size-4" />
                  Call the gym
                </a>
              )}
            </CardContent>
          )}
        </Card>

        {progress && (
          <Card>
            <CardHeader>
              <CardTitle>Your progress</CardTitle>
              <CardDescription>
                {progress.checkups} check-up{progress.checkups === 1 ? "" : "s"} since{" "}
                {formatDate(progress.first_date)}
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4">
              <div className="grid grid-cols-3 gap-2 text-center">
                {progress.weight_kg != null && (
                  <div className="rounded-lg border p-2">
                    <div className="text-lg font-semibold tabular-nums">{progress.weight_kg} kg</div>
                    <div className="text-xs text-muted-foreground">
                      {change != null ? `${change > 0 ? "+" : change < 0 ? "−" : ""}${Math.abs(change)} kg` : "Weight"}
                    </div>
                  </div>
                )}
                {progress.body_fat_pct != null && (
                  <div className="rounded-lg border p-2">
                    <div className="text-lg font-semibold tabular-nums">{progress.body_fat_pct}%</div>
                    <div className="text-xs text-muted-foreground">Body fat</div>
                  </div>
                )}
                {progress.waist_cm != null && (
                  <div className="rounded-lg border p-2">
                    <div className="text-lg font-semibold tabular-nums">{progress.waist_cm} cm</div>
                    <div className="text-xs text-muted-foreground">Waist</div>
                  </div>
                )}
              </div>
              {progress.weight_series.length >= 2 && (
                <div>
                  <div className="mb-1 text-sm font-medium">
                    Weight <span className="font-normal text-muted-foreground">(kg)</span>
                  </div>
                  <WeightChart points={progress.weight_series} />
                </div>
              )}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle>Your workout & diet plan</CardTitle>
            {plan && data.plan_updated_at && (
              <CardDescription>
                Updated {formatDate(data.plan_updated_at.slice(0, 10))} · prepared with your trainer
              </CardDescription>
            )}
          </CardHeader>
          <CardContent>
            {plan ? (
              <PlanView plan={plan} />
            ) : (
              <p className="text-sm text-muted-foreground">
                Your trainer is preparing your plan. It will appear here once it&apos;s ready.
              </p>
            )}
          </CardContent>
        </Card>

        <p className="px-2 text-center text-xs text-muted-foreground">
          This plan is general fitness guidance, not medical advice. Stop and tell your trainer if
          anything causes pain, and check with a doctor before starting if you have a health
          condition. Please don&apos;t share this private link.
        </p>
      </div>
    </main>
  );
}
