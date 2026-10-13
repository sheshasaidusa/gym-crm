"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { PageHeader } from "@/components/page-header";
import { DueList } from "@/components/reminders/due-list";
import { ReminderHistory } from "@/components/reminders/reminder-history";
import { ReminderSettingsPanel } from "@/components/reminders/reminder-settings";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCan } from "@/lib/queries";

const TABS = ["due", "history", "settings"] as const;

function RemindersView() {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const requested = params.get("tab");
  const tab = TABS.includes(requested as (typeof TABS)[number]) ? requested! : "due";

  return (
    <Tabs
      value={tab}
      onValueChange={(v, details) => {
        if (details.reason === "none") router.replace(`${pathname}?tab=${v}`, { scroll: false });
      }}
    >
      <TabsList>
        <TabsTrigger value="due">Due</TabsTrigger>
        <TabsTrigger value="history">History</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>
      <TabsContent value="due" className="pt-4">
        <DueList />
      </TabsContent>
      <TabsContent value="history" className="pt-4">
        <ReminderHistory />
      </TabsContent>
      <TabsContent value="settings" className="pt-4">
        <ReminderSettingsPanel />
      </TabsContent>
    </Tabs>
  );
}

export default function RemindersPage() {
  const can = useCan();
  if (!can.has("reminders")) {
    return <p className="text-sm text-muted-foreground">Reminders are handled by the front desk.</p>;
  }
  return (
    <>
      <PageHeader
        title="Reminders"
        description="Membership expiry reminders by email and WhatsApp."
      />
      <Suspense>
        <RemindersView />
      </Suspense>
    </>
  );
}
