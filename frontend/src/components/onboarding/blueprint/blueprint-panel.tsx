"use client";

import { useEffect, useRef, useState } from "react";

import { cn } from "@/lib/utils";

import { BlueprintSvg } from "./blueprint-svg";
import { describeBlueprint } from "./describe";
import type { BlueprintInput, Feature } from "./types";
import { structureKey, useBlueprint } from "./use-blueprint";

const SHEET = "radial-gradient(120% 95% at 50% 46%, var(--blueprint-paper) 35%, var(--blueprint-edge) 100%)";

type Props = {
  input: BlueprintInput;
  /** 0..1, how much of the questionnaire is answered. */
  progress: number;
  /** Set when an answer changes; the matching part of the drawing flashes a line along itself. */
  pulse?: { feature: Feature; nonce: number };
  className?: string;
};

/** The right-hand side of onboarding: the gym drawn on blueprint paper as the owner answers. */
export function BlueprintPanel({ input, progress, pulse, className }: Props) {
  const layers = useBlueprint(input);
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(VIEW_WIDTH_FALLBACK);
  const [ready, setReady] = useState(false);
  const [assembling, setAssembling] = useState(true);
  const { label, description } = describeBlueprint(input);

  useEffect(() => {
    setReady(true);
    const t = window.setTimeout(() => setAssembling(false), 3500);
    return () => window.clearTimeout(t);
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pct = Math.round(progress * 100);
  const done = progress >= 1;
  // The drawing is 840 wide; shown smaller its lines would turn hairline, so thicken them.
  const k = Math.min(1.7, Math.max(1, 840 / Math.max(width, 1)));

  return (
    <div
      ref={ref}
      role="img"
      aria-label={label}
      aria-describedby="blueprint-description"
      className={cn("relative isolate overflow-hidden", className)}
      style={{ background: SHEET }}
    >
      <p id="blueprint-description" className="sr-only">
        {description}
      </p>
      <div aria-hidden className="bp-grid absolute inset-0" />
      {ready && (
        <BlueprintSvg
          layers={layers}
          structure={structureKey(input)}
          assembling={assembling}
          k={k}
          tracer={!done}
          pulse={pulse}
        />
      )}
      <span
        aria-hidden
        className="absolute bottom-6 left-7 font-mono text-[11px] tracking-[0.08em] text-[var(--blueprint-line-dim)] tabular-nums"
      >
        {done ? "COMPLETE" : `DRAWING ${pct}%`}
      </span>
    </div>
  );
}

const VIEW_WIDTH_FALLBACK = 840;
