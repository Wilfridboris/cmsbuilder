import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import type Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { priceIdToTier, isSubscriptionTier } from "@/lib/billing/tiers";
import { reportError } from "@/lib/observability/report";

/**
 * `POST /api/stripe/webhook` — the Stripe event sink (Story 7.2).
 *
 * The SOLE writer of the trial -> active transition. It must:
 *   1. read the RAW request body (`await req.text()`) BEFORE any parse — HMAC
 *      verification needs the exact bytes. Next 16 route handlers are not
 *      body-parsed by default (Web Request API), so `req.text()` is the raw body.
 *   2. verify every event with `stripe.webhooks.constructEvent` against
 *      `STRIPE_WEBHOOK_SECRET`. A bad/absent signature is rejected 400 and NOT
 *      processed.
 *   3. on `checkout.session.completed`: resolve the org from
 *      `metadata.org_id`/`client_reference_id`, resolve the tier from the session
 *      price id (authoritative) with `metadata.tier` as fallback, and set the org
 *      `subscription_status='active'` + `subscription_tier` + `stripe_subscription_id`
 *      via the service-role admin client (no user session in a Stripe callback).
 *      Idempotent: a re-delivery lands the same values (no corruption).
 *   4. acknowledge every OTHER event type (`customer.subscription.deleted`,
 *      `invoice.payment_failed`, `invoice.paid`, ...) with 200 `{ received: true }`
 *      and NO state change — lapse/cancel handling is deferred to 7.3/7.4, and
 *      200-ing avoids a Stripe retry storm.
 *
 * Unknown price id / missing org on a completed session is logged and 200'd (no
 * crash, no state change) so a misconfiguration never wedges Stripe redelivery.
 */

export const dynamic = "force-dynamic";
// Pin the Node.js runtime: `stripe.webhooks.constructEvent` uses Node crypto for
// HMAC verification and is not Edge-compatible. App Router defaults to Node today,
// but this security-critical signature path must never silently move to Edge.
export const runtime = "nodejs";

function received(): NextResponse {
  return NextResponse.json({ received: true }, { status: 200 });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Misconfiguration: without the secret we cannot verify anything. Fail closed
    // (do not process) but log — never leak details to the caller.
    reportError(new Error("Missing STRIPE_WEBHOOK_SECRET"), {
      route: "/api/stripe/webhook",
    });
    return NextResponse.json({ error: "genericError" }, { status: 500 });
  }

  // Raw body FIRST — required for HMAC verification (never parse before this).
  const rawBody = await req.text();
  const signature = req.headers.get("stripe-signature");

  const stripe = getStripeClient();

  let event: Stripe.Event;
  try {
    if (!signature) {
      throw new Error("Missing stripe-signature header");
    }
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch {
    // Bad/absent signature — rejected and NOT processed. No detail leaked.
    return NextResponse.json({ error: "invalidSignature" }, { status: 400 });
  }

  try {
    if (event.type === "checkout.session.completed") {
      await handleCheckoutCompleted(event.data.object as Stripe.Checkout.Session);
    }
    // Every other event type is acknowledged with no state change (deferred to
    // later stories) so Stripe does not retry-storm.
  } catch (err) {
    // A processing failure is logged; we still 200 so Stripe does not retry
    // forever on a persistent bug. (Signature already verified above.)
    reportError(err, { route: "/api/stripe/webhook", eventType: event.type });
  }

  return received();
}

/**
 * Flip the org to active + record the purchased tier + subscription id. Idempotent:
 * a re-delivered event lands identical values on an already-active org.
 */
async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const metadata = session.metadata ?? {};
  const orgId =
    (typeof metadata.org_id === "string" && metadata.org_id) ||
    (typeof session.client_reference_id === "string" &&
      session.client_reference_id) ||
    null;

  if (!orgId) {
    // No org to resolve — log + no-op (the caller still 200s).
    reportError(new Error("checkout.session.completed without an org id"), {
      route: "/api/stripe/webhook",
      sessionId: session.id,
    });
    return;
  }

  // Resolve the purchased tier from the session's line-item price id
  // (authoritative), falling back to metadata.tier so a valid session with an
  // unexpanded line item still resolves. The price id is authoritative so a
  // tampered metadata.tier cannot grant a different plan than paid for.
  const stripe = getStripeClient();
  let tier = priceIdToTier(await resolveSessionPriceId(stripe, session));
  if (!tier && isSubscriptionTier(metadata.tier)) {
    tier = metadata.tier;
  }

  if (!tier) {
    reportError(new Error("checkout.session.completed with unresolvable tier"), {
      route: "/api/stripe/webhook",
      sessionId: session.id,
      orgId,
    });
    return;
  }

  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : (session.subscription?.id ?? null);

  // The customer id is normally persisted by the checkout route before the session
  // exists; record it here too (idempotent — same value) so AC#2 holds at the
  // webhook and the linkage survives even if the pre-checkout persist path changes.
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : (session.customer?.id ?? null);

  const orgUpdate: {
    subscription_status: "active";
    subscription_tier: typeof tier;
    stripe_subscription_id: string | null;
    stripe_customer_id?: string;
  } = {
    subscription_status: "active",
    subscription_tier: tier,
    stripe_subscription_id: subscriptionId,
  };
  if (customerId) {
    orgUpdate.stripe_customer_id = customerId;
  }

  const adminClient = createAdminClient();
  const { error } = await adminClient
    .from("organizations")
    .update(orgUpdate)
    .eq("id", orgId);

  if (error) {
    // Surface to the outer catch so it is logged; still 200 to Stripe.
    throw new Error(`Failed to activate org ${orgId}: ${error.message}`);
  }
}

/**
 * The price id of the session's single subscription line item. Prefers the price
 * already present on the session (when line items were expanded); otherwise fetches
 * the line items. Returns null when it cannot be determined (caller falls back to
 * metadata.tier).
 */
async function resolveSessionPriceId(
  stripe: Stripe,
  session: Stripe.Checkout.Session,
): Promise<string | null> {
  const inlineItems = session.line_items?.data;
  if (inlineItems && inlineItems.length > 0) {
    return inlineItems[0]?.price?.id ?? null;
  }
  try {
    const lineItems = await stripe.checkout.sessions.listLineItems(session.id, {
      limit: 1,
    });
    return lineItems.data[0]?.price?.id ?? null;
  } catch {
    return null;
  }
}
