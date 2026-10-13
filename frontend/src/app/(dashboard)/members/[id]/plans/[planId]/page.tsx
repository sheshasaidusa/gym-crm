"use client";

import { ArrowLeftIcon, EyeIcon, PencilIcon, SendIcon, Undo2Icon } from "lucide-react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";

import { PlanEditor, planProblems } from "@/components/ai-plans/plan-editor";
import { PlanView } from "@/components/plan-view";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  useAIPlan,
  usePublishPlan,
  useUpdatePlan,
  type AIPlan,
  type PlanContent,
} from "@/lib/ai-plan-queries";
import { useMember } from "@/lib/member-queries";
import { useCan } from "@/lib/queries";
import { cn } from "@/lib/utils";

function Review({ plan, memberId, memberName }: { plan: AIPlan; memberId: string; memberName: string }) {
  const can = useCan();
  const canEdit = can.has("workout_plans") && (plan.status === "draft" || plan.status === "published");
  const update = useUpdatePlan(plan.id);
  const publish = usePublishPlan();
  const [title, setTitle] = useState(plan.title);
  const [content, setContent] = useState<PlanContent>(plan.content!);
  const [mode, setMode] = useState<"edit" | "preview">(canEdit && plan.status === "draft" ? "edit" : "preview");

  const dirty = title !== plan.title || JSON.stringify(content) !== JSON.stringify(plan.content);
  const problems = planProblems(content);
  const save = (then?: () => void) =>
    update.mutate({ title, content }, { onSuccess: () => then?.() });

  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-center gap-2">
        {canEdit ? (
          <Input
            aria-label="Plan title"
            className="h-9 max-w-xs text-base font-semibold"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        ) : (
          <h1 className="text-xl font-semibold">{plan.title}</h1>
        )}
        <span className="text-sm text-muted-foreground">for {memberName}</span>
        <div className="ml-auto flex flex-wrap gap-2">
          {canEdit && (
            <div className="flex rounded-lg border p-0.5">
              {(["edit", "preview"] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  onClick={() => setMode(m)}
                  className={cn(
                    "flex items-center gap-1 rounded-md px-2.5 py-1 text-xs",
                    mode === m ? "bg-muted font-medium" : "text-muted-foreground",
                  )}
                >
                  {m === "edit" ? <PencilIcon className="size-3" /> : <EyeIcon className="size-3" />}
                  {m === "edit" ? "Edit" : "Member view"}
                </button>
              ))}
            </div>
          )}
          {canEdit && dirty && (
            <Button variant="outline" disabled={update.isPending || problems.length > 0} onClick={() => save()}>
              {update.isPending && <Spinner />}
              Save
            </Button>
          )}
          {can.has("workout_plans") && plan.status === "published" && (
            <Button variant="outline" onClick={() => publish.mutate({ id: plan.id, publish: false })}>
              <Undo2Icon />
              Unpublish
            </Button>
          )}
          {can.has("workout_plans") && (plan.status === "draft" || plan.status === "archived") && (
            <Button
              disabled={publish.isPending || update.isPending || problems.length > 0}
              onClick={() =>
                dirty
                  ? save(() => publish.mutate({ id: plan.id, publish: true }))
                  : publish.mutate({ id: plan.id, publish: true })
              }
            >
              {publish.isPending ? <Spinner /> : <SendIcon />}
              {dirty ? "Save & publish" : "Publish to member"}
            </Button>
          )}
        </div>
      </div>

      {plan.status === "draft" && (
        <Alert>
          <AlertDescription>
            This plan was written by AI. Check exercises against {memberName.split(" ")[0]}&apos;s medical
            notes and adjust anything before publishing.
          </AlertDescription>
        </Alert>
      )}
      {problems.length > 0 && (
        <Alert variant="destructive">
          <AlertDescription>
            <ul className="list-disc pl-4">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </AlertDescription>
        </Alert>
      )}

      {mode === "edit" && canEdit ? (
        <PlanEditor value={content} onChange={setContent} />
      ) : (
        <Card className="mx-auto w-full max-w-2xl">
          <CardContent>
            <PlanView plan={content} />
          </CardContent>
        </Card>
      )}

      <Button variant="ghost" size="sm" className="w-fit" nativeButton={false} render={<Link href={`/members/${memberId}`} />}>
        <ArrowLeftIcon />
        Back to member
      </Button>
    </div>
  );
}

export default function PlanReviewPage() {
  const { id, planId } = useParams<{ id: string; planId: string }>();
  const plan = useAIPlan(planId);
  const member = useMember(id);

  if (plan.isPending || member.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (plan.isError) return <p className="text-sm text-destructive">{plan.error.message}</p>;
  if (member.isError) return <p className="text-sm text-destructive">{member.error.message}</p>;
  if (!plan.data.content) {
    return (
      <p className="text-sm text-muted-foreground">
        {plan.data.status === "generating" ? "Still generating…" : (plan.data.error ?? "This plan has no content.")}
      </p>
    );
  }
  return (
    // Remount when the saved version changes so local edits start from it.
    <Review key={plan.data.updated_at} plan={plan.data} memberId={id} memberName={member.data.name} />
  );
}
