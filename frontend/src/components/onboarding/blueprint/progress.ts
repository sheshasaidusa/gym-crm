import type { BlueprintInput } from "./types";

export type Answers = {
  input: BlueprintInput;
  ownerName: string;
  emailValid: boolean;
  passwordValid: boolean;
  /** Steps the owner has moved past (their answers count even when left empty). */
  passedEquipment: boolean;
  passedTrainers: boolean;
};

/** Share of the 12 questions answered, 0..1. Drives the "DRAWING 42%" label. */
export function computeProgress(a: Answers): number {
  const i = a.input;
  const answered = [
    i.gymName.trim(),
    a.ownerName.trim(),
    a.emailValid,
    a.passwordValid,
    i.city.trim(),
    i.size,
    i.floors,
    i.staff != null,
    i.zones.length > 0 || a.passedEquipment,
    i.facilities.length > 0 || a.passedEquipment,
    i.hours || a.passedEquipment,
    i.trainers.length > 0 || a.passedTrainers,
  ];
  return answered.filter(Boolean).length / answered.length;
}
