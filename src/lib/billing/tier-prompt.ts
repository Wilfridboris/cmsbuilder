import "server-only";

import type { SubscriptionTier } from "@/types/db";
import { TIER_INVOICE_BANDS, nextTierUp } from "@/lib/billing/tiers";

/**
 * The tier-change prompt predicate (Story 7.5, FR55 — the no-silent-overage trust
 * promise). A small, pure, dependency-light server-only module that is the ONE
 * place the "should this subscribed org be nudged up a plan?" rule lives, mirroring
 * `access.ts`'s module style, so the Settings page never re-derives it.
 *
 * The rule (frozen Decision): the prompt fires when the LAST FULLY COMPLETED billing
 * cycle's issued-invoice count EXCEEDS the current tier's configured band
 * (`TIER_INVOICE_BANDS`). A single completed over-band cycle is the sustained signal
 * — a mid-cycle partial count never triggers (the caller only ever passes the last
 * completed cycle's count). Shop (no cap) never prompts. The prompt is ADVISORY only:
 * it never gates, never auto-charges, never meters overage — the change happens on
 * the Stripe Customer Portal.
 */

/**
 * True when the org should see a non-blocking "move up a plan" prompt: it is on a
 * tier that HAS a band (not Shop) AND its last completed billing cycle's issued count
 * strictly exceeds that band. A tier with no cap (`null` band, i.e. Shop) never
 * prompts; a count within band never prompts. `issuedLastCycle` is the count over the
 * LAST FULLY COMPLETED cycle (the caller passes 0 / omits when there is no completed
 * cycle yet, which stays within band and so never prompts).
 */
export function shouldPromptUpgrade(
  tier: SubscriptionTier,
  issuedLastCycle: number,
): boolean {
  const band = TIER_INVOICE_BANDS[tier];
  // No cap (Shop) never prompts; and there must be a tier to move up to.
  if (band === null || nextTierUp(tier) === null) {
    return false;
  }
  return issuedLastCycle > band;
}
