import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import {
  json,
  requireUser,
  resolveAdminIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { getPriceIdForTier } from "@/lib/billing/tiers";
import { checkoutBodySchema } from "./schemas";

/**
 * `POST /api/stripe/checkout` — start a flat-tier subscription (Story 7.2, FR30/FR53).
 *
 * Admin-only, enforced server-side via the shared `requireUser` →
 * `resolveAdminIdentity(slug, user)` chain (a non-member/Member/cross-org admin is
 * rejected 401/403 BEFORE any Stripe call). Then: validate the body (`slug` +
 * `tier`; an invalid tier is `invalidTier` 400) → ensure/create the org's Stripe
 * customer and persist `stripe_customer_id` → create a `mode:"subscription"`
 * Stripe-hosted Checkout session at the tier's fixed monthly price, carrying
 * `client_reference_id`=orgId and `metadata.org_id`/`metadata.tier` so the webhook
 * can resolve the org → return `{ data: { url } }` for the client to redirect to.
 *
 * Scheza renders NO card form and NO price (FR53) — this route only hands off to
 * Stripe's hosted page. Every failure resolves to a translated key via the
 * `{ data, error }` envelope; raw Stripe internals never leak (a missing price env
 * is `billingUnavailable` 500, thrown by the tiers config).
 *
 * The `stripe_customer_id` persist uses the service-role admin client scoped to the
 * already-resolved `orgId`: `organizations` UPDATE is service-role only under RLS,
 * and the caller is already proven to be an Admin of that exact org.
 */

export const dynamic = "force-dynamic";

/** The POST response: the Stripe-hosted Checkout URL to redirect to. */
export type CheckoutStartPayload = { url: string };

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<CheckoutStartPayload>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }

    const parsed = checkoutBodySchema.safeParse(raw);
    if (!parsed.success) {
      // A missing/invalid tier (or slug) is a 400 with the tier-specific key so
      // the client shows the right copy. The auth gate below still runs for a
      // valid slug; here the body itself is malformed.
      throw new AppError(400, "invalidTier");
    }
    const { slug, tier } = parsed.data;

    // Authenticate + authorize BEFORE any Stripe call — a non-admin never reaches
    // the Stripe API (the frozen matrix row).
    const user = await requireUser();
    const identity = await resolveAdminIdentity(slug, user);

    // Resolve the tier's price id (throws billingUnavailable 500 if the env is
    // unset) before touching Stripe.
    const priceId = getPriceIdForTier(tier);

    const stripe = getStripeClient();
    const adminClient = createAdminClient();

    // Read the org's cached Stripe customer id (service-role; RLS UPDATE on
    // organizations is service-role only and the caller is a proven Admin of this
    // exact org).
    const { data: orgRow, error: orgReadError } = await adminClient
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", identity.orgId)
      .maybeSingle();
    if (orgReadError) {
      throw new AppError(500, "genericError", orgReadError.message);
    }

    let customerId = (orgRow?.stripe_customer_id as string | null) ?? null;

    // Create + persist a Stripe customer on first checkout; reuse it thereafter so
    // later stories (portal 7.3) share the same customer.
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email ?? undefined,
        metadata: { org_id: identity.orgId },
      });
      customerId = customer.id;

      const { error: persistError } = await adminClient
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", identity.orgId);
      if (persistError) {
        throw new AppError(500, "genericError", persistError.message);
      }
    }

    // Stripe-hosted Checkout in subscription mode at the fixed per-tier price. No
    // metered/usage line item (flat-tier model). success/cancel return to the
    // settings billing section. The query string must precede the `#billing`
    // fragment so `?checkout=...` lands in location.search — a fragment-first URL
    // would bury the param inside the hash where a query read never finds it.
    const settingsBase = `${req.nextUrl.origin}/${slug}/settings`;
    const session = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      client_reference_id: identity.orgId,
      metadata: { org_id: identity.orgId, tier },
      subscription_data: {
        metadata: { org_id: identity.orgId, tier },
      },
      success_url: `${settingsBase}?checkout=success#billing`,
      cancel_url: `${settingsBase}?checkout=cancelled#billing`,
    });

    if (!session.url) {
      throw new AppError(500, "billingUnavailable", "Checkout session has no URL.");
    }

    return json<CheckoutStartPayload>({ data: { url: session.url }, error: null }, 200);
  } catch (err) {
    return handleError<CheckoutStartPayload>(err, "/api/stripe/checkout");
  }
}
