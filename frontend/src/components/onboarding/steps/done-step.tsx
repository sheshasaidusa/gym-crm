"use client";

import { CheckIcon, CopyIcon, MessageCircleIcon } from "lucide-react";
import Link from "next/link";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { InviteResult } from "@/lib/onboarding-queries";
import { useInvites } from "@/lib/queries";
import { whatsappUrl } from "@/lib/whatsapp";

import type { Draft } from "../draft";
import { SIZES, ZONES } from "../options";

type Props = {
  draft: Draft;
  ownerName: string;
  results: InviteResult[];
  retrying: boolean;
  onRetry: (emails: string[]) => void;
  onReview: () => void;
};

export function DoneStep({ draft, ownerName, results, retrying, onRetry, onReview }: Props) {
  const invites = useInvites(draft.team.length > 0);
  const linkFor = (email: string) => {
    const r = results.find((x) => x.email === email);
    if (r?.status === "sent") return r.url;
    return invites.data?.find((i) => i.email.toLowerCase() === email)?.url;
  };
  const failed = results.filter((r) => r.status === "failed");
  const statusOf = (email: string) => results.find((r) => r.email === email);

  const building = [
    draft.city.trim(),
    draft.size ? SIZES.find((s) => s.value === draft.size)?.label : "",
    draft.floors ? (draft.floors === 1 ? "1 floor" : `${draft.floors} floors`) : "",
  ].filter(Boolean);
  const summary = [
    { k: "Owner", v: ownerName || "—" },
    { k: "Building", v: building.join(" · ") || "—" },
    { k: "Zones", v: ZONES.filter((z) => draft.zones.includes(z.value)).map((z) => z.label).join(", ") || "—" },
    { k: "Team", v: draft.team.length ? draft.team.map((t) => t.name).join(", ") : "Add later" },
  ];

  const copy = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't copy. Select the link and copy it yourself.");
    }
  };

  return (
    <div className="flex flex-col gap-7">
      <span className="flex size-12 items-center justify-center rounded-full bg-primary text-primary-foreground">
        <CheckIcon className="size-6" />
      </span>
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-balance" tabIndex={-1} data-step-title>
          {(draft.gymName.trim() || "Your gym") + " is ready"}
        </h1>
        <p className="text-muted-foreground">Here&apos;s what we set up. You can change any of it in Settings.</p>
      </header>
      <dl className="flex flex-col border-t text-sm">
        {summary.map((r) => (
          <div key={r.k} className="flex justify-between gap-4 border-b py-3">
            <dt className="text-muted-foreground">{r.k}</dt>
            <dd className="text-right font-medium">{r.v}</dd>
          </div>
        ))}
      </dl>

      {draft.team.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="font-medium">Invite links</h2>
            <p className="text-sm text-muted-foreground">
              No email is sent. Share each link yourself; it works for 7 days.
            </p>
          </div>
          <ul className="divide-y border-y">
            {draft.team.map((m) => {
              const url = linkFor(m.email);
              const status = statusOf(m.email);
              return (
                <li key={m.email} className="flex flex-wrap items-center gap-2 py-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium">{m.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {status?.status === "exists"
                        ? "Already on your staff"
                        : status?.status === "failed"
                          ? status.error
                          : url ?? (invites.isPending ? "Loading link…" : "No invite yet")}
                    </p>
                  </div>
                  {url && (
                    <>
                      <Button type="button" variant="outline" size="sm" onClick={() => copy(url)}>
                        <CopyIcon /> Copy link
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        nativeButton={false}
                        render={
                          <a
                            href={whatsappUrl("", `Hi ${m.name}, join ${draft.gymName.trim() || "our gym"} on dunamis: ${url}`)}
                            target="_blank"
                            rel="noreferrer"
                          />
                        }
                      >
                        <MessageCircleIcon /> WhatsApp
                      </Button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {failed.length > 0 && (
            <Button type="button" variant="outline" disabled={retrying} onClick={() => onRetry(failed.map((f) => f.email))}>
              {retrying && <Spinner />}
              Try the failed invites again
            </Button>
          )}
        </section>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button size="lg" nativeButton={false} render={<Link href="/" />}>
          Open dashboard
        </Button>
        <Button type="button" variant="ghost" onClick={onReview}>
          Review setup
        </Button>
      </div>
    </div>
  );
}
