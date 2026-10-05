// Checks the TypeScript drawing generator against the frozen original prototype.
//   npm run test:blueprint
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";

import { buildBlueprint, VIEW_H, VIEW_W } from "../../src/components/onboarding/blueprint/build.ts";

const Reference = createRequire(import.meta.url)("./reference-build.cjs");
const ref = new Reference();

const ZONES = ["cardio", "weights", "machines", "functional", "studio"];
const FACILITIES = ["lockers", "showers", "parking"];
const SPECS = [...ZONES, "general"];
const subsets = (items) => items.reduce((acc, it) => acc.concat(acc.map((s) => [...s, it])), [[]]);

// Our input -> the prototype's state (it names hours '24' and trainers' speciality 'spec').
const toRef = (i) => ({
  gymName: i.gymName, city: i.city, size: i.size, floors: i.floors, staff: i.staff,
  zones: [...i.zones], facilities: [...i.facilities], hours: i.hours === "24_7" ? "24" : i.hours,
  // People who aren't trainers stand at reception, which the prototype does for "general".
  trainers: i.trainers.map((t) => ({ name: t.name, spec: t.role && t.role !== "trainer" ? "general" : t.speciality })),
});

// The prototype draws the clock inside the front-wall path; we draw it as its own layer so it can
// animate on its own. Fold it back for the comparison.
function foldClock(layers) {
  const out = [];
  for (const l of layers) {
    if (l.id === "clock") out[out.length - 1] = { ...out[out.length - 1], d: out[out.length - 1].d + l.d };
    else out.push(l);
  }
  return out;
}

function compare(input, label) {
  const mine = foldClock(buildBlueprint(input));
  const theirs = ref.build(toRef(input), "ink");
  assert.equal(mine.length, theirs.length, `${label}: layer count ${mine.length} vs ${theirs.length}`);
  mine.forEach((m, i) => {
    const t = theirs[i];
    const where = `${label} layer ${i} (${m.id})`;
    assert.equal(m.d, t.d, `${where}: path differs`);
    assert.equal(m.fill === "none", t.fill === "none", `${where}: fill`);
    assert.equal(m.width, t.w, `${where}: width`);
    assert.equal(m.dash ?? "none", t.dash, `${where}: dash`);
    assert.equal(m.opacity, t.op, `${where}: opacity`);
    if (t.txt) {
      assert.ok(m.text, `${where}: missing text`);
      assert.equal(m.text.value, t.txt, `${where}: text`);
      assert.equal(m.text.transform, t.tf, `${where}: text transform`);
      assert.equal(m.text.fontSize, Number(t.fs), `${where}: font size`);
      assert.equal(m.text.anchor, t.anchor, `${where}: anchor`);
    } else assert.equal(m.text, null, `${where}: unexpected text`);
  });
}

// Layer sanity that holds for any input.
function invariants(input, label, options = {}) {
  const frozen = structuredClone(input);
  const a = buildBlueprint(input, options);
  assert.deepEqual(input, frozen, `${label}: input was mutated`);
  assert.deepEqual(buildBlueprint(input, options), a, `${label}: not deterministic`);
  const ids = new Set();
  for (const l of a) {
    assert.ok(!ids.has(l.id), `${label}: duplicate id ${l.id}`);
    ids.add(l.id);
    assert.ok(!/NaN|Infinity|undefined/.test(l.d), `${label}: bad number in ${l.id}`);
    for (const [x, y] of [...l.d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => [Number(m[1]), Number(m[2])])) {
      if (!l.d.includes("a") && !l.d.includes("l")) {
        assert.ok(x > -80 && x < VIEW_W + 80 && y > -80 && y < VIEW_H + 80, `${label}: ${l.id} point ${x},${y} outside the sheet`);
      }
    }
  }
}

const base = { gymName: "", city: "", size: null, floors: null, staff: null, zones: [], facilities: [], hours: null, trainers: [] };
let count = 0;
const run = (input, label) => {
  compare(input, label);
  invariants(input, label);
  invariants(input, label + " (detail)", { detail: true, signMaxChars: 22 });
  count++;
};

// 1. Exhaustive over the structural choices.
for (const size of [null, "small", "medium", "large"])
  for (const floors of [null, 1, 2, 3])
    for (const zones of subsets(ZONES))
      for (const facilities of subsets(FACILITIES))
        run({ ...base, size, floors, zones, facilities }, `exhaustive ${size}/${floors}/${zones}/${facilities}`);

// 2. Seeded random over everything, including names and trainers.
let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const pick = (xs) => xs[Math.floor(rnd() * xs.length)];
const NAMES = ["", "Iron Temple", "A", "FitZone 24/7", "Ünï Çode Gym", "X".repeat(40), "Muscle Factory Pune"];
const TRAINER_NAMES = ["Aarav", "Meera", "Kabir", "Li", "Zoë", "Priyanka"];
for (let n = 0; n < 5000; n++) {
  const input = {
    gymName: pick(NAMES), city: pick(["", "Pune", "Koregaon Park, Pune"]),
    size: pick([null, "small", "medium", "large"]), floors: pick([null, 1, 2, 3]),
    staff: pick([null, 1, 2, 3, 6, 40]), zones: ZONES.filter(() => rnd() < 0.5),
    facilities: FACILITIES.filter(() => rnd() < 0.5), hours: pick([null, "standard", "early", "24_7"]),
    trainers: Array.from({ length: Math.floor(rnd() * 9) }, () => ({ name: pick(TRAINER_NAMES), speciality: pick(SPECS), ...(rnd() < 0.3 ? { role: pick(["trainer", "manager", "front_desk"]) } : {}) })),
  };
  run(input, `random #${n}`);
}

// 3. Limits the app adds on top of the prototype.
const long = buildBlueprint({ ...base, gymName: "X".repeat(40), floors: 2, trainers: [{ name: "Bartholomew-Alexander", speciality: "cardio" }] }, { signMaxChars: 22 });
assert.ok(long.find((l) => l.id === "sign-text").text.value.length <= 22, "sign name not capped");
assert.ok(long.find((l) => l.id === "tag:0").text.value.length <= 14, "trainer tag not capped");

// 4. Speed.
const heavy = { ...base, gymName: "Iron Temple", city: "Pune", size: "large", floors: 3, staff: 3, zones: ZONES, facilities: FACILITIES, hours: "24_7",
  trainers: Array.from({ length: 6 }, (_, i) => ({ name: "T" + i, speciality: SPECS[i] })) };
const t0 = performance.now();
for (let i = 0; i < 200; i++) buildBlueprint(heavy);
const per = (performance.now() - t0) / 200;
assert.ok(per < 5, `build took ${per.toFixed(2)} ms`);

console.log(`blueprint parity OK: ${count} states match the prototype (detailed drawing checked too); build ${per.toFixed(2)} ms (heaviest state)`);
