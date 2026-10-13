"use client";

import { CopyIcon, MessageCircleIcon, SmartphoneIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { formatDate } from "@/lib/format";
import { useAppAccess, useDisableAppAccess, useSendAppLink } from "@/lib/member-queries";
import { whatsappUrl } from "@/lib/whatsapp";

/** Staff side of the member app: send the activation link, see whether it was used, turn access off. */
export function AppAccess({ memberId, name, phone, gym }: { memberId: string; name: string; phone: string; gym: string }) {
  const access = useAppAccess(memberId);
  const send = useSendAppLink(memberId);
  const disable = useDisableAppAccess(memberId);
  const [link, setLink] = useState<string | null>(null);
  const [turningOff, setTurningOff] = useState(false);

  if (access.isPending) return <Skeleton className="h-16 w-full" />;
  if (access.isError) return <p className="text-sm text-destructive">{access.error.message}</p>;
  const a = access.data;

  const line = {
    none: "Not set up yet.",
    invited: `Link sent. Expires ${formatDate(a.link_expires_at?.slice(0, 10))}.`,
    active: `Active${a.last_login_at ? `, last opened ${formatDate(a.last_login_at.slice(0, 10))}` : ""}.`,
    disabled: "Turned off.",
  }[a.status];
  const message = link
    ? `Hi ${name.split(" ")[0]}, open your ${gym} app and set a PIN: ${link}`
    : "";

  return (
    <section className="mt-8 border-t border-border/70 pt-6">
      <h2 className="mb-1 flex items-center gap-2 font-medium">
        <SmartphoneIcon className="size-4" aria-hidden />
        Member app
      </h2>
      <p className="text-sm text-muted-foreground">
        {line}
        {a.locked && " Locked after too many wrong PINs."}
      </p>

      {link ? (
        <div className="mt-3 grid gap-2">
          <p className="text-xs text-muted-foreground">
            Link ready. It works once and lasts 3 days. Their old PIN no longer works.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              nativeButton={false}
              render={<a href={whatsappUrl(phone, message)} target="_blank" rel="noreferrer" />}
            >
              <MessageCircleIcon />
              Send on WhatsApp
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={async () => {
                await navigator.clipboard.writeText(link);
                toast.success("Link copied");
              }}
            >
              <CopyIcon />
              Copy link
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={send.isPending}
            onClick={() => send.mutate(undefined, { onSuccess: (r) => setLink(r.url) })}
          >
            {send.isPending && <Spinner />}
            {a.status === "active" ? "Reset PIN with a new link" : a.status === "invited" ? "Make a new link" : "Create app link"}
          </Button>
          {a.status === "active" && (
            <Button size="sm" variant="ghost" onClick={() => setTurningOff(true)}>
              Turn off
            </Button>
          )}
        </div>
      )}

      <ConfirmDialog
        open={turningOff}
        onOpenChange={setTurningOff}
        title="Turn off app access?"
        description={`${name} will be signed out and won't be able to open the app until you send a new link.`}
        confirmLabel="Turn off"
        pending={disable.isPending}
        onConfirm={() => disable.mutate(undefined, { onSuccess: () => setTurningOff(false) })}
      />
    </section>
  );
}
