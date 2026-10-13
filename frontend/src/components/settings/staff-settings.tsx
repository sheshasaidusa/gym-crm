"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { CopyIcon, MailPlusIcon, RefreshCwIcon, Trash2Icon, UserCheckIcon, UserMinusIcon } from "lucide-react";
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
  useDeactivateStaff,
  useInvites,
  useMe,
  useReactivateStaff,
  useRemoveStaff,
  useResendInvite,
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
const NO_ONE = "none";
// Mirrors the backend's RANK: you can only manage staff ranked below you (owners manage everyone).
const RANK: Record<Role, number> = { owner: 3, manager: 2, front_desk: 1, sales: 1, trainer: 1 };
const outranks = (mine: Role | undefined, theirs: Role) =>
  mine === "owner" || (!!mine && RANK[mine] > RANK[theirs]);
// Roles that can be someone's trainer.
const COACHES: Role[] = ["owner", "manager", "trainer"];

async function copy(text: string) {
  await navigator.clipboard.writeText(text);
  toast.success("Link copied");
}

const inviteSchema = z.object({
  email: z.email("Enter a valid email"),
  role: z.enum(["owner", "manager", "trainer", "front_desk", "sales"]),
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

  const roleOptions = ROLE_OPTIONS.filter((r) => outranks(can.role, r.value) || can.role === "owner");
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

function DeactivateDialog({ staff, onClose }: { staff: Staff | null; onClose: () => void }) {
  const all = useStaff();
  const deactivate = useDeactivateStaff();
  const [clientsTo, setClientsTo] = useState(NO_ONE);
  const [leadsTo, setLeadsTo] = useState(NO_ONE);

  const others = (all.data ?? []).filter((s) => s.is_active && s.id !== staff?.id);
  const optionsFor = (list: Staff[]) => [
    { value: NO_ONE, label: "Don't reassign" },
    ...list.map((s) => ({ value: s.user_id, label: `${s.name} · ${ROLE_LABELS[s.role]}` })),
  ];

  const close = () => {
    setClientsTo(NO_ONE);
    setLeadsTo(NO_ONE);
    onClose();
  };

  return (
    <Dialog open={!!staff} onOpenChange={(o) => !o && close()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Deactivate {staff?.name}?</DialogTitle>
          <DialogDescription>
            They&apos;ll lose access right away, but their history stays. You can reactivate them
            later. Hand over their work now so nothing is left unattended.
          </DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="move-clients">Give their clients to</FieldLabel>
            <SimpleSelect
              id="move-clients"
              options={optionsFor(others.filter((s) => COACHES.includes(s.role)))}
              value={clientsTo}
              onChange={setClientsTo}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="move-leads">Give their leads to</FieldLabel>
            <SimpleSelect
              id="move-leads"
              options={optionsFor(others)}
              value={leadsTo}
              onChange={setLeadsTo}
            />
          </Field>
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={close}>
            Cancel
          </Button>
          <Button
            variant="destructive"
            disabled={deactivate.isPending}
            onClick={() =>
              staff &&
              deactivate.mutate(
                {
                  id: staff.id,
                  reassign_members_to: clientsTo === NO_ONE ? null : clientsTo,
                  reassign_leads_to: leadsTo === NO_ONE ? null : leadsTo,
                },
                { onSuccess: close },
              )
            }
          >
            {deactivate.isPending && <Spinner />}
            Deactivate
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function StaffSettings() {
  const me = useMe();
  const can = useCan();
  const staff = useStaff();
  const branches = useBranches();
  const canManage = can.has("staff_manage");
  const invites = useInvites(canManage);
  const updateStaff = useUpdateStaff();
  const removeStaff = useRemoveStaff();
  const reactivate = useReactivateStaff();
  const resendInvite = useResendInvite();
  const revokeInvite = useRevokeInvite();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [deactivating, setDeactivating] = useState<Staff | null>(null);
  const [removing, setRemoving] = useState<Staff | null>(null);

  const branchName = (id: string | null) =>
    id ? (branches.data?.find((b) => b.id === id)?.name ?? "—") : "All branches";
  const branchOptions = [
    { value: NO_BRANCH, label: "All branches" },
    ...(branches.data ?? []).map((b) => ({ value: b.id, label: b.name })),
  ];
  // Roles this person may hand out: owners any, everyone else only roles below their own.
  const roleOptions = ROLE_OPTIONS.filter((r) => outranks(can.role, r.value) || can.role === "owner");

  return (
    <div className="grid gap-8 [&>*+*]:border-t [&>*+*]:border-border/70 [&>*+*]:pt-8">
      <Card variant="flat">
        <CardHeader>
          <CardTitle>Staff</CardTitle>
          <CardDescription>People who can log in to this gym.</CardDescription>
          {canManage && (
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
                  {canManage && <TableHead className="w-24" />}
                </TableRow>
              </TableHeader>
              <TableBody>
                {staff.data?.map((s) => {
                  const isMe = s.user_id === me.data?.user.id;
                  const actionable = canManage && !isMe && outranks(can.role, s.role);
                  const editable = actionable && s.is_active;
                  return (
                    <TableRow key={s.id} className={s.is_active ? undefined : "opacity-60"}>
                      <TableCell>
                        <div className="font-medium">
                          {s.name} {isMe && <Badge variant="secondary">You</Badge>}
                          {!s.is_active && <Badge variant="outline">Inactive</Badge>}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {s.email}
                          {s.phone && ` · ${s.phone}`}
                        </div>
                      </TableCell>
                      <TableCell>
                        {editable ? (
                          <SimpleSelect
                            options={roleOptions}
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
                      {canManage && (
                        <TableCell className="text-right">
                          {actionable &&
                            (s.is_active ? (
                              <Button
                                variant="ghost"
                                size="icon-sm"
                                aria-label={`Deactivate ${s.name}`}
                                onClick={() => setDeactivating(s)}
                              >
                                <UserMinusIcon />
                              </Button>
                            ) : (
                              <>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Reactivate ${s.name}`}
                                  onClick={() => reactivate.mutate(s.id)}
                                >
                                  <UserCheckIcon />
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="icon-sm"
                                  aria-label={`Remove ${s.name}`}
                                  onClick={() => setRemoving(s)}
                                >
                                  <Trash2Icon />
                                </Button>
                              </>
                            ))}
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

      {canManage && (invites.data?.length ?? 0) > 0 && (
        <Card variant="flat">
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
                  <TableHead className="w-32" />
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
                          aria-label="Make a new invite link"
                          title="New link (the old one stops working)"
                          disabled={resendInvite.isPending}
                          onClick={() => resendInvite.mutate(inv.id, { onSuccess: (i) => copy(i.url) })}
                        >
                          <RefreshCwIcon />
                        </Button>
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
      <DeactivateDialog staff={deactivating} onClose={() => setDeactivating(null)} />
      <ConfirmDialog
        open={!!removing}
        onOpenChange={(o) => !o && setRemoving(null)}
        title={`Remove ${removing?.name}?`}
        description="They'll be taken off the staff list for good. You can invite them again later."
        confirmLabel="Remove"
        pending={removeStaff.isPending}
        onConfirm={() =>
          removing && removeStaff.mutate(removing.id, { onSuccess: () => setRemoving(null) })
        }
      />
    </div>
  );
}
