"use client";

import { RotateCcwIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { SimpleSelect } from "@/components/simple-select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardFooter } from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { useCan } from "@/lib/queries";
import {
  previewTemplate,
  useReminderSettings,
  useUpdateReminderSettings,
  type ReminderKind,
  type ReminderSettings as Settings,
  type ReminderTemplate,
} from "@/lib/reminder-queries";
import { cn } from "@/lib/utils";

const OFFSET_CHOICES = [14, 7, 3, 1, 0, -1, -3, -7];

const KINDS: { kind: ReminderKind; title: string; description: string }[] = [
  { kind: "before", title: "Before it ends", description: "Sent on each “before” day you picked." },
  { kind: "on_day", title: "On the last day", description: "Sent on the membership's end date." },
  { kind: "after", title: "After it ends", description: "Win-back message after expiry." },
];

function offsetLabel(days: number) {
  if (days === 0) return "On expiry day";
  const n = Math.abs(days);
  return `${n} day${n === 1 ? "" : "s"} ${days > 0 ? "before" : "after"}`;
}

function hourLabel(h: number) {
  const suffix = h < 12 ? "AM" : "PM";
  return `${h % 12 === 0 ? 12 : h % 12}:00 ${suffix}`;
}

function TemplateEditor({
  kind,
  title,
  description,
  value,
  onChange,
  customized,
  onReset,
  placeholders,
  readOnly,
}: {
  kind: ReminderKind;
  title: string;
  description: string;
  value: ReminderTemplate;
  onChange: (t: ReminderTemplate) => void;
  customized: boolean;
  onReset: () => void;
  placeholders: Record<string, string>;
  readOnly: boolean;
}) {
  const bodyRef = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState<ReminderTemplate | null>(null);

  useEffect(() => {
    if (!value.subject.trim() || !value.body.trim()) return;
    const t = setTimeout(() => {
      previewTemplate(kind, value).then(setPreview, () => setPreview(null));
    }, 400);
    return () => clearTimeout(t);
  }, [kind, value]);

  const insert = (key: string) => {
    const el = bodyRef.current;
    const token = `{${key}}`;
    if (!el) return onChange({ ...value, body: value.body + token });
    const start = el.selectionStart ?? value.body.length;
    const end = el.selectionEnd ?? start;
    onChange({ ...value, body: value.body.slice(0, start) + token + value.body.slice(end) });
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <div className="grid gap-4">
      <div className="flex min-h-8 items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {description}
          {customized && <Badge variant="secondary" className="ml-2">Custom</Badge>}
        </p>
        {!readOnly && customized && (
          <Button variant="ghost" size="sm" onClick={onReset}>
            <RotateCcwIcon />
            Use default
          </Button>
        )}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor={`${kind}-subject`}>Email subject</FieldLabel>
            <Input
              id={`${kind}-subject`}
              value={value.subject}
              maxLength={200}
              disabled={readOnly}
              onChange={(e) => onChange({ ...value, subject: e.target.value })}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor={`${kind}-body`}>Message</FieldLabel>
            <Textarea
              id={`${kind}-body`}
              ref={bodyRef}
              rows={7}
              maxLength={3000}
              disabled={readOnly}
              value={value.body}
              onChange={(e) => onChange({ ...value, body: e.target.value })}
            />
            {!readOnly && (
              <div className="flex flex-wrap gap-1">
                {Object.entries(placeholders).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    title={label}
                    onClick={() => insert(key)}
                    className="rounded-md border border-dashed px-1.5 py-0.5 font-mono text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
                  >
                    {`{${key}}`}
                  </button>
                ))}
              </div>
            )}
            <FieldDescription>Used for both email and WhatsApp.</FieldDescription>
          </Field>
        </FieldGroup>
        <div className="grid content-start gap-2">
          <span className="text-xs tracking-wide text-muted-foreground uppercase">Preview · {title}</span>
          <div className="rounded-2xl border border-border/70 bg-background p-4 text-sm">
            {preview ? (
              <>
                <div className="mb-2 font-medium">{preview.subject}</div>
                <p className="whitespace-pre-line text-muted-foreground">{preview.body}</p>
              </>
            ) : (
              <Skeleton className="h-32 w-full" />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function SettingsForm({ initial }: { initial: Settings }) {
  const can = useCan();
  const readOnly = !can.own;
  const save = useUpdateReminderSettings();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [hour, setHour] = useState(initial.hour);
  const [offsets, setOffsets] = useState(initial.offsets);
  const [templates, setTemplates] = useState(initial.templates);
  // Kinds the owner wants reset to the default text on save.
  const [resets, setResets] = useState<Set<ReminderKind>>(new Set());

  const changedTemplates = KINDS.filter(
    ({ kind }) =>
      templates[kind].subject !== initial.templates[kind].subject ||
      templates[kind].body !== initial.templates[kind].body,
  );
  const dirty =
    enabled !== initial.enabled ||
    hour !== initial.hour ||
    offsets.join() !== initial.offsets.join() ||
    changedTemplates.length > 0 ||
    resets.size > 0;
  const invalid = KINDS.some(({ kind }) => !templates[kind].subject.trim() || !templates[kind].body.trim());

  const submit = () => {
    const body: Record<string, ReminderTemplate | null> = {};
    for (const { kind } of changedTemplates) body[kind] = templates[kind];
    for (const kind of resets) body[kind] = null;
    save.mutate({
      enabled,
      hour,
      offsets,
      templates: Object.keys(body).length ? body : undefined,
    });
  };

  return (
    <div className="grid gap-8">
      <section aria-labelledby="schedule" className="grid gap-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id="schedule" className="font-medium">Automatic reminders</h2>
            <p className="text-sm text-muted-foreground">
              {readOnly
                ? "Only the gym owner can change reminder settings."
                : "Members with an email get reminders automatically. Everyone shows up on the Due today list for WhatsApp."}
            </p>
          </div>
          <Switch
            aria-label="Send reminders automatically"
            checked={enabled}
            disabled={readOnly}
            onCheckedChange={setEnabled}
          />
        </div>
        <div className="grid gap-5 md:grid-cols-[1fr_220px]">
          <Field>
            <FieldLabel>When to remind</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {OFFSET_CHOICES.map((d) => {
                const on = offsets.includes(d);
                return (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={on}
                    disabled={readOnly}
                    onClick={() =>
                      setOffsets((on ? offsets.filter((o) => o !== d) : [...offsets, d]).sort((a, b) => b - a))
                    }
                    className={cn(
                      "rounded-full border px-3 py-1 text-sm transition-colors disabled:opacity-60",
                      on ? "border-primary bg-primary text-primary-foreground" : "hover:bg-muted",
                    )}
                  >
                    {offsetLabel(d)}
                  </button>
                );
              })}
            </div>
            <FieldDescription>Relative to the day the membership ends.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="send-hour">Send emails from</FieldLabel>
            <SimpleSelect
              id="send-hour"
              disabled={readOnly}
              options={Array.from({ length: 17 }, (_, i) => i + 6).map((h) => ({
                value: String(h),
                label: hourLabel(h),
              }))}
              value={String(hour)}
              onChange={(v) => setHour(Number(v))}
            />
            <FieldDescription>In your gym&apos;s time zone.</FieldDescription>
          </Field>
        </div>
      </section>

      <section aria-labelledby="messages" className="grid gap-4">
        <h2 id="messages" className="font-medium">Messages</h2>
        <Tabs defaultValue="before" className="gap-5">
          <TabsList variant="line" className="w-full justify-start overflow-x-auto border-b border-border">
            {KINDS.map(({ kind, title }) => (
              <TabsTrigger key={kind} value={kind} className="flex-none px-4">
                {title}
                {(changedTemplates.some((k) => k.kind === kind) || resets.has(kind)) && (
                  <span aria-label="unsaved changes" className="size-1.5 rounded-full bg-primary" />
                )}
              </TabsTrigger>
            ))}
          </TabsList>
          {KINDS.map(({ kind, title, description }) => (
            <TabsContent key={kind} value={kind} keepMounted>
              <TemplateEditor
                kind={kind}
                title={title}
                description={description}
                value={templates[kind]}
                onChange={(t) => {
                  setTemplates({ ...templates, [kind]: t });
                  setResets((r) => {
                    const next = new Set(r);
                    next.delete(kind);
                    return next;
                  });
                }}
                customized={initial.customized.includes(kind) && !resets.has(kind)}
                onReset={() => setResets((r) => new Set(r).add(kind))}
                placeholders={initial.placeholders}
                readOnly={readOnly}
              />
            </TabsContent>
          ))}
        </Tabs>
      </section>

      {!readOnly && (
        <Card className="sticky bottom-4 z-10 py-3 shadow-lg">
          <CardFooter className="justify-between gap-2">
            <span className="text-sm text-muted-foreground">
              {dirty ? "You have unsaved changes" : "All changes saved"}
            </span>
            <Button onClick={submit} disabled={!dirty || invalid || save.isPending}>
              {save.isPending && <Spinner />}
              Save settings
            </Button>
          </CardFooter>
        </Card>
      )}
    </div>
  );
}

export function ReminderSettingsPanel() {
  const settings = useReminderSettings();
  if (settings.isPending) return <Skeleton className="h-96 w-full rounded-xl" />;
  if (settings.isError) return <p className="text-sm text-destructive">{settings.error.message}</p>;
  // Re-mount the form whenever saved settings change so local state starts fresh.
  return <SettingsForm key={JSON.stringify(settings.data)} initial={settings.data} />;
}
