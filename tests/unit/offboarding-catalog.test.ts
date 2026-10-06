import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";

/**
 * Catalog-parity coverage for the Story 8.5 `Offboarding` namespace: every key is
 * present and non-empty in BOTH `en.json` and `fr.json` (banner + section +
 * account-closed + email stages), and no user-facing value contains an em-dash
 * (house style). Mirrors the repo convention (`data-export-catalog.test.ts`).
 */

type Dict = Record<string, unknown>;

const BANNER_KEYS = [
  "title",
  "message",
  "messageMember",
  "countdown",
  "downloadCta",
  "keepCta",
] as const;
const SECTION_KEYS = [
  "title",
  "subtitle",
  "lead",
  "stepGrace",
  "stepReminders",
  "stepDeletion",
  "retention",
  "manageCta",
  "downloadCta",
] as const;
const ACCOUNT_CLOSED_KEYS = ["title", "body", "homeCta"] as const;
const EMAIL_TOP_KEYS = ["greeting", "cta", "signature"] as const;
const EMAIL_STAGES = ["day1", "day7", "day25"] as const;
const EMAIL_STAGE_KEYS = ["subject", "body"] as const;

function collectStrings(dict: Dict): string[] {
  const out: string[] = [];
  const banner = dict.banner as Dict;
  for (const k of BANNER_KEYS) out.push(banner[k] as string);
  const section = dict.section as Dict;
  for (const k of SECTION_KEYS) out.push(section[k] as string);
  const closed = dict.accountClosed as Dict;
  for (const k of ACCOUNT_CLOSED_KEYS) out.push(closed[k] as string);
  const email = dict.email as Dict;
  for (const k of EMAIL_TOP_KEYS) out.push(email[k] as string);
  for (const stage of EMAIL_STAGES) {
    const s = email[stage] as Dict;
    for (const k of EMAIL_STAGE_KEYS) out.push(s[k] as string);
  }
  return out;
}

describe("Offboarding catalog (Story 8.5)", () => {
  const enDict = (en as { Offboarding: Dict }).Offboarding;
  const frDict = (fr as { Offboarding: Dict }).Offboarding;

  it("defines every Offboarding key, non-empty, in both EN and FR", () => {
    for (const dict of [enDict, frDict]) {
      const strings = collectStrings(dict);
      for (const value of strings) {
        expect(typeof value).toBe("string");
        expect((value as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("the email stages interpolate {date} in subject + body", () => {
    for (const dict of [enDict, frDict]) {
      const email = dict.email as Dict;
      for (const stage of EMAIL_STAGES) {
        const s = email[stage] as Dict;
        expect(s.subject as string).toContain("{date}");
        expect(s.body as string).toContain("{date}");
      }
    }
  });

  it("the banner message + countdown use ICU placeholders", () => {
    for (const dict of [enDict, frDict]) {
      const banner = dict.banner as Dict;
      expect(banner.message as string).toContain("{date}");
      expect(banner.countdown as string).toContain("{days");
    }
  });

  it("contains no em-dash in any EN or FR Offboarding value", () => {
    for (const value of [
      ...collectStrings(enDict),
      ...collectStrings(frDict),
    ]) {
      expect(value).not.toContain("—");
    }
  });
});
