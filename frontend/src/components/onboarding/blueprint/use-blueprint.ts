"use client";

import { useDeferredValue, useMemo } from "react";

import { buildBlueprint } from "./build";
import type { BlueprintInput, Layer } from "./types";

const MAX_TRAINERS_DRAWN = 6;
const SIGN_MAX_CHARS = 22;
const CACHE_SIZE = 8;
const cache = new Map<string, Layer[]>();

/** Same answers always give the same key, whatever order they were picked in. */
function specKey(i: BlueprintInput): string {
  return JSON.stringify([
    i.gymName.trim(),
    i.city.trim() ? 1 : 0,
    i.size,
    i.floors,
    i.staff == null ? null : Math.min(3, Math.max(1, i.staff)),
    [...i.zones].sort(),
    [...i.facilities].sort(),
    i.hours,
    i.trainers.slice(0, MAX_TRAINERS_DRAWN).map((t) => [t.name.trim(), t.speciality]),
  ]);
}

function layersFor(key: string, input: BlueprintInput): Layer[] {
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // most recently used goes last
    return hit;
  }
  const layers = buildBlueprint(input, { signMaxChars: SIGN_MAX_CHARS, detail: true });
  cache.set(key, layers);
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value as string);
  return layers;
}

/** Layers for the current answers. Typing in a field never blocks: the drawing catches up. */
export function useBlueprint(input: BlueprintInput): Layer[] {
  const deferred = useDeferredValue(input);
  const key = specKey(deferred);
  return useMemo(() => layersFor(key, deferred), [key, deferred]);
}

/** Changes of these answers move every wall, so the whole drawing is redrafted. */
export function structureKey(i: BlueprintInput): string {
  return [i.size ?? "-", i.floors ?? "-"].join("|");
}
