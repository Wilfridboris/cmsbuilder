'use client';

import { memo, useEffect, useRef, useState, type CSSProperties } from 'react';
import {
  REST, blendInto, copyPose, createSpring, geometry, sampleInto, stepSpring,
  type EyeVariant, type Geo, type Pose, type Spring,
} from './engine';
import { MOODS, type Mood, type SchezaMood } from './expressions';
import { Effects, FX_CSS } from './fx';
import { subscribe } from './ticker';

export interface SchezaBotProps {
  /** Which expression to play. Changing it blends smoothly to the new one. */
  mood?: SchezaMood;
  /** Width and height in px (number) or any CSS length (string). Default 96. */
  size?: number | string;
  /** Freeze on the current frame. */
  paused?: boolean;
  /** Playback speed. 1 = normal, 0.5 = half speed. */
  speed?: number;
  /** Blend time between moods, in ms. Default 280. */
  transitionMs?: number;
  /**
   * Accessible name (pass a translated string). When omitted the bot is
   * treated as decorative and hidden from screen readers.
   */
  label?: string;
  /** Body color. Defaults to var(--scheza-bot-ink, #232a36). */
  ink?: string;
  /** Eye and beak color. Defaults to var(--scheza-bot-face, #fff). */
  face?: string;
  className?: string;
  style?: CSSProperties;
}

const INK = 'var(--scheza-bot-ink,#232a36)';
const FACE = 'var(--scheza-bot-face,#fff)';
const TAU = Math.PI * 2;
const TUFT_A = 'M-6,-26 Q-4,-52 10,-49 Q2,-40 4,-28Z';
const TUFT_B = 'M6,-28 Q15,-44 25,-41 Q16,-35 15,-25Z';
const HEART = 'M0,0.9 C-1.4,-0.1 -0.6,-1.2 0,-0.35 C0.6,-1.2 1.4,-0.1 0,0.9Z';

const EYE_PARTS = ['white', 'pupil', 'happy', 'closed', 'blink', 'x', 'heart'] as const;
type EyePart = (typeof EYE_PARTS)[number];
const VISIBLE: Record<EyeVariant, readonly EyePart[]> = {
  dot: ['white'], wide: ['white', 'pupil'], happy: ['happy'], closed: ['closed'],
  blink: ['blink'], x: ['x'], heart: ['heart'],
};
const shows = (v: EyeVariant, part: EyePart) => VISIBLE[v].includes(part);

function gateOf(m: Mood, p: Pose): number {
  if (m.gate === 'f') return Math.min(1, Math.max(0, p.f));
  if (m.gate === 'bo') return Math.min(1, Math.max(0, p.bo * 1.3));
  return 1;
}

/** Remembers the last value written to each attribute so unchanged values cost nothing. */
class Slot {
  private cache: Record<string, string> = {};
  constructor(public el: Element) {}
  set(attr: string, value: string) {
    if (this.cache[attr] === value) return;
    this.cache[attr] = value;
    this.el.setAttribute(attr, value);
  }
}

interface Rig {
  root: Slot; scale: Slot; tuft: Slot; body: Slot; beak: Slot; mouth: Slot; fx: Slot;
  brows: [Slot, Slot];
  eyes: [{ g: Slot; parts: Record<EyePart, Slot>; variant: EyeVariant }, { g: Slot; parts: Record<EyePart, Slot>; variant: EyeVariant }];
}

function bindRig(svg: SVGSVGElement, init: Geo): Rig {
  const q = (k: string) => new Slot(svg.querySelector(`[data-sb="${k}"]`) as Element);
  const eye = (i: 0 | 1) => ({
    g: q(`eye${i}`),
    parts: Object.fromEntries(EYE_PARTS.map((p) => [p, q(`eye${i}-${p}`)])) as Record<EyePart, Slot>,
    variant: init.eyes[i].variant,
  });
  return {
    root: q('root'), scale: q('scale'), tuft: q('tuft'), body: q('body'), beak: q('beak'),
    mouth: q('mouth'), fx: q('fx'), brows: [q('brow0'), q('brow1')], eyes: [eye(0), eye(1)],
  };
}

function draw(rig: Rig, g: Geo, fxOpacity: number) {
  rig.root.set('transform', g.root);
  rig.scale.set('transform', g.scale);
  rig.tuft.set('transform', g.tuft);
  rig.body.set('d', g.body);
  rig.beak.set('d', g.beak);
  if (g.mouth) {
    rig.mouth.set('d', g.mouth);
    rig.mouth.set('display', 'inline');
  } else rig.mouth.set('display', 'none');
  rig.brows.forEach((b, i) => {
    const d = g.brows?.[i];
    if (d) {
      b.set('d', d);
      b.set('display', 'inline');
    } else b.set('display', 'none');
  });
  rig.eyes.forEach((e, i) => {
    const ge = g.eyes[i];
    e.g.set('transform', ge.tf);
    if (e.variant !== ge.variant) {
      e.variant = ge.variant;
      for (const p of EYE_PARTS) e.parts[p].set('display', shows(ge.variant, p) ? 'inline' : 'none');
    }
    if (ge.variant === 'dot' || ge.variant === 'wide') {
      e.parts.white.set('rx', ge.rx);
      e.parts.white.set('ry', ge.ry);
      if (ge.variant === 'wide') e.parts.pupil.set('r', ge.pupil);
    } else if (ge.variant === 'heart') e.parts.heart.set('transform', ge.heart);
  });
  rig.fx.set('opacity', String(Math.round(fxOpacity * 100) / 100));
}

interface Controller {
  sync: () => void;
  setMood: (m: SchezaMood) => void;
}

function SchezaBotImpl({
  mood = 'idle', size = 96, paused = false, speed = 1, transitionMs = 280,
  label, ink, face, className, style,
}: SchezaBotProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const opts = useRef({ paused, speed, transitionMs });
  const ctl = useRef<Controller | null>(null);

  // First frame, computed once. Identical on server and client, so no hydration mismatch.
  // These JSX values never change afterwards, so React never touches the animated attributes.
  const [init] = useState(() => {
    const m = MOODS[mood];
    const pose = sampleInto({ ...REST }, m.keys, 0);
    return { mood, geo: geometry(pose, 0), fx: gateOf(m, pose) };
  });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;
    const rig = bindRig(svg, init.geo);
    const st = {
      mood: init.mood,
      elapsed: 0,
      start: 0,
      blendStart: 0,
      from: null as Pose | null,
      fromBuf: { ...REST } as Pose,
      work: { ...REST } as Pose,
      last: { ...REST } as Pose,
      spring: createSpring() as Spring,
    };
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    let reduced = mq.matches;
    let visible = true;
    let unsub: (() => void) | null = null;

    const frame = (dt: number) => {
      const { speed: sp, transitionMs: tm } = opts.current;
      const step = dt * sp;
      st.elapsed += step;
      const m = MOODS[st.mood];
      const local = st.elapsed - st.start;
      const t = (((local % m.dur) + m.dur) % m.dur) / m.dur;
      const p = sampleInto(st.work, m.keys, t);
      p.sy *= 1 + 0.012 * Math.sin((st.elapsed / 3200) * TAU);
      if (st.from) {
        const u = (st.elapsed - st.blendStart) / Math.max(1, tm);
        if (u < 1) blendInto(p, st.from, p, u);
        else st.from = null;
      }
      copyPose(st.last, p);
      const spring = stepSpring(st.spring, p, step / 1000);
      draw(rig, geometry(p, spring), gateOf(m, p));
    };

    const still = () => {
      const m = MOODS[st.mood];
      const p = sampleInto(st.work, m.keys, m.still);
      copyPose(st.last, p);
      draw(rig, geometry(p, 0), gateOf(m, p));
    };

    const sync = () => {
      const run = visible && !reduced && !opts.current.paused;
      if (run && !unsub) unsub = subscribe(frame);
      if (!run && unsub) {
        unsub();
        unsub = null;
      }
      if (reduced) still();
    };

    ctl.current = {
      sync,
      setMood(next) {
        if (next === st.mood) return;
        st.from = copyPose(st.fromBuf, st.last);
        st.blendStart = st.elapsed;
        st.start = st.elapsed;
        st.mood = next;
        if (reduced) still();
        else if (!unsub) {
          st.from = null;
          frame(0);
        }
      },
    };

    const io = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting;
      sync();
    });
    io.observe(svg);
    const onMq = () => {
      reduced = mq.matches;
      sync();
    };
    mq.addEventListener('change', onMq);
    sync();

    return () => {
      io.disconnect();
      mq.removeEventListener('change', onMq);
      unsub?.();
      ctl.current = null;
    };
  }, [init]);

  useEffect(() => {
    opts.current = { paused, speed, transitionMs };
    ctl.current?.sync();
  }, [paused, speed, transitionMs]);

  useEffect(() => {
    ctl.current?.setMood(mood);
  }, [mood]);

  const g = init.geo;
  const cssVars = {
    ...style,
    ...(ink ? { '--scheza-bot-ink': ink } : null),
    ...(face ? { '--scheza-bot-face': face } : null),
  } as CSSProperties;
  const fxName = MOODS[mood].fx;

  return (
    <>
      <style href="scheza-bot-fx" precedence="low">{FX_CSS}</style>
      <svg
        ref={svgRef}
        viewBox="-64 -74 128 128"
        width={size}
        height={size}
        className={className}
        style={cssVars}
        overflow="visible"
        {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true, focusable: false })}
      >
        <g data-sb="root" transform={g.root}>
          <g data-sb="scale" transform={g.scale}>
            <g data-sb="tuft" transform={g.tuft}>
              <path d={TUFT_A} fill={INK} />
              <path d={TUFT_B} fill={INK} />
            </g>
            <path data-sb="body" d={g.body} fill={INK} />
            {g.eyes.map((e, i) => (
              <g key={i} data-sb={`eye${i}`} transform={e.tf}>
                <ellipse data-sb={`eye${i}-white`} rx={e.rx} ry={e.ry} fill={FACE} display={shows(e.variant, 'white') ? 'inline' : 'none'} />
                <circle data-sb={`eye${i}-pupil`} cx={0.6} r={e.pupil} fill={INK} display={shows(e.variant, 'pupil') ? 'inline' : 'none'} />
                <path data-sb={`eye${i}-happy`} d="M-5,2 Q0,-6 5,2" stroke={FACE} strokeWidth={2.6} fill="none" strokeLinecap="round" display={shows(e.variant, 'happy') ? 'inline' : 'none'} />
                <path data-sb={`eye${i}-closed`} d="M-5,-1 Q0,4 5,-1" stroke={FACE} strokeWidth={2.6} fill="none" strokeLinecap="round" display={shows(e.variant, 'closed') ? 'inline' : 'none'} />
                <path data-sb={`eye${i}-blink`} d="M-5.5,0 Q0,3 5.5,0" stroke={FACE} strokeWidth={2.4} fill="none" strokeLinecap="round" display={shows(e.variant, 'blink') ? 'inline' : 'none'} />
                <path data-sb={`eye${i}-x`} d="M-4,-4 L4,4 M4,-4 L-4,4" stroke={FACE} strokeWidth={2.6} strokeLinecap="round" display={shows(e.variant, 'x') ? 'inline' : 'none'} />
                <path data-sb={`eye${i}-heart`} d={HEART} transform={e.heart} fill={FACE} display={shows(e.variant, 'heart') ? 'inline' : 'none'} />
              </g>
            ))}
            {[0, 1].map((i) => (
              <path key={i} data-sb={`brow${i}`} d={g.brows?.[i] ?? 'M0,0'} stroke={FACE} strokeWidth={2.4} strokeLinecap="round" display={g.brows ? 'inline' : 'none'} />
            ))}
            <path data-sb="beak" d={g.beak} fill={FACE} />
            <path data-sb="mouth" d={g.mouth ?? 'M0,0'} fill={INK} display={g.mouth ? 'inline' : 'none'} />
          </g>
          <g data-sb="fx" className="sb-fx" opacity={init.fx}>
            {fxName ? <Effects key={mood} name={fxName} /> : null}
          </g>
        </g>
      </svg>
    </>
  );
}

/** Animated Scheza Bot mascot. Zero dependencies, one shared animation loop. */
export const SchezaBot = memo(SchezaBotImpl);
SchezaBot.displayName = 'SchezaBot';
