"use client";

import { memo, useEffect, useState } from "react";

import { VIEW_H, VIEW_W } from "./build";
import type { Feature, Layer } from "./types";

const LINE = "var(--blueprint-line)";
const FILL = { paper: "var(--blueprint-paper)", tint: "var(--blueprint-tint)", none: "none" } as const;

/** Order in which parts of the gym appear when the whole drawing is built at once. */
const FEATURE_RANK: Record<Feature, number> = {
  site: 0, sign: 1, shell: 2, stairs: 2, trees: 3, reception: 4, cells: 5, cardio: 6, weights: 7,
  machines: 8, functional: 9, studio: 10, lockers: 11, showers: 12, parking: 13, clock: 14,
  trainers: 15, dims: 16,
};

type LayerViewProps = { layer: Layer; delay: number; k: number };

function sameLayer(a: LayerViewProps, b: LayerViewProps) {
  const x = a.layer;
  const y = b.layer;
  return (
    a.delay === b.delay && a.k === b.k && x.d === y.d && x.fill === y.fill && x.width === y.width &&
    x.dash === y.dash && x.opacity === y.opacity && x.text?.value === y.text?.value &&
    x.text?.transform === y.text?.transform && x.text?.fontSize === y.text?.fontSize
  );
}

/** One layer. New layers settle into place and draw their lines in; edits to a layer don't replay. */
const LayerView = memo(function LayerView({ layer, delay, k }: LayerViewProps) {
  const solid = layer.dash === null;
  const style = { "--bp-delay": `${delay}ms` } as React.CSSProperties;
  return (
    <g className="bp-layer" style={style}>
      {layer.d && (
        <path
          d={layer.d}
          pathLength={solid ? 1 : undefined}
          className={solid ? "bp-draw" : undefined}
          fill={FILL[layer.fill]}
          stroke={LINE}
          strokeOpacity={layer.opacity}
          strokeWidth={layer.width * k}
          strokeDasharray={solid ? undefined : layer.dash ?? undefined}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      )}
      {layer.text && (
        <text
          transform={layer.text.transform}
          fontSize={layer.text.fontSize}
          textAnchor={layer.text.anchor}
          dominantBaseline="central"
          fill={LINE}
          className="font-mono font-medium"
          style={{ letterSpacing: "0.08em" }}
        >
          {layer.text.value}
        </text>
      )}
    </g>
  );
}, sameLayer);

type Props = {
  layers: readonly Layer[];
  /** Changes when the building's shape changes, so the drawing is redrafted from scratch. */
  structure: string;
  /** True during the first moments: parts appear in construction order instead of all at once. */
  assembling: boolean;
  /** Stroke width multiplier so lines stay crisp when the drawing is shown smaller. */
  k: number;
  /** Run the slow tracer line over the outline of the building. */
  tracer: boolean;
  pulse?: { feature: Feature; nonce: number };
};

type Snapshot = { structure: string; layers: readonly Layer[] };

const TRACED = /^(slab|back|left)@|^site$/;

/** The previous drawing, held still while it fades out under the new one. */
function Outgoing({ layers, k }: { layers: readonly Layer[]; k: number }) {
  return (
    <g className="bp-out">
      {layers.map((l) => (
        <g key={l.id}>
          {l.d && (
            <path
              d={l.d}
              fill={FILL[l.fill]}
              stroke={LINE}
              strokeOpacity={l.opacity}
              strokeWidth={l.width * k}
              strokeDasharray={l.dash ?? undefined}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
          {l.text && (
            <text
              transform={l.text.transform}
              fontSize={l.text.fontSize}
              textAnchor={l.text.anchor}
              dominantBaseline="central"
              fill={LINE}
              className="font-mono font-medium"
              style={{ letterSpacing: "0.08em" }}
            >
              {l.text.value}
            </text>
          )}
        </g>
      ))}
    </g>
  );
}

export function BlueprintSvg({ layers, structure, assembling, k, tracer, pulse }: Props) {
  // When the building changes shape, the old drawing fades out while the new one draws in.
  const [snap, setSnap] = useState<Snapshot>({ structure, layers });
  const [outgoing, setOutgoing] = useState<Snapshot | null>(null);
  if (snap.structure !== structure) {
    setOutgoing(snap);
    setSnap({ structure, layers });
  } else if (snap.layers !== layers) {
    setSnap({ structure, layers });
  }
  useEffect(() => {
    if (!outgoing) return;
    const t = window.setTimeout(() => setOutgoing(null), 450);
    return () => window.clearTimeout(t);
  }, [outgoing]);

  const redraft = outgoing !== null;
  const seen: Partial<Record<Feature, number>> = {};
  let tracerIndex = 0;
  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="absolute inset-0 size-full"
      aria-hidden="true"
      focusable="false"
    >
      {outgoing && <Outgoing layers={outgoing.layers} k={k} />}
      <g>
        {layers.map((layer) => {
          const n = (seen[layer.feature] = (seen[layer.feature] ?? -1) + 1);
          const within = Math.min(n * (assembling ? 20 : 12), assembling ? 420 : 160);
          const rank = FEATURE_RANK[layer.feature] * (assembling ? 90 : redraft ? 22 : 0);
          return <LayerView key={`${structure}:${layer.id}`} layer={layer} delay={rank + within} k={k} />;
        })}
      </g>
      {tracer && (
        <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round" opacity={0.7}>
          {layers
            .filter((l) => l.d && l.dash === null && TRACED.test(l.id))
            .map((l) => (
              <path
                key={`${structure}:t:${l.id}`}
                d={l.d}
                pathLength={1}
                strokeWidth={(l.width + 0.5) * k}
                className="bp-tracer"
                style={{ animationDelay: `${-(tracerIndex++ * 1.37).toFixed(2)}s` }}
              />
            ))}
        </g>
      )}
      {pulse && (
        <g fill="none" stroke="#fff" strokeLinecap="round" strokeLinejoin="round">
          {layers
            .filter((l) => l.feature === pulse.feature && l.d && l.dash === null)
            .map((l) => (
              <path
                key={`${pulse.nonce}:${l.id}`}
                d={l.d}
                pathLength={1}
                strokeWidth={(l.width + 0.9) * k}
                className="bp-pulse"
              />
            ))}
        </g>
      )}
    </svg>
  );
}
