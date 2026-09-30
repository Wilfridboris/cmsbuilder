import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { AppError } from "@/types/api";

/**
 * Unit coverage for `POST /api/stripe/portal` (Story 7.3) WITHOUT a live DB,
 * auth provider, or Stripe. Mirrors `route-stripe-checkout.test.ts`: the REAL
 * `resolveOrgIdentity` runs (org resolved under a mocked RLS client), while the
 * caller identity, the admin role check, the Stripe SDK, and the service-role
 * admin client are mocked. Locks the frozen matrix rows:
 *   - admin with a stored customer → creates a portal session with that customer
 *     + a settings `#billing` return_url, returns { url };
 *   - no stripe_customer_id (trial org) → 409 noSubscription, no Stripe call;
 *   - non-member (403) / no session (401) → rejected before any Stripe call.
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const portalSessionsCreate = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let orgRead: MaybeSingle; // organizations lookup inside resolveOrgIdentity (RLS)
let adminOrgRead: MaybeSingle; // organizations lookup via the admin client

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
    billingPortal: { sessions: { create: portalSessionsCreate } },
  }),
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function bodyReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: new URL("http://localhost:3000/api/stripe/portal"),
  } as unknown as NextRequest;
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "admin-1", email: "a@example.ca" });
  orgRead = { data: { id: "org-1" }, error: null };
  adminOrgRead = { data: { stripe_customer_id: "cus_existing" }, error: null };
  requireAdmin.mockResolvedValue({ orgId: "org-1", role: "admin", slug: "acme" });
  portalSessionsCreate.mockResolvedValue({
    id: "bps_1",
    url: "https://billing.stripe.com/p/session/bps_1",
  });
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

const VALID_BODY = { slug: "acme" };

describe("POST /api/stripe/portal", () => {
  it("creates a portal session for the stored customer and returns the url", async () => {
    const { POST } = await import("@/app/api/stripe/portal/route");
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual({
      url: "https://billing.stripe.com/p/session/bps_1",
    });

    const args = portalSessionsCreate.mock.calls[0][0];
    expect(args.customer).toBe("cus_existing");
    expect(args.return_url).toBe("http://localhost:3000/acme/settings#billing");
  });

  it("409 noSubscription when the org has no stripe_customer_id, no Stripe call", async () => {
    const { POST } = await import("@/app/api/stripe/portal/route");
    adminOrgRead = { data: { stripe_customer_id: null }, error: null };
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("noSubscription");
    expect(portalSessionsCreate).not.toHaveBeenCalled();
  });

  it("500 billingUnavailable when the Stripe portal call throws (matrix row)", async () => {
    const { POST } = await import("@/app/api/stripe/portal/route");
    portalSessionsCreate.mockRejectedValue(new Error("stripe down"));
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("billingUnavailable");
  });

  it("401 unauthorized (no session) before any Stripe call", async () => {
    const { POST } = await import("@/app/api/stripe/portal/route");
    getCurrentUser.mockResolvedValue(null);
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(401);
    expect(portalSessionsCreate).not.toHaveBeenCalled();
  });

  it("403 forbidden for a non-member (org hidden under RLS) before any Stripe call", async () => {
    const { POST } = await import("@/app/api/stripe/portal/route");
    orgRead = { data: null, error: null };
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(portalSessionsCreate).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member (requireAdmin rejects) before any Stripe call", async () => {
    const { POST } = await import("@/app/api/stripe/portal/route");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(portalSessionsCreate).not.toHaveBeenCalled();
  });

  it("403 forbidden for a cross-org Admin (slug mismatch) before any Stripe call", async () => {
    const { POST } = await import("@/app/api/stripe/portal/route");
    requireAdmin.mockResolvedValue({ orgId: "org-2", role: "admin", slug: "other" });
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(portalSessionsCreate).not.toHaveBeenCalled();
  });
});
