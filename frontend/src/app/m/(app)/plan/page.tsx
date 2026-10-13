"use client";

import { PlanView } from "@/components/plan-view";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDate } from "@/lib/format";
import { useMemberPlan } from "@/lib/member-app-queries";

export default function MemberPlanPage() {
  const plan = useMemberPlan();
  if (plan.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (plan.isError) return <p className="text-sm text-destructive">{plan.error.message}</p>;

  const { plan: content, updated_at } = plan.data;
  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>Your workout &amp; diet plan</CardTitle>
          {content && updated_at && (
            <CardDescription>
              Updated {formatDate(updated_at.slice(0, 10))} · prepared with your trainer
            </CardDescription>
          )}
        </CardHeader>
        <CardContent>
          {content ? (
            <PlanView plan={content} />
          ) : (
            <p className="text-sm text-muted-foreground">
              Your trainer is preparing your plan. It will appear here once it&apos;s ready.
            </p>
          )}
        </CardContent>
      </Card>
      <p className="px-2 text-center text-xs text-muted-foreground">
        This plan is general fitness guidance, not medical advice. Stop and tell your trainer if something hurts.
      </p>
    </div>
  );
}
