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

/** In the detailed drawing these keep a firm line; everything inside the building is drawn lighter. */
const STRUCTURE = new Set<Feature>(["shell", "sign", "site", "dims"]);

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
  equipment: 3,
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
  // The detailed drawing centres the building itself (the car park hangs off to the side);
  // the plain drawing centres the whole site, as the original design did.
  const cMinX = detail ? (-1.8 - ymax) * C : minX;
  const cMaxX = detail ? (W + 1.6 - ymin) * C : maxX;
  const cMaxY = detail ? (W + 1.6 + ymax) * 0.5 : maxY;
  const ox = 420 - ((cMinX + cMaxX) / 2) * sc;
  const oy = 450 - ((minY + cMaxY) / 2) * sc;
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

  /** A standing person (detailed drawing): head, shoulders, arms and legs, filled so it hides what's behind. */
  const person = (x: number, y: number, z: number) => {
    const [fx, fy] = P(x, y, z);
    const u = sc;
    const pt = (dx: number, dy: number) => n1(fx + dx * u) + " " + n1(fy - dy * u);
    return (
      "M" + pt(-0.14, 0.86) + "L" + pt(-0.13, 0.03) + "L" + pt(-0.03, 0.03) + "L" + pt(-0.01, 0.74) +
      "L" + pt(0.01, 0.74) + "L" + pt(0.03, 0.03) + "L" + pt(0.13, 0.03) + "L" + pt(0.14, 0.86) + "Z" +
      "M" + pt(-0.15, 0.84) + "L" + pt(-0.2, 1.3) + "Q" + pt(-0.2, 1.41) + " " + pt(-0.09, 1.42) +
      "L" + pt(0.09, 1.42) + "Q" + pt(0.2, 1.41) + " " + pt(0.2, 1.3) + "L" + pt(0.15, 0.84) + "Z" +
      "M" + pt(-0.19, 1.34) + "L" + pt(-0.26, 0.9) + "L" + pt(-0.2, 0.88) + "L" + pt(-0.15, 1.18) + "Z" +
      "M" + pt(0.19, 1.34) + "L" + pt(0.26, 0.9) + "L" + pt(0.2, 0.88) + "L" + pt(0.15, 1.18) + "Z" +
      "M" + pt(0, 1.42) + "L" + pt(0, 1.48) +
      circ(fx, fy - 1.6 * u, 0.13 * u)
    );
  };
  const human = (x: number, y: number, z: number) => (detail ? person(x, y, z) : figure(x, y, z));
  /** A thin upright (frame tube) from z0, h tall. */
  const post = (x: number, y: number, z0: number, h: number, s = 0.08) => box(x - s / 2, y - s / 2, z0, s, s, h);

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
      width: (o.w ?? 1.25) * (detail ? (STRUCTURE.has(o.feature ?? feature) ? 1.05 : 0.66) : 1),
      dash: o.dash ?? null,
      opacity: o.op ?? 1,
      text,
    });
  };
  const solidSize = !!size;
  const sw = {};
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

  // Detailed equipment. Each piece is a few filled boxes and tubes, painted back to front.
  const S = (feature: Feature): Style => ({ feature });
  const L = (feature: Feature): Style => ({ feature, fill: "none" });
  type Piece = (k: number, z: number, x: number, y: number, id: string, ft: Feature) => void;
  const treadmill: Piece = (k, z, x, y, id, ft) => {
    put(k, x + y + 0.1, `${id}:deck`, box(x, y, z, 0.85, 1.9, 0.16), S(ft));
    put(k, x + y + 0.15, `${id}:belt`, seg([x + 0.13, y + 0.4, z + 0.17], [x + 0.13, y + 1.85, z + 0.17]) + seg([x + 0.72, y + 0.4, z + 0.17], [x + 0.72, y + 1.85, z + 0.17]), L(ft));
    put(k, x + y + 0.2, `${id}:frame`, post(x + 0.07, y + 0.22, z + 0.16, 1.0) + post(x + 0.78, y + 0.22, z + 0.16, 1.0), S(ft));
    put(k, x + y + 0.3, `${id}:console`, box(x + 0.02, y + 0.06, z + 1.12, 0.81, 0.3, 0.14) + seg([x + 0.07, y + 0.25, z + 0.98], [x + 0.07, y + 0.8, z + 0.95]) + seg([x + 0.78, y + 0.25, z + 0.98], [x + 0.78, y + 0.8, z + 0.95]), S(ft));
  };
  const bike: Piece = (k, z, x, y, id, ft) => {
    put(k, x + y + 0.1, `${id}:base`, box(x + 0.1, y + 0.1, z, 0.3, 1.05, 0.06), S(ft));
    put(k, x + y + 0.2, `${id}:wheel`, ringX(x + 0.25, y + 0.32, z + 0.38, 0.24) + ringX(x + 0.25, y + 0.32, z + 0.38, 0.08), S(ft));
    put(k, x + y + 0.3, `${id}:frame`, seg([x + 0.25, y + 0.32, z + 0.38], [x + 0.25, y + 0.85, z + 0.9]) + seg([x + 0.25, y + 0.32, z + 0.38], [x + 0.25, y + 0.2, z + 1.05]) + seg([x + 0.05, y + 0.18, z + 1.08], [x + 0.45, y + 0.18, z + 1.08]), L(ft));
    put(k, x + y + 0.4, `${id}:seat`, box(x + 0.15, y + 0.75, z + 0.9, 0.2, 0.3, 0.06), S(ft));
  };
  const flatBench = (k: number, z: number, x: number, y: number, id: string, ft: Feature, len = 1.15) => {
    put(k, x + y + 0.2, `${id}:legs`, post(x + 0.18, y + 0.15, z, 0.38) + post(x + 0.18, y + len - 0.15, z, 0.38), S(ft));
    put(k, x + y + 0.3, `${id}:pad`, box(x, y, z + 0.38, 0.36, len, 0.1), S(ft));
  };
  const dumbbellRack = (k: number, z: number, x: number, y: number, len: number, id: string, ft: Feature) => {
    let bells = "";
    for (let cx = x + 0.15; cx < x + len - 0.08; cx += 0.28) {
      bells += ringY(cx, y + 0.08, z + 0.62, 0.09) + seg([cx, y + 0.08, z + 0.62], [cx, y + 0.42, z + 0.62]) + ringY(cx, y + 0.42, z + 0.62, 0.09);
    }
    put(k, x + y + 0.2, `${id}:frame`, box(x, y, z, len, 0.5, 0.5), S(ft));
    put(k, x + y + 0.3, `${id}:bells`, bells, S(ft));
  };
  const powerRack: Piece = (k, z, x, y, id, ft) => {
    put(k, x + y + 0.1, `${id}:backPosts`, post(x + 0.05, y + 0.05, z, 2.2) + post(x + 1.25, y + 0.05, z, 2.2), S(ft));
    put(k, x + y + 0.15, `${id}:top`, seg([x + 0.05, y + 0.05, z + 2.2], [x + 1.25, y + 0.05, z + 2.2]) + seg([x + 0.05, y + 1.15, z + 2.2], [x + 1.25, y + 1.15, z + 2.2]) + seg([x + 0.05, y + 0.05, z + 2.2], [x + 0.05, y + 1.15, z + 2.2]) + seg([x + 1.25, y + 0.05, z + 2.2], [x + 1.25, y + 1.15, z + 2.2]), L(ft));
    flatBench(k, z, x + 0.47, y + 0.35, `${id}:bench`, ft, 1.25);
    put(k, x + y + 1.3, `${id}:bar`, seg([x - 0.35, y + 0.6, z + 1.35], [x + 1.65, y + 0.6, z + 1.35]), S(ft));
    put(k, x + y + 1.4, `${id}:plates`, ringX(x - 0.18, y + 0.6, z + 1.35, 0.36) + ringX(x - 0.08, y + 0.6, z + 1.35, 0.28) + ringX(x + 1.38, y + 0.6, z + 1.35, 0.28) + ringX(x + 1.48, y + 0.6, z + 1.35, 0.36), S(ft));
    put(k, x + y + 2.5, `${id}:frontPosts`, post(x + 0.05, y + 1.15, z, 2.2) + post(x + 1.25, y + 1.15, z, 2.2), S(ft));
  };
  const stackLines = (x: number, y: number, z: number, w: number, z0: number, z1: number) => {
    let d = "";
    for (let zz = z0; zz < z1; zz += 0.13) d += seg([x, y, z + zz], [x + w, y, z + zz]);
    return d;
  };
  const chestPress: Piece = (k, z, x, y, id, ft) => {
    put(k, x + y + 0.05, `${id}:base`, box(x + 0.05, y, z, 0.8, 1.2, 0.05), S(ft));
    put(k, x + y + 0.1, `${id}:stack`, box(x + 0.15, y, z, 0.6, 0.3, 1.8) + stackLines(x + 0.2, y + 0.3, z, 0.5, 0.3, 1.2), S(ft));
    put(k, x + y + 0.2, `${id}:arms`, seg([x + 0.06, y + 0.3, z + 1.6], [x + 0.06, y + 0.95, z + 1.0]) + seg([x + 0.84, y + 0.3, z + 1.6], [x + 0.84, y + 0.95, z + 1.0]) + seg([x + 0.06, y + 0.95, z + 1.0], [x + 0.22, y + 0.95, z + 1.0]) + seg([x + 0.84, y + 0.95, z + 1.0], [x + 0.68, y + 0.95, z + 1.0]), L(ft));
    put(k, x + y + 0.3, `${id}:back`, box(x + 0.25, y + 0.55, z + 0.5, 0.4, 0.1, 0.7), S(ft));
    put(k, x + y + 0.4, `${id}:seat`, post(x + 0.45, y + 0.85, z, 0.42) + box(x + 0.25, y + 0.65, z + 0.42, 0.4, 0.4, 0.08), S(ft));
  };
  const latPulldown: Piece = (k, z, x, y, id, ft) => {
    put(k, x + y + 0.05, `${id}:base`, box(x + 0.1, y, z, 0.8, 1.25, 0.05), S(ft));
    put(k, x + y + 0.1, `${id}:stack`, box(x + 0.3, y + 0.05, z, 0.4, 0.25, 1.5) + stackLines(x + 0.34, y + 0.3, z, 0.32, 0.25, 1.1), S(ft));
    put(k, x + y + 0.15, `${id}:frame`, post(x + 0.15, y + 0.15, z, 2.3) + post(x + 0.85, y + 0.15, z, 2.3) + box(x + 0.1, y + 0.1, z + 2.25, 0.8, 0.1, 0.08), S(ft));
    put(k, x + y + 0.2, `${id}:bar`, seg([x + 0.5, y + 0.15, z + 2.25], [x + 0.5, y + 0.75, z + 1.9]) + seg([x - 0.02, y + 0.75, z + 1.9], [x + 1.02, y + 0.75, z + 1.9]) + seg([x - 0.02, y + 0.75, z + 1.9], [x - 0.08, y + 0.75, z + 1.75]) + seg([x + 1.02, y + 0.75, z + 1.9], [x + 1.08, y + 0.75, z + 1.75]), L(ft));
    put(k, x + y + 0.3, `${id}:knee`, box(x + 0.3, y + 0.85, z + 0.62, 0.4, 0.12, 0.1), S(ft));
    put(k, x + y + 0.4, `${id}:seat`, post(x + 0.5, y + 1.1, z, 0.42) + box(x + 0.32, y + 0.95, z + 0.42, 0.36, 0.3, 0.08), S(ft));
  };
  const legPress: Piece = (k, z, x, y, id, ft) => {
    put(k, x + y + 0.05, `${id}:base`, box(x + 0.05, y, z, 0.8, 1.85, 0.1), S(ft));
    put(k, x + y + 0.1, `${id}:rails`, seg([x + 0.2, y + 1.3, z + 0.5], [x + 0.2, y + 0.15, z + 1.45]) + seg([x + 0.7, y + 1.3, z + 0.5], [x + 0.7, y + 0.15, z + 1.45]), L(ft));
    put(k, x + y + 0.2, `${id}:sled`, poly([[x + 0.12, y + 0.28, z + 0.95], [x + 0.78, y + 0.28, z + 0.95], [x + 0.78, y + 0.55, z + 1.55], [x + 0.12, y + 0.55, z + 1.55]]) + ringX(x + 0.06, y + 0.42, z + 1.25, 0.2) + ringX(x + 0.84, y + 0.42, z + 1.25, 0.2), S(ft));
    put(k, x + y + 0.3, `${id}:seat`, box(x + 0.2, y + 1.3, z + 0.1, 0.5, 0.45, 0.32) + poly([[x + 0.2, y + 1.72, z + 0.42], [x + 0.7, y + 1.72, z + 0.42], [x + 0.7, y + 1.9, z + 1.1], [x + 0.2, y + 1.9, z + 1.1]]), S(ft));
  };
  const crossover = (k: number, z: number, x: number, y: number, w: number, id: string, ft: Feature) => {
    put(k, x + y + 0.1, `${id}:stacks`, box(x, y, z, 0.45, 0.35, 2.2) + stackLines(x + 0.05, y + 0.35, z, 0.35, 0.3, 1.3) + box(x + w - 0.45, y, z, 0.45, 0.35, 2.2) + stackLines(x + w - 0.4, y + 0.35, z, 0.35, 0.3, 1.3), S(ft));
    put(k, x + y + 0.15, `${id}:beam`, box(x, y, z + 2.2, w, 0.35, 0.1), S(ft));
    put(k, x + y + 0.2, `${id}:cables`, seg([x + 0.22, y + 0.35, z + 2.05], [x + 0.6, y + 1.05, z + 1.25]) + seg([x + w - 0.22, y + 0.35, z + 2.05], [x + w - 0.6, y + 1.05, z + 1.25]) + ringY(x + 0.6, y + 1.05, z + 1.2, 0.05) + ringY(x + w - 0.6, y + 1.05, z + 1.2, 0.05), L(ft));
  };
  const lockerBank = (k: number, z: number, x: number, y: number, w: number, id: string, ft: Feature) => {
    let doors = "";
    for (let xx = x + 0.42; xx < x + w - 0.05; xx += 0.42) doors += seg([xx, y + 0.5, z], [xx, y + 0.5, z + 1.9]);
    for (let xx = x + 0.3; xx < x + w; xx += 0.42) doors += seg([xx, y + 0.5, z + 1.0], [xx, y + 0.5, z + 1.12]);
    doors += seg([x, y + 0.5, z + 0.95], [x + w, y + 0.5, z + 0.95]);
    put(k, x + y + 0.1, `${id}:bank`, box(x, y, z, w, 0.5, 1.9) + doors, S(ft));
    put(k, x + y + 1.0, `${id}:bench`, post(x + 0.4, y + 1.05, z, 0.38) + post(x + w - 0.4, y + 1.05, z, 0.38) + box(x + 0.25, y + 0.9, z + 0.38, w - 0.5, 0.32, 0.08), S(ft));
  };
  const showerRow = (k: number, z: number, x: number, y: number, w: number, d: number, id: string, ft: Feature) => {
    // Cubicles drawn as glass outlines so the room behind stays readable.
    const n = Math.max(2, Math.min(3, Math.floor(w / 0.85)));
    const cw2 = w / n;
    const h = 1.9;
    let frame = poly([[x, y, z], [x + w, y, z], [x + w, y, z + h], [x, y, z + h]]);
    for (let i = 0; i <= n; i++) frame += poly([[x + i * cw2, y, z], [x + i * cw2, y + d, z], [x + i * cw2, y + d, z + h], [x + i * cw2, y, z + h]]);
    let fixtures = "";
    for (let i = 0; i < n; i++) {
      const hx = x + (i + 0.5) * cw2;
      fixtures += seg([hx, y, z + 1.8], [hx, y + 0.28, z + 1.72]) + ringH(hx, y + 0.3, z + 1.7, 0.08) +
        poly([[x + i * cw2 + 0.08, y + 0.08, z + 0.02], [x + (i + 1) * cw2 - 0.08, y + 0.08, z + 0.02], [x + (i + 1) * cw2 - 0.08, y + d - 0.08, z + 0.02], [x + i * cw2 + 0.08, y + d - 0.08, z + 0.02]]) +
        ringH(hx, y + d / 2, z + 0.03, 0.06);
    }
    put(k, x + y + 0.1, `${id}:fixtures`, fixtures, L(ft));
    put(k, x + y + 0.2, `${id}:glass`, frame, { feature: ft, fill: "none", op: 0.75 });
    put(k, x + y + d, `${id}:doors`, seg([x, y + d, z + h], [x + w, y + d, z + h]), { feature: ft, fill: "none", dash: "4 4", op: 0.7 });
  };

  const zoneDetail: Record<Zone, (c: Cell) => void> = {
    cardio: (c) => {
      const id = `cardio@${c.k}.${c.slot}`;
      const n = Math.max(1, Math.min(3, Math.floor((cw - 0.3) / 1.15)));
      const y = c.y + Math.max(0.2, (cd - 1.9) / 2);
      const x0 = c.x + (cw - (n * 1.15 - 0.3)) / 2;
      for (let i = 0; i < n; i++) treadmill(c.k, c.z, x0 + i * 1.15, y, `${id}:tread${i}`, "cardio");
      if (cw - n * 1.15 > 0.6) bike(c.k, c.z, x0 + n * 1.15, y + 0.4, `${id}:bike`, "cardio");
    },
    weights: (c) => {
      const id = `weights@${c.k}.${c.slot}`;
      powerRack(c.k, c.z, c.x + 0.45, c.y + 0.25, `${id}:rack`, "weights");
      const len = Math.min(1.7, cw - 2.2);
      if (len >= 0.8) dumbbellRack(c.k, c.z, c.x + 2.0, c.y + 0.3, len, `${id}:dumbbells`, "weights");
      if (len >= 0.8 && cd > 2.6) flatBench(c.k, c.z, c.x + 2.2, c.y + 1.2, `${id}:bench2`, "weights", Math.min(1.15, cd - 1.4));
    },
    machines: (c) => {
      const id = `machines@${c.k}.${c.slot}`;
      const w = Math.min(cw - 0.4, 2.6);
      crossover(c.k, c.z, c.x + (cw - w) / 2, c.y + 0.2, w, `${id}:cross`, "machines");
      if (cd > 2.8) chestPress(c.k, c.z, c.x + (cw - 0.9) / 2, c.y + 1.5, `${id}:press`, "machines");
    },
    functional: zoneDraw.functional,
    studio: zoneDraw.studio,
  };

  // Machines that fill the rest of the floor so a gym never looks empty. Picked by position,
  // so the same cell always gets the same machines.
  const FILLERS: [Piece, number][][] = [
    [[chestPress, 0.9], [latPulldown, 1.0]],
    [[legPress, 0.9], [chestPress, 0.9]],
    [[latPulldown, 1.0], [legPress, 0.9]],
  ];
  const fillCell = (c: Cell, n: number) => {
    const id = `equip@${c.k}.${c.slot}`;
    if (n % 4 === 3) {
      const len = Math.min(1.9, cw - 0.6);
      dumbbellRack(c.k, c.z, c.x + (cw - len) / 2, c.y + 0.25, len, `${id}:dumbbells`, "equipment");
      flatBench(c.k, c.z, c.x + cw / 2 - 0.55, c.y + 1.05, `${id}:bench1`, "equipment", Math.min(1.15, cd - 1.3));
      flatBench(c.k, c.z, c.x + cw / 2 + 0.2, c.y + 1.05, `${id}:bench2`, "equipment", Math.min(1.15, cd - 1.3));
      return;
    }
    const pair = FILLERS[n % FILLERS.length];
    const total = pair[0][1] + pair[1][1] + 0.35;
    const fit = total <= cw - 0.3 ? pair : pair.slice(0, 1);
    let x = c.x + (cw - (fit.length === 2 ? total : fit[0][1])) / 2;
    fit.forEach(([piece, w], i) => {
      piece(c.k, c.z, x, c.y + 0.25, `${id}:m${i}`, "equipment");
      x += w + 0.35;
    });
  };

  // Lockers and showers take over ground-floor cells (replacing default machines) in the detailed drawing.
  const facilityCell: Partial<Record<"lockers" | "showers", Cell>> = {};
  const furnished = detail && (size !== null || input.floors !== null);
  if (detail) {
    const free = slots(0).filter((i) => !used[0][i]);
    const prefer = (want: number[]) => want.find((i) => free.includes(i)) ?? free[0];
    for (const fac of ["lockers", "showers"] as const) {
      if (!input.facilities.includes(fac)) continue;
      const slot = prefer(fac === "lockers" ? [0, 3, 1, 4, 2] : [3, 0, 4, 1, 2]);
      if (slot === undefined) continue;
      facilityCell[fac] = cellAt(0, slot);
      used[0][slot] = fac;
      free.splice(free.indexOf(slot), 1);
    }
  }

  for (let k = 0; k < F; k++) {
    for (const i of slots(k)) {
      if (used[k][i]) continue;
      if (furnished) {
        fillCell(cellAt(k, i), k * 6 + i);
        continue;
      }
      const c = cellAt(k, i);
      put(k, -100, `cell@${k}.${i}`, poly([[c.x + 0.15, c.y + 0.15, c.z + 0.01], [c.x + cw - 0.15, c.y + 0.15, c.z + 0.01], [c.x + cw - 0.15, c.y + cd - 0.15, c.z + 0.01], [c.x + 0.15, c.y + cd - 0.15, c.z + 0.01]]), { fill: "none", dash: "3 5", w: 0.75, op: 0.6, feature: "cells" });
    }
  }
  for (const id of sel) (detail ? zoneDetail : zoneDraw)[id](where[id] as Cell);

  const lockerCell = facilityCell.lockers;
  const showerCell = facilityCell.showers;
  if (lockerCell) lockerBank(0, 0, lockerCell.x + 0.25, lockerCell.y + 0.25, cw - 0.5, "lockers", "lockers");
  if (showerCell) showerRow(0, 0, showerCell.x + 0.25, showerCell.y + 0.25, cw - 0.5, Math.min(1.3, cd - 0.5), "showers", "showers");

  if (input.facilities.includes("lockers") && !lockerCell) {
    const y0 = 0.6;
    const y1 = D / 2 - 0.15;
    let d = box(0.3, y0, 0, 0.55, y1 - y0, 1.9);
    for (let yy = y0 + 0.5; yy < y1 - 0.1; yy += 0.5) d += seg([0.85, yy, 0], [0.85, yy, 1.9]);
    put(0, 0.6 + (y0 + y1) / 2, "lockers", d, { feature: "lockers" });
  }
  if (input.facilities.includes("showers") && !showerCell) {
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
      put(0, fx + fy, `staff:${i}`, human(fx, fy, 0), { feature: "reception" });
    }
    put(0, desk.x + desk.y + 1.6, "desk", box(desk.x + 0.3, desk.y + 0.95, 0, cw - 0.6, 0.5, 1.0), { feature: "reception" });
    put(0, desk.x + desk.y + 1.7, "monitor", box(desk.x + 0.7, desk.y + 0.98, 1.0, 0.45, 0.06, 0.4), { feature: "reception" });
  } else {
    put(0, -100, "cell@desk", poly([[desk.x + 0.15, desk.y + 0.15, 0.01], [desk.x + cw - 0.15, desk.y + 0.15, 0.01], [desk.x + cw - 0.15, desk.y + cd - 0.15, 0.01], [desk.x + 0.15, desk.y + cd - 0.15, 0.01]]), { fill: "none", dash: "3 5", w: 0.75, op: 0.6, feature: "cells" });
  }

  const perCell: Record<string, number> = {};
  input.trainers.slice(0, 6).forEach((t, i) => {
    const spec: Speciality = t.speciality;
    const atDesk = t.role !== undefined && t.role !== "trainer";
    const c = (spec !== "general" && !atDesk ? where[spec] : undefined) ?? desk;
    const ck = c.k + ":" + c.x + ":" + c.y;
    const j = (perCell[ck] = (perCell[ck] ?? -1) + 1);
    const tx = c.x + 0.45 + (j % 3) * 0.8;
    const ty = c.y + cd - 0.3 - Math.floor(j / 3) * 0.6;
    put(c.k, tx + ty + 0.5, `trainer:${i}`, human(tx, ty, c.z), { feature: "trainers" });
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
      if (k === 0 && ((input.facilities.includes("lockers") && !lockerCell) || (input.facilities.includes("showers") && !showerCell))) break;
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
        // A straight stair along the open front, rising over the first two bays so the reception
        // corner stays clear. Treads only, with a light stringer and handrail.
        const steps = 11;
        const ya = D - 0.95;
        const yb = D - 0.25;
        const xs = 1.5;
        const xe = Math.min(1.3 + 2 * cw, W - 1.2);
        const dx = (xe - xs) / steps;
        const dz = gap / steps;
        let st = "";
        for (let i = steps - 1; i >= 0; i--) {
          const xf = xs + i * dx;
          const top = (i + 1) * dz;
          st += poly([[xf, ya, z0 + top], [xf + dx, ya, z0 + top], [xf + dx, yb, z0 + top], [xf, yb, z0 + top]]);
        }
        add(`stairs@${k}`, "stairs", st, { fill: "tint", w: 1 });
        let rails = seg([xs, yb, z0], [xe, yb, z0 + gap]) + seg([xs, yb, z0 + 1.0], [xe, yb, z0 + gap + 1.0]);
        for (let i = 0; i <= steps; i += 2) rails += seg([xs + i * dx, yb, z0 + i * dz], [xs + i * dx, yb, z0 + i * dz + 1.0]);
        add(`stringer@${k}`, "stairs", rails, { fill: "none", w: 0.9 });
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
