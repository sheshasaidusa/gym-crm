"use client";

import { ChevronLeftIcon, ChevronRightIcon, PaperclipIcon, PencilIcon, PlusIcon, Trash2Icon } from "lucide-react";
import { useState } from "react";

import { ConfirmDialog } from "@/components/confirm-dialog";
import { PERIODS } from "@/components/finance/payments-tab";
import { SimpleSelect } from "@/components/simple-select";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
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
import { Textarea } from "@/components/ui/textarea";
import {
  CATEGORY_LABELS,
  METHOD_LABELS,
  useDeleteExpense,
  useExpenses,
  useSaveExpense,
  type Expense,
  type ExpenseCategory,
  type PaymentMethod,
} from "@/lib/finance-queries";
import { formatDate, formatMoney, todayIso } from "@/lib/format";
import { useCurrency } from "@/lib/queries";
import { cn } from "@/lib/utils";

const ALL = "all";
const NONE = "none";

function ExpenseDialog({
  expense,
  open,
  onOpenChange,
}: {
  expense: Expense | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const currency = useCurrency();
  const save = useSaveExpense();
  const blank = () => ({
    category: (expense?.category ?? "rent") as ExpenseCategory,
    amount: expense ? String(expense.amount) : "",
    spent_on: expense?.spent_on ?? todayIso(),
    vendor: expense?.vendor ?? "",
    method: (expense?.method ?? NONE) as PaymentMethod | typeof NONE,
    note: expense?.note ?? "",
  });
  const [draft, setDraft] = useState(blank);
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState<string>();
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDraft(blank());
      setFile(null);
      setError(undefined);
    }
  }

  const submit = () => {
    const n = Number(draft.amount);
    if (!draft.amount || Number.isNaN(n) || n <= 0) return setError("Enter the amount");
    setError(undefined);
    save.mutate(
      {
        id: expense?.id,
        file,
        category: draft.category,
        amount: n,
        spent_on: draft.spent_on,
        vendor: draft.vendor.trim() || null,
        method: draft.method === NONE ? null : draft.method,
        note: draft.note.trim() || null,
      },
      { onSuccess: () => onOpenChange(false) },
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{expense ? "Edit expense" : "Add expense"}</DialogTitle>
          <DialogDescription>Money the gym spent.</DialogDescription>
        </DialogHeader>
        <FieldGroup>
          <div className="grid grid-cols-2 gap-3">
            <Field>
              <FieldLabel htmlFor="exp-category">Category</FieldLabel>
              <SimpleSelect
                id="exp-category"
                options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
                value={draft.category}
                onChange={(v) => setDraft({ ...draft, category: v as ExpenseCategory })}
              />
            </Field>
            <Field>
              <FieldLabel htmlFor="exp-amount">Amount ({currency})</FieldLabel>
              <Input id="exp-amount" type="number" min={0} inputMode="decimal" value={draft.amount} onChange={(e) => setDraft({ ...draft, amount: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="exp-date">Date</FieldLabel>
              <Input id="exp-date" type="date" max={todayIso()} value={draft.spent_on} onChange={(e) => setDraft({ ...draft, spent_on: e.target.value })} />
            </Field>
            <Field>
              <FieldLabel htmlFor="exp-method">Paid by</FieldLabel>
              <SimpleSelect
                id="exp-method"
                options={[{ value: NONE, label: "—" }, ...Object.entries(METHOD_LABELS).map(([value, label]) => ({ value, label }))]}
                value={draft.method}
                onChange={(v) => setDraft({ ...draft, method: v as PaymentMethod | typeof NONE })}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="exp-vendor">Paid to (optional)</FieldLabel>
            <Input id="exp-vendor" placeholder="e.g. Landlord, electricity board" value={draft.vendor} onChange={(e) => setDraft({ ...draft, vendor: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="exp-note">Note (optional)</FieldLabel>
            <Textarea id="exp-note" rows={2} value={draft.note} onChange={(e) => setDraft({ ...draft, note: e.target.value })} />
          </Field>
          <Field>
            <FieldLabel htmlFor="exp-file">Bill or receipt (optional)</FieldLabel>
            <Input
              id="exp-file"
              type="file"
              accept="application/pdf,image/jpeg,image/png,image/webp"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <FieldDescription>
              {expense?.attachment_url && !file ? "A file is attached; choosing a new one replaces it. " : ""}
              PDF or photo, up to 10 MB.
            </FieldDescription>
          </Field>
          {error && <FieldError>{error}</FieldError>}
        </FieldGroup>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={save.isPending}>
            {save.isPending && <Spinner />}
            {expense ? "Save" : "Add expense"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ExpensesTab() {
  const currency = useCurrency();
  const [period, setPeriod] = useState<string>("this_month");
  const [category, setCategory] = useState<string>(ALL);
  const [page, setPage] = useState(1);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const remove = useDeleteExpense();

  const range = PERIODS.find((p) => p.value === period)?.range() ?? {};
  const expenses = useExpenses({ ...range, category: category === ALL ? undefined : (category as ExpenseCategory), page });
  const data = expenses.data;
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;
  const open = (e: Expense | null) => {
    setEditing(e);
    setDialogOpen(true);
  };

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap gap-2">
        <SimpleSelect
          className="w-auto min-w-36"
          options={PERIODS.map((p) => ({ value: p.value, label: p.label }))}
          value={period}
          onChange={(v) => {
            setPeriod(v);
            setPage(1);
          }}
        />
        <SimpleSelect
          className="w-auto min-w-40"
          options={[{ value: ALL, label: "All categories" }, ...Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))]}
          value={category}
          onChange={(v) => {
            setCategory(v);
            setPage(1);
          }}
        />
        <Button className="ml-auto" onClick={() => open(null)}>
          <PlusIcon />
          Add expense
        </Button>
      </div>

      {expenses.isPending ? (
        <Skeleton className="h-64 w-full rounded-xl" />
      ) : (
        <Card className="py-0">
          <Table className={cn(expenses.isPlaceholderData && "opacity-60")}>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-4">Category</TableHead>
                <TableHead>Amount</TableHead>
                <TableHead className="hidden sm:table-cell">Date</TableHead>
                <TableHead className="hidden md:table-cell">Paid to</TableHead>
                <TableHead className="w-28" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {!data?.items.length ? (
                <TableRow>
                  <TableCell colSpan={5} className="py-8 text-center text-muted-foreground">
                    No expenses in this period.
                  </TableCell>
                </TableRow>
              ) : (
                data.items.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="pl-4">
                      <div className="font-medium">{CATEGORY_LABELS[e.category]}</div>
                      {e.note && <div className="max-w-56 truncate text-xs text-muted-foreground">{e.note}</div>}
                    </TableCell>
                    <TableCell className="tabular-nums">{formatMoney(e.amount, currency)}</TableCell>
                    <TableCell className="hidden text-muted-foreground sm:table-cell">{formatDate(e.spent_on, { year: false })}</TableCell>
                    <TableCell className="hidden text-muted-foreground md:table-cell">{e.vendor ?? "—"}</TableCell>
                    <TableCell className="text-right">
                      {e.attachment_url && (
                        <Button
                          variant="ghost"
                          size="icon-sm"
                          aria-label="Open attached bill"
                          nativeButton={false}
                          render={<a href={e.attachment_url} target="_blank" rel="noreferrer" />}
                        >
                          <PaperclipIcon />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon-sm" aria-label="Edit expense" onClick={() => open(e)}>
                        <PencilIcon />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Delete expense" onClick={() => setDeleting(e)}>
                        <Trash2Icon />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
          <div className="flex items-center justify-between border-t px-4 py-2 text-sm text-muted-foreground">
            <span>
              {data?.total ?? 0} expenses · <strong className="text-foreground">{formatMoney(data?.amount_total ?? 0, currency)}</strong> spent
            </span>
            <div className="flex gap-1">
              <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => setPage(page - 1)}>
                <ChevronLeftIcon />
              </Button>
              <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pages} onClick={() => setPage(page + 1)}>
                <ChevronRightIcon />
              </Button>
            </div>
          </div>
        </Card>
      )}

      <ExpenseDialog expense={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
      <ConfirmDialog
        open={!!deleting}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this expense?"
        description={deleting ? `${CATEGORY_LABELS[deleting.category]} · ${formatMoney(deleting.amount, currency)} on ${formatDate(deleting.spent_on)}` : ""}
        confirmLabel="Delete"
        pending={remove.isPending}
        onConfirm={() => deleting && remove.mutate(deleting.id, { onSuccess: () => setDeleting(null) })}
      />
    </div>
  );
}
