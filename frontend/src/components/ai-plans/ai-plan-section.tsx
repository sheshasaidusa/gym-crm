"use client";

import { CopyIcon, MoreHorizontalIcon, SparklesIcon, Trash2Icon } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { SimpleSelect } from "@/components/simple-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  useAIStatus,
  useDeletePlan,
  useGeneratePlan,
  useMemberPlans,
  type AIPlan,
  type GenerateInput,
} from "@/lib/ai-plan-queries";
import type { Member } from "@/lib/member-queries";
import { useCan } from "@/lib/queries";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<AIPlan["status"], string> = {
  generating: "bg-sky-500/15 text-sky-700 dark:text-sky-400",
  draft: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
  published: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
  archived: "bg-muted text-muted-foreground",
  failed: "bg-red-500/15 text-red-700 dark:text-red-400",
};
const STATUS_LABEL: Record<AIPlan["status"], string> = {
  generating: "Generating…",
  draft: "Needs review",
  published: "Live for member",
  archived: "Older version",
  failed: "Failed",
};

function GenerateDialog({
  member,
  open,
  onOpenChange,
}: {
  member: Member;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const generate = useGeneratePlan(member.id);
  const [form, setForm] = useState<GenerateInput>({
    days_per_week: 4,
    session_minutes: 60,
    equipment: "full_gym",
    instructions: "",
  });
  const missing = [
    !member.goal && "goal",
    !member.diet_pref && "diet preference",
    !member.experience_level && "experience level",
    !member.last_checkup_on && "a check-up (weight)",
  ].filter(Boolean);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Generate a workout & diet plan</DialogTitle>
          <DialogDescription>
            Uses {member.name.split(" ")[0]}&apos;s profile, medical notes and recent check-ups. You
            review and edit it before the member sees it.
          </DialogDescription>
        </DialogHeader>
        {missing.length > 0 && (
          <Alert>
            <AlertTitle>Better with more detail</AlertTitle>
            <AlertDescription>
              This member has no {missing.join(", ")}. Add them for a more personal plan.
            </AlertDescription>
          </Alert>
        )}
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="gen-days">Workouts per week</FieldLabel>
              <SimpleSelect
                id="gen-days"
                options={[2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: `${n} days` }))}
                value={String(form.days_per_week)}
                onChange={(v) => setForm({ ...form, days_per_week: Number(v) })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="gen-minutes">Session length</FieldLabel>
              <SimpleSelect
                id="gen-minutes"
                options={[30, 45, 60, 75, 90].map((n) => ({ value: String(n), label: `${n} min` }))}
                value={String(form.session_minutes)}
                onChange={(v) => setForm({ ...form, session_minutes: Number(v) })}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="gen-equipment">Equipment</FieldLabel>
            <SimpleSelect
              id="gen-equipment"
              options={[
                { value: "full_gym", label: "Full gym" },
                { value: "basic", label: "Basic (dumbbells, bench, machines)" },
                { value: "bodyweight", label: "Bodyweight / home" },
              ]}
              value={form.equipment ?? "full_gym"}
              onChange={(v) => setForm({ ...form, equipment: v as GenerateInput["equipment"] })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="gen-notes">Instructions for the AI (optional)</FieldLabel>
            <Textarea
              id="gen-notes"
              rows={3}
              maxLength={1000}
              placeholder="e.g. Prefers morning sessions, wants to run a 10K in 3 months, no fish."
              value={form.instructions ?? ""}
              onChange={(e) => setForm({ ...form, instructions: e.target.value })}
            />
            <FieldDescription>
              The member&apos;s name and contact details are never sent to the AI.
            </FieldDescription>
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            disabled={generate.isPending}
            onClick={() =>
              generate.mutate(
                { ...form, instructions: form.instructions?.trim() || null },
                { onSuccess: () => onOpenChange(false) },
              )
            }
          >
            {generate.isPending ? <Spinner /> : <SparklesIcon />}
            Generate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function AIPlanSection({ member }: { member: Member }) {
  const can = useCan();
  const status = useAIStatus();
  const plans = useMemberPlans(member.id);
  const remove = useDeletePlan(member.id);
  const [generateOpen, setGenerateOpen] = useState(false);
  const [deleting, setDeleting] = useState<AIPlan | null>(null);
  const isCoach = can.role !== "front_desk";

  const list = plans.data ?? [];
  const published = list.find((p) => p.status === "published");
  const generating = list.some((p) => p.status === "generating");
  const configured = status.data?.configured ?? false;

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <SparklesIcon className="size-4 shrink-0" />
          {published
            ? `${published.title} is live on ${member.name.split(" ")[0]}'s page.`
            : "AI-generated, reviewed by a trainer, shared on the member's page."}
        </p>
        {isCoach && configured && (
          <Button size="sm" variant={published ? "outline" : "default"} disabled={generating} onClick={() => setGenerateOpen(true)}>
            {generating ? <Spinner /> : <SparklesIcon />}
            {published ? "New version" : "Generate plan"}
          </Button>
        )}
      </div>

      {status.data && !configured && (
        <Alert>
          <AlertTitle>AI plans aren&apos;t switched on</AlertTitle>
          <AlertDescription>
            Add an Anthropic API key as <code>ANTHROPIC_API_KEY</code> in the server settings to
            generate plans.
          </AlertDescription>
        </Alert>
      )}

      {plans.isPending ? (
        <Skeleton className="h-24 w-full rounded-2xl" />
      ) : list.length === 0 ? (
        configured && (
          <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">No plans yet.</p>
        )
      ) : (
        <div className="overflow-hidden rounded-2xl border border-border/70 bg-background">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Plan</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden sm:table-cell">Created</TableHead>
                <TableHead className="hidden md:table-cell">By</TableHead>
                <TableHead className="w-32" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {list.map((p) => (
                <TableRow key={p.id}>
                  <TableCell className="pl-4 whitespace-normal">
                    <div className="font-medium">{p.title}</div>
                    {(p.params || (p.status === "failed" && p.error)) && (
                      <div className="text-xs text-muted-foreground">
                        {p.params && `${p.params.days_per_week} days/week`}
                        {p.status === "failed" && p.error && ` · ${p.error}`}
                      </div>
                    )}
                  </TableCell>
                  <TableCell>
                    <span className={cn("rounded-full px-2 py-0.5 text-xs", STATUS_STYLE[p.status])}>
                      {STATUS_LABEL[p.status]}
                    </span>
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground sm:table-cell">
                    {new Date(p.created_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                  </TableCell>
                  <TableCell className="hidden text-muted-foreground md:table-cell">{p.created_by?.name ?? "—"}</TableCell>
                  <TableCell className="pr-2">
                    <div className="flex justify-end gap-1">
                      {(p.status === "draft" || p.status === "published" || p.status === "archived") && (
                        <Button
                          size="sm"
                          variant={p.status === "draft" ? "default" : "outline"}
                          nativeButton={false}
                          render={<Link href={`/members/${member.id}/plans/${p.id}`} />}
                        >
                          {p.status === "draft" && isCoach ? "Review" : "Open"}
                        </Button>
                      )}
                      {isCoach && p.status !== "published" && p.status !== "generating" && (
                        <DropdownMenu>
                          <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label="Plan actions" />}>
                            <MoreHorizontalIcon />
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem variant="destructive" onClick={() => setDeleting(p)}>
                              <Trash2Icon />
                              Delete
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {(published || (status.data && configured)) && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          {published && (
            <Button
              variant="ghost"
              size="xs"
              className="-ml-2"
              onClick={async () => {
                await navigator.clipboard.writeText(member.preview_url);
                toast.success("Member page link copied");
              }}
            >
              <CopyIcon />
              Copy member page link
            </Button>
          )}
          {status.data && configured && (
            <span>
              {status.data.used_this_month} of {status.data.monthly_limit} AI plans used this month · AI-generated,
              trainer-reviewed
            </span>
          )}
        </div>
      )}

      <GenerateDialog member={member} open={generateOpen} onOpenChange={setGenerateOpen} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.title}?`}
        description="This version will be removed. It doesn't affect the plan the member currently sees."
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
    </div>
  );
}
