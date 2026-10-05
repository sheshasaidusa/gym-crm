/** Ids shared with the API (`GymProfile`), so a saved profile feeds the drawing directly. */
export type Size = "small" | "medium" | "large";
export type Zone = "cardio" | "weights" | "machines" | "functional" | "studio";
export type Facility = "lockers" | "showers" | "parking";
export type Hours = "standard" | "early" | "24_7";
export type Speciality = Zone | "general";

export type BlueprintTrainer = { name: string; speciality: Speciality };

/** Everything the drawing depends on. Unanswered questions are null / empty. */
export type BlueprintInput = {
  gymName: string;
  city: string;
  size: Size | null;
  floors: 1 | 2 | 3 | null;
  staff: number | null;
  zones: readonly Zone[];
  facilities: readonly Facility[];
  hours: Hours | null;
  trainers: readonly BlueprintTrainer[];
};

/** Which part of the gym a layer belongs to; drives reveal order and the "just changed" pulse. */
export type Feature =
  | "site"
  | "sign"
  | "shell"
  | "stairs"
  | "trees"
  | "reception"
  | "cells"
  | Zone
  | "lockers"
  | "showers"
  | "parking"
  | "clock"
  | "trainers"
  | "dims";

/** Opaque fills hide the lines behind them; they use the sheet colours, never a fixed grey. */
export type Fill = "paper" | "tint" | "none";

export type LayerText = {
  value: string;
  transform: string;
  fontSize: number;
  anchor: "start" | "middle";
};

export type Layer = {
  /** Stable across renders while the layer's meaning is unchanged (used as the React key). */
  id: string;
  feature: Feature;
  /** Construction stage 1..5: the wizard step at which this part of the drawing appears. */
  stage: 1 | 2 | 3 | 4 | 5;
  d: string;
  fill: Fill;
  width: number;
  dash: string | null;
  opacity: number;
  text: LayerText | null;
};

export type BuildOptions = {
  /** Longest gym name drawn on the sign (longer names are cut with an ellipsis). */
  signMaxChars?: number;
  /** Draftsman's detail: heavier lines, thick walls, columns, railings, stairs, shop front. */
  detail?: boolean;
};
