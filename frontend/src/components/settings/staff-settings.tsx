"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CopyIcon, MailPlusIcon, Trash2Icon, UserMinusIcon } from "lucide-react";
import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { TextField } from "@/components/form-fields";
import { SimpleSelect } from "@/components/simple-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ROLE_LABELS,
  useBranches,
  useCan,
  useCreateInvite,
  useInvites,
  useMe,
  useRemoveStaff,
  useRevokeInvite,
  useStaff,
  useUpdateStaff,
  type Invite,
  type Role,
  type Staff,
} from "@/lib/queries";

const ROLE_OPTIONS = (Object.keys(ROLE_LABELS) as Role[]).map((r) => ({
  value: r,
  label: ROLE_LABELS[r],
}));
const NO_BRANCH = "none";

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success("Link copied");
}

const inviteSchema = z.object({
  email: z.email("Enter a valid email"),
  role: z.enum(["owner", "manager", "trainer", "front_desk"]),
  branch_id: z.string(),
});

function InviteDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const can = useCan();
  const branches = useBranches();
  const create = useCreateInvite();
  const [created, setCreated] = useState<Invite | null>(null);
  const form = useForm({
    resolver: zodResolver(inviteSchema),
    defaultValues: { email: "", role: "trainer" as Role, branch_id: NO_BRANCH },
  });

  const close = (o: boolean) => {
    onOpenChange(o);
    if (!o) {
      setCreated(null);
      form.reset();
    }
  };

  const roleOptions = can.own ? ROLE_OPTIONS : ROLE_OPTIONS.filter((r) => r.value !== "owner");
  const branchOptions = [
    { value: NO_BRANCH, label: "All branches" },
    ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name })),
  ];

  return (
    <Dialog open={open} onOpenChange={close}>
      <DialogContent>
        {created ? (
          <div className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Invite link ready</DialogTitle>
              <DialogDescription>
                Send this link to {created.email}. It works once and expires in 7 days.
              </DialogDescription>
            </DialogHeader>
            <div className="flex gap-2">
              <Input readOnly value={created.url} onFocus={(e) => e.currentTarget.select()} />
              <Button variant="outline" size="icon" aria-label="Copy link" onClick={() => copy(created.url)}>
                <CopyIcon />
              </Button>
            </div>
            <DialogFooter>
              <Button
                variant="outline"
                nativeButton={false}
                render={
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`Join our gym team on dunamis: ${created.url}`)}`}
                    target="_blank"
                    rel="noreferrer"
                  />
                }
              >
                Share on WhatsApp
              </Button>
              <Button onClick={() => close(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <form
            noValidate
            className="grid gap-4"
            onSubmit={form.handleSubmit((v) =>
              create.mutate(
                { ...v, branch_id: v.branch_id === NO_BRANCH ? null : v.branch_id },
                { onSuccess: setCreated },
              ),
            )}
          >
            <DialogHeader>
              <DialogTitle>Invite staff</DialogTitle>
              <DialogDescription>You&apos;ll get a link to share with them.</DialogDescription>
            </DialogHeader>
            <FieldGroup>
              <TextField
                label="Email"
                type="email"
                error={form.formState.errors.email}
                {...form.register("email")}
              />
              <Field>
                <FieldLabel htmlFor="invite-role">Role</FieldLabel>
                <Controller
                  control={form.control}
                  name="role"
                  render={({ field }) => (
                    <SimpleSelect id="invite-role" options={roleOptions} value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="invite-branch">Branch</FieldLabel>
                <Controller
                  control={form.control}
                  name="branch_id"
                  render={({ field }) => (
                    <SimpleSelect id="invite-branch" options={branchOptions} value={field.value} onChange={field.onChange} />
                  )}
                />
              </Field>
            </FieldGroup>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => close(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={create.isPending}>
                {create.isPending && <Spinner />}
                Create invite link
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function StaffSettings() {
  const me = useMe();
  const can = useCan();
  const staff = useStaff();
  const branches = useBranches();
  const invites = useInvites(can.manage);
  const updateStaff = useUpdateStaff();
  const removeStaff = useRemoveStaff();
  const revokeInvite = useRevokeInvite();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [removing, setRemoving] = useState<Staff | null>(null);

  const branchName = (id: string | null) =>
    id ? (branches.data?.find((b) => b.id === id)?.name ?? "—") : "All branches";
  const branchOptions = [
    { value: NO_BRANCH, label: "All branches" },
    ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name })),
  ];

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Staff</CardTitle>
          <CardDescription>People who can log in to this gym.</CardDescription>
          {can.manage && (
            <CardAction>
              <Button size="sm" onClick={() => setInviteOpen(true)}>
                <MailPlusIcon />
                Invite staff
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          {staff.isPending ? (
            <Skeleton className="h-24 w-full" />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-40">Role</TableHead>
                  <TableHead className="w-44">Branch</TableHead>
                  {can.own && <TableHead className="w-12" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.data?.map((s) => {
                  const isMe = s.user_id === me.data?.user.id;
                  const editable = can.own && !isMe;
                  return (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-medium">
                          {s.name} {isMe && <Badge variant="secondary">You</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">{s.email}</div>
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <SimpleSelect
                            options={ROLE_OPTIONS}
                            value={s.role}
                            onChange={(role) => updateStaff.mutate({ id: s.id, role: role as Role })}
                          />
                        ) : (
                          ROLE_LABELS[s.role]
                        )}
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <SimpleSelect
                            options={branchOptions}
                            value={s.branch_id ?? NO_BRANCH}
                            onChange={(b) =>
                              updateStaff.mutate({ id: s.id, branch_id: b === NO_BRANCH ? null : b })
                            }
                          />
                        ) : (
                          branchName(s.branch_id)
                        )}
                      </TableCell>
                      {can.own && (
                        <TableCell>
                          {!isMe && (
                            <Button
                              variant="ghost"
                              size="icon-sm"
                              aria-label={`Remove ${s.name}`}
                              onClick={() => setRemoving(s)}
                            >
                              <UserMinusIcon />
                            </Button>
                          )}
                        </TableCell>
                      )}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {can.manage && (invites.data?.length ?? 0) > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Pending invites</CardTitle>
            <CardDescription>Links that haven&apos;t been accepted yet.</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invites.data?.map((inv) => {
                  const expired = new Date(inv.expires_at) < new Date();
                  return (
                    <TableRow key={inv.id}>
                      <TableCell className="font-medium">{inv.email}</TableCell>
                      <TableCell>{ROLE_LABELS[inv.role]}</TableCell>
                      <TableCell>
                        {expired ? (
                          <Badge variant="destructive">Expired</Badge>
                        ) : (
                          new Date(inv.expires_at).toLocaleDateString()
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {!expired && (
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Copy invite link"
                            onClick={() => copy(inv.url)}
                          >
                            <CopyIcon />
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Revoke invite"
                          onClick={() => revokeInvite.mutate(inv.id)}
                        >
                          <Trash2Icon />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name}?`}
        description="They'll lose access to this gym immediately. You can invite them again later."
        confirmLabel="Remove"
        pending={removeStaff.isPending}
        onConfirm={() =>
          removing && removeStaff.mutate(removing.id, { onSuccess: () => setRemoving(null) })
        }
      />
    </div>
  );
}
