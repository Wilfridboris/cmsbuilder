import { describe, expect, it } from "vitest";

import { shouldPromptUpgrade } from "@/lib/billing/tier-prompt";
import { TIER_INVOICE_BANDS, nextTierUp } from "@/lib/billing/tiers";

/**
 * Unit coverage for the Story 7.5 tier-change prompt predicate (FR55) against the
 * frozen I/O & Edge-Case Matrix: the prompt fires when the LAST FULLY COMPLETED
 * cycle's issued count EXCEEDS the current tier's band; Shop (no cap) never prompts;
 * under-band / no-data never prompts. Bands are provisional config (Solo <= 20,
 * Crew <= 100, Shop = no cap).
 */

describe("TIER_INVOICE_BANDS (provisional config)", () => {
  it("matches the frozen Decision: Solo <= 20, Crew <= 100, Shop = no cap", () => {
    expect(TIER_INVOICE_BANDS.solo).toBe(20);
    expect(TIER_INVOICE_BANDS.crew).toBe(100);
    expect(TIER_INVOICE_BANDS.shop).toBeNull();
  });
});

describe("nextTierUp", () => {
  it("orders solo -> crew -> shop -> null", () => {
    expect(nextTierUp("solo")).toBe("crew");
    expect(nextTierUp("crew")).toBe("shop");
    expect(nextTierUp("shop")).toBeNull();
  });
});

describe("shouldPromptUpgrade", () => {
  it("fires for Solo when the last completed cycle exceeds the band (> 20)", () => {
    expect(shouldPromptUpgrade("solo", 21)).toBe(true);
    expect(shouldPromptUpgrade("solo", 100)).toBe(true);
  });

  it("does NOT fire for Solo at or under the band (<= 20)", () => {
    expect(shouldPromptUpgrade("solo", 20)).toBe(false);
    expect(shouldPromptUpgrade("solo", 19)).toBe(false);
    expect(shouldPromptUpgrade("solo", 0)).toBe(false);
  });

  it("fires for Crew only above its larger band (> 100)", () => {
    expect(shouldPromptUpgrade("crew", 101)).toBe(true);
    expect(shouldPromptUpgrade("crew", 100)).toBe(false);
    expect(shouldPromptUpgrade("crew", 21)).toBe(false);
  });

  it("never fires for Shop (no cap, top tier) regardless of volume", () => {
    expect(shouldPromptUpgrade("shop", 0)).toBe(false);
    expect(shouldPromptUpgrade("shop", 1000)).toBe(false);
  });

  it("never fires with no data (zero issued in the last cycle)", () => {
    expect(shouldPromptUpgrade("solo", 0)).toBe(false);
    expect(shouldPromptUpgrade("crew", 0)).toBe(false);
  });
});
