import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { AppError } from "@/types/api";

/**
 * Unit coverage for `POST /api/stripe/checkout` (Story 7.2) WITHOUT a live DB,
 * auth provider, or Stripe. Mirrors `route-invoices.test.ts`: the REAL
 * `resolveOrgIdentity` runs (org resolved under a mocked RLS client), while the
 * caller identity, the admin role check, the Stripe SDK, and the service-role
 * admin client are mocked. Locks the frozen matrix rows:
 *   - admin start → creates/reuses a customer, creates a subscription-mode session
 *     with the tier price + client_reference_id + metadata, returns { url };
 *   - reuse: an existing stripe_customer_id is NOT re-created;
 *   - invalid tier → 400 invalidTier, no Stripe call;
 *   - missing price env → 500 billingUnavailable, no Stripe call;
 *   - non-member (403) / no session (401) → rejected before any Stripe call.
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const customersCreate = vi.fn();
const sessionsCreate = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let orgRead: MaybeSingle; // organizations lookup inside resolveOrgIdentity (RLS)
let adminOrgRead: MaybeSingle; // organizations lookup via the admin client
const adminUpdate = vi.fn();

function makeRlsClient() {
  return {
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => orgRead }) }),
      };
    },
  };
}

function makeAdminClient() {
  return {
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => adminOrgRead }) }),
        update: (patch: unknown) => ({
          eq: async (_col: string, id: string) => adminUpdate(patch, id),
        }),
      };
    },
  };
}

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => makeRlsClient(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeAdminClient() }));
vi.mock("@/lib/stripe/client", () => ({
  getStripeClient: () => ({
    customers: { create: customersCreate },
    checkout: { sessions: { create: sessionsCreate } },
  }),
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function bodyReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: new URL("http://localhost:3000/api/stripe/checkout"),
  } as unknown as NextRequest;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "admin-1", email: "a@example.ca" });
  orgRead = { data: { id: "org-1" }, error: null };
  adminOrgRead = { data: { stripe_customer_id: null }, error: null };
  requireAdmin.mockResolvedValue({ organization_id: "org-1", role: "admin", slug: "acme" });
  adminUpdate.mockResolvedValue({ error: null });
  customersCreate.mockResolvedValue({ id: "cus_new" });
  sessionsCreate.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/c/pay/cs_1" });
  process.env.STRIPE_PRICE_SOLO = "price_solo_123";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const VALID_BODY = { slug: "acme", tier: "solo" };

describe("POST /api/stripe/checkout", () => {
  it("creates a customer + subscription session and returns the url", async () => {
    const { POST } = await import("@/app/api/stripe/checkout/route");
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({ url: "https://checkout.stripe.com/c/pay/cs_1" });

    // A customer was created and persisted.
    expect(customersCreate).toHaveBeenCalledWith(
      expect.objectContaining({ metadata: { org_id: "org-1" } }),
    );
    expect(adminUpdate).toHaveBeenCalledWith({ stripe_customer_id: "cus_new" }, "org-1");

    // The session carries the price, subscription mode, client_reference_id, metadata.
    const args = sessionsCreate.mock.calls[0][0];
    expect(args.mode).toBe("subscription");
    expect(args.customer).toBe("cus_new");
    expect(args.line_items).toEqual([{ price: "price_solo_123", quantity: 1 }]);
    expect(args.client_reference_id).toBe("org-1");
    expect(args.metadata).toEqual({ org_id: "org-1", tier: "solo" });
    // The subscription itself (not just the session) carries the org linkage so
    // later stories (7.3 portal / 7.4 gating) can resolve the org from it.
    expect(args.subscription_data).toEqual({
      metadata: { org_id: "org-1", tier: "solo" },
    });
    // Return URLs put the query BEFORE the `#billing` fragment so `?checkout=...`
    // is a real query param (a fragment-first URL would bury it in the hash).
    expect(args.success_url).toBe(
      "http://localhost:3000/acme/settings?checkout=success#billing",
    );
    expect(args.cancel_url).toBe(
      "http://localhost:3000/acme/settings?checkout=cancelled#billing",
    );
    expect(args.success_url.indexOf("?")).toBeLessThan(
      args.success_url.indexOf("#"),
    );
  });

  it("reuses an existing stripe_customer_id (no new customer created)", async () => {
    const { POST } = await import("@/app/api/stripe/checkout/route");
    adminOrgRead = { data: { stripe_customer_id: "cus_existing" }, error: null };
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(200);
    expect(customersCreate).not.toHaveBeenCalled();
    expect(adminUpdate).not.toHaveBeenCalled();
    expect(sessionsCreate.mock.calls[0][0].customer).toBe("cus_existing");
  });

  it("400 invalidTier for an unknown tier, before any Stripe call", async () => {
    const { POST } = await import("@/app/api/stripe/checkout/route");
    const res = await POST(bodyReq({ slug: "acme", tier: "enterprise" }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalidTier");
    expect(customersCreate).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("500 billingUnavailable when the tier price env is missing, no Stripe call", async () => {
    const { POST } = await import("@/app/api/stripe/checkout/route");
    delete process.env.STRIPE_PRICE_SOLO;
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("billingUnavailable");
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("401 unauthorized (no session) before any Stripe call", async () => {
    const { POST } = await import("@/app/api/stripe/checkout/route");
    getCurrentUser.mockResolvedValue(null);
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(401);
    expect(customersCreate).not.toHaveBeenCalled();
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("403 forbidden for a non-member (org hidden under RLS) before any Stripe call", async () => {
    const { POST } = await import("@/app/api/stripe/checkout/route");
    orgRead = { data: null, error: null };
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member (requireAdmin rejects) before any Stripe call", async () => {
    const { POST } = await import("@/app/api/stripe/checkout/route");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });

  it("403 forbidden for a cross-org Admin (slug mismatch) before any Stripe call", async () => {
    const { POST } = await import("@/app/api/stripe/checkout/route");
    requireAdmin.mockResolvedValue({ organization_id: "org-2", role: "admin", slug: "other" });
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(sessionsCreate).not.toHaveBeenCalled();
  });
});
