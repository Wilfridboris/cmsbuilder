/**
 * Scheza Bot animation engine.
 * Pure functions only: no React, no DOM. Safe to unit test and to run on the server.
 */

export type EyeType = 'dot' | 'wide' | 'happy' | 'closed' | 'x' | 'heart';
export type EyeVariant = EyeType | 'blink';
export type Ease = 'io' | 'in' | 'out' | 'lin' | 'back';

/** Every value the rig can animate. */
export interface Pose {
  /** Vertical offset of the whole bot (negative = up). */
  y: number;
  /** Squash and stretch, scaled from the feet. */
  sx: number;
  sy: number;
  /** Head tilt in degrees. */
  rot: number;
  /** Tuft rotation in degrees (on top of the physics spring). */
  tuft: number;
  /** Where the eyes look. */
  lx: number;
  ly: number;
  /** Eye openness, 0 = closed, 1 = open. */
  op: number;
  /** Eye scale. */
  es: number;
  eL: EyeType;
  /** Right eye type. null = same as left. */
  eR: EyeType | null;
  /** Beak size, beak openness, beak vertical offset. */
  bs: number;
  bo: number;
  by: number;
  /** Brow angle. 0 = no brows. */
  br: number;
  /** Effects strength (sparkles, "!", "?"...). */
  f: number;
  /** Body lean: top moves sideways, feet stay planted. */
  L: number;
  /** Body sag: positive = droop, negative = puff up. */
  G: number;
}

export const REST: Readonly<Pose> = {
  y: 0, sx: 1, sy: 1, rot: 0, tuft: 0, lx: 0, ly: 0, op: 1, es: 1,
  eL: 'dot', eR: null, bs: 1, bo: 0, by: 0, br: 0, f: 0, L: 0, G: 0,
};

const NUM = ['y', 'sx', 'sy', 'rot', 'tuft', 'lx', 'ly', 'op', 'es', 'bs', 'bo', 'by', 'br', 'f', 'L', 'G'] as const;

export type KeyDef = readonly [t: number, pose: Partial<Pose>, ease?: Ease];
export interface Key {
  t: number;
  pose: Pose;
  ease: Ease;
}

const TAU = Math.PI * 2;

/** Turns sparse keyframes into full poses. Values carry forward until changed. */
export function buildKeys(defs: readonly KeyDef[]): Key[] {
  let cur: Pose = { ...REST };
  const keys: Key[] = defs.map(([t, p, e]) => {
    cur = { ...cur, ...p };
    return { t, pose: cur, ease: e ?? 'io' };
  });
  if (keys.length === 0) keys.push({ t: 0, pose: { ...REST }, ease: 'io' });
  if (keys[keys.length - 1].t < 1) keys.push({ t: 1, pose: { ...keys[0].pose }, ease: 'io' });
  return keys;
}

export function ease(u: number, e: Ease): number {
  switch (e) {
    case 'lin':
      return u;
    case 'in':
      return u * u * u;
    case 'out':
      return 1 - Math.pow(1 - u, 3);
    case 'back': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      return 1 + c3 * Math.pow(u - 1, 3) + c1 * Math.pow(u - 1, 2);
    }
    default:
      return 0.5 - 0.5 * Math.cos(Math.PI * u);
  }
}

export function copyPose(out: Pose, src: Readonly<Pose>): Pose {
  for (const k of NUM) out[k] = src[k];
  out.eL = src.eL;
  out.eR = src.eR;
  return out;
}

/** Writes the pose at time t (0..1) into `out`. No allocation. */
export function sampleInto(out: Pose, keys: readonly Key[], t: number): Pose {
  let i = 0;
  while (i < keys.length - 2 && t >= keys[i + 1].t) i++;
  const a = keys[i];
  const b = keys[i + 1] ?? a;
  const span = b.t - a.t;
  const u = span > 0 ? Math.min(1, Math.max(0, (t - a.t) / span)) : 0;
  const k = ease(u, b.ease);
  for (const n of NUM) out[n] = a.pose[n] + (b.pose[n] - a.pose[n]) * k;
  out.eL = a.pose.eL;
  out.eR = a.pose.eR;
  return out;
}

/** Blends from pose `a` to pose `b`. `out` may be the same object as `b`. */
export function blendInto(out: Pose, a: Readonly<Pose>, b: Readonly<Pose>, u: number): Pose {
  const k = 1 - Math.pow(1 - Math.min(1, Math.max(0, u)), 3);
  for (const n of NUM) out[n] = a[n] + (b[n] - a[n]) * k;
  out.eL = u < 0.5 ? a.eL : b.eL;
  out.eR = u < 0.5 ? a.eR : b.eR;
  return out;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r3 = (n: number) => Math.round(n * 1000) / 1000;

/** Smooth closed body outline that can lean (L) and sag or puff (G). */
export function bodyPath(L: number, G: number): string {
  const n = 16;
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    let x = Math.cos(a) * 40;
    let y = 4 + Math.sin(a) * 35;
    if (y < 4) {
      y = 4 + (y - 4) * (1 - G * 0.1);
      x *= 1 - G * 0.02;
    } else {
      x *= 1 + G * 0.05 * ((y - 4) / 35);
    }
    x += (L * (39 - y)) / 70;
    xs.push(x);
    ys.push(y);
  }
  let d = `M${r2(xs[0])},${r2(ys[0])}`;
  for (let i = 0; i < n; i++) {
    const i0 = (i - 1 + n) % n;
    const i2 = (i + 1) % n;
    const i3 = (i + 2) % n;
    d +=
      ` C${r2(xs[i] + (xs[i2] - xs[i0]) / 6)},${r2(ys[i] + (ys[i2] - ys[i0]) / 6)}` +
      ` ${r2(xs[i2] - (xs[i3] - xs[i]) / 6)},${r2(ys[i2] - (ys[i3] - ys[i]) / 6)}` +
      ` ${r2(xs[i2])},${r2(ys[i2])}`;
  }
  return d + 'Z';
}

export interface EyeGeo {
  variant: EyeVariant;
  tf: string;
  rx: string;
  ry: string;
  pupil: string;
  heart: string;
}

export interface Geo {
  root: string;
  scale: string;
  tuft: string;
  body: string;
  eyes: [EyeGeo, EyeGeo];
  brows: [string, string] | null;
  beak: string;
  mouth: string | null;
}

/** Converts a pose into SVG attribute strings. */
export function geometry(p: Readonly<Pose>, tuftSpring: number): Geo {
  const off = (y: number) => (p.L * (39 - y)) / 70;
  const yA = (y: number) => (y < 4 ? 4 + (y - 4) * (1 - p.G * 0.1) : y);
  const ey = yA(2 + p.ly);
  const eo = off(ey);
  const op = Math.max(0, p.op);
  const stretch = 1 + (1 - op) * 0.25;

  const eye = (side: -1 | 1): EyeGeo => {
    const type = side < 0 ? p.eL : p.eR ?? p.eL;
    const blinkable = type === 'dot' || type === 'wide';
    const base = type === 'wide' ? 5.6 : 5;
    return {
      variant: blinkable && op < 0.18 ? 'blink' : type,
      tf: `translate(${r2(side * 16 + p.lx + eo)} ${r2(ey)})`,
      rx: String(r2(base * p.es * stretch)),
      ry: String(r2(base * p.es * op)),
      pupil: String(r2(2.1 * p.es * op)),
      heart: `scale(${r2(5 * p.es)})`,
    };
  };

  let brows: [string, string] | null = null;
  if (Math.abs(p.br) > 0.3) {
    const brow = (side: -1 | 1) => {
      const a = side < 0 ? p.br : -p.br;
      const x = side * 16 + p.lx + eo;
      return `M${r2(x - 6)},${r2(ey - 9 - a)} L${r2(x + 6)},${r2(ey - 9 + a)}`;
    };
    brows = [brow(-1), brow(1)];
  }

  const by = yA(12 + p.by);
  const bx = off(by);
  const bs = p.bs;
  const bo = p.bo;

  return {
    root: `translate(0 ${r2(p.y)}) rotate(${r2(p.rot)} 0 30)`,
    scale: `translate(0 38) scale(${r3(p.sx)} ${r3(p.sy)}) translate(0 -38)`,
    tuft: `translate(${r2(off(-28))} ${r2(yA(-28) + 28)}) rotate(${r2(p.tuft + tuftSpring)} 0 -28)`,
    body: bodyPath(p.L, p.G),
    eyes: [eye(-1), eye(1)],
    brows,
    beak: `M${r2(bx - 5 * bs)},${r2(by)} L${r2(bx)},${r2(by - 4 * bs)} L${r2(bx + 5 * bs)},${r2(by)} L${r2(bx)},${r2(by + 8 * bs + bo * 3)}Z`,
    mouth:
      bo > 0.05
        ? `M${r2(bx - 3 * bo)},${r2(by + 1)} L${r2(bx + 3 * bo)},${r2(by + 1)} L${r2(bx)},${r2(by + 1 + 6 * bo)}Z`
        : null,
  };
}

/** Damped spring that makes the tuft lag behind head motion (secondary motion). */
export interface Spring {
  a: number;
  v: number;
  px: number | null;
  py: number;
}

export const createSpring = (): Spring => ({ a: 0, v: 0, px: null, py: 0 });

export function stepSpring(sp: Spring, p: Readonly<Pose>, dts: number): number {
  if (dts <= 0) return sp.a;
  const th = (p.rot * Math.PI) / 180;
  const reach = 30 - (38 - 66 * p.sy);
  const hx = p.L * 0.96 + reach * Math.sin(th);
  const hy = p.y + 30 - reach * Math.cos(th);
  if (sp.px === null) {
    sp.px = hx;
    sp.py = hy;
  }
  const vx = (hx - sp.px) / dts;
  const vy = (hy - sp.py) / dts;
  sp.px = hx;
  sp.py = hy;
  const target = Math.max(-28, Math.min(28, -vx * 0.22 - vy * 0.16));
  const steps = 4;
  const h = Math.min(dts, 0.05) / steps;
  for (let i = 0; i < steps; i++) {
    sp.v += (260 * (target - sp.a) - 13 * sp.v) * h;
    sp.a += sp.v * h;
  }
  return sp.a;
}
