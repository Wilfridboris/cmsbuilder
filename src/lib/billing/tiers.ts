import "server-only";

import { AppError } from "@/types/api";
import type { SubscriptionTier } from "@/types/db";

/**
 * Flat-tier billing config (Story 7.2). Maps each tier to the env var holding its
 * fixed monthly Stripe price id, and back from a price id to its tier for the
 * webhook. This is the single place a tier <-> price-id mapping lives so the
 * checkout route, the webhook, and later stories (7.5 tier change) share one
 * source of truth.
 *
 * Server-only: price ids are read from server env at call time, never bundled.
 * There is deliberately NO metered/usage price here — the model is flat-tier
 * (Boundaries: never reuse the stale `STRIPE_METERED_PRICE_ID`).
 *
 * Price ids are read at call time (not module load) so importing this module
 * never throws at build time when the env is unset; a missing price env surfaces
 * as `AppError(500, "billingUnavailable")` at request time (a controlled 500 that
 * never leaks Stripe internals to the user).
 */

/** The ordered set of valid flat tiers. */
export const TIERS = ["solo", "crew", "shop"] as const;

/** The env var name holding each tier's fixed monthly Stripe price id. */
const TIER_PRICE_ENV: Record<SubscriptionTier, string> = {
  solo: "STRIPE_PRICE_SOLO",
  crew: "STRIPE_PRICE_CREW",
  shop: "STRIPE_PRICE_SHOP",
};

/** The default tier the 7.2 "Add Billing" button posts (plan change deferred to 7.5). */
export const DEFAULT_TIER: SubscriptionTier = "solo";

/** Narrow an untrusted string to a valid `SubscriptionTier`. */
export function isSubscriptionTier(value: unknown): value is SubscriptionTier {
  return (
    typeof value === "string" &&
    (TIERS as readonly string[]).includes(value)
  );
}

/**
 * The configured Stripe price id for a tier. Throws
 * `AppError(500, "billingUnavailable")` when the tier's price env is unset — a
 * controlled server error, never a leaked Stripe internal.
 */
export function getPriceIdForTier(tier: SubscriptionTier): string {
  const priceId = process.env[TIER_PRICE_ENV[tier]];
  if (!priceId) {
    throw new AppError(
      500,
      "billingUnavailable",
      `Missing ${TIER_PRICE_ENV[tier]} for tier "${tier}".`,
    );
  }
  return priceId;
}

/**
 * Reverse lookup for the webhook: resolve a Stripe price id back to its tier by
 * comparing against the configured price envs. Returns `null` for an unknown
 * price id (the webhook then falls back to `metadata.tier`, and logs + 200s if
 * that too is unresolvable — never crashing). Reading env at call time means a
 * tier whose env is unset simply does not match (never throws here).
 */
export function priceIdToTier(priceId: string | null | undefined): SubscriptionTier | null {
  if (!priceId) {
    return null;
  }
  for (const tier of TIERS) {
    if (process.env[TIER_PRICE_ENV[tier]] === priceId) {
      return tier;
    }
  }
  return null;
}
