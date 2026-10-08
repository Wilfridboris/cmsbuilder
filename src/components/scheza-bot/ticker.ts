/**
 * One shared requestAnimationFrame loop for every bot on the page.
 * It only runs while at least one visible, unpaused bot is subscribed,
 * and the browser already pauses it in background tabs.
 */
type Tick = (dtMs: number) => void;

const subs = new Set<Tick>();
let raf = 0;
let last = 0;

function loop(now: number) {
  // Clamp so a long pause (tab switch, debugger) does not cause a jump.
  const dt = Math.min(100, now - last);
  last = now;
  subs.forEach((fn) => fn(dt));
  raf = subs.size > 0 ? requestAnimationFrame(loop) : 0;
}

export function subscribe(fn: Tick): () => void {
  subs.add(fn);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(loop);
  }
  return () => {
    subs.delete(fn);
    if (subs.size === 0 && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  };
}

/** For tests and diagnostics. */
export const activeSubscribers = () => subs.size;
