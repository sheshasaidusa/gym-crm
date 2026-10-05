"use client";

import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type Props = {
  onBack?: () => void;
  onSkip?: () => void;
  primary: { label: string; pending?: boolean; disabled?: boolean } & (
    | { onClick: () => void; form?: never }
    | { form: string; onClick?: never }
  );
};

export function WizardFooter({ onBack, onSkip, primary }: Props) {
  return (
    <footer className="sticky bottom-0 z-10 -mx-6 mt-auto flex items-center justify-between gap-3 border-t bg-background px-6 py-4 sm:-mx-10 sm:px-10 lg:-mx-14 lg:px-14">
      <div>
        {onBack && (
          <Button type="button" variant="ghost" onClick={onBack}>
            Back
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {onSkip && (
          <Button type="button" variant="ghost" className="text-muted-foreground" onClick={onSkip}>
            Skip for now
          </Button>
        )}
        <Button
          type={primary.form ? "submit" : "button"}
          form={primary.form}
          onClick={primary.onClick}
          disabled={primary.pending || primary.disabled}
          size="lg"
        >
          {primary.pending && <Spinner />}
          {primary.label}
        </Button>
      </div>
    </footer>
  );
}
