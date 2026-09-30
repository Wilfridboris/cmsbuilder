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
import { portalBodySchema } from "./schemas";

/**
 * `POST /api/stripe/portal` — open the Stripe-hosted Customer Portal (Story 7.3,
 * FR31). The self-serve billing surface for an Admin whose org already has a
 * subscription: update the card, view invoice history, or cancel — all on Stripe.
 *
 * Admin-only, enforced server-side via the same `requireUser` →
 * `resolveAdminIdentity(slug, user)` chain as 7.2's checkout (a
 * non-member/Member/cross-org admin is rejected 401/403 BEFORE any Stripe call).
 * Then: validate the body (`slug`) → read the org's cached `stripe_customer_id`
 * via the service-role admin client → if there is no customer (e.g. a trial org
 * that never checked out) reject `AppError(409, "noSubscription")` BEFORE any
 * Stripe call → create a `billingPortal.sessions.create` session for that
 * customer with a `return_url` back to the settings billing section → return
 * `{ data: { url } }` for the client to redirect to.
 *
 * Scheza renders NO card form, price, or invoice in-app (FR53): the portal and
 * all its features (card, invoice history, cancel-anytime, no contract) are the
 * Stripe Dashboard's default portal configuration, not code. Passing no
 * `configuration` uses the account default. Every failure resolves to a
 * translated key via the `{ data, error }` envelope; raw Stripe internals never
 * leak (a Stripe failure is `billingUnavailable` 500 from `handleError`).
 *
 * The `stripe_customer_id` read uses the service-role admin client scoped to the
 * already-resolved `orgId`: the caller is a proven Admin of that exact org.
 */

export const dynamic = "force-dynamic";

/** The POST response: the Stripe-hosted Customer Portal URL to redirect to. */
export type PortalPayload = { url: string };

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<PortalPayload>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }

    const parsed = portalBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug } = parsed.data;

    // Authenticate + authorize BEFORE any Stripe call — a non-admin never reaches
    // the Stripe API (the frozen matrix row).
    const user = await requireUser();
    const identity = await resolveAdminIdentity(slug, user);

    const adminClient = createAdminClient();

    // Read the org's cached Stripe customer id (service-role; the caller is a
    // proven Admin of this exact org).
    const { data: orgRow, error: orgReadError } = await adminClient
      .from("organizations")
      .select("stripe_customer_id")
      .eq("id", identity.orgId)
      .maybeSingle();
    if (orgReadError) {
      throw new AppError(500, "genericError", orgReadError.message);
    }

    const customerId = (orgRow?.stripe_customer_id as string | null) ?? null;
    if (!customerId) {
      // No Stripe customer (a trial org that never checked out) — reject before
      // any Stripe call. The Settings surface only shows "Manage billing" for
      // active/past_due orgs (which always have a customer), so this is a
      // defense-in-depth guard against a direct/racing call.
      throw new AppError(409, "noSubscription");
    }

    const stripe = getStripeClient();
    let session;
    try {
      session = await stripe.billingPortal.sessions.create({
        customer: customerId,
        return_url: `${req.nextUrl.origin}/${slug}/settings#billing`,
      });
    } catch (stripeErr) {
      // Any Stripe API failure (network, config, rate-limit) surfaces as the
      // matrix's billingUnavailable 500 — never leak raw Stripe internals.
      throw new AppError(
        500,
        "billingUnavailable",
        stripeErr instanceof Error ? stripeErr.message : "Stripe portal error.",
      );
    }

    if (!session.url) {
      throw new AppError(500, "billingUnavailable", "Portal session has no URL.");
    }

    return json<PortalPayload>({ data: { url: session.url }, error: null }, 200);
  } catch (err) {
    return handleError<PortalPayload>(err, "/api/stripe/portal");
  }
}
