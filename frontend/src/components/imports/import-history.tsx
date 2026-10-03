"use client";

import { DownloadIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ENTITY_META, problemsUrl, useImports, type ImportJob } from "@/lib/import-queries";

function statusBadge(job: ImportJob) {
  switch (job.status) {
    case "done":
      return <Badge variant="outline">Done</Badge>;
    case "failed":
      return <Badge variant="destructive">Stopped</Badge>;
    case "running":
      return <Badge>Importing</Badge>;
    default:
      return <Badge variant="secondary">Not imported</Badge>;
  }
}

function when(iso: string) {
  return new Date(iso).toLocaleString("en-IN", {
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

function summary(job: ImportJob) {
  if (job.status !== "done" && job.status !== "failed") {
    return `${job.total_rows.toLocaleString()} rows`;
  }
  const parts = [`${job.created} added`];
  if (job.updated) parts.push(`${job.updated} updated`);
  if (job.skipped) parts.push(`${job.skipped} skipped`);
  if (job.failed) parts.push(`${job.failed} problems`);
  return parts.join(" · ");
}

export function ImportHistory() {
  const imports = useImports();
  const jobs = imports.data ?? [];

  if (imports.isPending) return <Skeleton className="h-32 w-full" />;
  if (jobs.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Recent imports</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Result</TableHead>
                <TableHead>When</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {jobs.map((job) => (
                <TableRow key={job.id}>
                  <TableCell className="max-w-56 truncate font-medium">{job.filename}</TableCell>
                  <TableCell>{ENTITY_META[job.entity].label}</TableCell>
                  <TableCell>{statusBadge(job)}</TableCell>
                  <TableCell className="text-muted-foreground">{summary(job)}</TableCell>
                  <TableCell className="text-muted-foreground">{when(job.created_at)}</TableCell>
                  <TableCell>
                    {job.has_error_file && (
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Download rows with problems"
                        title="Download rows with problems"
                        nativeButton={false}
                        render={<a href={problemsUrl(job.id)} />}
                      >
                        <DownloadIcon />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </CardContent>
    </Card>
  );
}
