"use client";

import { ImportHistory } from "@/components/imports/import-history";
import { ImportWizard } from "@/components/imports/import-wizard";
import { PageHeader } from "@/components/page-header";
import { useCan } from "@/lib/queries";

export default function ImportPage() {
  const can = useCan();
  if (can.role && !can.manage) {
    return (
      <p className="text-sm text-muted-foreground">Only owners and managers can import data.</p>
    );
  }
  return (
    <div className="space-y-6">
      <PageHeader
        title="Import data"
        description="Bring your members, plans, payments, check-ups and leads over from spreadsheets."
      />
      <ImportWizard />
      <ImportHistory />
    </div>
  );
}
