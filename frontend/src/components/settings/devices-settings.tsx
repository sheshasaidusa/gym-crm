"use client";

import { CopyIcon, KeyRoundIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import {
  useCreateDevice,
  useDeleteDevice,
  useDevices,
  useRotateDeviceKey,
  useUpdateDevice,
  type Device,
} from "@/lib/attendance-queries";

function lastSeen(iso: string | null) {
  if (!iso) return "Never reported";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} min ago`;
  if (mins < 60 * 24) return `${Math.round(mins / 60)} h ago`;
  return new Date(iso).toLocaleDateString();
}

/** Shown once, right after a key is made: the only time it can be copied. */
function KeyDialog({ keyText, name, onClose }: { keyText: string | null; name: string; onClose: () => void }) {
  return (
    <Dialog open={!!keyText} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Key for {name}</DialogTitle>
          <DialogDescription>
            Copy it into the device or its connector now. For safety it can&apos;t be shown again; if you lose it, make a
            new key.
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2">
          <Input readOnly value={keyText ?? ""} onFocus={(e) => e.currentTarget.select()} className="font-mono text-xs" />
          <Button
            variant="outline"
            size="icon"
            aria-label="Copy key"
            onClick={async () => {
              await navigator.clipboard.writeText(keyText ?? "");
              toast.success("Key copied");
            }}
          >
            <CopyIcon />
          </Button>
        </div>
        <DialogFooter>
          <Button onClick={onClose}>I&apos;ve saved it</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Door scanners and turnstiles that report visits. See docs/attendance-ingestion.md for the connector side. */
export function DevicesSettings() {
  const devices = useDevices();
  const create = useCreateDevice();
  const rotate = useRotateDeviceKey();
  const update = useUpdateDevice();
  const remove = useDeleteDevice();
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [shown, setShown] = useState<{ key: string; name: string } | null>(null);
  const [rotating, setRotating] = useState<Device | null>(null);
  const [removing, setRemoving] = useState<Device | null>(null);

  return (
    <Card variant="flat">
      <CardHeader>
        <CardTitle>Door devices</CardTitle>
        <CardDescription>
          Fingerprint scanners and turnstiles can send each visit here. Members are matched by the &ldquo;Scanner
          number&rdquo; on their profile.
        </CardDescription>
        <CardAction>
          <Button size="sm" onClick={() => setAdding(true)}>
            <PlusIcon />
            Add device
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent>
        {devices.isPending ? (
          <Skeleton className="h-20 w-full" />
        ) : devices.data?.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No devices yet. Front-desk check-in works without one; add a device only when you have a scanner to connect.
          </p>
        ) : (
          <ul className="divide-y">
            {devices.data?.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 py-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 font-medium">
                    {d.name}
                    {!d.is_active && <Badge variant="outline">Off</Badge>}
                  </div>
                  <div className="text-xs text-muted-foreground">{lastSeen(d.last_seen_at)}</div>
                </div>
                <label className="flex items-center gap-2 text-xs text-muted-foreground">
                  Active
                  <Switch
                    checked={d.is_active}
                    onCheckedChange={(on) => update.mutate({ id: d.id, is_active: on })}
                    aria-label={`${d.name} active`}
                  />
                </label>
                <Button variant="ghost" size="sm" onClick={() => setRotating(d)}>
                  <KeyRoundIcon />
                  New key
                </Button>
                <Button variant="ghost" size="icon-sm" aria-label={`Remove ${d.name}`} onClick={() => setRemoving(d)}>
                  <Trash2Icon />
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent>
          <form
            className="grid gap-4"
            onSubmit={(e) => {
              e.preventDefault();
              create.mutate(
                { name: name.trim() },
                {
                  onSuccess: (d) => {
                    setAdding(false);
                    setName("");
                    setShown({ key: d.api_key, name: d.name });
                  },
                },
              );
            }}
          >
            <DialogHeader>
              <DialogTitle>Add a device</DialogTitle>
              <DialogDescription>You&apos;ll get a key to put in the device or its connector.</DialogDescription>
            </DialogHeader>
            <Field>
              <FieldLabel htmlFor="device-name">Name</FieldLabel>
              <Input
                id="device-name"
                placeholder="Front door"
                value={name}
                onChange={(e) => setName(e.target.value)}
                autoFocus
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setAdding(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={name.trim().length < 2 || create.isPending}>
                {create.isPending && <Spinner />}
                Create key
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <KeyDialog keyText={shown?.key ?? null} name={shown?.name ?? ""} onClose={() => setShown(null)} />

      <ConfirmDialog
        open={!!rotating}
        onOpenChange={(o) => !o && setRotating(null)}
        title={`Make a new key for ${rotating?.name}?`}
        description="The old key stops working immediately, so update the device or connector right after."
        confirmLabel="Make new key"
        pending={rotate.isPending}
        onConfirm={() =>
          rotating &&
          rotate.mutate(rotating.id, {
            onSuccess: (d) => {
              setRotating(null);
              setShown({ key: d.api_key, name: d.name });
            },
          })
        }
      />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name}?`}
        description="It stops reporting right away. Visits it already recorded stay."
        confirmLabel="Remove"
        pending={remove.isPending}
        onConfirm={() => removing && remove.mutate(removing.id, { onSuccess: () => setRemoving(null) })}
      />
    </Card>
  );
}
