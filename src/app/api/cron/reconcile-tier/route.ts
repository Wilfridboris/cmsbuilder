import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { SubscriptionTier } from "@/types/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { priceIdToTier } from "@/lib/billing/tiers";
import { json, handleError } from "@/lib/api/route-helpers";
import { reportError, reportCritical } from "@/lib/observability/report";

/**
 * `GET /api/cron/reconcile-tier` — the per-cycle tier-reconciliation sweep (Story
 * 7.5, NFR-R5, the billing-accuracy trust requirement), run by Vercel Cron (see
 * `vercel.json`). Mirrors `trial-lifecycle`'s auth/scan/summary pattern; a separate
 * route because it is a separate concern (one mechanism, many sweeps).
 *
 * Protected by `Authorization: Bearer ${CRON_SECRET}`: a missing/invalid header does
 * NO work and returns 401 (the secret is read at call time). All reads go through the
 * service-role admin client (no user session) — a platform-ops path over every org.
 *
 * For each subscribed org (`subscription_status in ('active','past_due')` with a
 * non-null `stripe_subscription_id`): retrieve its Stripe subscription, reverse-map
 * the subscription ITEM's price id to a tier (`priceIdToTier`), and on any mismatch
 * vs the stored `subscription_tier` emit a HIGH-SEVERITY Sentry alert via
 * `reportCritical({ orgId, storedTier, stripeTier })`. It CORRECTS NOTHING — the
 * webhook remains the sole writer of `subscription_tier`, avoiding a cron/webhook
 * write race, and `subscription_status` stays the access authority (reconciliation
 * never touches the access path). A single org's Stripe error is logged via
 * `reportError` and the sweep continues (per-org isolation).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SubscribedOrg = {
  id: string;
  subscription_tier: SubscriptionTier | null;
  stripe_subscription_id: string | null;
};

export type ReconcileTierSummary = {
  /** How many subscribed orgs the sweep checked. */
  processed: number;
  /** How many of them had a Stripe-held tier differing from the stored tier. */
  drifted: number;
};

/**
 * The price id of the subscription's first item. On the pinned API version the price
 * lives on the subscription ITEM (`subscription.items.data[0].price.id`), not
 * top-level (the webhook already reads items this way). Returns null when absent.
 */
function resolveSubscriptionPriceId(
  subscription: Stripe.Subscription,
): string | null {
  return subscription.items?.data?.[0]?.price?.id ?? null;
}

export async function GET(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<ReconcileTierSummary>>> {
  try {
    // 1. Authorize via the shared cron secret (read at call time). No valid header
    //    → 401 with NO reads/writes.
    const secret = process.env.CRON_SECRET;
    const header = req.headers.get("authorization");
    if (!secret || header !== `Bearer ${secret}`) {
      throw new AppError(401, "unauthorized");
    }

    const adminClient = createAdminClient();

    // 2. Load every subscribed org with a Stripe subscription to check.
    const { data: orgs, error } = await adminClient
      .from("organizations")
      .select("id, subscription_tier, stripe_subscription_id")
      .in("subscription_status", ["active", "past_due"])
      .not("stripe_subscription_id", "is", null);
    if (error) {
      throw new AppError(500, "genericError", error.message);
    }

    const subscribedOrgs = (orgs ?? []) as SubscribedOrg[];
    const stripe = getStripeClient();
    let drifted = 0;

    for (const org of subscribedOrgs) {
      if (!org.stripe_subscription_id) {
        continue;
      }
      try {
        const subscription = await stripe.subscriptions.retrieve(
          org.stripe_subscription_id,
        );
        const stripeTier = priceIdToTier(
          resolveSubscriptionPriceId(subscription),
        );

        // A null stripeTier means the price id did not reverse-map to a known tier
        // (misconfiguration): that IS a drift from the stored tier worth paging.
        if (stripeTier !== org.subscription_tier) {
          drifted += 1;
          // High-severity alert ONLY — no DB write. The webhook is the sole writer
          // of subscription_tier; this surfaces drift for a human (NFR-R5).
          reportCritical(
            new Error(
              `Subscription tier drift for org ${org.id}: stored=${org.subscription_tier}, stripe=${stripeTier}`,
            ),
            {
              route: "/api/cron/reconcile-tier",
              orgId: org.id,
              storedTier: org.subscription_tier,
              stripeTier,
            },
          );
        }
      } catch (orgErr) {
        // Per-org isolation: one failing Stripe retrieve is logged and the sweep
        // continues over the rest of the orgs.
        reportError(orgErr, {
          route: "/api/cron/reconcile-tier",
          orgId: org.id,
          subscriptionId: org.stripe_subscription_id,
        });
      }
    }

    return json<ReconcileTierSummary>(
      { data: { processed: subscribedOrgs.length, drifted }, error: null },
      200,
    );
  } catch (err) {
    return handleError<ReconcileTierSummary>(err, "/api/cron/reconcile-tier");
  }
}
