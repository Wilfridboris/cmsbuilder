import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { AppError } from "@/types/api";
import {
  DEFAULT_TIER,
  TIERS,
  getPriceIdForTier,
  isSubscriptionTier,
  priceIdToTier,
} from "@/lib/billing/tiers";

/**
 * Unit coverage for the flat-tier billing config (Story 7.2): the price-id <-> tier
 * mapping the checkout route and webhook share, and the missing-env error contract.
 * Env is read at call time, so each case sets/clears the price envs directly.
 */

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  delete process.env.STRIPE_PRICE_SOLO;
  delete process.env.STRIPE_PRICE_CREW;
  delete process.env.STRIPE_PRICE_SHOP;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("tiers config", () => {
  it("exposes the three flat tiers with solo as the default", () => {
    expect(TIERS).toEqual(["solo", "crew", "shop"]);
    expect(DEFAULT_TIER).toBe("solo");
  });

  it("isSubscriptionTier narrows only the known tiers", () => {
    expect(isSubscriptionTier("solo")).toBe(true);
    expect(isSubscriptionTier("crew")).toBe(true);
    expect(isSubscriptionTier("shop")).toBe(true);
    expect(isSubscriptionTier("enterprise")).toBe(false);
    expect(isSubscriptionTier(null)).toBe(false);
    expect(isSubscriptionTier(undefined)).toBe(false);
    expect(isSubscriptionTier(42)).toBe(false);
  });

  describe("getPriceIdForTier", () => {
    it("returns the configured price id for a tier", () => {
      process.env.STRIPE_PRICE_SOLO = "price_solo_123";
      process.env.STRIPE_PRICE_CREW = "price_crew_456";
      process.env.STRIPE_PRICE_SHOP = "price_shop_789";
      expect(getPriceIdForTier("solo")).toBe("price_solo_123");
      expect(getPriceIdForTier("crew")).toBe("price_crew_456");
      expect(getPriceIdForTier("shop")).toBe("price_shop_789");
    });

    it("throws AppError(500, billingUnavailable) when the price env is missing", () => {
      try {
        getPriceIdForTier("solo");
        expect.unreachable("should have thrown");
      } catch (err) {
        expect(err).toBeInstanceOf(AppError);
        expect((err as AppError).statusCode).toBe(500);
        expect((err as AppError).userMessage).toBe("billingUnavailable");
      }
    });
  });

  describe("priceIdToTier (webhook reverse lookup)", () => {
    it("resolves a configured price id back to its tier", () => {
      process.env.STRIPE_PRICE_SOLO = "price_solo_123";
      process.env.STRIPE_PRICE_CREW = "price_crew_456";
      expect(priceIdToTier("price_solo_123")).toBe("solo");
      expect(priceIdToTier("price_crew_456")).toBe("crew");
    });

    it("returns null for an unknown or empty price id (no throw)", () => {
      process.env.STRIPE_PRICE_SOLO = "price_solo_123";
      expect(priceIdToTier("price_unknown")).toBeNull();
      expect(priceIdToTier(null)).toBeNull();
      expect(priceIdToTier(undefined)).toBeNull();
      expect(priceIdToTier("")).toBeNull();
    });
  });
});
