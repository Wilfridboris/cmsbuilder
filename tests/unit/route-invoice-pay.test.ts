import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { AppError } from "@/types/api";

/**
 * Unit coverage for `POST /api/invoices/[id]/pay` (Story 12.7) WITHOUT a live DB or auth
 * provider — mirroring `route-invoice-send.test.ts`: the REAL `resolveOrgIdentity` runs
 * (org resolved under a mocked RLS client), while the caller identity, the admin check,
 * and the `recordPayment` mutation are mocked. Closes the frozen I/O-matrix rows that live
 * in this handler:
 *   - happy: 200, recordPayment called with the parsed method/date/amount/reference;
 *   - already paid -> 409, no record;
 *   - not issued -> 409, no record;
 *   - stale version -> 409 versionConflict;
 *   - bad input (negative amount) -> 400, before any DB access;
 *   - bad input (malformed date) -> 400;
 *   - 401 / 403 gating before any DB access.
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const recordPayment = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let orgRead: MaybeSingle; // organizations lookup inside resolveOrgIdentity (RLS)

function makeClient() {
  return {
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({ eq: () => ({ maybeSingle: async () => orgRead }) }),
        };
      }
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => ({ data: null, error: null }) }),
        }),
      };
    },
  };
}

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => makeClient(),
}));
vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/data/invoice-mutate", () => ({ recordPayment }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function payReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: { origin: "http://localhost:3000" },
  } as unknown as NextRequest;
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const VALID_BODY = {
  slug: "acme",
  version: 2,
  method: "etransfer",
  paidDate: "2026-09-29",
  amount: 226,
  reference: "conf-123",
};

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "admin-1", email: "owner@example.ca" });
  orgRead = { data: { id: "org-1" }, error: null };
  requireAdmin.mockResolvedValue({
    organization_id: "org-1",
    role: "admin",
    slug: "acme",
  });
  recordPayment.mockResolvedValue({ data: { id: "inv-1", version: 3 }, error: null });
});

describe("POST /api/invoices/[id]/pay", () => {
  it("records a payment: 200, recordPayment called with the parsed input", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/pay/route");
    const res = await POST(payReq(VALID_BODY), idParams("inv-1"));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "inv-1", version: 3 });

    expect(recordPayment).toHaveBeenCalledTimes(1);
    const [, input] = recordPayment.mock.calls[0];
    expect(input).toMatchObject({
      invoiceId: "inv-1",
      version: 2,
      method: "etransfer",
      paidDate: "2026-09-29",
      amount: 226,
      reference: "conf-123",
    });
  });

  it("passes a null reference when omitted", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/pay/route");
    const { reference: _omit, ...noRef } = VALID_BODY;
    void _omit;
    const res = await POST(payReq(noRef), idParams("inv-1"));
    expect(res.status).toBe(200);
    const [, input] = recordPayment.mock.calls[0];
    expect(input.reference).toBeNull();
  });

  it("409 alreadyPaid for an already-paid invoice, surfaced from the mutation", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/pay/route");
    recordPayment.mockRejectedValue(new AppError(409, "alreadyPaid"));
    const res = await POST(payReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("alreadyPaid");
  });

  it("409 notIssued for a non-issued invoice", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/pay/route");
    recordPayment.mockRejectedValue(new AppError(409, "notIssued"));
    const res = await POST(payReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("notIssued");
  });

  it("409 versionConflict for a stale version", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/pay/route");
    recordPayment.mockRejectedValue(new AppError(409, "versionConflict"));
    const res = await POST(payReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("versionConflict");
  });

  it("400 for a negative amount, before any DB access", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/pay/route");
    const res = await POST(
      payReq({ ...VALID_BODY, amount: -5 }),
      idParams("inv-1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("amountInvalid");
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("400 for an amount beyond the numeric(15,2) range, before any DB access", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/pay/route");
    const res = await POST(
      payReq({ ...VALID_BODY, amount: 1e14 }),
      idParams("inv-1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("amountInvalid");
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("400 for a malformed paidDate", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/pay/route");
    const res = await POST(
      payReq({ ...VALID_BODY, paidDate: "2026-13-40" }),
      idParams("inv-1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("dateInvalid");
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("401 unauthorized before any DB access", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/pay/route");
    getCurrentUser.mockResolvedValue(null);
    const res = await POST(payReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(401);
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member before any DB access", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/pay/route");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await POST(payReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(403);
    expect(recordPayment).not.toHaveBeenCalled();
  });

  it("403 forbidden for a cross-org Admin (slug mismatch)", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/pay/route");
    requireAdmin.mockResolvedValue({
      organization_id: "org-2",
      role: "admin",
      slug: "other",
    });
    const res = await POST(payReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(403);
    expect(recordPayment).not.toHaveBeenCalled();
  });
});
