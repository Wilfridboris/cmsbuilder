import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";

/**
 * Copy parity pin for the Story 8.3 field-level sensitivity indicator: the
 * `Sensitivity` namespace exposes `indicatorLabel` and `message` in both the EN
 * and FR catalogs, each a non-empty string. `SensitivityBadge` reads these via
 * `useTranslations('Sensitivity')`, so a missing or blank key would surface as
 * a runtime fallback at every sensitive-field render site.
 */

const KEYS = ["indicatorLabel", "message"] as const;

type SensitivityDict = Record<string, unknown>;

describe("sensitivity badge copy (Story 8.3)", () => {
  it("defines every Sensitivity key as a non-empty string in both EN and FR", () => {
    const enDict = (en as { Sensitivity: SensitivityDict }).Sensitivity;
    const frDict = (fr as { Sensitivity: SensitivityDict }).Sensitivity;
    for (const key of KEYS) {
      expect(typeof enDict[key], `EN Sensitivity.${key}`).toBe("string");
      expect((enDict[key] as string).trim(), `EN Sensitivity.${key}`).not.toBe(
        "",
      );
      expect(typeof frDict[key], `FR Sensitivity.${key}`).toBe("string");
      expect((frDict[key] as string).trim(), `FR Sensitivity.${key}`).not.toBe(
        "",
      );
    }
  });
});
