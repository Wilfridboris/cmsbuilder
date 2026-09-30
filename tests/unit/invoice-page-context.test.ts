import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Unit coverage for `loadInvoicePageContext.taxRegistered` (Story 12.3 preview seam,
 * closes the self-disclosed verification gap in deferred-work.md). The composite is
 * `taxRegistered = has(gst_hst_number) && isRegistrationEffective(effective_date, today)`
 * — a preview-only value the draft form uses so its live tax preview matches the server's
 * provisional reference date. The REAL `isRegistrationEffective` (tax.ts) runs; only the
 * auth/identity/schema seams are mocked. The RLS client is a stub returning a chosen
 * `business_profiles` row.
 */

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const { resolveOrgIdentity } = vi.hoisted(() => ({ resolveOrgIdentity: vi.fn() }));
const { getSchema } = vi.hoisted(() => ({ getSchema: vi.fn() }));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`unexpected redirect: ${url}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/api/route-helpers", () => ({ resolveOrgIdentity }));
vi.mock("@/lib/data/records", () => ({ getSchema }));

import { loadInvoicePageContext } from "@/app/[slug]/invoices/_shared";

const SLUG = "acme";

/** `YYYY-MM-DD` offset from today by `days` (negative = past, positive = future). */
function isoOffset(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

/** A stub RLS client whose `business_profiles` read resolves to `profile`. */
function clientWithProfile(profile: Record<string, unknown> | null): SupabaseClient {
  return {
    from() {
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        maybeSingle: () => Promise.resolve({ data: profile, error: null }),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

async function loadWith(
  profile: Record<string, unknown> | null,
): Promise<boolean> {
  resolveOrgIdentity.mockResolvedValue({
    client: clientWithProfile(profile),
    actorId: "user-1",
    orgId: "org-1",
  });
  const ctx = await loadInvoicePageContext(SLUG);
  return ctx.taxRegistered;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1" });
  requireAdmin.mockResolvedValue({ slug: SLUG });
  // Schema read degrades to no tables; the taxRegistered branch is what we exercise.
  getSchema.mockResolvedValue({ data: null, error: null });
});

describe("loadInvoicePageContext.taxRegistered", () => {
  it("true when a GST/HST number is present and the registration is effective as of today", async () => {
    expect(
      await loadWith({
        jurisdiction: "ON",
        default_language: "en",
        gst_hst_number: "123456789RT0001",
        gst_hst_effective_date: isoOffset(-1),
      }),
    ).toBe(true);
  });

  it("false when there is no GST/HST number (even with an effective date)", async () => {
    expect(
      await loadWith({
        jurisdiction: "ON",
        default_language: "en",
        gst_hst_number: null,
        gst_hst_effective_date: isoOffset(-1),
      }),
    ).toBe(false);
  });

  it("false when the GST/HST number is blank/whitespace", async () => {
    expect(
      await loadWith({
        jurisdiction: "ON",
        default_language: "en",
        gst_hst_number: "   ",
        gst_hst_effective_date: isoOffset(-1),
      }),
    ).toBe(false);
  });

  it("false when the registration effective date is in the future", async () => {
    expect(
      await loadWith({
        jurisdiction: "ON",
        default_language: "en",
        gst_hst_number: "123456789RT0001",
        gst_hst_effective_date: isoOffset(1),
      }),
    ).toBe(false);
  });

  it("false when the effective date is null", async () => {
    expect(
      await loadWith({
        jurisdiction: "ON",
        default_language: "en",
        gst_hst_number: "123456789RT0001",
        gst_hst_effective_date: null,
      }),
    ).toBe(false);
  });

  it("false when there is no business profile at all", async () => {
    expect(await loadWith(null)).toBe(false);
  });
});
