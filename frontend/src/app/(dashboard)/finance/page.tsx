"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";

import { DuesTab } from "@/components/finance/dues-tab";
import { ExpensesTab } from "@/components/finance/expenses-tab";
import { FinanceOverview } from "@/components/finance/overview";
import { PaymentsTab } from "@/components/finance/payments-tab";
import { PageHeader } from "@/components/page-header";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCan } from "@/lib/queries";

function FinanceView() {
  const can = useCan();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // Front desk takes payments and chases dues; owners and managers see the full picture.
  const tabs = can.manage ? ["overview", "payments", "expenses", "dues"] : ["payments", "dues"];
  const requested = params.get("tab");
  const tab = requested && tabs.includes(requested) ? requested : tabs[0];

  return (
    <Tabs
      value={tab}
      onValueChange={(v, details) => {
        if (details.reason === "none") router.replace(`${pathname}?tab=${v}`, { scroll: false });
      }}
    >
      <TabsList>
        {can.manage && <TabsTrigger value="overview">Overview</TabsTrigger>}
        <TabsTrigger value="payments">Payments</TabsTrigger>
        {can.manage && <TabsTrigger value="expenses">Expenses</TabsTrigger>}
        <TabsTrigger value="dues">Dues</TabsTrigger>
      </TabsList>
      {can.manage && (
        <TabsContent value="overview" className="pt-4">
          <FinanceOverview />
        </TabsContent>
      )}
      <TabsContent value="payments" className="pt-4">
        <PaymentsTab />
      </TabsContent>
      {can.manage && (
        <TabsContent value="expenses" className="pt-4">
          <ExpensesTab />
        </TabsContent>
      )}
      <TabsContent value="dues" className="pt-4">
        <DuesTab />
      </TabsContent>
    </Tabs>
  );
}

export default function FinancePage() {
  const can = useCan();
  if (can.role === "trainer") {
    return <p className="text-sm text-muted-foreground">Finance is managed by the front desk and owners.</p>;
  }
  return (
    <>
      <PageHeader title="Finance" description="Payments, expenses and money owed." />
      <Suspense>
        <FinanceView />
      </Suspense>
    </>
  );
}
