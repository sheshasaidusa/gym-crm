import type {
  BlueprintInput,
  BuildOptions,
  Feature,
  Fill,
  Layer,
  Size,
  Speciality,
  Zone,
} from "./types";

/*
 * Isometric line drawing of the gym, as an ordered list of layers (back to front).
 *
 * A pure function of the owner's answers: no randomness, no dates, no mutation of the input.
 * The arithmetic is a port of the original design prototype, so the geometry is checked against
 * it by scripts/blueprint-parity. Only erasable TypeScript is used here, so Node can load this
 * file directly for that check.
 */

export const VIEW_W = 840;
export const VIEW_H = 900;

export const ZONE_ORDER: readonly Zone[] = ["cardio", "weights", "machines", "functional", "studio"];

const C = 0.8660254;
const SIZES: Record<Size, readonly [number, number]> = {
  small: [9, 6],
  medium: [11, 7],
  large: [13, 8],
};

type V3 = readonly [number, number, number];
type Cell = { x: number; y: number; z: number; k: number; slot: number };
type Obj = { key: number; id: string; d: string; opts: Style };
type Style = {
  fill?: Fill;
  w?: number;
  dash?: string | null;
  op?: number;
  feature?: Feature;
};

const STAGE: Record<Feature, Layer["stage"]> = {
  site: 1,
  sign: 1,
  shell: 2,
  trees: 2,
  reception: 2,
  cells: 3,
  cardio: 3,
  weights: 3,
  machines: 3,
  functional: 3,
  studio: 3,
  lockers: 3,
  showers: 3,
  parking: 3,
  clock: 3,
  trainers: 4,
  dims: 5,
  stairs: 2,
};

export function buildBlueprint(input: BlueprintInput, options: BuildOptions = {}): Layer[] {
  const detail = options.detail === true;
  const size = input.size;
  const [W, D] = SIZES[size ?? "medium"];
  const F = input.floors ?? 1;
  const R = (W + D) * 0.5;
  const gap = R * 0.62 + 1.6;
  const wallH = 2.4;
  const park = input.facilities.includes("parking");
  const xmin = -1.8;
  // The detailed drawing always leaves room for the car park, so ticking it never rescales the picture.
  const xmax = W + (park || detail ? 5.4 : 1.6);
  const ymin = -1.8;
  const ymax = D + 1.8;
  const topU = (F - 1) * gap + wallH + 2.2;
  const wU = (xmax - ymin - (xmin - ymax)) * C;
  const hU = (xmax + ymax - (xmin + ymin)) * 0.5 + topU;
  const sc = Math.min(30, 740 / wU, 760 / hU);
  const minX = (xmin - ymax) * C;
  const maxX = (xmax - ymin) * C;
  const minY = (xmin + ymin) * 0.5 - topU;
  const maxY = (xmax + ymax) * 0.5;
  const ox = 420 - ((minX + maxX) / 2) * sc;
  const oy = 450 - ((minY + maxY) / 2) * sc;
  const n1 = (v: number) => v.toFixed(1);
  const P = (x: number, y: number, z: number): [number, number] => [
    ox + (x - y) * C * sc,
    oy + ((x + y) * 0.5 - z) * sc,
  ];
  const f = (q: readonly [number, number]) => n1(q[0]) + " " + n1(q[1]);
  const poly = (pts: readonly V3[]) => "M" + pts.map((q) => f(P(q[0], q[1], q[2]))).join("L") + "Z";
  const seg = (a: V3, b: V3) => "M" + f(P(a[0], a[1], a[2])) + "L" + f(P(b[0], b[1], b[2]));
  const box = (x: number, y: number, z: number, w: number, d: number, h: number) =>
    poly([
      [x, y, z + h],
      [x + w, y, z + h],
      [x + w, y + d, z + h],
      [x, y + d, z + h],
    ]) +
    poly([
      [x + w, y, z],
      [x + w, y + d, z],
      [x + w, y + d, z + h],
      [x + w, y, z + h],
    ]) +
    poly([
      [x, y + d, z],
      [x + w, y + d, z],
      [x + w, y + d, z + h],
      [x, y + d, z + h],
    ]);
  const wire = (x: number, y: number, z: number, w: number, d: number, h: number) => {
    const c: [number, number][] = [
      [x, y],
      [x + w, y],
      [x + w, y + d],
      [x, y + d],
    ];
    let out = "";
    for (let i = 0; i < 4; i++) {
      const a = c[i];
      const b = c[(i + 1) % 4];
      out +=
        seg([a[0], a[1], z], [b[0], b[1], z]) +
        seg([a[0], a[1], z + h], [b[0], b[1], z + h]) +
        seg([a[0], a[1], z], [a[0], a[1], z + h]);
    }
    return out;
  };
  const ring = (fn: (t: number) => V3, n = 28) => {
    const pts: V3[] = [];
    for (let i = 0; i < n; i++) pts.push(fn((i / n) * Math.PI * 2));
    return poly(pts);
  };
  const ringH = (cx: number, cy: number, z: number, r: number) =>
    ring((t) => [cx + r * Math.cos(t), cy + r * Math.sin(t), z]);
  const ringX = (x: number, cy: number, cz: number, r: number) =>
    ring((t) => [x, cy + r * Math.cos(t), cz + r * Math.sin(t)]);
  const ringY = (cx: number, y: number, cz: number, r: number) =>
    ring((t) => [cx + r * Math.cos(t), y, cz + r * Math.sin(t)]);
  const circ = (cx: number, cy: number, r: number) =>
    "M" +
    n1(cx - r) +
    " " +
    n1(cy) +
    "a" +
    n1(r) +
    " " +
    n1(r) +
    " 0 1 0 " +
    n1(2 * r) +
    " 0a" +
    n1(r) +
    " " +
    n1(r) +
    " 0 1 0 " +
    n1(-2 * r) +
    " 0";
  const figure = (x: number, y: number, z: number) => {
    const [fx, fy] = P(x, y, z);
    const u = sc;
    const r = 0.17 * u;
    const hy = fy - 1.57 * u;
    return (
      "M" + n1(fx - 0.09 * u) + " " + n1(fy) + "L" + n1(fx - 0.11 * u) + " " + n1(fy - 0.76 * u) +
      "M" + n1(fx + 0.09 * u) + " " + n1(fy) + "L" + n1(fx + 0.11 * u) + " " + n1(fy - 0.76 * u) +
      "M" + n1(fx - 0.2 * u) + " " + n1(fy - 0.74 * u) + "L" + n1(fx - 0.24 * u) + " " + n1(fy - 1.32 * u) +
      "L" + n1(fx + 0.24 * u) + " " + n1(fy - 1.32 * u) + "L" + n1(fx + 0.2 * u) + " " + n1(fy - 0.74 * u) + "Z" +
      circ(fx, hy, r)
    );
  };

  const layers: Layer[] = [];
  const ids = new Set<string>();
  const add = (id: string, feature: Feature, d: string, o: Style = {}, text: Layer["text"] = null) => {
    let unique = id;
    for (let n = 2; ids.has(unique); n++) unique = id + "#" + n;
    ids.add(unique);
    layers.push({
      id: unique,
      feature: o.feature ?? feature,
      stage: STAGE[o.feature ?? feature],
      d,
      fill: o.fill ?? "paper",
      width: (o.w ?? 1.25) * (detail ? 1.35 : 1),
      dash: o.dash ?? null,
      opacity: o.op ?? 1,
      text,
    });
  };
  const solidSize = !!size;
  const sw = detail ? { w: 1.5 } : {};
  const sz: Style = solidSize ? { fill: "tint", ...sw } : { fill: "tint", dash: "5 5", op: 0.7, ...sw };
  // Wall thickness; the plain drawing keeps the original thin walls.
  const t = detail ? 0.32 : 0.2;

  // Site, dimension lines, trees
  add("site", "site", poly([[xmin, ymin, -0.3], [xmax, ymin, -0.3], [xmax, ymax, -0.3], [xmin, ymax, -0.3]]), {
    fill: "none", dash: "2 6", w: 0.8, op: 0.55,
  });
  const topZ = (F - 1) * gap + wallH;
  let dims =
    seg([0, D + 1.1, -0.3], [W, D + 1.1, -0.3]) + seg([0, D + 0.2, -0.3], [0, D + 1.5, -0.3]) + seg([W, D + 0.2, -0.3], [W, D + 1.5, -0.3]) +
    seg([-0.2, D + 1.3, -0.3], [0.2, D + 0.9, -0.3]) + seg([W - 0.2, D + 1.3, -0.3], [W + 0.2, D + 0.9, -0.3]) +
    seg([-1.1, 0, -0.3], [-1.1, D, -0.3]) + seg([-0.2, 0, -0.3], [-1.5, 0, -0.3]) + seg([-0.2, D, -0.3], [-1.5, D, -0.3]) +
    seg([-1.3, -0.2, -0.3], [-0.9, 0.2, -0.3]) + seg([-1.3, D - 0.2, -0.3], [-0.9, D + 0.2, -0.3]) +
    seg([-1.1, D + 1.1, -0.3], [-1.1, D + 1.1, topZ]);
  for (let k = 0; k < F; k++) dims += seg([-1.3, D + 1.1, k * gap], [-0.9, D + 1.1, k * gap]);
  dims += seg([-1.3, D + 1.1, topZ], [-0.9, D + 1.1, topZ]);
  add("dims", "dims", dims, { fill: "none", w: 0.75, op: 0.8 });
  if (input.city.trim()) {
    [[W * 0.28, -1.0], [W * 0.62, -1.1]].forEach(([tx, ty], i) => {
      const [cx, cy] = P(tx, ty, 1.95);
      add("tree:" + i, "trees", seg([tx, ty, 0], [tx, ty, 1.15]) + circ(cx, cy, 0.8 * sc));
    });
  }

  // Where each zone goes: spread evenly over the floors, 3 x 2 cells per floor
  const gx0 = 1.3;
  const gx1 = W - 0.3;
  const gy0 = 0.5;
  // With detail on and several floors, keep a strip along the open front free for the stairs.
  const gy1 = D - 0.3 - (detail && F > 1 ? 1.1 : 0);
  const cw = (gx1 - gx0) / 3;
  const cd = (gy1 - gy0) / 2;
  const cellAt = (k: number, i: number): Cell => ({
    x: gx0 + (i % 3) * cw,
    y: gy0 + Math.floor(i / 3) * cd,
    z: k * gap,
    k,
    slot: i,
  });
  const sel = ZONE_ORDER.filter((id) => input.zones.includes(id));
  const q = Math.max(1, Math.ceil(sel.length / F));
  const slots = (k: number) => (k === 0 ? [0, 1, 2, 3, 4] : [0, 1, 2, 3, 4, 5]);
  const where: Partial<Record<Zone, Cell>> = {};
  const used: Record<number, string>[] = Array.from({ length: F }, () => ({}));
  for (let k = 0; k < F; k++) {
    sel.slice(k * q, (k + 1) * q).forEach((id, j) => {
      const slot = slots(k)[j];
      where[id] = cellAt(k, slot);
      used[k][slot] = id;
    });
  }
  const desk = cellAt(0, 5);

  // Per-floor objects, painted back to front by depth (x + y)
  const objsByFloor: Obj[][] = Array.from({ length: F }, () => []);
  const tags: { d: string; x: number; y: number; txt: string; id: string }[] = [];
  const put = (k: number, key: number, id: string, d: string, opts: Style = {}) =>
    objsByFloor[k].push({ key, id, d, opts });

  const zoneDraw: Record<Zone, (c: Cell) => void> = {
    cardio: (c) => {
      const n = Math.max(1, Math.min(3, Math.floor((cw - 0.2) / 1.3)));
      const tot = n * 0.9 + (n - 1) * 0.4;
      const ty = c.y + (cd - 1.9) / 2;
      for (let i = 0; i < n; i++) {
        const tx = c.x + (cw - tot) / 2 + i * 1.3;
        put(c.k, tx + ty + 1, `cardio@${c.k}.${c.slot}:deck${i}`, box(tx, ty, c.z, 0.9, 1.9, 0.22), { feature: "cardio" });
        put(
          c.k,
          tx + ty + 1.01,
          `cardio@${c.k}.${c.slot}:rail${i}`,
          seg([tx + 0.1, ty + 0.2, c.z + 0.22], [tx + 0.1, ty + 0.2, c.z + 1.2]) + seg([tx + 0.8, ty + 0.2, c.z + 0.22], [tx + 0.8, ty + 0.2, c.z + 1.2]) +
            seg([tx + 0.1, ty + 0.2, c.z + 0.95], [tx + 0.1, ty + 0.75, c.z + 0.95]) + seg([tx + 0.8, ty + 0.2, c.z + 0.95], [tx + 0.8, ty + 0.75, c.z + 0.95]) +
            box(tx + 0.02, ty + 0.06, c.z + 1.15, 0.86, 0.3, 0.16),
          { feature: "cardio" },
        );
      }
    },
    weights: (c) => {
      const id = `weights@${c.k}.${c.slot}`;
      const rx = c.x + 0.3;
      const ry = c.y + 0.25;
      put(c.k, rx + ry + 1, `${id}:rack`, wire(rx, ry, c.z, 1.4, 1.1, 2.3), { fill: "none", feature: "weights" });
      put(c.k, rx + ry + 1.2, `${id}:bar`, seg([rx - 0.25, ry + 0.75, c.z + 1.45], [rx + 1.65, ry + 0.75, c.z + 1.45]), { feature: "weights" });
      put(c.k, rx + ry + 1.3, `${id}:plateL`, ringX(rx + 0.0, ry + 0.75, c.z + 1.45, 0.42), { feature: "weights" });
      put(c.k, rx + ry + 1.31, `${id}:plateR`, ringX(rx + 1.45, ry + 0.75, c.z + 1.45, 0.42), { feature: "weights" });
      const bd = Math.max(0.7, Math.min(1.2, cd - 1.75));
      put(c.k, rx + ry + 2.5, `${id}:bench`, box(rx + 0.48, ry + 1.35, c.z, 0.45, bd, 0.42), { feature: "weights" });
      if (cw > 2.9) {
        const dx = c.x + cw - 0.9;
        let bells = box(dx, c.y + 0.3, c.z, 0.55, cd - 0.6, 0.6);
        for (let yy = c.y + 0.55; yy < c.y + cd - 0.5; yy += 0.45) bells += ringH(dx + 0.27, yy, c.z + 0.68, 0.12);
        put(c.k, dx + c.y + cd / 2, `${id}:rack2`, bells, { feature: "weights" });
      }
    },
    machines: (c) => {
      const id = `machines@${c.k}.${c.slot}`;
      const n = Math.max(1, Math.min(2, Math.floor((cw - 0.2) / 1.5)));
      for (let i = 0; i < n; i++) {
        const mx = c.x + 0.35 + i * 1.5;
        const my = c.y + 0.25;
        let tower = box(mx, my, c.z, 0.8, 0.5, 2.3);
        for (let zz = 0.35; zz < 1.5; zz += 0.16) tower += seg([mx + 0.22, my + 0.5, c.z + zz], [mx + 0.58, my + 0.5, c.z + zz]);
        put(c.k, mx + my + 0.5, `${id}:tower${i}`, tower, { feature: "machines" });
        put(c.k, mx + my + 0.6, `${id}:cable${i}`, seg([mx + 0.4, my + 0.5, c.z + 2.2], [mx + 0.4, my + 1.15, c.z + 1.1]), { feature: "machines" });
        put(c.k, mx + my + 1.4, `${id}:back${i}`, box(mx + 0.1, my + 1.0, c.z + 0.45, 0.6, 0.12, 0.85), { feature: "machines" });
        put(c.k, mx + my + 1.6, `${id}:seat${i}`, box(mx + 0.1, my + 1.1, c.z, 0.6, 0.75, 0.45), { feature: "machines" });
      }
    },
    functional: (c) => {
      const id = `functional@${c.k}.${c.slot}`;
      const td = Math.min(1.3, cd * 0.45);
      put(c.k, c.x + c.y, `${id}:turf`, poly([[c.x + 0.15, c.y + 0.25, c.z + 0.02], [c.x + cw - 0.15, c.y + 0.25, c.z + 0.02], [c.x + cw - 0.15, c.y + 0.25 + td, c.z + 0.02], [c.x + 0.15, c.y + 0.25 + td, c.z + 0.02]]), { feature: "functional" });
      put(c.k, c.x + c.y + 0.01, `${id}:lane`, seg([c.x + 0.4, c.y + 0.25 + td / 2, c.z + 0.02], [c.x + cw - 0.4, c.y + 0.25 + td / 2, c.z + 0.02]), { fill: "none", dash: "4 4", w: 0.8, feature: "functional" });
      const bx = c.x + 0.35;
      const by = c.y + cd - 1.15;
      put(c.k, bx + by + 1, `${id}:box1`, box(bx, by, c.z, 0.9, 0.8, 0.55), { feature: "functional" });
      put(c.k, bx + by + 1.1, `${id}:box2`, box(bx + 0.12, by + 0.1, c.z + 0.55, 0.66, 0.6, 0.4), { feature: "functional" });
      const tx = c.x + cw - 0.85;
      const ty = c.y + cd - 0.75;
      put(c.k, tx + ty, `${id}:tyre`, ringH(tx, ty, c.z, 0.52) + ringH(tx, ty, c.z + 0.28, 0.52), { feature: "functional" });
      put(c.k, tx + ty + 0.01, `${id}:tyreHole`, ringH(tx, ty, c.z + 0.28, 0.24), { fill: "none", feature: "functional" });
    },
    studio: (c) => {
      const id = `studio@${c.k}.${c.slot}`;
      const n = Math.max(1, Math.min(4, Math.floor((cw - 0.1) / 0.95)));
      const md = Math.min(1.8, cd - 0.8);
      for (let i = 0; i < n; i++) {
        const mx = c.x + 0.25 + i * 0.95;
        put(c.k, mx + c.y, `${id}:mat${i}`, box(mx, c.y + 0.3, c.z, 0.7, md, 0.05), { feature: "studio" });
      }
      const [bx, by] = P(c.x + cw - 0.5, c.y + cd - 0.45, c.z + 0.38);
      put(c.k, c.x + cw + c.y + cd, `${id}:ball`, circ(bx, by, 0.38 * sc) + ringH(c.x + cw - 0.5, c.y + cd - 0.45, c.z + 0.38, 0.38), { feature: "studio" });
    },
  };

  for (let k = 0; k < F; k++) {
    for (const i of slots(k)) {
      if (used[k][i]) continue;
      const c = cellAt(k, i);
      put(k, -100, `cell@${k}.${i}`, poly([[c.x + 0.15, c.y + 0.15, c.z + 0.01], [c.x + cw - 0.15, c.y + 0.15, c.z + 0.01], [c.x + cw - 0.15, c.y + cd - 0.15, c.z + 0.01], [c.x + 0.15, c.y + cd - 0.15, c.z + 0.01]]), { fill: "none", dash: "3 5", w: 0.75, op: 0.6, feature: "cells" });
    }
  }
  for (const id of sel) zoneDraw[id](where[id] as Cell);

  if (input.facilities.includes("lockers")) {
    const y0 = 0.6;
    const y1 = D / 2 - 0.15;
    let d = box(0.3, y0, 0, 0.55, y1 - y0, 1.9);
    for (let yy = y0 + 0.5; yy < y1 - 0.1; yy += 0.5) d += seg([0.85, yy, 0], [0.85, yy, 1.9]);
    put(0, 0.6 + (y0 + y1) / 2, "lockers", d, { feature: "lockers" });
  }
  if (input.facilities.includes("showers")) {
    for (let i = 0; i < 2; i++) {
      const sy = D / 2 + 0.15 + i * 1.0;
      if (sy + 0.9 > D - 0.2) break;
      put(0, 0.6 + sy + 0.4, `showers:${i}`, poly([[0.3, sy, 0.02], [1.1, sy, 0.02], [1.1, sy + 0.9, 0.02], [0.3, sy + 0.9, 0.02]]) + wire(0.3, sy, 0, 0.8, 0.9, 2.0) + seg([0.35, sy + 0.45, 1.9], [0.65, sy + 0.45, 1.75]), { fill: "none", feature: "showers" });
    }
  }

  if (input.staff != null) {
    const n = Math.max(1, Math.min(3, input.staff));
    for (let i = 0; i < n; i++) {
      const fx = desk.x + 0.6 + i * 0.75;
      const fy = desk.y + 0.45;
      put(0, fx + fy, `staff:${i}`, figure(fx, fy, 0), { feature: "reception" });
    }
    put(0, desk.x + desk.y + 1.6, "desk", box(desk.x + 0.3, desk.y + 0.95, 0, cw - 0.6, 0.5, 1.0), { feature: "reception" });
    put(0, desk.x + desk.y + 1.7, "monitor", box(desk.x + 0.7, desk.y + 0.98, 1.0, 0.45, 0.06, 0.4), { feature: "reception" });
  } else {
    put(0, -100, "cell@desk", poly([[desk.x + 0.15, desk.y + 0.15, 0.01], [desk.x + cw - 0.15, desk.y + 0.15, 0.01], [desk.x + cw - 0.15, desk.y + cd - 0.15, 0.01], [desk.x + 0.15, desk.y + cd - 0.15, 0.01]]), { fill: "none", dash: "3 5", w: 0.75, op: 0.6, feature: "cells" });
  }

  const perCell: Record<string, number> = {};
  input.trainers.slice(0, 6).forEach((t, i) => {
    const spec: Speciality = t.speciality;
    const c = (spec !== "general" ? where[spec] : undefined) ?? desk;
    const ck = c.k + ":" + c.x + ":" + c.y;
    const j = (perCell[ck] = (perCell[ck] ?? -1) + 1);
    const tx = c.x + 0.45 + (j % 3) * 0.8;
    const ty = c.y + cd - 0.3 - Math.floor(j / 3) * 0.6;
    put(c.k, tx + ty + 0.5, `trainer:${i}`, figure(tx, ty, c.z), { feature: "trainers" });
    const [hx, hy] = P(tx, ty, c.z + 1.95);
    const label = t.name.length > 14 ? t.name.slice(0, 13) + "…" : t.name;
    const tw = label.length * 7.4 + 6;
    tags.push({ id: `tag:${i}`, d: "M" + n1(hx) + " " + n1(hy) + "l14 -16h" + n1(tw), x: hx + 17, y: hy - 25, txt: label.toUpperCase() });
  });

  // Paint: floors bottom to top, parking after the ground floor
  for (let k = 0; k < F; k++) {
    const z0 = k * gap;
    if (k > 0) {
      let g = "";
      for (const [cx, cy] of [[0, D], [W, D], [W, 0]]) g += seg([cx, cy, z0 - gap + 0.01], [cx, cy, z0 - 0.3]);
      add(`post@${k}`, "shell", g, { fill: "none", dash: "3 5", w: 0.75, op: 0.7 });
    }
    add(`slab@${k}`, "shell", box(0, 0, z0 - 0.3, W, D, 0.3), sz);
    let back = box(0, 0, z0, W, t, wallH);
    const wx0 = k === 0 ? 2.6 : 1.3;
    const wx1 = k === 0 ? W - 2.6 : W - 0.8;
    for (let x = wx0; x + 1.2 <= wx1; x += 1.9) {
      back += poly([[x, t, z0 + 0.9], [x + 1.2, t, z0 + 0.9], [x + 1.2, t, z0 + 2.0], [x, t, z0 + 2.0]]) + seg([x + 0.6, t, z0 + 0.9], [x + 0.6, t, z0 + 2.0]);
    }
    if (k === 0) back += poly([[W - 2.0, t, 0], [W - 1.0, t, 0], [W - 1.0, t, 2.0], [W - 2.0, t, 2.0]]) + seg([W - 1.2, t, 0.95], [W - 1.2, t, 1.1]);
    add(`back@${k}`, "shell", back, sz);
    if (k === 0 && input.hours) {
      let clock = ringY(1.5, t, 1.55, 0.38) + seg([1.5, t, 1.55], [1.5, t, 1.82]) + seg([1.5, t, 1.55], [1.7, t, 1.45]);
      if (input.hours === "24_7") clock += ringY(1.5, t, 1.55, 0.48);
      add("clock", "clock", clock, { fill: "none" });
    }
    let left = box(0, 0, z0, t, D, wallH);
    for (let y = 1.3; y + 1.2 <= D - 0.6; y += 1.9) {
      if (k === 0 && (input.facilities.includes("lockers") || input.facilities.includes("showers"))) break;
      left += poly([[t, y, z0 + 0.9], [t, y + 1.2, z0 + 0.9], [t, y + 1.2, z0 + 2.0], [t, y, z0 + 2.0]]) + seg([t, y + 0.6, z0 + 0.9], [t, y + 0.6, z0 + 2.0]);
    }
    add(`left@${k}`, "shell", left, sz);

    if (k === F - 1) {
      const sx0 = W * 0.18;
      const sx1 = W * 0.82;
      const sz0 = z0 + wallH + 0.55;
      const sz1 = sz0 + 1.25;
      const raw = input.gymName.trim();
      const max = options.signMaxChars ?? Infinity;
      const name = (raw.length > max ? raw.slice(0, Math.max(1, max - 1)) + "…" : raw).toUpperCase();
      add("sign-posts", "sign", seg([W * 0.3, 0.1, z0 + wallH], [W * 0.3, 0.1, sz0]) + seg([W * 0.7, 0.1, z0 + wallH], [W * 0.7, 0.1, sz0]), { fill: "none" });
      add("sign", "sign", box(sx0, 0, sz0, sx1 - sx0, 0.18, sz1 - sz0), raw ? { fill: "tint" } : { fill: "tint", dash: "4 4", op: 0.7 });
      const [tx, ty] = P((sx0 + sx1) / 2, 0.18, (sz0 + sz1) / 2);
      const fs = Math.min(0.62 * sc, ((sx1 - sx0) * sc * 0.88) / (Math.max(5, name.length) * 0.68));
      add(
        "sign-text",
        "sign",
        "",
        {},
        name
          ? {
              value: name,
              transform: "matrix(" + C + " 0.5 0 1 " + n1(tx) + " " + n1(ty) + ")",
              fontSize: Number(n1(fs)),
              anchor: "middle",
            }
          : null,
      );
    }

    objsByFloor[k].sort((a, b) => a.key - b.key).forEach((ob) => add(ob.id, ob.opts.feature ?? "shell", ob.d, ob.opts));

    if (detail) {
      // Floor border: the line where the slab meets the walls.
      add(`floor@${k}`, "shell", poly([[t, t, z0 + 0.01], [W, t, z0 + 0.01], [W, D, z0 + 0.01], [t, D, z0 + 0.01]]), { fill: "none", w: 0.7, op: 0.45 });
      const last = k === F - 1;
      const colTop = last ? wallH : gap - 0.3;
      if (k > 0) {
        // Glass railing along the open edges of an upper floor.
        let rail = seg([0, D, z0 + 1.05], [W, D, z0 + 1.05]) + seg([W, D, z0 + 1.05], [W, 0, z0 + 1.05]);
        for (let x = 0.9; x < W - 0.3; x += 1.2) rail += seg([x, D, z0], [x, D, z0 + 1.05]);
        for (let y = D - 1.2; y > 0.3; y -= 1.2) rail += seg([W, y, z0], [W, y, z0 + 1.05]);
        add(`rail@${k}`, "shell", rail, { fill: "none", w: 0.9, op: 0.85 });
      } else {
        // Shop front: header and mullions along the two open sides, drawn lightly so the inside stays visible.
        let front = seg([0, D, wallH], [W, D, wallH]) + seg([W, D, wallH], [W, 0, wallH]);
        for (let x = 1.9; x < W - 0.3; x += 1.9) front += seg([x, D, 0], [x, D, wallH]);
        for (let y = D - 1.9; y > 0.3; y -= 1.9) front += seg([W, y, 0], [W, y, wallH]);
        add("storefront", "shell", front, { fill: "none", w: 0.7, op: 0.5 });
      }
      if (k < F - 1) {
        // Stair run along the open front up to the next floor, drawn over the room behind it.
        const steps = 12;
        const ya = D - 1.0;
        const yb = D - 0.2;
        const xs = 1.4;
        const xe = W - 0.9;
        const dx = (xe - xs) / steps;
        const dz = gap / steps;
        let st = "";
        for (let i = steps - 1; i >= 0; i--) {
          const xf = xs + i * dx;
          const top = (i + 1) * dz;
          st += poly([[xf, ya, z0 + top], [xf + dx, ya, z0 + top], [xf + dx, yb, z0 + top], [xf, yb, z0 + top]]);
        }
        add(`stairs@${k}`, "stairs", st, { fill: "tint", w: 1 });
        const side: V3[] = [[xs, yb, z0]];
        for (let i = 0; i < steps; i++) side.push([xs + i * dx, yb, z0 + (i + 1) * dz], [xs + (i + 1) * dx, yb, z0 + (i + 1) * dz]);
        side.push([xe, yb, z0]);
        let rails = seg([xs, yb, z0 + 1.0], [xe, yb, z0 + gap + 1.0]);
        for (let i = 0; i < steps; i += 3) rails += seg([xs + i * dx, yb, z0 + (i + 1) * dz], [xs + i * dx, yb, z0 + (i + 1) * dz + 1.0]);
        add(`stringer@${k}`, "stairs", poly(side) + rails, { fill: "none", w: 0.9 });
      }
      // Columns tie the floors together; drawn last so they stand in front of the room.
      for (const [cx, cy] of [[W - 0.3, 0], [0, D - 0.3], [W - 0.3, D - 0.3]]) {
        add(`col@${k}:${cx}:${cy}`, "shell", box(cx, cy, z0 - 0.3, 0.3, 0.3, colTop + 0.3), { fill: "tint", w: 1.2 });
      }
    }

    if (k === 0 && park) {
      const px0 = W + 1.3;
      const px1 = W + 4.9;
      let lot = poly([[px0, 0.3, 0], [px1, 0.3, 0], [px1, D - 0.3, 0], [px0, D - 0.3, 0]]);
      for (let y = 0.3 + 2.0; y < D - 0.6; y += 2.0) lot += seg([px0, y, 0], [px1, y, 0]);
      add("lot", "parking", lot, { fill: "none", dash: "4 4", w: 0.8 });
      const cars = Math.min(2, Math.floor((D - 0.6) / 2.0));
      for (let i = 0; i < cars; i++) {
        const cx = px0 + 0.5;
        const cy = 0.3 + i * 2.0 + 0.35;
        add(`car:${i}:body`, "parking", box(cx, cy, 0.15, 2.6, 1.3, 0.5) + ringX(cx + 2.6, cy + 0.3, 0.25, 0.01));
        add(`car:${i}:cabin`, "parking", box(cx + 0.65, cy + 0.12, 0.65, 1.25, 1.06, 0.42));
        add(`car:${i}:wheels`, "parking", ringY(cx + 0.55, cy + 1.3, 0.25, 0.25) + ringY(cx + 2.05, cy + 1.3, 0.25, 0.25));
      }
    }
  }

  tags.forEach((t) =>
    add(t.id, "trainers", t.d, { fill: "none", w: 0.75 }, { value: t.txt, transform: "translate(" + n1(t.x) + " " + n1(t.y) + ")", fontSize: 11, anchor: "start" }),
  );
  return layers;
}
