"use client";

import { useState } from "react";

import { FollowUpPicker, fromLocalInput } from "@/components/leads/follow-up";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { useMoveLead, type Lead, type LeadStage } from "@/lib/lead-queries";

const LOST_REASONS = ["Too expensive", "Joined another gym", "Location too far", "Timing doesn't suit", "Not interested now", "No response"];

export type PendingMove = { lead: Pick<Lead, "id" | "name">; stage: LeadStage } | null;

/** Moves that need extra input: "lost" (reason, required) and "trial booked" (time, optional). */
export function needsDialog(stage: LeadStage) {
  return stage === "lost" || stage === "trial_booked";
}

export function StageDialog({ move, onDone }: { move: PendingMove; onDone: () => void }) {
  const moveLead = useMoveLead();
  const [reason, setReason] = useState("");
  const [trial, setTrial] = useState("");
  const [current, setCurrent] = useState<PendingMove>(null);
  if (move !== current) {
    setCurrent(move);
    setReason("");
    setTrial("");
  }
  const lost = move?.stage === "lost";

  const submit = () => {
    if (!move) return;
    moveLead.mutate(
      {
        id: move.lead.id,
        stage: move.stage,
        lost_reason: lost ? reason.trim() : null,
        trial_at: !lost ? fromLocalInput(trial) : null,
      },
      { onSettled: onDone },
    );
  };

  return (
    <Dialog open={!!move} onOpenChange={(o) => !o && onDone()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{lost ? `Mark ${move?.lead.name} as lost` : `Book a trial for ${move?.lead.name}`}</DialogTitle>
          <DialogDescription>
            {lost
              ? "Knowing why helps you spot patterns (price, timing, location)."
              : "Add the trial time so the team knows when they're coming in (optional)."}
          </DialogDescription>
        </DialogHeader>
        {lost ? (
          <Field>
            <FieldLabel htmlFor="lost-reason">Reason</FieldLabel>
            <div className="flex flex-wrap gap-1">
              {LOST_REASONS.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => setReason(r)}
                  className="rounded-md border border-dashed px-1.5 py-0.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  {r}
                </button>
              ))}
            </div>
            <Textarea id="lost-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
        ) : (
          <Field>
            <FieldLabel htmlFor="trial-at">Trial time</FieldLabel>
            <FollowUpPicker id="trial-at" value={trial} onChange={setTrial} />
          </Field>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onDone}>
            Cancel
          </Button>
          <Button
            variant={lost ? "destructive" : "default"}
            disabled={moveLead.isPending || (lost && !reason.trim())}
            onClick={submit}
          >
            {moveLead.isPending && <Spinner />}
            {lost ? "Mark as lost" : "Book trial"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
