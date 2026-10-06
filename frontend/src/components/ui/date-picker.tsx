"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarIcon } from "lucide-react";
import { cn } from "cn";

import { Calendar } from "@/components/ui/calendar";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

// Values stay "yyyy-mm-dd" strings, like <input type="date">, parsed as local dates so they never shift a day.
function parseIso(value?: string) {
  if (!value) return undefined;
  const [y, m, d] = value.split("-").map(Number);
  return y && m && d ? new Date(y, m - 1, d) : undefined;
}

type DatePickerProps = {
  id?: string;
  value?: string;
  onChange: (value: string) => void;
  min?: string;
  max?: string;
  className?: string;
  "aria-label"?: string;
  "aria-invalid"?: boolean;
};

/** A typeable date field (the browser's own dd-mm-yyyy input) with a calendar button on the right. */
export function DatePicker({ id, value, onChange, min, max, className, ...aria }: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const fieldRef = React.useRef<HTMLDivElement>(null);
  const selected = parseIso(value);
  const minDate = parseIso(min);
  const maxDate = parseIso(max);
  const year = new Date().getFullYear();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <div ref={fieldRef} className={cn("relative w-full", className)}>
        <Input
          id={id}
          type="date"
          min={min}
          max={max}
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          // Hide the browser's own picker; the calendar button replaces it.
          className="pr-9 [&::-webkit-calendar-picker-indicator]:hidden"
          {...aria}
        />
        <PopoverTrigger
          aria-label="Open calendar"
          className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring"
        >
          <CalendarIcon className="size-4" />
        </PopoverTrigger>
      </div>
      <PopoverContent anchor={fieldRef} align="start" className="w-(--anchor-width) min-w-64 p-0">
        <Calendar
          mode="single"
          captionLayout="dropdown"
          className="w-full"
          classNames={{ root: "rdp-root w-full" }}
          selected={selected}
          defaultMonth={selected ?? maxDate}
          startMonth={minDate ?? new Date(year - 100, 0)}
          endMonth={maxDate ?? new Date(year + 10, 11)}
          disabled={[...(minDate ? [{ before: minDate }] : []), ...(maxDate ? [{ after: maxDate }] : [])]}
          onSelect={(date) => {
            if (!date) return;
            onChange(format(date, "yyyy-MM-dd"));
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}
