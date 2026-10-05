import type { BlueprintInput } from "./types";

const ZONE_LABEL = {
  cardio: "cardio",
  weights: "free weights",
  machines: "machines",
  functional: "functional training",
  studio: "yoga studio",
} as const;
const FACILITY_LABEL = { lockers: "lockers", showers: "showers", parking: "parking" } as const;
const HOURS_LABEL = { standard: "6 am to 10 pm", early: "5 am to 11 pm", "24_7": "open 24 hours" } as const;

const list = (items: string[]) =>
  items.length < 2 ? items.join("") : items.slice(0, -1).join(", ") + " and " + items[items.length - 1];

/** Words for people who can't see the drawing. */
export function describeBlueprint(i: BlueprintInput): { label: string; description: string } {
  const name = i.gymName.trim();
  const parts: string[] = [];
  if (i.size || i.floors) {
    parts.push(
      `A ${i.size ?? "medium"} building${i.floors ? ` with ${i.floors} floor${i.floors > 1 ? "s" : ""}` : ""}`,
    );
  }
  if (i.city.trim()) parts.push(`in ${i.city.trim()}`);
  if (i.zones.length) parts.push(`with ${list(i.zones.map((z) => ZONE_LABEL[z]))} areas`);
  if (i.facilities.length) parts.push(`and ${list(i.facilities.map((f) => FACILITY_LABEL[f]))}`);
  if (i.hours) parts.push(`, ${HOURS_LABEL[i.hours]}`);
  if (i.staff) parts.push(`. ${i.staff} staff`);
  if (i.trainers.length) parts.push(`. Trainers: ${list(i.trainers.map((t) => t.name))}`);
  return {
    label: name ? `Blueprint of ${name}` : "Blueprint of your gym",
    description: parts.length
      ? parts.join(" ").replace(/ \./g, ".").replace(/ ,/g, ",") + "."
      : "The drawing is empty. It fills in as you answer.",
  };
}
