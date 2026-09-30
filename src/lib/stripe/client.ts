import "server-only";

import Stripe from "stripe";

/**
 * The single server-only Stripe client entry point (Story 7.2). Reused by the
 * checkout route (create customer + Checkout session) and the webhook route
 * (signature verification). Server-only: `STRIPE_SECRET_KEY` must never enter a
 * client bundle.
 *
 * Mirrors `lib/gemini/client.ts`: a shared client is instantiated lazily on
 * first call and the env var is read at call time, so importing this module
 * never throws at build time when `STRIPE_SECRET_KEY` is absent (the routes are
 * dynamic; the key is only needed at request time). A clear error is thrown when
 * the key is missing so a misconfiguration surfaces as a controlled 500, never a
 * leaked Stripe internal.
 */

// Pinned to the SDK's bundled API version (stripe@22.1.1) so a future Stripe
// dashboard default change never silently alters request/response shapes.
export const STRIPE_API_VERSION = "2026-04-22.dahlia";

let sharedClient: Stripe | null = null;

export function getStripeClient(): Stripe {
  if (!sharedClient) {
    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
      throw new Error("Missing STRIPE_SECRET_KEY for the Stripe client.");
    }
    sharedClient = new Stripe(secretKey, {
      apiVersion: STRIPE_API_VERSION,
    });
  }
  return sharedClient;
}
