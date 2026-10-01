import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

/**
 * Composition coverage for Story 7.5's `resolveTierView` inside the Settings page
 * (VG-1 / BH-4 / BH-5). The leaf helpers (`countIssuedInvoicesInPeriod`,
 * `shouldPromptUpgrade`, `priceIdToTier`) are unit-tested in isolation, and
 * `settings-page.test.tsx` pins the admin gate + billing branch — but nothing
 * exercised `resolveTierView`'s wiring: the last-completed-cycle window
 * `[periodStart - (periodEnd - periodStart), periodStart)`, the next-billing-date
 * derived from the subscription ITEM's `current_period_end`, the
 * `priceIdToTier`→cached-tier fallback, and the graceful degradation on a Stripe
 * throw. A regression (wrong window end, wrong date field, dropped catch) would
 * otherwise pass the whole suite.
 *
 * Driven through the real page (node env, no DOM): the Stripe client, the RLS
 * client, cookies, and the invoice count are mocked, so no real Stripe SDK loads;
 * `priceIdToTier` / `shouldPromptUpgrade` / `nextTierUp` stay REAL (the STRIPE_PRICE_*
 * envs are set so the reverse-map resolves). A prop-capturing `TierView` stub lets
 * us read exactly what the page computed.
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const subscriptionsRetrieve = vi.fn();
const countIssuedInvoicesInPeriod = vi.fn();
const reportError = vi.fn();

let billingRead: { data: unknown; error: unknown };

function makeAdminClient() {
  return {
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => billingRead }) }),
      };
    },
  };
}

// Capture the props the page hands to TierView (the function body is invoked only
// if rendered; instead we walk the returned element tree and read its props — so a
// plain marker component is enough).
function TierViewStub(): null {
  return null;
}

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({ __rls: true }),
}));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
vi.mock("@/lib/stripe/client", () => ({
  getStripeClient: () => ({ subscriptions: { retrieve: subscriptionsRetrieve } }),
}));
vi.mock("@/lib/data/invoices", () => ({ countIssuedInvoicesInPeriod }));
vi.mock("@/lib/observability/report", () => ({ reportError }));
// Stub the client components so the node test pulls none of their client deps.
vi.mock("@/components/settings/InviteForm", () => ({ InviteForm: () => null }));
vi.mock("@/components/settings/BusinessProfileForm", () => ({
  BusinessProfileForm: () => null,
}));
vi.mock("@/components/settings/BillingStart", () => ({ BillingStart: () => null }));
vi.mock("@/components/settings/BillingManage", () => ({
  BillingManage: () => null,
}));
vi.mock("@/components/settings/TierView", () => ({ TierView: TierViewStub }));

/** Depth-first search for the first element whose `type` is `target`; return props. */
function findProps(
  node: unknown,
  target: unknown,
): Record<string, unknown> | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = findProps(child, target);
      if (hit) return hit;
    }
    return null;
  }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === target) return (el.props ?? {}) as Record<string, unknown>;
  if (el.props?.children !== undefined) {
    return findProps(el.props.children, target);
  }
  return null;
}

async function renderPage(): Promise<Record<string, unknown> | null> {
  const mod = await import("@/app/[slug]/settings/page");
  const tree = await mod.default({ params: Promise.resolve({ slug: "acme" }) });
  return findProps(tree, TierViewStub);
}

// 2026-10-01 .. 2026-11-01 (a 31-day cycle), so the last completed cycle is
// [2026-08-31, 2026-10-01) and the next billing date is 2026-11-01.
const START_SEC = Date.UTC(2026, 9, 1) / 1000;
const END_SEC = Date.UTC(2026, 10, 1) / 1000;
const EXPECTED_START = "2026-08-31";
const EXPECTED_END = "2026-10-01";
const EXPECTED_NEXT_BILLING = "2026-11-01T00:00:00.000Z";

function subItem(priceId: string) {
  return {
    items: {
      data: [
        {
          current_period_start: START_SEC,
          current_period_end: END_SEC,
          price: { id: priceId },
        },
      ],
    },
  };
}

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.clearAllMocks();
  requireAdmin.mockResolvedValue({ orgId: "org-1", slug: "acme", role: "admin" });
  getCurrentUser.mockResolvedValue({ id: "user-1" });
  countIssuedInvoicesInPeriod.mockResolvedValue(0);
  process.env.STRIPE_PRICE_SOLO = "price_solo";
  process.env.STRIPE_PRICE_CREW = "price_crew";
  process.env.STRIPE_PRICE_SHOP = "price_shop";
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
});

describe("resolveTierView composition (Story 7.5)", () => {
  it("derives next-billing-date, last-completed-cycle window, tier + prompt", async () => {
    billingRead = {
      data: {
        subscription_status: "active",
        subscription_tier: "solo",
        stripe_subscription_id: "sub_1",
      },
      error: null,
    };
    subscriptionsRetrieve.mockResolvedValue(subItem("price_solo"));
    countIssuedInvoicesInPeriod.mockResolvedValue(25); // > Solo band (20) → prompt

    const props = await renderPage();

    expect(props).not.toBeNull();
    // Next billing date = ISO of the item's current_period_end.
    expect(props!.nextBillingDate).toBe(EXPECTED_NEXT_BILLING);
    // Authoritative tier from the item price id reverse-map.
    expect(props!.tier).toBe("solo");
    // Window = [periodStart - cycleLength, periodStart), as YYYY-MM-DD.
    expect(countIssuedInvoicesInPeriod).toHaveBeenCalledWith(
      { __rls: true },
      "org-1",
      EXPECTED_START,
      EXPECTED_END,
    );
    // 25 > 20 → prompt to the next tier up.
    expect(props!.showUpgradePrompt).toBe(true);
    expect(props!.suggestedTier).toBe("crew");
  });

  it("falls back to the cached tier when the item price id does not reverse-map", async () => {
    billingRead = {
      data: {
        subscription_status: "active",
        subscription_tier: "crew",
        stripe_subscription_id: "sub_1",
      },
      error: null,
    };
    subscriptionsRetrieve.mockResolvedValue(subItem("price_unknown"));
    countIssuedInvoicesInPeriod.mockResolvedValue(0);

    const props = await renderPage();

    expect(props).not.toBeNull();
    // Unmapped price → authoritative tier falls back to the cached tier (not drift
    // here — the reconcile cron owns surfacing that; the view must not break).
    expect(props!.tier).toBe("crew");
    expect(props!.showUpgradePrompt).toBe(false);
  });

  it("degrades gracefully to the cached tier when the Stripe fetch throws", async () => {
    billingRead = {
      data: {
        subscription_status: "active",
        subscription_tier: "shop",
        stripe_subscription_id: "sub_1",
      },
      error: null,
    };
    subscriptionsRetrieve.mockRejectedValue(new Error("stripe down"));

    const props = await renderPage();

    expect(props).not.toBeNull();
    expect(props!.tier).toBe("shop"); // cached
    expect(props!.nextBillingDate).toBeNull();
    expect(props!.showUpgradePrompt).toBe(false);
    expect(props!.suggestedTier).toBeNull();
    // The failure is logged, and the count never runs (fetch threw first).
    expect(reportError).toHaveBeenCalledTimes(1);
    expect(countIssuedInvoicesInPeriod).not.toHaveBeenCalled();
  });
});
