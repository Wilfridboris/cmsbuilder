import type { CSSProperties, ReactNode } from 'react';
import type { FxName } from './expressions';

/**
 * Effects layer (sparkles, "!", "?", z, drops, hearts).
 * Animated with plain CSS keyframes, so it costs no JavaScript per frame.
 */

export const FX_CSS = `
.sb-fx *{transform-box:fill-box;transform-origin:center}
.sb-pulse{animation:sb-pulse var(--d,1s) ease-in-out infinite}
.sb-twinkle{animation:sb-twinkle var(--d,.8s) ease-in-out infinite}
.sb-pop{animation:sb-pop .35s cubic-bezier(.34,1.56,.64,1) both}
.sb-bob{animation:sb-bob var(--d,1.5s) ease-in-out infinite}
.sb-hop{animation:sb-hop var(--d,.8s) ease-in-out infinite}
.sb-rise{animation:sb-rise var(--d,2s) ease-out infinite}
.sb-tear{animation:sb-tear var(--d,3.6s) ease-in infinite}
.sb-slide{animation:sb-slide var(--d,2.4s) ease-in infinite}
@keyframes sb-pulse{0%,100%{opacity:.25}50%{opacity:1}}
@keyframes sb-twinkle{0%,100%{transform:scale(.7)}50%{transform:scale(1.1)}}
@keyframes sb-pop{0%{transform:scale(0)}100%{transform:scale(1)}}
@keyframes sb-bob{0%,100%{transform:translateY(-2px)}50%{transform:translateY(2px)}}
@keyframes sb-hop{0%,100%{transform:translateY(0);opacity:.35}50%{transform:translateY(-4px);opacity:1}}
@keyframes sb-rise{0%{transform:translate(0,0);opacity:0}30%{opacity:1}100%{transform:translate(var(--dx,0),var(--dy,-30px));opacity:0}}
@keyframes sb-tear{0%{transform:translateY(0);opacity:0}5%{opacity:1}62%{transform:translateY(28px);opacity:0}100%{transform:translateY(28px);opacity:0}}
@keyframes sb-slide{0%{transform:translateY(0);opacity:0}25%{opacity:1}85%{opacity:1}100%{transform:translateY(14px);opacity:0}}
@media (prefers-reduced-motion:reduce){.sb-fx *{animation:none!important;opacity:1!important;transform:none!important}}
`;

const ACCENT = 'var(--scheza-bot-accent,#3b82f6)';
const WARN = 'var(--scheza-bot-warning,#f59e0b)';
const DANGER = 'var(--scheza-bot-danger,#ef4444)';
const SUCCESS = 'var(--scheza-bot-success,#22c55e)';
const MUTED = 'var(--scheza-bot-muted,#94a3b8)';
const INK = 'var(--scheza-bot-ink,#232a36)';

type Vars = CSSProperties & Record<`--${string}`, string>;
const v = (d: string, delay = 0, extra: Record<string, string> = {}): Vars => ({
  '--d': d,
  animationDelay: `${delay}s`,
  ...extra,
});

const sparkle = (x: number, y: number, s: number) =>
  `M${x},${y - s} Q${x},${y} ${x + s},${y} Q${x},${y} ${x},${y + s} Q${x},${y} ${x - s},${y} Q${x},${y} ${x},${y - s}Z`;

const heart = (x: number, y: number, s: number) =>
  `M${x},${y + s * 0.9} C${x - s * 1.4},${y - s * 0.1} ${x - s * 0.6},${y - s * 1.2} ${x},${y - s * 0.35} C${x + s * 0.6},${y - s * 1.2} ${x + s * 1.4},${y - s * 0.1} ${x},${y + s * 0.9}Z`;

const drop = (x: number, y: number) =>
  `M${x},${y - 7} Q${x + 5},${y + 1} ${x},${y + 4} Q${x - 5},${y + 1} ${x},${y - 7}Z`;

function ticks(cx: number, cy: number, angles: number[], className?: string, dur = '0.6s') {
  return angles.map((deg, i) => {
    const r = (deg * Math.PI) / 180;
    return (
      <line
        key={i}
        className={className}
        style={className ? v(dur, i * 0.1) : undefined}
        x1={cx + Math.cos(r) * 9}
        y1={cy + Math.sin(r) * 9}
        x2={cx + Math.cos(r) * 15}
        y2={cy + Math.sin(r) * 15}
        stroke={INK}
        strokeWidth={2.4}
        strokeLinecap="round"
      />
    );
  });
}

function Bang({ x, y, color, scale = 1 }: { x: number; y: number; color: string; scale?: number }) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className="sb-pop">
        <path d="M0,-14 L0,-5" stroke={color} strokeWidth={3.4} strokeLinecap="round" />
        <circle cx={0} cy={1.5} r={2} fill={color} />
      </g>
    </g>
  );
}

function Question({ x, y, color, scale = 1, className, style }: {
  x: number; y: number; color: string; scale?: number; className?: string; style?: CSSProperties;
}) {
  return (
    <g transform={`translate(${x} ${y}) scale(${scale})`}>
      <g className={className} style={style}>
        <path
          d="M-4.5,-10 Q-4.5,-15.5 0.5,-15.5 Q5.5,-15.5 5.5,-10.5 Q5.5,-7 1.5,-5.5 Q0.5,-5 0.5,-2.5"
          stroke={color}
          strokeWidth={2.6}
          strokeLinecap="round"
          fill="none"
        />
        <circle cx={0.5} cy={2.2} r={1.7} fill={color} />
      </g>
    </g>
  );
}

const Z = ({ x, y, s, delay }: { x: number; y: number; s: number; delay: number }) => (
  <path
    className="sb-rise"
    style={v('3.6s', delay, { '--dx': '14px', '--dy': '-26px' })}
    d={`M${x - s},${y - s} L${x + s},${y - s} L${x - s},${y + s} L${x + s},${y + s}`}
    stroke={MUTED}
    strokeWidth={2}
    strokeLinecap="round"
    strokeLinejoin="round"
    fill="none"
  />
);

const FX: Record<FxName, () => ReactNode> = {
  listen: () => ticks(32, -32, [-80, -50, -20], 'sb-pulse'),
  speak: () => ticks(38, 16, [-30, 0, 30]),
  think: () =>
    [[36, -34, 2], [44, -43, 2.6], [53, -53, 3.2]].map(([x, y, r], i) => (
      <circle key={i} className="sb-pulse" style={v('1.5s', i * 0.25)} cx={x} cy={y} r={r} fill={MUTED} />
    )),
  load: () =>
    [0, 1, 2].map((i) => (
      <circle key={i} className="sb-hop" style={v('0.8s', i * 0.13)} cx={-12 + i * 12} cy={-58} r={2.6} fill={MUTED} />
    )),
  success: () => (
    <>
      <path className="sb-twinkle" style={v('0.8s', 0)} d={sparkle(-44, -26, 6)} fill={WARN} />
      <path className="sb-twinkle" style={v('0.8s', 0.25)} d={sparkle(44, -36, 8)} fill={WARN} />
      <path className="sb-twinkle" style={v('0.8s', 0.5)} d={sparkle(50, -14, 4)} fill={WARN} />
    </>
  ),
  error: () => <Bang x={44} y={-24} color={DANGER} />,
  alert: () => <Bang x={44} y={-28} color={WARN} />,
  sleep: () => (
    <>
      <Z x={32} y={-26} s={3} delay={0} />
      <Z x={32} y={-26} s={4} delay={1.8} />
    </>
  ),
  tear: () => <path className="sb-tear" style={v('3.6s')} d={drop(-19, 12)} fill={ACCENT} />,
  sweat: () => <path className="sb-slide" style={v('2.4s')} d={drop(42, -18)} fill={ACCENT} />,
  hearts: () => (
    <>
      <path className="sb-rise" style={v('1.6s', 0, { '--dx': '3px', '--dy': '-34px' })} d={heart(40, -16, 4)} fill={DANGER} />
      <path className="sb-rise" style={v('1.6s', 0.8, { '--dx': '-3px', '--dy': '-34px' })} d={heart(-42, -16, 5)} fill={DANGER} />
    </>
  ),
  question: () => <Question x={42} y={-26} color={ACCENT} className="sb-bob" style={v('1.5s')} />,
  confused: () => (
    <>
      <Question x={38} y={-24} color={MUTED} scale={0.8} className="sb-pulse" style={v('1.5s', 0)} />
      <Question x={50} y={-38} color={MUTED} scale={0.65} className="sb-pulse" style={v('1.5s', 0.5)} />
    </>
  ),
  proud: () => <path className="sb-twinkle" style={v('1.2s')} d={sparkle(44, -36, 8)} fill={SUCCESS} />,
  excite: () => (
    <>
      <path className="sb-twinkle" style={v('0.45s', 0)} d={sparkle(-44, -28, 6)} fill={WARN} />
      <path className="sb-twinkle" style={v('0.45s', 0.22)} d={sparkle(46, -32, 7)} fill={WARN} />
    </>
  ),
};

export function Effects({ name }: { name: FxName }) {
  return <>{FX[name]()}</>;
}
