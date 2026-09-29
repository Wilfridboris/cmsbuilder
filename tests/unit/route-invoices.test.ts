import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { AppError } from "@/types/api";

/**
 * Unit coverage for the `/api/invoices` route family (Story 12.2) WITHOUT a live
 * DB or auth provider — mirroring `route-business-profile.test.ts`: the REAL
 * `resolveOrgIdentity` runs (org resolved under a mocked RLS client), while the
 * caller identity, the admin role check, the read layer, and the mutation layer
 * are mocked. Locks the frozen matrix rows that live in the handlers:
 *   GET   — list empty (200 []) + populated (200 rows); 401/403 before access;
 *   POST  — create standalone (200) + linked (200); cross-org link
 *           (customerRecordInvalid 400, no write); descriptionRequired /
 *           lineItemsRequired (400, no write); 401/403 before access;
 *   PUT   — version-gated update (200); versionConflict (409); notDraft-ish via
 *           the mutation-layer conflict (409); missing version (409);
 *   DELETE — discard draft (200); non-draft (notDraft 409).
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const listInvoices = vi.fn();
const getInvoiceWithLineItems = vi.fn();
const customerRecordBelongsToOrg = vi.fn();
const saveInvoiceDraft = vi.fn();
const discardInvoiceDraft = vi.fn();

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
      // Any other table read under the RLS client is not exercised directly here
      // (the read + membership helpers are mocked); return an empty shape.
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({ is: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
          }),
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
vi.mock("@/lib/data/invoices", () => ({
  listInvoices,
  getInvoiceWithLineItems,
  customerRecordBelongsToOrg,
}));
vi.mock("@/lib/data/invoice-mutate", () => ({
  saveInvoiceDraft,
  discardInvoiceDraft,
}));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function getReq(query: Record<string, string>): NextRequest {
  const url = new URL("http://localhost:3000/api/invoices");
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v);
  return { nextUrl: url } as unknown as NextRequest;
}

function bodyReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const LINE = { description: "Consulting", quantity: 2, unitPrice: 50 };
const VALID_BODY = { slug: "acme", lineItems: [LINE] };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "admin-1", email: "a@example.ca" });
  orgRead = { data: { id: "org-1" }, error: null };
  requireAdmin.mockResolvedValue({ organization_id: "org-1", role: "admin", slug: "acme" });
  listInvoices.mockResolvedValue({ data: [], error: null });
  customerRecordBelongsToOrg.mockResolvedValue(true);
  saveInvoiceDraft.mockResolvedValue({ data: { id: "inv-1", version: 1 }, error: null });
  discardInvoiceDraft.mockResolvedValue({ data: { id: "inv-1" }, error: null });
  getInvoiceWithLineItems.mockResolvedValue({
    data: { invoice: { id: "inv-1", version: 2 }, lineItems: [], customerLabel: null },
    error: null,
  });
});

describe("GET /api/invoices (list)", () => {
  it("returns an empty list when the org has no invoices", async () => {
    const { GET } = await import("@/app/api/invoices/route");
    const res = await GET(getReq({ slug: "acme" }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.error).toBeNull();
    expect(body.data).toEqual([]);
  });

  it("returns the org's invoices when they exist", async () => {
    const { GET } = await import("@/app/api/invoices/route");
    listInvoices.mockResolvedValue({
      data: [{ id: "inv-1", status: "draft" }],
      error: null,
    });
    const res = await GET(getReq({ slug: "acme" }));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toHaveLength(1);
  });

  it("401 unauthorized when there is no session (no access)", async () => {
    const { GET } = await import("@/app/api/invoices/route");
    getCurrentUser.mockResolvedValue(null);
    const res = await GET(getReq({ slug: "acme" }));
    expect(res.status).toBe(401);
    expect(listInvoices).not.toHaveBeenCalled();
  });

  it("403 forbidden for a non-member (org hidden under RLS)", async () => {
    const { GET } = await import("@/app/api/invoices/route");
    orgRead = { data: null, error: null };
    const res = await GET(getReq({ slug: "acme" }));
    expect(res.status).toBe(403);
    expect(listInvoices).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member (requireAdmin rejects)", async () => {
    const { GET } = await import("@/app/api/invoices/route");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await GET(getReq({ slug: "acme" }));
    expect(res.status).toBe(403);
    expect(listInvoices).not.toHaveBeenCalled();
  });

  it("403 forbidden for a cross-org Admin (slug mismatch)", async () => {
    const { GET } = await import("@/app/api/invoices/route");
    requireAdmin.mockResolvedValue({ organization_id: "org-2", role: "admin", slug: "other" });
    const res = await GET(getReq({ slug: "acme" }));
    expect(res.status).toBe(403);
    expect(listInvoices).not.toHaveBeenCalled();
  });
});

describe("POST /api/invoices (create draft)", () => {
  it("creates a standalone draft (no customer) and returns 200", async () => {
    const { POST } = await import("@/app/api/invoices/route");
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "inv-1", version: 1 });
    expect(customerRecordBelongsToOrg).not.toHaveBeenCalled();
    const [, input] = saveInvoiceDraft.mock.calls[0];
    expect(input.invoiceId).toBeNull();
    expect(input.customerRecordId).toBeNull();
  });

  it("creates a draft from a linked record after verifying org ownership", async () => {
    const { POST } = await import("@/app/api/invoices/route");
    const res = await POST(
      bodyReq({ ...VALID_BODY, customerRecordId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(res.status).toBe(200);
    expect(customerRecordBelongsToOrg).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      "11111111-1111-4111-8111-111111111111",
    );
    const [, input] = saveInvoiceDraft.mock.calls[0];
    expect(input.customerRecordId).toBe("11111111-1111-4111-8111-111111111111");
  });

  it("400 customerRecordInvalid for a cross-org link, before any write", async () => {
    const { POST } = await import("@/app/api/invoices/route");
    customerRecordBelongsToOrg.mockResolvedValue(false);
    const res = await POST(
      bodyReq({ ...VALID_BODY, customerRecordId: "11111111-1111-4111-8111-111111111111" }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invoice.error.customerRecordInvalid");
    expect(saveInvoiceDraft).not.toHaveBeenCalled();
  });

  it("400 descriptionRequired for a blank description (no write)", async () => {
    const { POST } = await import("@/app/api/invoices/route");
    const res = await POST(
      bodyReq({ slug: "acme", lineItems: [{ description: " ", quantity: 1, unitPrice: 1 }] }),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invoice.error.descriptionRequired");
    expect(saveInvoiceDraft).not.toHaveBeenCalled();
  });

  it("400 lineItemsRequired for a draft with zero lines (no write)", async () => {
    const { POST } = await import("@/app/api/invoices/route");
    const res = await POST(bodyReq({ slug: "acme", lineItems: [] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("Invoice.error.lineItemsRequired");
    expect(saveInvoiceDraft).not.toHaveBeenCalled();
  });

  it("401 unauthorized before any write", async () => {
    const { POST } = await import("@/app/api/invoices/route");
    getCurrentUser.mockResolvedValue(null);
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(401);
    expect(saveInvoiceDraft).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member before any write", async () => {
    const { POST } = await import("@/app/api/invoices/route");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await POST(bodyReq(VALID_BODY));
    expect(res.status).toBe(403);
    expect(saveInvoiceDraft).not.toHaveBeenCalled();
  });
});

describe("PUT /api/invoices/[id] (update draft)", () => {
  it("updates a draft with a correct version and returns 200", async () => {
    const { PUT } = await import("@/app/api/invoices/[id]/route");
    saveInvoiceDraft.mockResolvedValue({ data: { id: "inv-1", version: 3 }, error: null });
    const res = await PUT(bodyReq({ ...VALID_BODY, version: 2 }), idParams("inv-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "inv-1", version: 3 });
    const [, input] = saveInvoiceDraft.mock.calls[0];
    expect(input.invoiceId).toBe("inv-1");
    expect(input.version).toBe(2);
  });

  it("409 versionConflict when the mutation layer reports a stale/non-draft row", async () => {
    const { PUT } = await import("@/app/api/invoices/[id]/route");
    saveInvoiceDraft.mockRejectedValue(new AppError(409, "versionConflict"));
    const res = await PUT(bodyReq({ ...VALID_BODY, version: 1 }), idParams("inv-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("versionConflict");
  });

  it("409 versionConflict when an update omits the version (never an accidental create)", async () => {
    const { PUT } = await import("@/app/api/invoices/[id]/route");
    const res = await PUT(bodyReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("versionConflict");
    expect(saveInvoiceDraft).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member before any write", async () => {
    const { PUT } = await import("@/app/api/invoices/[id]/route");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await PUT(bodyReq({ ...VALID_BODY, version: 1 }), idParams("inv-1"));
    expect(res.status).toBe(403);
    expect(saveInvoiceDraft).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/invoices/[id] (discard draft)", () => {
  it("discards a draft and returns 200", async () => {
    const { DELETE } = await import("@/app/api/invoices/[id]/route");
    const res = await DELETE(getReq({ slug: "acme" }), idParams("inv-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "inv-1" });
    expect(discardInvoiceDraft).toHaveBeenCalledWith(expect.anything(), "inv-1");
  });

  it("409 notDraft when discarding a non-draft row", async () => {
    const { DELETE } = await import("@/app/api/invoices/[id]/route");
    discardInvoiceDraft.mockRejectedValue(new AppError(409, "notDraft"));
    const res = await DELETE(getReq({ slug: "acme" }), idParams("inv-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("notDraft");
  });

  it("403 forbidden for a Member before any delete", async () => {
    const { DELETE } = await import("@/app/api/invoices/[id]/route");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await DELETE(getReq({ slug: "acme" }), idParams("inv-1"));
    expect(res.status).toBe(403);
    expect(discardInvoiceDraft).not.toHaveBeenCalled();
  });
});
