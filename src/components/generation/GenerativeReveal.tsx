"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { useReducedMotion } from "framer-motion";

import { SchezaBot } from "@/components/scheza-bot";
import { readIntent } from "@/lib/generation/intent";

/**
 * GenerativeReveal (Story 15.2) — the bot-led signature reveal on `/generate`.
 *
 * It owns the visible AI presence while generation runs and the short, bounded
 * assembly when it lands. The `/generate` page keeps its phase machine, the
 * single-POST guard, the accessibility attributes, and the fallback /
 * `StartOver` degradations; it drives THIS component by `status`:
 *
 *   - `working`  — the in-flight `POST /api/generate`. The bot plays `focused`
 *     and honest phase lines rotate in an `aria-live="polite"` region. The
 *     narration is PURELY ambient: it never gates progression, so a fast
 *     response reveals immediately and a slow one simply shows more lines. No
 *     artificial timer pads the wait.
 *   - `ready`    — the 200 landed. The bot settles into `proud`/`success`, an
 *     `h1` greets the owner by the captured business name
 *     (`Generate.readyWithName`, falling back to a nameless headline when the
 *     stored intent has no `businessName`), and the dashboard (`children`)
 *     flows in under a short CSS `@keyframes` + `animation-delay` stagger that
 *     COMPOSES with — never duplicates — `DemoDashboard`'s own mount grow.
 *   - `degraded` — the fallback / `StartOver` surfaces. The bot shows a calm
 *     `oops`; the page renders the existing banner / start-over copy as
 *     `children`. No stuck or broken animation.
 *
 * Under `prefers-reduced-motion` the bot is a calm still pose (the component
 * itself gates its loop on the media query) and the reveal is instant: no
 * staged assembly, no narration hold. In all cases the layout reserves the
 * bot + headline space so nothing shifts when content swaps.
 */

export type RevealStatus = "working" | "ready" | "degraded";

/** How long each ambient phase line shows before the next (ms). */
const PHASE_INTERVAL_MS = 1800;

/** The bot size in px — ~96px per the UX direction, reserved so no CLS. */
const BOT_SIZE = 96;

type GenerativeRevealProps = {
  status: RevealStatus;
  /** The reveal body (DemoDashboard on ready, the banner/start-over otherwise). */
  children: ReactNode;
};

export function GenerativeReveal({ status, children }: GenerativeRevealProps) {
  const t = useTranslations("Generate");
  const prefersReducedMotion = useReducedMotion();

  // The ambient phase lines. These are honest labels for what the server is
  // doing, rotated on a gentle interval; they NEVER gate the reveal.
  const phases = useMemo(
    () => [
      t("phaseReading"),
      t("phaseDesigning"),
      t("phaseSeeding"),
      t("phaseFinishing"),
    ],
    [t],
  );

  const [phaseIndex, setPhaseIndex] = useState(0);

  // Rotate the ambient narration only while working and only with motion. A
  // reduced-motion visitor sees a single calm line; a fast response unmounts
  // this before it ever advances, so the narration cannot delay anything.
  useEffect(() => {
    if (status !== "working" || prefersReducedMotion) {
      return;
    }
    const id = window.setInterval(() => {
      setPhaseIndex((prev) => Math.min(prev + 1, phases.length - 1));
    }, PHASE_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [status, prefersReducedMotion, phases.length]);

  // The captured business name drives the proud headline. Read once from the
  // anonymous session (sessionStorage) in the initializer — this is a client
  // component mounted after the POST resolves, so storage is available and the
  // SSR pass has no window (readIntent returns null, giving the nameless
  // headline until hydration swaps in the stored name). Absent / lost intent →
  // a nameless headline (degrade), never a crash.
  const [businessName] = useState<string | null>(
    () => readIntent()?.businessName ?? null,
  );

  const mood =
    status === "ready"
      ? "proud"
      : status === "degraded"
        ? "oops"
        : "focused";

  const botLabel = t("botLabel");

  const headline =
    status === "ready"
      ? businessName
        ? t("readyWithName", { businessName })
        : t("readyTitle")
      : null;

  return (
    <div className="flex flex-col gap-8">
      {/* Scoped CSS for the bounded staged assembly. Reduced motion disables it
          (instant reveal); the FX layer inside the bot has its own guard. */}
      <style href="generative-reveal" precedence="low">{REVEAL_CSS}</style>

      {/* Centered bot + narration/headline column. Space is reserved for the
          bot and a single line of text so the surface never shifts when the
          phase label swaps for the headline. */}
      <div className="flex flex-col items-center gap-4 text-center">
        <SchezaBot mood={mood} size={BOT_SIZE} label={botLabel} />

        {/* Reserve a consistent slot height for both the working phase line and
            the taller ready headline, so the working→ready swap never nudges the
            dashboard below it (no layout shift). The headline wraps (`break-words`)
            rather than overflowing for a long business name. */}
        <div className="flex min-h-9 w-full items-center justify-center">
          {status === "ready" && headline ? (
            <h1 className="text-3xl font-semibold tracking-tight text-balance break-words">
              {headline}
            </h1>
          ) : (
            <p
              aria-live="polite"
              className="text-base text-muted-foreground text-pretty"
            >
              {status === "working" ? phases[phaseIndex] : null}
            </p>
          )}
        </div>
      </div>

      {/* The reveal body. On `ready` with motion, wrap it in the bounded
          staged-assembly animation; otherwise render it plainly (reduced
          motion = instant). The DemoDashboard's own grow still runs inside. */}
      <div
        className={
          status === "ready" && !prefersReducedMotion ? "sb-reveal-stage" : undefined
        }
      >
        {children}
      </div>
    </div>
  );
}

/**
 * Bounded staged assembly: a short opacity+rise that runs ONCE on the ready
 * mount, composing above the DemoDashboard's own Framer-Motion grow rather than
 * replacing it. Kept brief (a single ~360ms pass) so the reveal stays paced to
 * the real POST, not to a scripted timeline. Reduced motion never applies this
 * class, and the media query below is a belt-and-braces guard.
 */
const REVEAL_CSS = `
.sb-reveal-stage{animation:sb-reveal-stage .36s ease-out both}
@keyframes sb-reveal-stage{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
@media (prefers-reduced-motion:reduce){.sb-reveal-stage{animation:none}}
`;
