import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `POST /api/stripe/webhook` (Story 7.2) WITHOUT a live Stripe
 * or DB. The Stripe SDK (`constructEvent`, `listLineItems`) and the service-role
 * admin client are mocked. Locks the frozen matrix rows:
 *   - invalid/absent signature → 400, event NOT processed (no org update);
 *   - checkout.session.completed → org set active + tier + subscription id;
 *   - tier resolved from the price id is AUTHORITATIVE over metadata.tier;
 *   - duplicate delivery → same write (idempotent no-op on already-active org);
 *   - unhandled event type → 200 { received: true }, no org update;
 *   - missing org / unresolvable tier → logged + 200, no org update.
 */

const constructEvent = vi.fn();
const listLineItems = vi.fn();
const adminUpdate = vi.fn();
const reportError = vi.fn();

/**
 * Configurable `select().eq(col, value).maybeSingle()` responses keyed by the
 * filter column. The Story 7.3 handlers read twice: resolve the org by
 * `stripe_subscription_id`, and (for invoice events) read the org's current
 * `subscription_status` by `id`. A test sets `orgById` / `orgBySubscription` to
 * drive each.
 */
let orgBySubscription: { data: unknown; error: unknown };
let orgById: { data: unknown; error: unknown };

function makeAdminClient() {
  return {
    from() {
      return {
        select: () => ({
          eq: (col: string, _value: string) => ({
            maybeSingle: async () =>
              col === "stripe_subscription_id" ? orgBySubscription : orgById,
          }),
        }),
        update: (patch: unknown) => ({
          eq: async (_col: string, id: string) => adminUpdate(patch, id),
        }),
      };
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeAdminClient() }));
vi.mock("@/lib/stripe/client", () => ({
  getStripeClient: () => ({
    webhooks: { constructEvent },
    checkout: { sessions: { listLineItems } },
  }),
}));
vi.mock("@/lib/observability/report", () => ({ reportError }));

function webhookReq(rawBody: string, signature: string | null): NextRequest {
  return {
    text: async () => rawBody,
    headers: { get: (name: string) => (name === "stripe-signature" ? signature : null) },
  } as unknown as NextRequest;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  adminUpdate.mockResolvedValue({ error: null });
  listLineItems.mockResolvedValue({ data: [{ price: { id: "price_solo_123" } }] });
  // Default: subscription resolves to org-1, whose current status is 'active'
  // (not read_only) so invoice events proceed to a write.
  orgBySubscription = { data: { id: "org-1" }, error: null };
  orgById = { data: { subscription_status: "active" }, error: null };
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  process.env.STRIPE_PRICE_SOLO = "price_solo_123";
  process.env.STRIPE_PRICE_CREW = "price_crew_456";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

function completedEvent(session: Record<string, unknown>) {
  return { type: "checkout.session.completed", data: { object: session } };
}

describe("POST /api/stripe/webhook", () => {
  it("fails closed (500) and does NOT process when STRIPE_WEBHOOK_SECRET is absent", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    delete process.env.STRIPE_WEBHOOK_SECRET;
    const res = await POST(webhookReq("{}", "good-sig"));
    expect(res.status).toBe(500);
    // The verification path is never reached and no state is changed.
    expect(constructEvent).not.toHaveBeenCalled();
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("400 and does NOT process when the signature is invalid", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockImplementation(() => {
      throw new Error("bad signature");
    });
    const res = await POST(webhookReq("{}", "bad-sig"));
    expect(res.status).toBe(400);
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("400 and does NOT process when the signature header is absent", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const res = await POST(webhookReq("{}", null));
    expect(res.status).toBe(400);
    expect(constructEvent).not.toHaveBeenCalled();
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("checkout.session.completed sets active + tier + subscription id", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue(
      completedEvent({
        id: "cs_1",
        metadata: { org_id: "org-1", tier: "solo" },
        client_reference_id: "org-1",
        subscription: "sub_123",
        line_items: { data: [{ price: { id: "price_solo_123" } }] },
      }),
    );
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(adminUpdate).toHaveBeenCalledWith(
      {
        subscription_status: "active",
        subscription_tier: "solo",
        stripe_subscription_id: "sub_123",
        past_due_since: null,
      },
      "org-1",
    );
  });

  it("also records stripe_customer_id from session.customer when present (idempotent backfill)", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue(
      completedEvent({
        id: "cs_1",
        metadata: { org_id: "org-1", tier: "solo" },
        subscription: "sub_123",
        customer: "cus_abc",
        line_items: { data: [{ price: { id: "price_solo_123" } }] },
      }),
    );
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).toHaveBeenCalledWith(
      {
        subscription_status: "active",
        subscription_tier: "solo",
        stripe_subscription_id: "sub_123",
        past_due_since: null,
        stripe_customer_id: "cus_abc",
      },
      "org-1",
    );
  });

  it("resolves the tier from the price id AUTHORITATIVELY over metadata.tier", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    // metadata claims 'shop' but the actual price id is the crew price → crew wins.
    constructEvent.mockReturnValue(
      completedEvent({
        id: "cs_1",
        metadata: { org_id: "org-1", tier: "shop" },
        subscription: "sub_123",
        line_items: { data: [{ price: { id: "price_crew_456" } }] },
      }),
    );
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate.mock.calls[0][0].subscription_tier).toBe("crew");
  });

  it("falls back to metadata.tier when the price id is unknown", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue(
      completedEvent({
        id: "cs_1",
        metadata: { org_id: "org-1", tier: "crew" },
        subscription: "sub_123",
        line_items: { data: [{ price: { id: "price_unknown" } }] },
      }),
    );
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate.mock.calls[0][0].subscription_tier).toBe("crew");
  });

  it("resolves the org from client_reference_id when metadata.org_id is absent", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue(
      completedEvent({
        id: "cs_1",
        metadata: {},
        client_reference_id: "org-9",
        subscription: "sub_9",
        line_items: { data: [{ price: { id: "price_solo_123" } }] },
      }),
    );
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).toHaveBeenCalledWith(expect.anything(), "org-9");
  });

  it("is idempotent: a duplicate delivery lands the same write", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    const event = completedEvent({
      id: "cs_1",
      metadata: { org_id: "org-1", tier: "solo" },
      subscription: "sub_123",
      line_items: { data: [{ price: { id: "price_solo_123" } }] },
    });
    constructEvent.mockReturnValue(event);
    const first = await POST(webhookReq("{...}", "good-sig"));
    const second = await POST(webhookReq("{...}", "good-sig"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(adminUpdate).toHaveBeenCalledTimes(2);
    expect(adminUpdate.mock.calls[0]).toEqual(adminUpdate.mock.calls[1]);
  });

  it("unhandled event type → 200 { received: true } with no org update", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue({
      type: "customer.subscription.updated",
      data: { object: {} },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  // --- Story 7.3 lifecycle events -----------------------------------------

  it("customer.subscription.deleted sets the org read_only (resolved by subscription id)", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_123", metadata: { org_id: "org-1" } } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).toHaveBeenCalledWith(
      { subscription_status: "read_only", past_due_since: null },
      "org-1",
    );
  });

  it("invoice.paid sets active when the org is NOT read_only", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: { object: { id: "in_1", subscription: "sub_123" } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    // Recovery to active clears the past_due marker [F1].
    expect(adminUpdate).toHaveBeenCalledWith(
      { subscription_status: "active", past_due_since: null },
      "org-1",
    );
  });

  it("invoice.payment_failed sets past_due and stamps past_due_since when the org is NOT read_only", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue({
      type: "invoice.payment_failed",
      data: { object: { id: "in_2", subscription: "sub_123" } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    // Entering past_due from active stamps the first-entry time [F1].
    const [patch, id] = adminUpdate.mock.calls[0];
    expect(id).toBe("org-1");
    expect(patch.subscription_status).toBe("past_due");
    expect(typeof patch.past_due_since).toBe("string");
  });

  it("invoice.payment_failed preserves an existing past_due_since on redelivery", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    orgById = {
      data: {
        subscription_status: "past_due",
        past_due_since: "2026-09-01T00:00:00.000Z",
      },
      error: null,
    };
    constructEvent.mockReturnValue({
      type: "invoice.payment_failed",
      data: { object: { id: "in_2b", subscription: "sub_123" } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    // Already past_due → do not re-stamp (the update omits past_due_since).
    const [patch] = adminUpdate.mock.calls[0];
    expect(patch).toEqual({ subscription_status: "past_due" });
  });

  it("[F2] invoice.payment_failed on a trial org performs no write (checkout is the sole activator)", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    orgById = { data: { subscription_status: "trial" }, error: null };
    constructEvent.mockReturnValue({
      type: "invoice.payment_failed",
      data: { object: { id: "in_trial", subscription: "sub_123" } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("[F2] invoice.paid on a trial org performs no write (only checkout.session.completed activates a trial)", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    orgById = { data: { subscription_status: "trial" }, error: null };
    constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: { object: { id: "in_trial2", subscription: "sub_123" } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("read_only is TERMINAL: invoice.paid on a read_only org performs no write", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    orgById = { data: { subscription_status: "read_only" }, error: null };
    constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: { object: { id: "in_1", subscription: "sub_123" } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("read_only is TERMINAL: invoice.payment_failed on a read_only org performs no write", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    orgById = { data: { subscription_status: "read_only" }, error: null };
    constructEvent.mockReturnValue({
      type: "invoice.payment_failed",
      data: { object: { id: "in_2", subscription: "sub_123" } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("invoice.paid resolves the org via metadata.org_id when the subscription id misses (parent.subscription_details.metadata)", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    // Subscription-id lookup misses (no row); fall back to the invoice's
    // parent.subscription_details.metadata.org_id.
    orgBySubscription = { data: null, error: null };
    constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: {
        object: {
          id: "in_3",
          subscription: "sub_unknown",
          parent: {
            subscription_details: { metadata: { org_id: "org-meta" } },
          },
        },
      },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).toHaveBeenCalledWith(
      { subscription_status: "active", past_due_since: null },
      "org-meta",
    );
  });

  it("invoice.paid extracts the subscription id from an expanded subscription object", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: { object: { id: "in_4", subscription: { id: "sub_123" } } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    // Resolved via the subscription-id lookup (orgBySubscription → org-1).
    expect(adminUpdate).toHaveBeenCalledWith(
      { subscription_status: "active", past_due_since: null },
      "org-1",
    );
  });

  it("customer.subscription.deleted resolves via metadata.org_id fallback when the id misses", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    orgBySubscription = { data: null, error: null };
    constructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_gone", metadata: { org_id: "org-meta" } } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).toHaveBeenCalledWith(
      { subscription_status: "read_only", past_due_since: null },
      "org-meta",
    );
  });

  it("lifecycle event with an unresolvable org → logged + 200, no update", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    orgBySubscription = { data: null, error: null };
    constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: { object: { id: "in_x", subscription: "sub_unknown" } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalled();
  });

  it("customer.subscription.deleted is a duplicate no-op (same write on re-delivery)", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: { object: { id: "sub_123", metadata: { org_id: "org-1" } } },
    });
    await POST(webhookReq("{...}", "good-sig"));
    await POST(webhookReq("{...}", "good-sig"));
    expect(adminUpdate).toHaveBeenCalledTimes(2);
    expect(adminUpdate.mock.calls[0]).toEqual(adminUpdate.mock.calls[1]);
  });

  it("invoice.paid resolves the subscription id from parent.subscription_details.subscription (pinned .dahlia API shape)", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    // On the pinned 2026-04-22.dahlia API there is no top-level `subscription`;
    // the linkage lives under parent.subscription_details.subscription. Resolve
    // by subscription id (orgBySubscription → org-1), no metadata fallback.
    constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: {
        object: {
          id: "in_dahlia",
          parent: { subscription_details: { subscription: "sub_123" } },
        },
      },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).toHaveBeenCalledWith(
      { subscription_status: "active", past_due_since: null },
      "org-1",
    );
  });

  it("checkout.session.completed reactivates a read_only org to active (only checkout reactivates)", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    // The org is currently read_only (canceled). The read_only-terminal guard
    // applies ONLY to invoice events — a new checkout is the sanctioned
    // reactivation path and writes active unconditionally.
    orgById = { data: { subscription_status: "read_only" }, error: null };
    constructEvent.mockReturnValue(
      completedEvent({
        id: "cs_re",
        metadata: { org_id: "org-1", tier: "solo" },
        client_reference_id: "org-1",
        subscription: "sub_123",
        line_items: { data: [{ price: { id: "price_solo_123" } }] },
      }),
    );
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ subscription_status: "active" }),
      "org-1",
    );
  });

  it("invoice event whose status pre-read errors → caught + 200, no update", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    // The org resolves, but the subscription_status pre-read errors; the handler
    // throws, the outer catch logs and still 200s (no retry storm), no write.
    orgById = { data: null, error: { message: "read boom" } };
    constructEvent.mockReturnValue({
      type: "invoice.paid",
      data: { object: { id: "in_err", subscription: "sub_123" } },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("completed session without an org id → logged + 200, no update", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue(
      completedEvent({ id: "cs_1", metadata: {}, subscription: "sub_1" }),
    );
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalled();
  });

  it("completed session with an unresolvable tier → logged + 200, no update", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    listLineItems.mockResolvedValue({ data: [{ price: { id: "price_unknown" } }] });
    constructEvent.mockReturnValue(
      completedEvent({
        id: "cs_1",
        metadata: { org_id: "org-1" },
        subscription: "sub_1",
        // no inline line_items → falls to listLineItems (unknown) and no metadata.tier
      }),
    );
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(adminUpdate).not.toHaveBeenCalled();
    expect(reportError).toHaveBeenCalled();
  });
});
