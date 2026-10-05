"use client";

import { DumbbellIcon } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { useMediaQuery } from "@/hooks/use-media-query";
import {
  sendTeamInvites,
  useCompleteOnboarding,
  useRenameGym,
  useSaveProfile,
  type InviteResult,
} from "@/lib/onboarding-queries";
import { keys, useInvites, useMe, useStaff, type Me } from "@/lib/queries";
import { cn } from "@/lib/utils";

import { BlueprintPanel } from "./blueprint/blueprint-panel";
import { computeProgress } from "./blueprint/progress";
import type { Feature } from "./blueprint/types";
import {
  blueprintInput,
  draftFromProfile,
  emptyDraft,
  profileFromDraft,
  STEP_LABELS,
  stepNumber,
  STEPS,
  type Draft,
  type StepName,
} from "./draft";
import { AccountStep, type AccountSignals } from "./steps/account-step";
import { DoneStep } from "./steps/done-step";
import { EquipmentStep } from "./steps/equipment-step";
import { SpaceStep } from "./steps/space-step";
import { TeamStep } from "./steps/team-step";
import { WizardFooter } from "./wizard-footer";

const noopSubscribe = () => () => {};
const useIsClient = () => useSyncExternalStore(noopSubscribe, () => true, () => false);

function FullScreen({ children }: { children: React.ReactNode }) {
  return <div className="flex min-h-svh flex-col items-center justify-center gap-3 text-sm">{children}</div>;
}

/**
 * Gym-owner onboarding. Step 1 creates the account; steps 2 to 4 save to the gym's profile; the
 * drawing on the right is built from the answers as they are given.
 */
export function OnboardingWizard({ hasSession: initialSession }: { hasSession: boolean }) {
  const isClient = useIsClient();
  const [hasSession, setHasSession] = useState(initialSession);
  const me = useMe(hasSession);
  const router = useRouter();
  const params = useSearchParams();
  const review = params.get("review") === "1";
  const step = params.get("step");

  const data = hasSession ? me.data : null;
  const notOwner = !!data && data.role !== "owner";
  const finished = !!data?.gym.onboarding_completed_at && !review && step !== "done";
  useEffect(() => {
    if (notOwner || finished) router.replace("/");
  }, [notOwner, finished, router]);

  if (!isClient || (hasSession && me.isPending) || notOwner || finished) {
    return (
      <FullScreen>
        <Spinner className="size-6 text-muted-foreground" />
      </FullScreen>
    );
  }
  if (hasSession && me.isError) {
    return (
      <FullScreen>
        <p className="text-muted-foreground">{me.error.message}</p>
        <Button variant="outline" onClick={() => me.refetch()}>
          Try again
        </Button>
      </FullScreen>
    );
  }
  return <Wizard me={data ?? null} review={review} onSignedUp={() => setHasSession(true)} />;
}

function Wizard({ me, review, onSignedUp }: { me: Me | null; review: boolean; onSignedUp: () => void }) {
  const router = useRouter();
  const params = useSearchParams();
  const profile = me?.gym.profile;
  const completed = !!me?.gym.onboarding_completed_at;

  const resume: StepName = !me ? "account" : completed ? "done" : STEPS[Math.min(4, Math.max(2, profile?.last_step ?? 2)) - 1];
  const requested = params.get("step") as StepName | null;
  let step: StepName = requested && STEPS.includes(requested) ? requested : resume;
  if (!me) step = "account";
  if (step === "done" && !completed) step = resume;
  const n = stepNumber(step);

  const go = useCallback(
    (s: StepName, replace = false) => {
      const url = `/onboarding?step=${s}${review && s !== "done" ? "&review=1" : ""}`;
      if (replace) router.replace(url);
      else router.push(url);
    },
    [router, review],
  );

  const [draft, setDraft] = useState<Draft>(() => (me ? draftFromProfile(me.gym.name, profile) : emptyDraft()));
  const [signals, setSignals] = useState<AccountSignals>(() =>
    me ? { ownerName: me.user.name, emailValid: true, passwordValid: true } : { ownerName: "", emailValid: false, passwordValid: false },
  );
  const [pulse, setPulse] = useState<{ feature: Feature; nonce: number }>();
  const [results, setResults] = useState<InviteResult[]>([]);
  const [busy, setBusy] = useState(false);

  const change = useCallback((patch: Partial<Draft>, feature: string) => {
    setDraft((d) => ({ ...d, ...patch }));
    setPulse((p) => ({ feature: feature as Feature, nonce: (p?.nonce ?? 0) + 1 }));
  }, []);
  const onGymName = useCallback((gymName: string) => {
    setDraft((d) => (d.gymName === gymName ? d : { ...d, gymName }));
    setPulse((p) => ({ feature: "sign", nonce: (p?.nonce ?? 0) + 1 }));
  }, []);

  const qc = useQueryClient();
  const save = useSaveProfile();
  const rename = useRenameGym();
  const complete = useCompleteOnboarding();
  const invites = useInvites(!!me && n >= 4);
  const staff = useStaff(!!me && n >= 4);
  const invited = useMemo(() => {
    const s = new Set<string>();
    if (n >= 4) {
      invites.data?.forEach((i) => s.add(i.email.toLowerCase()));
      staff.data?.forEach((m) => s.add(m.email.toLowerCase()));
    }
    return s;
  }, [n, invites.data, staff.data]);

  // Move focus to the new step's heading, so keyboard and screen-reader users land in the right place.
  const firstRender = useRef(true);
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    document.querySelector<HTMLElement>("[data-step-title]")?.focus();
  }, [step]);

  const fail = (e: unknown) => toast.error(e instanceof Error ? e.message : "Something went wrong. Please try again.");
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      fail(e);
    } finally {
      setBusy(false);
    }
  };

  const next = (from: 2 | 3) => (from === 2 ? "equipment" : "team") as StepName;
  const fieldsFor = (s: 2 | 3) => {
    const p = profileFromDraft(draft);
    return s === 2
      ? { city: p.city, size: p.size, floors: p.floors, staff_count: p.staff_count }
      : { zones: p.zones, facilities: p.facilities, hours: p.hours };
  };
  const continueFrom = (s: 2 | 3) =>
    run(async () => {
      const skipped = draft.skipped.filter((x) => x !== s);
      await save.mutateAsync({ ...fieldsFor(s), skipped_steps: skipped, ...(review ? {} : { last_step: s + 1 }) });
      setDraft((d) => ({ ...d, skipped }));
      go(next(s));
    });
  const skipFrom = (s: 2 | 3 | 4) => {
    const skipped = Array.from(new Set([...draft.skipped, s])).sort() as Draft["skipped"];
    setDraft((d) => ({ ...d, skipped }));
    // Best effort: skipping must never get stuck on a failed save.
    save.mutate({ skipped_steps: skipped, ...(review ? {} : { last_step: Math.min(5, s + 1) }) }, { onError: fail });
    if (s === 4) finish(skipped);
    else go(next(s as 2 | 3));
  };
  const finish = (skipped = draft.skipped) =>
    run(async () => {
      await save.mutateAsync({ ...profileFromDraft({ ...draft, skipped }), ...(review ? {} : { last_step: 5 }) });
      if (!completed) await complete.mutateAsync();
      // On a review, only people who have no invite or account yet are invited.
      const fresh = review ? draft.team.filter((m) => !invited.has(m.email)) : draft.team;
      setResults(fresh.length ? await sendTeamInvites(fresh) : []);
      await qc.invalidateQueries({ queryKey: keys.invites });
      go("done");
    });
  const retry = (emails: string[]) =>
    run(async () => {
      const again = await sendTeamInvites(draft.team.filter((m) => emails.includes(m.email)));
      setResults((r) => [...r.filter((x) => !emails.includes(x.email)), ...again]);
      await qc.invalidateQueries({ queryKey: keys.invites });
    });

  const input = useMemo(() => blueprintInput(draft), [draft]);
  const progress =
    step === "done"
      ? 1
      : computeProgress({
          input,
          ...signals,
          passedEquipment: n > 3 || (profile?.last_step ?? 0) > 3 || draft.skipped.includes(3),
          passedTrainers: false,
        });
  const wide = useMediaQuery("(min-width: 1024px)");

  return (
    <div className="flex min-h-svh flex-col lg:flex-row">
      <div className="flex min-w-0 flex-col px-6 pt-6 sm:px-10 sm:pt-10 lg:w-[clamp(32rem,48vw,43rem)] lg:flex-none lg:px-14">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 font-semibold">
            <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
              <DumbbellIcon className="size-4" />
            </span>
            Dunamis
          </div>
          <span className="text-sm text-muted-foreground">
            {step === "done" ? "Setup complete" : review ? "Reviewing setup" : `Step ${n} of 4`}
          </span>
        </div>

        {step !== "done" && (
          <nav aria-label="Setup progress" className="mt-8 grid grid-cols-4 gap-2">
            {(Object.keys(STEP_LABELS) as Exclude<StepName, "done">[]).map((s, i) => {
              const reachable = i === 0 || !!me;
              const active = i + 1 <= n;
              return (
                <button
                  key={s}
                  type="button"
                  disabled={!reachable}
                  aria-current={s === step ? "step" : undefined}
                  onClick={() => go(s)}
                  className="flex min-h-11 flex-col gap-2 pt-2 text-left text-xs outline-none disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-ring/50"
                >
                  <span className={cn("h-[3px] w-full rounded-full transition-colors", active ? "bg-primary" : "bg-border")} />
                  <span className={cn(active ? "text-foreground" : "text-muted-foreground", s === step && "font-semibold")}>
                    {STEP_LABELS[s]}
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        {!wide && (
          <BlueprintPanel input={input} progress={progress} pulse={pulse} className="mt-6 h-56 rounded-xl sm:h-72" />
        )}

        <main className="flex flex-1 flex-col gap-7 pt-8">
          {step === "account" && (
            <AccountStep
              me={me}
              gymName={draft.gymName}
              onGymName={onGymName}
              onSignals={setSignals}
              onCreated={() => {
                onSignedUp();
                go("space", true);
              }}
              continuing={busy}
              onContinue={() =>
                run(async () => {
                  if (me && draft.gymName.trim() !== me.gym.name) await rename.mutateAsync(draft.gymName.trim());
                  go("space");
                })
              }
            />
          )}
          {step === "space" && (
            <>
              <SpaceStep draft={draft} change={change} />
              <WizardFooter
                onBack={() => go("account")}
                onSkip={review ? undefined : () => skipFrom(2)}
                primary={{ label: "Continue", onClick: () => continueFrom(2), pending: busy }}
              />
            </>
          )}
          {step === "equipment" && (
            <>
              <EquipmentStep draft={draft} change={change} />
              <WizardFooter
                onBack={() => go("space")}
                onSkip={review ? undefined : () => skipFrom(3)}
                primary={{ label: "Continue", onClick: () => continueFrom(3), pending: busy }}
              />
            </>
          )}
          {step === "team" && (
            <>
              <TeamStep draft={draft} change={change} ownerEmail={me?.user.email ?? ""} invited={invited} />
              <WizardFooter
                onBack={() => go("equipment")}
                onSkip={!review && draft.team.length === 0 ? () => skipFrom(4) : undefined}
                primary={{ label: review ? "Save changes" : "Finish setup", onClick: () => finish(), pending: busy }}
              />
            </>
          )}
          {step === "done" && (
            <div className="pb-10">
              <DoneStep
                draft={draft}
                ownerName={me?.user.name ?? ""}
                results={results}
                retrying={busy}
                onRetry={retry}
                onReview={() => router.push("/onboarding?step=space&review=1")}
              />
            </div>
          )}
        </main>
      </div>

      {wide && (
        <BlueprintPanel input={input} progress={progress} pulse={pulse} className="sticky top-0 h-svh flex-1 border-l" />
      )}
    </div>
  );
}
