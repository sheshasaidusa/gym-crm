"use client";

import {
  AlertTriangleIcon,
  ArrowLeftIcon,
  CheckCircle2Icon,
  DownloadIcon,
  FileSpreadsheetIcon,
  UploadIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { ChipSelect } from "@/components/chip-select";
import { SimpleSelect } from "@/components/simple-select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
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
  ENTITY_META,
  ENTITY_ORDER,
  problemsUrl,
  templateUrl,
  useCheckImport,
  useImportFields,
  useImportJob,
  useInvalidateImported,
  useRunImport,
  useUploadImport,
  type CheckIn,
  type CheckResult,
  type ImportEntity,
  type UploadResult,
} from "@/lib/import-queries";
import { cn } from "@/lib/utils";

const NONE = "__none";

type Settings = Omit<CheckIn, "mapping"> & { mapping: Record<string, string> };

type Step =
  | { kind: "choose" }
  | { kind: "map"; upload: UploadResult }
  | { kind: "review"; upload: UploadResult; check: CheckResult }
  | { kind: "run"; jobId: string };

export function ImportWizard() {
  const [entity, setEntity] = useState<ImportEntity>("members");
  const [step, setStep] = useState<Step>({ kind: "choose" });
  const [settings, setSettings] = useState<Settings>({
    mapping: {},
    duplicate_mode: "skip",
    date_order: "dmy",
  });

  const reset = () => setStep({ kind: "choose" });

  switch (step.kind) {
    case "choose":
      return (
        <ChooseStep
          entity={entity}
          onEntity={setEntity}
          onUploaded={(upload) => {
            setSettings((s) => ({ ...s, mapping: upload.suggested_mapping }));
            setStep({ kind: "map", upload });
          }}
        />
      );
    case "map":
      return (
        <MapStep
          upload={step.upload}
          settings={settings}
          onSettings={setSettings}
          onBack={reset}
          onChecked={(check) => setStep({ kind: "review", upload: step.upload, check })}
        />
      );
    case "review":
      return (
        <ReviewStep
          check={step.check}
          duplicateMode={settings.duplicate_mode ?? "skip"}
          onBack={() => setStep({ kind: "map", upload: step.upload })}
          onStarted={() => setStep({ kind: "run", jobId: step.check.job.id })}
        />
      );
    case "run":
      return <RunStep jobId={step.jobId} onDone={reset} />;
  }
}

function Steps({ current }: { current: number }) {
  const labels = ["Upload", "Match columns", "Review", "Import"];
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {labels.map((l, i) => (
        <li key={l} className={cn(i === current && "font-medium text-foreground")}>
          {i + 1}. {l}
        </li>
      ))}
    </ol>
  );
}

// --- 1. Choose a type and upload ---------------------------------------------------

function ChooseStep({
  entity,
  onEntity,
  onUploaded,
}: {
  entity: ImportEntity;
  onEntity: (e: ImportEntity) => void;
  onUploaded: (u: UploadResult) => void;
}) {
  const upload = useUploadImport();
  const input = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);

  const send = (file: File | undefined) => {
    if (!file) return;
    upload.mutate({ entity, file }, { onSuccess: onUploaded });
  };

  return (
    <Card>
      <CardHeader>
        <Steps current={0} />
        <CardTitle className="pt-2">What are you importing?</CardTitle>
        <CardDescription>
          Moving from another system? Import in this order so everything links up: plans,
          members, then payments and check-ups.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div role="radiogroup" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
          {ENTITY_ORDER.map((e, i) => {
            const on = e === entity;
            return (
              <button
                key={e}
                type="button"
                role="radio"
                aria-checked={on}
                onClick={() => onEntity(e)}
                className={cn(
                  "rounded-lg border p-3 text-left transition-colors",
                  on ? "border-primary bg-primary/5 ring-1 ring-primary" : "hover:bg-muted",
                )}
              >
                <div className="text-sm font-medium">
                  <span className="text-muted-foreground">{i + 1}.</span> {ENTITY_META[e].label}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">{ENTITY_META[e].text}</div>
              </button>
            );
          })}
        </div>

        <div
          onDragOver={(ev) => {
            ev.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={(ev) => {
            ev.preventDefault();
            setDragging(false);
            send(ev.dataTransfer.files[0]);
          }}
          className={cn(
            "flex flex-col items-center gap-3 rounded-lg border border-dashed px-4 py-10 text-center",
            dragging && "border-primary bg-primary/5",
          )}
        >
          <FileSpreadsheetIcon className="size-8 text-muted-foreground" />
          <div className="space-y-1">
            <p className="text-sm font-medium">
              Drop a CSV or Excel file of {ENTITY_META[entity].label.toLowerCase()} here
            </p>
            <p className="text-xs text-muted-foreground">
              .csv or .xlsx, up to 5 MB and 10,000 rows. The first row should be column names.
            </p>
          </div>
          <input
            ref={input}
            type="file"
            accept=".csv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="sr-only"
            onChange={(ev) => {
              send(ev.target.files?.[0]);
              ev.target.value = "";
            }}
          />
          <div className="flex flex-wrap justify-center gap-2">
            <Button onClick={() => input.current?.click()} disabled={upload.isPending}>
              {upload.isPending ? <Spinner /> : <UploadIcon />}
              Choose file
            </Button>
            <Button variant="outline" nativeButton={false} render={<a href={templateUrl(entity)} />}>
              <DownloadIcon />
              Template
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

// --- 2. Match columns -----------------------------------------------------------------

function MapStep({
  upload,
  settings,
  onSettings,
  onBack,
  onChecked,
}: {
  upload: UploadResult;
  settings: Settings;
  onSettings: (s: Settings) => void;
  onBack: () => void;
  onChecked: (c: CheckResult) => void;
}) {
  const { job, sample } = upload;
  const fields = useImportFields().data?.[job.entity] ?? [];
  const check = useCheckImport(job.id);
  const columnOptions = [
    { value: NONE, label: "Not in my file" },
    ...job.columns.map((c) => ({ value: c, label: c })),
  ];
  const missing = fields.filter((f) => f.required && !settings.mapping[f.key]);
  const used = new Set(Object.values(settings.mapping));
  const unused = job.columns.filter((c) => !used.has(c));
  // Payments are never overwritten, so there's nothing to choose.
  const canUpdate = job.entity !== "payments";

  const setColumn = (key: string, column: string) => {
    const mapping = { ...settings.mapping };
    if (column === NONE || !column) delete mapping[key];
    else mapping[key] = column;
    onSettings({ ...settings, mapping });
  };

  const exampleFor = (column: string | undefined) =>
    column ? sample.map((r) => r[column]).find((v) => v) : undefined;

  return (
    <Card>
      <CardHeader>
        <Steps current={1} />
        <CardTitle className="pt-2">Match your columns</CardTitle>
        <CardDescription>
          {job.filename} · {job.total_rows.toLocaleString()} rows. We matched what we could; check
          each field and pick the right column from your file.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="divide-y rounded-lg border">
          {fields.map((f) => {
            const column = settings.mapping[f.key];
            const example = exampleFor(column);
            return (
              <div
                key={f.key}
                className="grid gap-2 p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] sm:items-center"
              >
                <div className="min-w-0">
                  <Label htmlFor={`map-${f.key}`}>
                    {f.label}
                    {f.required && <span className="text-destructive">*</span>}
                  </Label>
                  {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                </div>
                <div className="min-w-0 space-y-1">
                  <SimpleSelect
                    id={`map-${f.key}`}
                    options={columnOptions}
                    value={column ?? ""}
                    onChange={(v) => setColumn(f.key, v)}
                    placeholder="Not in my file"
                    invalid={f.required && !column}
                  />
                  {example && (
                    <p className="truncate text-xs text-muted-foreground">e.g. {example}</p>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {unused.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Not imported: {unused.join(", ")}
          </p>
        )}

        <div className="grid gap-6 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Dates like 05/10/2026 mean</Label>
            <ChipSelect
              options={[
                { value: "dmy", label: "5 October (day first)" },
                { value: "mdy", label: "May 10 (month first)" },
              ]}
              value={settings.date_order === "mdy" ? "mdy" : "dmy"}
              onChange={(v) => v && onSettings({ ...settings, date_order: v as "dmy" | "mdy" })}
            />
          </div>
          {canUpdate && (
            <div className="space-y-2">
              <Label>If a row is already in dunamis</Label>
              <ChipSelect
                options={[
                  { value: "skip", label: "Skip it" },
                  { value: "update", label: "Update it with the file's details" },
                ]}
                value={settings.duplicate_mode ?? "skip"}
                onChange={(v) =>
                  v && onSettings({ ...settings, duplicate_mode: v as "skip" | "update" })
                }
              />
              <p className="text-xs text-muted-foreground">
                {job.entity === "members" || job.entity === "leads"
                  ? "Matched by phone number."
                  : job.entity === "checkups"
                    ? "Matched by member and date."
                    : "Matched by plan name."}
              </p>
            </div>
          )}
        </div>
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeftIcon />
          Different file
        </Button>
        <Button
          disabled={missing.length > 0 || check.isPending}
          onClick={() => check.mutate(settings, { onSuccess: onChecked })}
        >
          {check.isPending && <Spinner />}
          {missing.length > 0
            ? `Choose a column for ${missing.map((f) => f.label).join(", ")}`
            : "Check file"}
        </Button>
      </CardFooter>
    </Card>
  );
}

// --- 3. Review --------------------------------------------------------------------------

function Stat({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" }) {
  return (
    <div className="rounded-lg border p-3">
      <div
        className={cn(
          "text-2xl font-semibold tabular-nums",
          tone === "bad" && value > 0 && "text-destructive",
          tone === "warn" && value > 0 && "text-amber-600 dark:text-amber-400",
        )}
      >
        {value.toLocaleString()}
      </div>
      <div className="text-xs text-muted-foreground">{label}</div>
    </div>
  );
}

function ReviewStep({
  check,
  duplicateMode,
  onBack,
  onStarted,
}: {
  check: CheckResult;
  duplicateMode: "skip" | "update";
  onBack: () => void;
  onStarted: () => void;
}) {
  const run = useRunImport(check.job.id);
  const fields = useImportFields().data?.[check.job.entity] ?? [];
  const shownKeys = fields.map((f) => f.key).filter((k) => check.preview.some((p) => p.values[k]));
  const labelFor = (k: string) => fields.find((f) => f.key === k)?.label ?? k;
  const updates = duplicateMode === "update" && check.job.entity !== "payments";
  const willImport = check.new + (updates ? check.duplicates : 0);

  return (
    <Card>
      <CardHeader>
        <Steps current={2} />
        <CardTitle className="pt-2">Review before importing</CardTitle>
        <CardDescription>Nothing has been saved yet.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="grid grid-cols-3 gap-2">
          <Stat label="New" value={check.new} />
          <Stat
            label={updates ? "Already there · will update" : "Already there · will skip"}
            value={check.duplicates}
            tone="warn"
          />
          <Stat label="Have problems · will skip" value={check.invalid} tone="bad" />
        </div>

        {check.errors.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">Rows with problems</h3>
            <p className="text-xs text-muted-foreground">
              Fix these in your spreadsheet and import them again later. You&apos;ll get a file of
              just these rows once the import finishes.
            </p>
            <div className="max-h-72 overflow-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Row</TableHead>
                    <TableHead>Problem</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {check.errors.map((e) => (
                    <TableRow key={e.row}>
                      <TableCell className="tabular-nums">{e.row}</TableCell>
                      <TableCell className="whitespace-normal">{e.messages.join(" · ")}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            {check.invalid > check.errors.length && (
              <p className="text-xs text-muted-foreground">
                Showing the first {check.errors.length} of {check.invalid}.
              </p>
            )}
          </div>
        )}

        {check.preview.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-sm font-medium">How it will look</h3>
            <div className="overflow-x-auto rounded-lg border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-16">Row</TableHead>
                    {shownKeys.map((k) => (
                      <TableHead key={k}>{labelFor(k)}</TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {check.preview.map((p) => (
                    <TableRow key={p.row}>
                      <TableCell className="tabular-nums">
                        {p.row}
                        {p.status === "duplicate" && (
                          <Badge variant="secondary" className="ml-2">
                            {updates ? "Update" : "Skip"}
                          </Badge>
                        )}
                      </TableCell>
                      {shownKeys.map((k) => (
                        <TableCell key={k}>{p.values[k] || "—"}</TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        )}
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <Button variant="ghost" onClick={onBack}>
          <ArrowLeftIcon />
          Change matching
        </Button>
        <Button
          disabled={willImport === 0 || run.isPending}
          onClick={() => run.mutate(undefined, { onSuccess: onStarted })}
        >
          {run.isPending && <Spinner />}
          {willImport === 0
            ? "Nothing to import"
            : `Import ${willImport.toLocaleString()} ${willImport === 1 ? "row" : "rows"}`}
        </Button>
      </CardFooter>
    </Card>
  );
}

// --- 4. Run ---------------------------------------------------------------------------

function RunStep({ jobId, onDone }: { jobId: string; onDone: () => void }) {
  const job = useImportJob(jobId).data;
  const invalidate = useInvalidateImported();
  const finished = job?.status === "done" || job?.status === "failed";

  useEffect(() => {
    if (finished) invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [finished]);

  const pct = job && job.total_rows ? Math.round((job.processed / job.total_rows) * 100) : 0;

  return (
    <Card>
      <CardHeader>
        <Steps current={3} />
        <CardTitle className="pt-2">
          {!finished ? "Importing…" : job?.status === "failed" ? "Import stopped" : "Import finished"}
        </CardTitle>
        <CardDescription>
          {!finished
            ? "You can leave this page; we'll notify you when it's done."
            : job?.filename}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!finished && (
          <div className="space-y-2">
            <div
              className="h-2 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuenow={pct}
              aria-valuemin={0}
              aria-valuemax={100}
            >
              <div className="h-full bg-primary transition-all" style={{ width: `${pct}%` }} />
            </div>
            <p className="text-xs text-muted-foreground tabular-nums">
              {job?.processed.toLocaleString() ?? 0} of {job?.total_rows.toLocaleString() ?? "…"}{" "}
              rows
            </p>
          </div>
        )}

        {job?.status === "failed" && (
          <Alert variant="destructive">
            <AlertTriangleIcon />
            <AlertTitle>The import stopped part-way</AlertTitle>
            <AlertDescription>
              {job.error} Rows saved before it stopped ({job.created + job.updated}) are kept.
            </AlertDescription>
          </Alert>
        )}

        {job?.status === "done" && (
          <>
            <div className="flex items-center gap-2 text-sm">
              <CheckCircle2Icon className="size-5 text-primary" />
              Done. The imported rows are already live in dunamis.
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Stat label="Added" value={job.created} />
              <Stat label="Updated" value={job.updated} />
              <Stat label="Skipped" value={job.skipped} tone="warn" />
              <Stat label="Problems" value={job.failed} tone="bad" />
            </div>
          </>
        )}

        {job?.has_error_file && (
          <Alert>
            <AlertTriangleIcon />
            <AlertTitle>
              {job.failed === 1 ? "1 row wasn't" : `${job.failed} rows weren't`} imported
            </AlertTitle>
            <AlertDescription>
              Download them with the reason for each, fix them, and import that file again.
            </AlertDescription>
            <div className="col-start-2 pt-2">
              <Button
                variant="outline"
                size="sm"
                nativeButton={false}
                render={<a href={problemsUrl(job.id)} />}
              >
                <DownloadIcon />
                Rows with problems
              </Button>
            </div>
          </Alert>
        )}
      </CardContent>
      {finished && (
        <CardFooter>
          <Button onClick={onDone}>Import another file</Button>
        </CardFooter>
      )}
    </Card>
  );
}
