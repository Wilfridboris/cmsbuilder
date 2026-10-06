import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";

/**
 * Catalog-parity coverage for the Story 8.4 `DataExport` namespace: every key is
 * present and non-empty in BOTH `en.json` and `fr.json`, and no user-facing value
 * contains an em-dash (house style). Mirrors the repo convention
 * (`tier-view-copy.test.ts`).
 */

const TOP_KEYS = ["title", "subtitle", "button", "preparing"] as const;
const ERROR_KEYS = ["unauthorized", "forbidden", "genericError"] as const;

type Dict = Record<string, unknown>;

function values(dict: Dict): string[] {
  const out: string[] = [];
  for (const key of TOP_KEYS) out.push(dict[key] as string);
  const errors = dict.error as Dict;
  for (const key of ERROR_KEYS) out.push(errors[key] as string);
  return out;
}

describe("DataExport catalog (Story 8.4)", () => {
  const enDict = (en as { DataExport: Dict }).DataExport;
  const frDict = (fr as { DataExport: Dict }).DataExport;

  it("defines every DataExport key, non-empty, in both EN and FR", () => {
    for (const dict of [enDict, frDict]) {
      for (const key of TOP_KEYS) {
        expect(typeof dict[key]).toBe("string");
        expect((dict[key] as string).trim().length).toBeGreaterThan(0);
      }
      const errors = dict.error as Dict;
      for (const key of ERROR_KEYS) {
        expect(typeof errors[key]).toBe("string");
        expect((errors[key] as string).trim().length).toBeGreaterThan(0);
      }
    }
  });

  it("contains no em-dash in any EN or FR DataExport value", () => {
    for (const value of [...values(enDict), ...values(frDict)]) {
      expect(value).not.toContain("—");
    }
  });
});
