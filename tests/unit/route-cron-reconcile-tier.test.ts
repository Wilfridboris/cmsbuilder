import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `GET /api/cron/reconcile-tier` (Story 7.5, NFR-R5) WITHOUT a live
 * DB or Stripe. The service-role admin client, the Stripe client, and the
 * observability seam are mocked. Pins the frozen I/O & Edge-Case Matrix rows:
 *   - unauthorized (missing/invalid Bearer)  → 401, NO reads/writes;
 *   - match (Stripe tier == stored)          → no alert, counted as checked;
 *   - drift (Stripe tier != stored)          → reportCritical({orgId,storedTier,stripeTier}), NO DB write;
 *   - per-org Stripe error                    → reportError, sweep continues;
 * and asserts the route NEVER calls `.update` (the webhook is the sole tier writer).
 */

const reportError = vi.fn();
const reportCritical = vi.fn();
const subscriptionsRetrieve = vi.fn();

// --- Configurable admin-client state --------------------------------------
let subscribedOrgs: unknown[];
let updateCalled = false;

function makeAdminClient() {
  return {
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({
            in: () => ({
              not: async () => ({ data: subscribedOrgs, error: null }),
            }),
          }),
          update: () => {
            updateCalled = true;
            return { eq: async () => ({ error: null }) };
          },
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));
vi.mock("@/lib/stripe/client", () => ({
  getStripeClient: () => ({
    subscriptions: { retrieve: subscriptionsRetrieve },
  }),
}));
vi.mock("@/lib/observability/report", () => ({ reportError, reportCritical }));

function cronReq(authHeader: string | null): NextRequest {
  return {
    headers: {
      get: (name: string) => (name === "authorization" ? authHeader : null),
    },
    nextUrl: new URL("https://app.example.com/api/cron/reconcile-tier"),
  } as unknown as NextRequest;
}

/** A Stripe subscription whose single item carries the given price id. */
function subWithPrice(priceId: string) {
  return { id: "sub_1", items: { data: [{ price: { id: priceId } }] } };
}

const SECRET = "test-cron-secret";
const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  subscribedOrgs = [];
  updateCalled = false;
  process.env.CRON_SECRET = SECRET;
  process.env.STRIPE_PRICE_SOLO = "price_solo";
  process.env.STRIPE_PRICE_CREW = "price_crew";
  process.env.STRIPE_PRICE_SHOP = "price_shop";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("GET /api/cron/reconcile-tier auth", () => {
  it("401 and no work when the Authorization header is missing", async () => {
    const { GET } = await import("@/app/api/cron/reconcile-tier/route");
    const res = await GET(cronReq(null));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(subscriptionsRetrieve).not.toHaveBeenCalled();
    expect(reportCritical).not.toHaveBeenCalled();
  });

  it("401 when the Bearer secret is wrong", async () => {
    const { GET } = await import("@/app/api/cron/reconcile-tier/route");
    const res = await GET(cronReq("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(subscriptionsRetrieve).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/reconcile-tier sweep", () => {
  it("match: Stripe tier == stored → no alert, counted as checked, no write", async () => {
    subscribedOrgs = [
      {
        id: "org-1",
        subscription_tier: "solo",
        stripe_subscription_id: "sub_1",
      },
    ];
    subscriptionsRetrieve.mockResolvedValue(subWithPrice("price_solo"));

    const { GET } = await import("@/app/api/cron/reconcile-tier/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ processed: 1, drifted: 0 });
    expect(reportCritical).not.toHaveBeenCalled();
    expect(updateCalled).toBe(false);
  });

  it("drift: Stripe tier != stored → reportCritical with payload, NO DB write", async () => {
    subscribedOrgs = [
      {
        id: "org-2",
        subscription_tier: "solo",
        stripe_subscription_id: "sub_1",
      },
    ];
    subscriptionsRetrieve.mockResolvedValue(subWithPrice("price_crew"));

    const { GET } = await import("@/app/api/cron/reconcile-tier/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ processed: 1, drifted: 1 });
    expect(reportCritical).toHaveBeenCalledTimes(1);
    expect(reportCritical).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({
        orgId: "org-2",
        storedTier: "solo",
        stripeTier: "crew",
      }),
    );
    // The webhook is the sole writer of subscription_tier — the cron never writes.
    expect(updateCalled).toBe(false);
  });

  it("per-org Stripe error: logged, drifted not incremented, sweep continues", async () => {
    subscribedOrgs = [
      { id: "org-a", subscription_tier: "solo", stripe_subscription_id: "sub_a" },
      { id: "org-b", subscription_tier: "crew", stripe_subscription_id: "sub_b" },
    ];
    subscriptionsRetrieve
      .mockRejectedValueOnce(new Error("stripe 404"))
      .mockResolvedValueOnce(subWithPrice("price_crew"));

    const { GET } = await import("@/app/api/cron/reconcile-tier/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    // Both orgs were processed; org-a failed (logged), org-b matched.
    expect((await res.json()).data).toMatchObject({ processed: 2, drifted: 0 });
    expect(reportError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ orgId: "org-a" }),
    );
    expect(reportCritical).not.toHaveBeenCalled();
    expect(subscriptionsRetrieve).toHaveBeenCalledTimes(2);
  });

  it("unmapped price id counts as drift (misconfiguration surfaced)", async () => {
    subscribedOrgs = [
      { id: "org-x", subscription_tier: "solo", stripe_subscription_id: "sub_x" },
    ];
    subscriptionsRetrieve.mockResolvedValue(subWithPrice("price_unknown"));

    const { GET } = await import("@/app/api/cron/reconcile-tier/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));

    expect((await res.json()).data).toMatchObject({ drifted: 1 });
    expect(reportCritical).toHaveBeenCalledWith(
      expect.any(Error),
      expect.objectContaining({ orgId: "org-x", stripeTier: null }),
    );
    expect(updateCalled).toBe(false);
  });
});
