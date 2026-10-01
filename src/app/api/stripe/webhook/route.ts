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
 *   4. on the portal lifecycle events (Story 7.3): resolve the org by
 *      `stripe_subscription_id` (indexed) with a `metadata.org_id` fallback, then
 *      idempotently record the cached `subscription_status`:
 *        - `customer.subscription.deleted` -> `read_only` (straight write);
 *        - `invoice.paid`                  -> `active`;
 *        - `invoice.payment_failed`        -> `past_due`.
 *      `read_only` is TERMINAL for the invoice events: the invoice handlers read
 *      the org's current status and SKIP the write when it is already
 *      `read_only` — only `checkout.session.completed` reactivates a canceled org.
 *      This blocks an out-of-order/redelivered `invoice.paid` from silently
 *      restoring paid access to a canceled account.
 *   5. acknowledge every OTHER event type with 200 `{ received: true }` and NO
 *      state change so a Stripe retry storm is avoided.
 *
 * Unknown price id / missing (or unresolvable) org is logged and 200'd (no crash,
 * no state change) so a misconfiguration never wedges Stripe redelivery.
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
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;
      case "customer.subscription.deleted":
        // Straight idempotent write: the subscription reached true end-of-life
        // (period end for a cancel-at-period-end), so record read_only.
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;
      case "invoice.paid":
        await handleInvoiceStatus(event.data.object as Stripe.Invoice, "active");
        break;
      case "invoice.payment_failed":
        await handleInvoiceStatus(
          event.data.object as Stripe.Invoice,
          "past_due",
        );
        break;
      // Every other event type is acknowledged with no state change (deferred to
      // later stories) so Stripe does not retry-storm.
    }
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
    // Reactivation clears any prior past_due marker [F1] — a completed checkout is a
    // paid, current subscription regardless of what state the org was in before.
    past_due_since: null;
    stripe_customer_id?: string;
  } = {
    subscription_status: "active",
    subscription_tier: tier,
    stripe_subscription_id: subscriptionId,
    past_due_since: null,
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
 * `customer.subscription.deleted` (Story 7.3): the subscription reached true
 * end-of-life (Stripe fires this at period end for a cancel-at-period-end, not at
 * the cancel request), so record `read_only`. Straight idempotent write — a
 * re-delivery lands the same value. `read_only` is terminal for lifecycle events:
 * only a new `checkout.session.completed` moves an org back out of it.
 */
async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<void> {
  const orgId = await resolveOrgForSubscription(
    subscription.id ?? null,
    (subscription.metadata ?? null) as Record<string, unknown> | null,
  );
  if (!orgId) {
    reportError(
      new Error("customer.subscription.deleted with unresolvable org"),
      { route: "/api/stripe/webhook", subscriptionId: subscription.id },
    );
    return;
  }
  await writeOrgStatus(orgId, "read_only");
}

/**
 * `invoice.paid` -> `active` / `invoice.payment_failed` -> `past_due` (Story 7.3).
 * An invoice lifecycle event only acts on an already-SUBSCRIBED org (`active` or
 * `past_due`); any other current status is skipped [F2/F11, retro]:
 *   - `read_only` is terminal — a stale/redelivered/out-of-order `invoice.paid`
 *     must never restore paid access to a canceled account (only a new
 *     `checkout.session.completed` reactivates);
 *   - `trial` means `checkout.session.completed` has not landed yet — it is the
 *     SOLE trial -> active writer (it also records the tier + subscription id), so
 *     an out-of-order invoice event must not pre-empt it (which would set `active`
 *     with a null tier) nor mis-transition the trial straight to `past_due`.
 * On `past_due`, the first-entry time is stamped into `past_due_since` [F1] and
 * preserved across redeliveries; recovery to `active` clears it.
 */
async function handleInvoiceStatus(
  invoice: Stripe.Invoice,
  target: "active" | "past_due",
): Promise<void> {
  const subscriptionId = extractSubscriptionId(invoice);
  const orgId = await resolveOrgForSubscription(
    subscriptionId,
    invoiceSubscriptionMetadata(invoice),
  );
  if (!orgId) {
    reportError(new Error(`${target} invoice event with unresolvable org`), {
      route: "/api/stripe/webhook",
      invoiceId: invoice.id,
    });
    return;
  }

  const adminClient = createAdminClient();
  const { data: orgRow, error: readError } = await adminClient
    .from("organizations")
    .select("subscription_status, past_due_since")
    .eq("id", orgId)
    .maybeSingle();
  if (readError) {
    throw new Error(
      `Failed to read org ${orgId} status for invoice event: ${readError.message}`,
    );
  }

  const current = orgRow?.subscription_status as string | undefined;
  if (current !== "active" && current !== "past_due") {
    // Not a subscribed org (read_only terminal, or trial awaiting checkout) — skip.
    reportError(
      new Error(
        `invoice ${target} event skipped: org status=${current} is not subscribed`,
      ),
      { route: "/api/stripe/webhook", orgId, invoiceId: invoice.id },
    );
    return;
  }

  if (target === "active") {
    // Recovery: clear the past_due marker (handled inside writeOrgStatus).
    await writeOrgStatus(orgId, "active", adminClient);
    return;
  }

  // target === "past_due": stamp the first-entry time, preserve it on redelivery.
  const update: {
    subscription_status: "past_due";
    past_due_since?: string;
  } = { subscription_status: "past_due" };
  if (!orgRow?.past_due_since) {
    update.past_due_since = new Date().toISOString();
  }
  const { error } = await adminClient
    .from("organizations")
    .update(update)
    .eq("id", orgId);
  if (error) {
    throw new Error(
      `Failed to set org ${orgId} status=past_due: ${error.message}`,
    );
  }
}

/**
 * Resolve the org for a lifecycle event: by `stripe_subscription_id` (the UNIQUE
 * index guarantees `.maybeSingle()` cannot throw on duplicates), falling back to
 * the `org_id` carried in the subscription's metadata (set by 7.2's
 * `subscription_data.metadata`). Returns null when neither resolves (caller logs
 * + 200s, never crashes).
 */
async function resolveOrgForSubscription(
  subscriptionId: string | null,
  metadata: Record<string, unknown> | null,
): Promise<string | null> {
  if (subscriptionId) {
    const adminClient = createAdminClient();
    const { data, error } = await adminClient
      .from("organizations")
      .select("id")
      .eq("stripe_subscription_id", subscriptionId)
      .maybeSingle();
    if (error) {
      throw new Error(
        `Failed to resolve org for subscription ${subscriptionId}: ${error.message}`,
      );
    }
    if (data?.id) {
      return data.id as string;
    }
  }

  const metaOrgId = metadata?.org_id;
  if (typeof metaOrgId === "string" && metaOrgId) {
    return metaOrgId;
  }
  return null;
}

/**
 * Idempotent `subscription_status` write via the service-role admin client. An
 * optional pre-built client is reused (the invoice handler already made one for
 * its status read) to avoid a second instantiation.
 */
async function writeOrgStatus(
  orgId: string,
  status: "active" | "read_only",
  adminClient = createAdminClient(),
): Promise<void> {
  // Both states are definitively NOT past_due, so clear the past_due marker [F1].
  // (The past_due write manages its own marker and never routes through here.)
  const { error } = await adminClient
    .from("organizations")
    .update({ subscription_status: status, past_due_since: null })
    .eq("id", orgId);
  if (error) {
    throw new Error(
      `Failed to set org ${orgId} status=${status}: ${error.message}`,
    );
  }
}

/**
 * The subscription id carried by an invoice. Handles both shapes the SDK returns:
 * a string id, or an expanded `Subscription` object. Also tolerates the API's
 * `parent.subscription_details` shape where the linkage lives under `parent`.
 * Returns null when no subscription is present (caller falls back to metadata).
 */
function extractSubscriptionId(invoice: Stripe.Invoice): string | null {
  const direct = (invoice as { subscription?: unknown }).subscription;
  if (typeof direct === "string" && direct) {
    return direct;
  }
  if (direct && typeof direct === "object" && "id" in direct) {
    const id = (direct as { id?: unknown }).id;
    if (typeof id === "string" && id) {
      return id;
    }
  }

  const parentSub = (
    invoice as {
      parent?: { subscription_details?: { subscription?: unknown } };
    }
  ).parent?.subscription_details?.subscription;
  if (typeof parentSub === "string" && parentSub) {
    return parentSub;
  }
  if (parentSub && typeof parentSub === "object" && "id" in parentSub) {
    const id = (parentSub as { id?: unknown }).id;
    if (typeof id === "string" && id) {
      return id;
    }
  }
  return null;
}

/**
 * The subscription metadata carried by an invoice, checked across both shapes:
 * the newer `parent.subscription_details.metadata` and the legacy top-level
 * `subscription_details.metadata`. Used as the org-resolution fallback when the
 * subscription id misses (7.2 stamps `org_id` into `subscription_data.metadata`).
 */
function invoiceSubscriptionMetadata(
  invoice: Stripe.Invoice,
): Record<string, unknown> | null {
  const parentMeta = (
    invoice as {
      parent?: { subscription_details?: { metadata?: unknown } };
    }
  ).parent?.subscription_details?.metadata;
  if (parentMeta && typeof parentMeta === "object") {
    return parentMeta as Record<string, unknown>;
  }
  const topMeta = (
    invoice as { subscription_details?: { metadata?: unknown } }
  ).subscription_details?.metadata;
  if (topMeta && typeof topMeta === "object") {
    return topMeta as Record<string, unknown>;
  }
  return null;
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
