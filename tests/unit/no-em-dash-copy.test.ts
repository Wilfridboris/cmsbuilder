import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";
import { buildGenerationPrompt, buildEditorPrompt } from "@/lib/gemini/prompts";
import type { GenerationIntent } from "@/lib/generation/intent";

/**
 * Story 15.3 no-em-dash invariant. Every user-facing i18n string (en + fr) and
 * every Gemini prompt INSTRUCTION TEXT (the strings sent to the model) must be
 * free of the em-dash (U+2014). The generation + editor prompts must also tell
 * the model to avoid em-dashes in its output.
 */

const EM_DASH = "—";

/** Collect every leaf string value from a nested i18n bundle. */
function collectStrings(node: unknown, path: string, out: [string, string][]) {
  if (typeof node === "string") {
    out.push([path, node]);
    return;
  }
  if (node && typeof node === "object") {
    for (const [key, value] of Object.entries(node)) {
      collectStrings(value, path ? `${path}.${key}` : key, out);
    }
  }
}

describe("i18n bundles contain no em-dash", () => {
  it("en.json has no em-dash in any user-facing string", () => {
    const strings: [string, string][] = [];
    collectStrings(en, "", strings);
    const offenders = strings.filter(([, v]) => v.includes(EM_DASH));
    expect(offenders).toEqual([]);
  });

  it("fr.json has no em-dash in any user-facing string", () => {
    const strings: [string, string][] = [];
    collectStrings(fr, "", strings);
    const offenders = strings.filter(([, v]) => v.includes(EM_DASH));
    expect(offenders).toEqual([]);
  });
});

describe("Gemini prompt instruction text contains no em-dash", () => {
  const intent: GenerationIntent = {
    businessName: "Maple HVAC",
    tradeType: "hvac",
    city: "Ottawa",
    description: "We install and service furnaces and air conditioners.",
    submittedLocale: "en",
  } as GenerationIntent;

  it("the generation prompt has no em-dash and instructs the model to avoid them", () => {
    const prompt = buildGenerationPrompt(intent);
    expect(prompt.includes(EM_DASH)).toBe(false);
    expect(prompt.toLowerCase()).toContain("em-dash");
  });

  it("the editor prompt has no em-dash and instructs the model to avoid them", () => {
    const prompt = buildEditorPrompt("add a notes column to jobs", {
      tables: [
        {
          key: "jobs",
          label: "Jobs",
          fields: [{ key: "title", label: "Title", type: "text" }],
        },
      ],
    });
    expect(prompt.includes(EM_DASH)).toBe(false);
    expect(prompt.toLowerCase()).toContain("em-dash");
  });
});
