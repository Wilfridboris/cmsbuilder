import { buildKeys, type Key, type KeyDef } from './engine';

export type FxName =
  | 'listen' | 'speak' | 'think' | 'load' | 'success' | 'error' | 'alert' | 'sleep'
  | 'tear' | 'sweat' | 'hearts' | 'question' | 'confused' | 'proud' | 'excite';

/** What controls the opacity of the effects layer, frame by frame. */
export type FxGate = 'f' | 'bo' | null;

export const SCHEZA_MOODS = [
  'idle', 'blink', 'listening', 'thinking', 'speaking', 'happy', 'success',
  'loading', 'error', 'sleeping', 'waking-up', 'waiting',
  'sad', 'surprised', 'excited', 'curious', 'oops',
  'thank-you', 'proud', 'focused', 'wink', 'confused',
] as const;

export type SchezaMood = (typeof SCHEZA_MOODS)[number];

interface MoodDef {
  /** Loop length in milliseconds at speed 1. */
  dur: number;
  fx: FxName | null;
  gate: FxGate;
  /** Frame (0..1) shown when the user prefers reduced motion. */
  still: number;
  keys: KeyDef[];
}

const DEFS: Record<SchezaMood, MoodDef> = {
  // Core states
  idle: { dur: 3200, fx: null, gate: null, still: 0, keys: [
    [0, {}], [0.28, {}], [0.3, { lx: 2.5 }, 'out'], [0.55, { L: 1 }], [0.57, { lx: 0 }, 'out'],
    [0.78, {}], [0.81, { op: 0 }, 'in'], [0.85, { op: 1 }, 'out'], [1, { L: 0 }],
  ] },
  blink: { dur: 1400, fx: null, gate: null, still: 0, keys: [
    [0, {}], [0.5, {}], [0.55, { op: 0, sy: 0.98 }, 'in'], [0.6, { op: 1, sy: 1 }, 'out'],
    [0.7, {}], [0.73, { op: 0 }, 'in'], [0.77, { op: 1 }, 'out'],
  ] },
  listening: { dur: 2400, fx: 'listen', gate: 'f', still: 0.5, keys: [
    [0, {}], [0.18, { rot: 6, L: 5, lx: 2.5, f: 1 }, 'out'], [0.8, {}], [0.83, { op: 0 }, 'in'],
    [0.87, { op: 1 }, 'out'], [1, { rot: 0, L: 0, lx: 0, f: 0 }],
  ] },
  thinking: { dur: 3200, fx: 'think', gate: 'f', still: 0.15, keys: [
    [0, { f: 1 }], [0.15, { lx: 3, ly: -3, rot: -5, L: -4 }], [0.45, {}],
    [0.6, { lx: -3, rot: 4, L: 4 }], [0.85, {}], [1, { lx: 0, ly: 0, rot: 0, L: 0 }],
  ] },
  speaking: { dur: 1200, fx: 'speak', gate: 'bo', still: 0.12, keys: [
    [0, {}], [0.12, { bo: 1, sy: 1.03, L: 1.5 }, 'out'], [0.25, { bo: 0.2, sy: 1, L: 0 }],
    [0.4, { bo: 0.9, sy: 1.03, L: -1.5 }, 'out'], [0.55, { bo: 0, sy: 1, L: 0 }],
    [0.7, { bo: 0.7, L: 1 }, 'out'], [0.85, { bo: 0.1, L: 0 }], [1, { bo: 0 }],
  ] },
  happy: { dur: 1600, fx: null, gate: null, still: 0.7, keys: [
    [0, { eL: 'happy' }], [0.15, { y: 2, sy: 0.88, sx: 1.08, G: 0.4 }],
    [0.32, { y: -12, sy: 1.08, sx: 0.94, G: -0.5 }, 'out'],
    [0.48, { y: 0, sy: 0.9, sx: 1.08, G: 0.4 }, 'in'], [0.6, { sy: 1, sx: 1, G: 0 }, 'back'], [1, {}],
  ] },
  success: { dur: 2400, fx: 'success', gate: 'f', still: 0.7, keys: [
    [0, { eL: 'happy' }], [0.1, { y: 2, sy: 0.88, sx: 1.08, G: 0.4 }],
    [0.26, { y: -14, sy: 1.1, sx: 0.93, G: -0.6, f: 1, rot: -6 }, 'out'],
    [0.42, { y: 0, sy: 0.9, sx: 1.08, G: 0.4, rot: 0 }, 'in'],
    [0.54, { sy: 1, sx: 1, G: 0 }, 'back'], [0.85, {}], [1, { f: 0 }],
  ] },

  // App states
  loading: { dur: 1600, fx: 'load', gate: null, still: 0, keys: [
    [0, { ly: -3, lx: -2.5, L: -1 }], [0.5, { lx: 2.5, L: 1 }], [1, { lx: -2.5, L: -1 }],
  ] },
  error: { dur: 2400, fx: 'error', gate: 'f', still: 0.5, keys: [
    [0, { eL: 'x', bs: 0.7, tuft: 10 }], [0.05, { rot: -8, L: -5, f: 1, sy: 0.95 }, 'out'],
    [0.12, { rot: 7, L: 5 }], [0.19, { rot: -5, L: -3 }], [0.26, { rot: 3, L: 2 }],
    [0.34, { rot: 0, L: 0, sy: 1 }], [0.85, {}], [1, { f: 0 }],
  ] },
  sleeping: { dur: 3600, fx: 'sleep', gate: null, still: 0, keys: [
    [0, { eL: 'closed', tuft: 20, y: 2, G: 0.5, L: -2 }], [0.5, { sy: 1.04, sx: 0.99, G: 0.3 }],
    [1, { sy: 1, sx: 1, G: 0.5 }],
  ] },
  'waking-up': { dur: 3200, fx: null, gate: null, still: 0.8, keys: [
    [0, { op: 0, tuft: 20, y: 2, G: 0.5 }], [0.2, { op: 0.3 }], [0.28, { op: 0 }],
    [0.45, { op: 0.6, sy: 1.12, sx: 0.92, y: -4, tuft: -6, rot: -4, G: -0.6 }, 'out'],
    [0.6, { op: 1, sy: 0.96, sx: 1.04, y: 0, tuft: 0, rot: 0, G: 0 }],
    [0.7, { sy: 1, sx: 1 }, 'back'], [0.9, {}], [1, { op: 0, tuft: 20, y: 2, G: 0.5 }],
  ] },
  waiting: { dur: 3000, fx: null, gate: null, still: 0.4, keys: [
    [0, {}], [0.15, { rot: 8, lx: 3, L: 3 }, 'out'], [0.55, {}], [0.58, { op: 0 }, 'in'],
    [0.62, { op: 1 }, 'out'], [0.7, {}], [0.72, { lx: 1 }, 'out'], [0.8, {}],
    [0.82, { lx: 3 }, 'out'], [0.9, {}], [1, { rot: 0, lx: 0, L: 0 }],
  ] },

  // Emotions
  sad: { dur: 3600, fx: 'tear', gate: null, still: 0.5, keys: [
    [0, { br: -2.5, ly: 2.5, tuft: 20, y: 2, sy: 0.96, G: 0.9 }],
    [0.5, { tuft: 24, sy: 0.94, G: 1 }], [1, { tuft: 20, sy: 0.96, G: 0.9 }],
  ] },
  surprised: { dur: 2000, fx: 'alert', gate: 'f', still: 0.5, keys: [
    [0, {}], [0.1, { sy: 0.93, sx: 1.05, y: 1, G: 0.3 }],
    [0.18, { sy: 1.12, sx: 0.92, y: -6, es: 1.45, eL: 'wide', bo: 1, tuft: -14, f: 1, G: -0.8 }, 'back'],
    [0.32, { sy: 1, sx: 1, y: 0, es: 1.3, tuft: -6, G: 0 }], [0.78, {}],
    // Swap back to normal eyes hidden inside a blink, so there is no pop.
    [0.83, { op: 0 }, 'in'], [0.86, { op: 0, eL: 'dot', es: 1 }], [0.9, { op: 1 }, 'out'],
    [1, { f: 0, bo: 0, tuft: 0 }],
  ] },
  excited: { dur: 900, fx: 'excite', gate: null, still: 0.4, keys: [
    [0, { eL: 'happy', bo: 0.8, sy: 0.93, sx: 1.06, G: 0.3, L: -3 }],
    [0.4, { y: -9, sy: 1.07, sx: 0.95, G: -0.4, L: 3 }, 'out'],
    [0.8, { y: 0, sy: 0.93, sx: 1.06, G: 0.3, L: -3 }, 'in'], [1, {}],
  ] },
  curious: { dur: 3000, fx: 'question', gate: 'f', still: 0.5, keys: [
    [0, {}], [0.15, { rot: -10, L: -6, lx: 2, eL: 'wide', eR: 'dot', es: 1.2, f: 1 }, 'back'],
    [0.85, {}], [0.88, { op: 0 }, 'in'], [0.9, { op: 0, eL: 'dot', eR: null, es: 1 }],
    [0.93, { op: 1 }, 'out'], [1, { rot: 0, L: 0, lx: 0, f: 0 }],
  ] },
  oops: { dur: 2400, fx: 'sweat', gate: 'f', still: 0.5, keys: [
    [0, { eL: 'closed', bs: 0.7, f: 1 }], [0.1, { sx: 1.05, sy: 0.92, y: 2, rot: -4, G: 0.5 }, 'out'],
    [0.25, { sx: 1, sy: 1, y: 0, G: 0.2 }], [0.85, {}], [1, { rot: 0, G: 0 }],
  ] },

  // Reactions
  'thank-you': { dur: 1600, fx: 'hearts', gate: null, still: 0.6, keys: [
    [0, { eL: 'heart' }], [0.12, { es: 1.35, sy: 1.03, G: -0.2 }, 'out'], [0.26, { es: 1, sy: 1, G: 0 }],
    [0.38, { es: 1.25 }, 'out'], [0.5, { es: 1 }], [1, {}],
  ] },
  proud: { dur: 2400, fx: 'proud', gate: 'f', still: 0.5, keys: [
    [0, { eL: 'closed' }],
    [0.2, { rot: -8, y: -3, sx: 1.05, sy: 1.03, by: -2, f: 1, G: -0.5, L: -3 }, 'back'],
    [0.8, {}], [1, { rot: 0, y: 0, sx: 1, sy: 1, by: 0, f: 0, G: 0, L: 0 }],
  ] },
  focused: { dur: 2400, fx: null, gate: null, still: 0, keys: [
    [0, { op: 0.4, br: 2.5, y: 1, L: 2, G: 0.2 }], [0.5, { lx: -1, y: 2, sy: 0.98 }],
    [1, { lx: 0, y: 1, sy: 1 }],
  ] },
  wink: { dur: 2000, fx: null, gate: null, still: 0.4, keys: [
    [0, {}], [0.15, { rot: 6, L: 3, eR: 'happy', bo: 0.6, sy: 1.03 }, 'back'], [0.6, {}],
    [0.75, { rot: 0, L: 0, eR: null, bo: 0, sy: 1 }], [1, {}],
  ] },
  confused: { dur: 3000, fx: 'confused', gate: null, still: 0, keys: [
    [0, { eL: 'wide', eR: 'dot', bs: 0.7, rot: 6, lx: 2, L: 3 }],
    [0.5, { rot: -6, lx: -2, L: -3 }], [1, { rot: 6, lx: 2, L: 3 }],
  ] },
};

export interface Mood extends Omit<MoodDef, 'keys'> {
  keys: Key[];
}

/** Keyframes are expanded once at import time, never during animation. */
export const MOODS = Object.fromEntries(
  (Object.keys(DEFS) as SchezaMood[]).map((m) => [m, { ...DEFS[m], keys: buildKeys(DEFS[m].keys) }]),
) as Record<SchezaMood, Mood>;
