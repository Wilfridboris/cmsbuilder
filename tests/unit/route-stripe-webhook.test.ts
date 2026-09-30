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

function makeAdminClient() {
  return {
    from() {
      return {
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
      type: "invoice.paid",
      data: { object: {} },
    });
    const res = await POST(webhookReq("{...}", "good-sig"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ received: true });
    expect(adminUpdate).not.toHaveBeenCalled();
  });

  it("subscription.deleted is acknowledged 200 with no state change (deferred)", async () => {
    const { POST } = await import("@/app/api/stripe/webhook/route");
    constructEvent.mockReturnValue({
      type: "customer.subscription.deleted",
      data: { object: {} },
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
