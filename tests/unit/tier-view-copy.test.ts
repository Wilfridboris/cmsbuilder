import { describe, expect, it } from "vitest";

import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";

/**
 * Copy coverage for the Story 7.5 tier-view i18n keys: both EN and FR are present for
 * every new `Billing` key, and no user-facing value contains an em-dash (project rule).
 */

const NEW_KEYS = [
  "tierHeading",
  "tierSolo",
  "tierCrew",
  "tierShop",
  "tierLabel",
  "inclusionsHeading",
  "inclusionTeam",
  "inclusionCustomers",
  "inclusionRecords",
  "inclusionImport",
  "nextBillingDate",
  "upgradePromptTitle",
  "upgradePromptBody",
  "upgradePromptCta",
  "upgradePromptRedirecting",
] as const;

type BillingDict = Record<string, unknown>;

describe("tier-view copy (Story 7.5)", () => {
  it("defines every new Billing key in both EN and FR", () => {
    const enBilling = (en as { Billing: BillingDict }).Billing;
    const frBilling = (fr as { Billing: BillingDict }).Billing;
    for (const key of NEW_KEYS) {
      expect(typeof enBilling[key], `EN Billing.${key}`).toBe("string");
      expect(typeof frBilling[key], `FR Billing.${key}`).toBe("string");
    }
  });

  it("contains no em-dash in any new EN or FR value", () => {
    const enBilling = (en as { Billing: BillingDict }).Billing;
    const frBilling = (fr as { Billing: BillingDict }).Billing;
    for (const key of NEW_KEYS) {
      expect(String(enBilling[key]), `EN Billing.${key}`).not.toContain("—");
      expect(String(frBilling[key]), `FR Billing.${key}`).not.toContain("—");
    }
  });
});
