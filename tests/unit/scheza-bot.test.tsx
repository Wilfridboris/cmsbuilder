import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SchezaBot, SCHEZA_MOODS } from "@/components/scheza-bot";
import {
  REST,
  blendInto,
  copyPose,
  createSpring,
  geometry,
  sampleInto,
  stepSpring,
  type Pose,
} from "@/components/scheza-bot/engine";
import { MOODS } from "@/components/scheza-bot/expressions";

/**
 * Vendored SchezaBot (Story 15.2) — tested the repo way: a node-env SSR smoke of
 * the public component (first frame, accessibility contract) plus a pure-math
 * smoke of the React-free `engine.ts`. The mascot's own jsdom DOM-loop suite is
 * NOT ported (no jsdom dev dependency is added, per the story's Boundaries); the
 * live animation loop, IntersectionObserver gating, and reduced-motion still
 * pose are confirmed in the manual Playwright review instead.
 */

describe("SchezaBot — SSR first frame + accessibility", () => {
  it("renders a labelled bot as <svg role=\"img\" aria-label> (named for screen readers)", () => {
    const html = renderToStaticMarkup(
      <SchezaBot mood="thinking" label="Scheza assistant" />,
    );
    expect(html).toContain("<svg");
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Scheza assistant"');
    // A labelled bot is NOT hidden from assistive tech.
    expect(html).not.toContain('aria-hidden="true"');
  });

  it("renders a decorative bot (no label) as aria-hidden and not focusable", () => {
    const html = renderToStaticMarkup(<SchezaBot mood="idle" />);
    expect(html).toContain("<svg");
    expect(html).toContain('aria-hidden="true"');
    // Decorative: no accessible name is exposed.
    expect(html).not.toContain('role="img"');
    expect(html).not.toContain("aria-label=");
  });

  it("renders a valid first frame for every one of the 22 moods", () => {
    expect(SCHEZA_MOODS).toHaveLength(22);
    for (const mood of SCHEZA_MOODS) {
      const html = renderToStaticMarkup(<SchezaBot mood={mood} label="bot" />);
      expect(html, mood).toContain("<svg");
      // The body path is present and well-formed (starts with a moveto).
      expect(html, mood).toMatch(/data-sb="body" d="M/);
    }
  });
});

describe("engine — pure math produces finite poses across the loop", () => {
  it("samples finite geometry for every frame of every mood", () => {
    const work: Pose = { ...REST };
    for (const mood of SCHEZA_MOODS) {
      const keys = MOODS[mood].keys;
      for (let i = 0; i <= 48; i += 1) {
        const pose = sampleInto(work, keys, i / 48);
        const geo = geometry(pose, 0);
        const serialized = [
          geo.root,
          geo.scale,
          geo.tuft,
          geo.body,
          geo.beak,
          geo.eyes[0].tf,
          geo.eyes[1].rx,
        ].join(" ");
        expect(serialized, `${mood}@${i}`).not.toMatch(/NaN|Infinity/);
      }
    }
  });

  it("blends between two poses without producing NaN/Infinity", () => {
    const a = sampleInto({ ...REST }, MOODS.thinking.keys, 0.2);
    const b = sampleInto({ ...REST }, MOODS.proud.keys, 0.4);
    const out: Pose = { ...REST };
    for (const u of [0, 0.25, 0.5, 0.75, 1]) {
      blendInto(out, copyPose({ ...REST }, a), b, u);
      const geo = geometry(out, 0);
      expect([geo.root, geo.body, geo.beak].join(" ")).not.toMatch(
        /NaN|Infinity/,
      );
    }
  });

  it("steps the tuft spring to a finite, bounded angle over the loop", () => {
    const spring = createSpring();
    const work: Pose = { ...REST };
    for (let i = 0; i <= 64; i += 1) {
      const pose = sampleInto(work, MOODS.excited.keys, (i % 48) / 48);
      const angle = stepSpring(spring, pose, 1 / 60);
      expect(Number.isFinite(angle), `frame ${i}`).toBe(true);
      // The spring clamps its target to ±28 degrees; the eased angle stays near.
      expect(Math.abs(angle)).toBeLessThan(40);
    }
  });
});
