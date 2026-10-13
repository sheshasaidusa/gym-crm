"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { MapPinIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { z } from "zod";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { TextField } from "@/components/form-fields";
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
import { FieldGroup } from "@/components/ui/field";
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
import { useBranches, useCan, useDeleteBranch, useSaveBranch, type Branch } from "@/lib/queries";

const schema = z.object({
  name: z.string().trim().min(2, "Enter a branch name").max(120),
  address: z.string().trim().max(500),
  phone: z.string().trim().max(30),
});

function BranchDialog({
  branch,
  open,
  onOpenChange,
}: {
  branch: Branch | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const save = useSaveBranch();
  const form = useForm({
    resolver: zodResolver(schema),
    values: {
      name: branch?.name ?? "",
      address: branch?.address ?? "",
      phone: branch?.phone ?? "",
    },
  });
  const { errors } = form.formState;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <form
          onSubmit={form.handleSubmit((v) =>
            save.mutate(
              { id: branch?.id, name: v.name, address: v.address || null, phone: v.phone || null },
              { onSuccess: () => onOpenChange(false) },
            ),
          )}
          noValidate
          className="grid gap-4"
        >
          <DialogHeader>
            <DialogTitle>{branch ? "Edit branch" : "Add branch"}</DialogTitle>
            <DialogDescription>Members and staff can be assigned to a branch.</DialogDescription>
          </DialogHeader>
          <FieldGroup>
            <TextField label="Name" error={errors.name} {...form.register("name")} />
            <TextField label="Address" error={errors.address} {...form.register("address")} />
            <TextField label="Phone" type="tel" error={errors.phone} {...form.register("phone")} />
          </FieldGroup>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={save.isPending}>
              {save.isPending && <Spinner />}
              {branch ? "Save" : "Add branch"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function BranchesSettings() {
  const branches = useBranches();
  const can = useCan();
  const remove = useDeleteBranch();
  const [editing, setEditing] = useState<Branch | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Branch | null>(null);

  const openDialog = (branch: Branch | null) => {
    setEditing(branch);
    setDialogOpen(true);
  };

  return (
    <Card variant="flat">
      <CardHeader>
        <CardTitle>Branches</CardTitle>
        <CardDescription>Every gym has at least one branch.</CardDescription>
        {can.manage && (
          <CardAction>
            <Button size="sm" onClick={() => openDialog(null)}>
              <PlusIcon />
              Add branch
            </Button>
          </CardAction>
        )}
      </CardHeader>
      <CardContent>
        {branches.isPending ? (
          <Skeleton className="h-24 w-full" />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Phone</TableHead>
                {can.manage && <TableHead className="w-24" />}
              </TableRow>
            </TableHeader>
            <TableBody>
              {branches.data?.map((b) => (
                <TableRow key={b.id}>
                  <TableCell className="font-medium">
                    <span className="flex items-center gap-2">
                      <MapPinIcon className="size-4 text-muted-foreground" />
                      {b.name}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-xs truncate text-muted-foreground">
                    {b.address || "—"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">{b.phone || "—"}</TableCell>
                  {can.manage && (
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Edit ${b.name}`}
                        onClick={() => openDialog(b)}
                      >
                        <PencilIcon />
                      </Button>
                      {can.own && (branches.data?.length ?? 0) > 1 && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Delete ${b.name}`}
                          onClick={() => setDeleting(b)}
                        >
                          <Trash2Icon />
                        </Button>
                      )}
                    </TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <BranchDialog branch={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title={`Delete ${deleting?.name}?`}
        description="Staff assigned to this branch will become unassigned. This can't be undone."
        confirmLabel="Delete branch"
        pending={remove.isPending}
        onConfirm={() =>
          deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })
        }
      />
    </Card>
  );
}
