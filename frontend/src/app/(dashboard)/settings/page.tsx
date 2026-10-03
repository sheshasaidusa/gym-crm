"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { ActivityLog } from "@/components/settings/activity-log";
import { BranchesSettings } from "@/components/settings/branches-settings";
import { DataSettings } from "@/components/settings/data-settings";
import { GeneralSettings } from "@/components/settings/general-settings";
import { StaffSettings } from "@/components/settings/staff-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCan } from "@/lib/queries";

function SettingsTabs() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const can = useCan();
  // Exports are for managers and owners; the activity log only for owners.
  const tabs = [
    "general",
    "branches",
    "staff",
    ...(can.manage ? ["data"] : []),
    ...(can.own ? ["activity"] : []),
  ];
  const requested = params.get("tab");
  const tab = requested && tabs.includes(requested) ? requested : "general";

  return (
    <Tabs
      value={tab}
      onValueChange={(v, details) => {
        // Base UI also reports automatic fallbacks while tabs mount; only follow user clicks.
        if (details.reason === "none") router.replace(`${pathname}?tab=${v}`, { scroll: false });
      }}
    >
      <TabsList>
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="branches">Branches</TabsTrigger>
        <TabsTrigger value="staff">Staff</TabsTrigger>
        {can.manage && <TabsTrigger value="data">Data</TabsTrigger>}
        {can.own && <TabsTrigger value="activity">Activity</TabsTrigger>}
      </TabsList>
      <TabsContent value="general" className="pt-4">
        <GeneralSettings />
      </TabsContent>
      <TabsContent value="branches" className="pt-4">
        <BranchesSettings />
      </TabsContent>
      <TabsContent value="staff" className="pt-4">
        <StaffSettings />
      </TabsContent>
      {can.manage && (
        <TabsContent value="data" className="pt-4">
          <DataSettings />
        </TabsContent>
      )}
      {can.own && (
        <TabsContent value="activity" className="pt-4">
          <ActivityLog />
        </TabsContent>
      )}
    </Tabs>
  );
}

export default function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Your gym's details, branches, team and data." />
      <Suspense>
        <SettingsTabs />
      </Suspense>
    </>
  );
}
