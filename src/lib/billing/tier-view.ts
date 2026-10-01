import "server-only";

import { cookies } from "next/headers";

import type { SubscriptionTier } from "@/types/db";
import { priceIdToTier, nextTierUp } from "@/lib/billing/tiers";
import { shouldPromptUpgrade } from "@/lib/billing/tier-prompt";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { countIssuedInvoicesInPeriod } from "@/lib/data/invoices";
import { reportError } from "@/lib/observability/report";

/**
 * Tier-view resolution (Story 7.5, FR54/FR55). Extracted from `settings/page.tsx`
 * (retro [A4]) so the page is a view, not an owner of live-Stripe + billing-cycle
 * domain logic. Does a LIVE Stripe fetch of the subscription: the next billing date
 * and the authoritative current tier come from the subscription ITEM
 * (`items.data[0].current_period_end` / `.price.id` on the pinned API version), and
 * the last fully-completed billing cycle's issued-invoice count drives the advisory
 * upgrade prompt.
 *
 * Graceful degradation (Boundaries / matrix): if the Stripe fetch (or anything after
 * it) throws, log via `reportError` and fall back to the CACHED tier with no
 * next-billing-date and no prompt — the page must never be blocked by Stripe downtime.
 */

/** The read-only tier-view props the page passes to `<TierView>` (Story 7.5). */
export type TierViewData = {
  tier: SubscriptionTier;
  nextBillingDate: string | null;
  showUpgradePrompt: boolean;
  suggestedTier: SubscriptionTier | null;
};

/**
 * The UTC instant exactly one calendar month before `ms`, clamping the day to the
 * target month's length (retro [F9]). Monthly Stripe cycles vary 28-31 days, so the
 * last completed cycle is the PRIOR calendar month `[oneMonthBefore(periodStart),
 * periodStart)` — not `periodStart - currentCycleLength`, which uses the current
 * cycle's length to reach back and lands a day or two off at month boundaries.
 * Clamping matches Stripe's own anchor behavior (a Jan-31 anchor bills Feb-28).
 */
export function oneMonthBeforeUtc(ms: number): number {
  const d = new Date(ms);
  const year = d.getUTCFullYear();
  const month = d.getUTCMonth();
  const day = d.getUTCDate();
  const targetYear = month === 0 ? year - 1 : year;
  const targetMonth = month === 0 ? 11 : month - 1;
  // Days in the target month (day 0 of the next month = last day of this one).
  const daysInTarget = new Date(
    Date.UTC(targetYear, targetMonth + 1, 0),
  ).getUTCDate();
  const clampedDay = Math.min(day, daysInTarget);
  return Date.UTC(
    targetYear,
    targetMonth,
    clampedDay,
    d.getUTCHours(),
    d.getUTCMinutes(),
    d.getUTCSeconds(),
    d.getUTCMilliseconds(),
  );
}

export async function resolveTierView(
  orgId: string,
  subscriptionId: string,
  cachedTier: SubscriptionTier,
): Promise<TierViewData> {
  try {
    // Lazy-load the Stripe client so the heavy SDK stays OUT of the page module's
    // eager import graph: unauthenticated / trial / read-only settings loads (the
    // common path) never pay to evaluate it, and only a subscribed org resolving its
    // tier view pulls it in.
    const { getStripeClient } = await import("@/lib/stripe/client");
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // On the pinned API version the billing-period boundaries + price live on the
    // subscription ITEM, not top-level.
    const item = subscription.items?.data?.[0];
    const periodEndSec = item?.current_period_end ?? null;
    const periodStartSec = item?.current_period_start ?? null;

    // Authoritative tier from the item's price id; fall back to the cached tier when
    // the price id does not reverse-map (misconfiguration — surfaced by the reconcile
    // cron, never blocking the view).
    const authoritativeTier =
      priceIdToTier(item?.price?.id ?? null) ?? cachedTier;

    const nextBillingDate =
      periodEndSec !== null
        ? new Date(periodEndSec * 1000).toISOString()
        : null;

    // Count issued invoices over the LAST FULLY COMPLETED calendar-month cycle:
    // [oneMonthBefore(current_period_start), current_period_start). [retro F9]
    let issuedLastCycle = 0;
    if (periodStartSec !== null) {
      const periodStartMs = periodStartSec * 1000;
      const lastCycleStartMs = oneMonthBeforeUtc(periodStartMs);
      const cookieStore = await cookies();
      const rlsClient = createServerSupabaseClient(cookieStore);
      const startDate = new Date(lastCycleStartMs).toISOString().slice(0, 10);
      const endDate = new Date(periodStartMs).toISOString().slice(0, 10);
      issuedLastCycle = await countIssuedInvoicesInPeriod(
        rlsClient,
        orgId,
        startDate,
        endDate,
      );
    }

    const showUpgradePrompt = shouldPromptUpgrade(
      authoritativeTier,
      issuedLastCycle,
    );

    return {
      tier: authoritativeTier,
      nextBillingDate,
      showUpgradePrompt,
      suggestedTier: showUpgradePrompt ? nextTierUp(authoritativeTier) : null,
    };
  } catch (err) {
    // Degrade gracefully: cached tier + inclusions only, no date, no prompt.
    reportError(err, { route: "/[slug]/settings", orgId, subscriptionId });
    return {
      tier: cachedTier,
      nextBillingDate: null,
      showUpgradePrompt: false,
      suggestedTier: null,
    };
  }
}
