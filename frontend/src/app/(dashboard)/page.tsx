"use client";

import { ArrowLeftIcon, PlusIcon } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { DeskDashboard } from "@/components/dashboards/desk-dashboard";
import { OwnerDashboard } from "@/components/dashboards/owner-dashboard";
import { SalesDashboard } from "@/components/dashboards/sales-dashboard";
import { TrainerDashboard } from "@/components/dashboards/trainer-dashboard";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useCan, useMe } from "@/lib/queries";

/** Everyone lands here, but each role gets the board built for their job. */
function Dashboard() {
  const me = useMe();
  const can = useCan();
  // Owners and managers open a trainer's board from the team table (/?trainer=<id>).
  const trainerId = useSearchParams().get("trainer");
  const viewingTrainer = !!trainerId && can.has("analytics");
  const firstName = me.data?.user.name.split(" ")[0];

  return (
    <>
      <PageHeader
        title={firstName ? `Welcome, ${firstName}` : "Welcome"}
        description={
          can.role === "trainer"
            ? "Your clients and what needs doing today."
            : `Here's what's happening at ${me.data?.gym.name ?? "your gym"}.`
        }
      >
        {viewingTrainer && (
          <Button variant="outline" nativeButton={false} render={<Link href="/" />}>
            <ArrowLeftIcon />
            Back to overview
          </Button>
        )}
        {can.has("members_edit") && (
          <Button nativeButton={false} render={<Link href="/members/new" />}>
            <PlusIcon />
            Add member
          </Button>
        )}
      </PageHeader>

      {!can.role ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : !me.data?.capabilities ? (
        // An API that predates roles doesn't say what anyone may do, so there is nothing to show yet.
        <p className="text-sm text-muted-foreground">
          The server this app is connected to hasn&apos;t been updated yet, so the dashboards can&apos;t load.
        </p>
      ) : can.has("analytics") ? (
        viewingTrainer ? (
          <TrainerDashboard trainerId={trainerId} />
        ) : (
          <OwnerDashboard />
        )
      ) : can.has("checkups") ? (
        <TrainerDashboard />
      ) : can.has("payments") ? (
        <DeskDashboard />
      ) : can.has("leads") ? (
        <SalesDashboard />
      ) : null}
    </>
  );
}

export default function DashboardPage() {
  return (
    <Suspense>
      <Dashboard />
    </Suspense>
  );
}
