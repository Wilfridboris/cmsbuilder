import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { AppError } from "@/types/api";

/**
 * Unit coverage for the credit-note routes (Story 12.8) WITHOUT a live DB or auth provider,
 * mirroring `route-invoice-pay.test.ts`: the REAL `resolveOrgIdentity` runs (org resolved
 * under a mocked RLS client), while the caller identity, the admin check, the source-invoice
 * read, and the credit-note mutation layer are mocked. Covers the matrix rows that live in
 * these handlers:
 *   - create: 200 (creditable source), 409 notIssued (draft/void source), 404 (missing
 *     source), 400 (empty lines), 401/403 gating before any DB access;
 *   - issue: 200, 422 gate block surfaced, 409 versionConflict/notDraft, 401/403 gating.
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const getInvoiceWithLineItems = vi.fn();
const customerRecordBelongsToOrg = vi.fn();
const saveCreditNoteDraft = vi.fn();
const issueCreditNote = vi.fn();
const discardCreditNoteDraft = vi.fn();
const getCreditNoteWithLineItems = vi.fn();

type MaybeSingle = { data: unknown; error: unknown };
let orgRead: MaybeSingle;

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
vi.mock("@/lib/data/invoices", () => ({
  getInvoiceWithLineItems,
  customerRecordBelongsToOrg,
}));
vi.mock("@/lib/data/credit-note-mutate", () => ({
  saveCreditNoteDraft,
  issueCreditNote,
  discardCreditNoteDraft,
}));
vi.mock("@/lib/data/credit-notes", () => ({ getCreditNoteWithLineItems }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function req(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: { origin: "http://localhost:3000", searchParams: new URLSearchParams() },
  } as unknown as NextRequest;
}

/** A request whose `slug` (and any other params) live in the query string (GET/DELETE). */
function reqQuery(slug: string | null, body: unknown = {}): NextRequest {
  const searchParams = new URLSearchParams();
  if (slug !== null) searchParams.set("slug", slug);
  return {
    json: async () => body,
    nextUrl: { origin: "http://localhost:3000", searchParams },
  } as unknown as NextRequest;
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });
const cnParams = (id: string, cnId: string) => ({
  params: Promise.resolve({ id, cnId }),
});

const CREATE_BODY = {
  slug: "acme",
  language: "en",
  lineItems: [{ description: "Overcharge", quantity: 1, unitPrice: 50 }],
};

const ISSUE_BODY = { slug: "acme", version: 1 };

function sourceInvoice(status: string, customerRecordId: string | null = "cust-9") {
  return {
    data: {
      invoice: {
        id: "inv-1",
        status,
        invoice_number: 42,
        language: "en",
        customer_record_id: customerRecordId,
        place_of_supply_province: "ON",
      },
      lineItems: [],
      taxLines: [],
      customerLabel: null,
    },
    error: null,
  };
}

const PUT_BODY = {
  slug: "acme",
  version: 2,
  language: "en",
  lineItems: [{ description: "Overcharge", quantity: 1, unitPrice: 50 }],
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
  getInvoiceWithLineItems.mockResolvedValue(sourceInvoice("issued"));
  customerRecordBelongsToOrg.mockResolvedValue(true);
  saveCreditNoteDraft.mockResolvedValue({
    data: { id: "cn-1", version: 1 },
    error: null,
  });
  issueCreditNote.mockResolvedValue({
    data: { id: "cn-1", version: 2, credit_note_number: 1 },
    error: null,
  });
  discardCreditNoteDraft.mockResolvedValue({ data: { id: "cn-1" }, error: null });
  getCreditNoteWithLineItems.mockResolvedValue({
    data: {
      creditNote: { id: "cn-1", status: "draft", version: 1 },
      lineItems: [],
      taxLines: [],
      customerLabel: null,
    },
    error: null,
  });
});

describe("POST /api/invoices/[id]/credit-notes (create)", () => {
  it("creates a draft from a creditable (issued) source: 200, saveCreditNoteDraft called", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const res = await POST(req(CREATE_BODY), idParams("inv-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "cn-1", version: 1 });
    expect(saveCreditNoteDraft).toHaveBeenCalledTimes(1);
    const [, input] = saveCreditNoteDraft.mock.calls[0];
    expect(input.invoiceId).toBe("inv-1");
    expect(input.creditNoteId).toBeNull();
  });

  it("inherits the source invoice's linked customer when the body supplies none", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const res = await POST(req(CREATE_BODY), idParams("inv-1"));
    expect(res.status).toBe(200);
    const [, input] = saveCreditNoteDraft.mock.calls[0];
    // The source invoice carried customer "cust-9"; the credit note re-states it.
    expect(input.customerRecordId).toBe("cust-9");
  });

  it("400 customerRecordInvalid when a body-supplied customer is not in the org", async () => {
    customerRecordBelongsToOrg.mockResolvedValue(false);
    const { POST } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const res = await POST(
      req({ ...CREATE_BODY, customerRecordId: "11111111-1111-1111-1111-111111111111" }),
      idParams("inv-1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("customerRecordInvalid");
    expect(saveCreditNoteDraft).not.toHaveBeenCalled();
  });

  it("allows crediting a paid source invoice", async () => {
    getInvoiceWithLineItems.mockResolvedValue(sourceInvoice("paid"));
    const { POST } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const res = await POST(req(CREATE_BODY), idParams("inv-1"));
    expect(res.status).toBe(200);
  });

  it("409 notIssued for a draft source invoice, no write", async () => {
    getInvoiceWithLineItems.mockResolvedValue(sourceInvoice("draft"));
    const { POST } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const res = await POST(req(CREATE_BODY), idParams("inv-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("notIssued");
    expect(saveCreditNoteDraft).not.toHaveBeenCalled();
  });

  it("409 notIssued for a void source invoice", async () => {
    getInvoiceWithLineItems.mockResolvedValue(sourceInvoice("void"));
    const { POST } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const res = await POST(req(CREATE_BODY), idParams("inv-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("notIssued");
  });

  it("404 when the source invoice does not exist", async () => {
    getInvoiceWithLineItems.mockResolvedValue({ data: null, error: null });
    const { POST } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const res = await POST(req(CREATE_BODY), idParams("inv-1"));
    expect(res.status).toBe(404);
    expect(saveCreditNoteDraft).not.toHaveBeenCalled();
  });

  it("400 for empty line items", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const res = await POST(
      req({ ...CREATE_BODY, lineItems: [] }),
      idParams("inv-1"),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("lineItemsRequired");
    expect(saveCreditNoteDraft).not.toHaveBeenCalled();
  });

  it("401 unauthorized before any DB access", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { POST } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const res = await POST(req(CREATE_BODY), idParams("inv-1"));
    expect(res.status).toBe(401);
    expect(getInvoiceWithLineItems).not.toHaveBeenCalled();
    expect(saveCreditNoteDraft).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member before any DB access", async () => {
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const { POST } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const res = await POST(req(CREATE_BODY), idParams("inv-1"));
    expect(res.status).toBe(403);
    expect(saveCreditNoteDraft).not.toHaveBeenCalled();
  });

  it("403 forbidden for a cross-org Admin (slug mismatch)", async () => {
    requireAdmin.mockResolvedValue({
      organization_id: "org-2",
      role: "admin",
      slug: "other",
    });
    const { POST } = await import("@/app/api/invoices/[id]/credit-notes/route");
    const res = await POST(req(CREATE_BODY), idParams("inv-1"));
    expect(res.status).toBe(403);
    expect(saveCreditNoteDraft).not.toHaveBeenCalled();
  });
});

describe("POST /api/invoices/[id]/credit-notes/[cnId]/issue", () => {
  it("issues a validated draft: 200, minted number", async () => {
    const { POST } = await import(
      "@/app/api/invoices/[id]/credit-notes/[cnId]/issue/route"
    );
    const res = await POST(req(ISSUE_BODY), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({
      id: "cn-1",
      version: 2,
      credit_note_number: 1,
    });
    expect(issueCreditNote).toHaveBeenCalledTimes(1);
  });

  it("422 surfaces an assertIssuableCreditNote block", async () => {
    issueCreditNote.mockRejectedValue(
      new AppError(422, "Invoice.error.legalIdentityMissing"),
    );
    const { POST } = await import(
      "@/app/api/invoices/[id]/credit-notes/[cnId]/issue/route"
    );
    const res = await POST(req(ISSUE_BODY), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(422);
    expect((await res.json()).error).toBe("Invoice.error.legalIdentityMissing");
  });

  it("409 versionConflict for a stale version", async () => {
    issueCreditNote.mockRejectedValue(new AppError(409, "versionConflict"));
    const { POST } = await import(
      "@/app/api/invoices/[id]/credit-notes/[cnId]/issue/route"
    );
    const res = await POST(req(ISSUE_BODY), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("versionConflict");
  });

  it("409 notDraft for an already-issued credit note", async () => {
    issueCreditNote.mockRejectedValue(new AppError(409, "notDraft"));
    const { POST } = await import(
      "@/app/api/invoices/[id]/credit-notes/[cnId]/issue/route"
    );
    const res = await POST(req(ISSUE_BODY), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("notDraft");
  });

  it("400 for a missing version", async () => {
    const { POST } = await import(
      "@/app/api/invoices/[id]/credit-notes/[cnId]/issue/route"
    );
    const res = await POST(req({ slug: "acme" }), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(400);
    expect(issueCreditNote).not.toHaveBeenCalled();
  });

  it("401 unauthorized before any DB access", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { POST } = await import(
      "@/app/api/invoices/[id]/credit-notes/[cnId]/issue/route"
    );
    const res = await POST(req(ISSUE_BODY), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(401);
    expect(issueCreditNote).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member before any DB access", async () => {
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const { POST } = await import(
      "@/app/api/invoices/[id]/credit-notes/[cnId]/issue/route"
    );
    const res = await POST(req(ISSUE_BODY), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(403);
    expect(issueCreditNote).not.toHaveBeenCalled();
  });
});

describe("PUT /api/invoices/[id]/credit-notes/[cnId] (update draft)", () => {
  it("updates a draft with a current version: 200", async () => {
    saveCreditNoteDraft.mockResolvedValue({ data: { id: "cn-1", version: 3 }, error: null });
    const { PUT } = await import("@/app/api/invoices/[id]/credit-notes/[cnId]/route");
    const res = await PUT(req(PUT_BODY), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "cn-1", version: 3 });
    const [, input] = saveCreditNoteDraft.mock.calls[0];
    expect(input.creditNoteId).toBe("cn-1");
    expect(input.invoiceId).toBe("inv-1");
  });

  it("409 versionConflict when the update omits the version (never an accidental create)", async () => {
    const { PUT } = await import("@/app/api/invoices/[id]/credit-notes/[cnId]/route");
    const { version: _omit, ...noVersion } = PUT_BODY;
    const res = await PUT(req(noVersion), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("versionConflict");
    expect(saveCreditNoteDraft).not.toHaveBeenCalled();
  });

  it("409 versionConflict surfaced from the mutation layer on a stale update", async () => {
    saveCreditNoteDraft.mockRejectedValue(new AppError(409, "versionConflict"));
    const { PUT } = await import("@/app/api/invoices/[id]/credit-notes/[cnId]/route");
    const res = await PUT(req(PUT_BODY), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("versionConflict");
  });

  it("401 unauthorized before any DB access", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { PUT } = await import("@/app/api/invoices/[id]/credit-notes/[cnId]/route");
    const res = await PUT(req(PUT_BODY), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(401);
    expect(saveCreditNoteDraft).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member before any DB access", async () => {
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const { PUT } = await import("@/app/api/invoices/[id]/credit-notes/[cnId]/route");
    const res = await PUT(req(PUT_BODY), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(403);
    expect(saveCreditNoteDraft).not.toHaveBeenCalled();
  });
});

describe("GET /api/invoices/[id]/credit-notes/[cnId] (load draft)", () => {
  it("returns the credit note + children: 200", async () => {
    const { GET } = await import("@/app/api/invoices/[id]/credit-notes/[cnId]/route");
    const res = await GET(reqQuery("acme"), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(200);
    expect(getCreditNoteWithLineItems).toHaveBeenCalledTimes(1);
  });

  it("404 when the credit note does not exist under this org", async () => {
    getCreditNoteWithLineItems.mockResolvedValue({ data: null, error: null });
    const { GET } = await import("@/app/api/invoices/[id]/credit-notes/[cnId]/route");
    const res = await GET(reqQuery("acme"), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(404);
  });

  it("403 forbidden for a Member before any DB access", async () => {
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const { GET } = await import("@/app/api/invoices/[id]/credit-notes/[cnId]/route");
    const res = await GET(reqQuery("acme"), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(403);
    expect(getCreditNoteWithLineItems).not.toHaveBeenCalled();
  });
});

describe("DELETE /api/invoices/[id]/credit-notes/[cnId] (discard draft)", () => {
  it("discards a draft: 200", async () => {
    const { DELETE } = await import("@/app/api/invoices/[id]/credit-notes/[cnId]/route");
    const res = await DELETE(reqQuery("acme"), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "cn-1" });
    expect(discardCreditNoteDraft).toHaveBeenCalledTimes(1);
  });

  it("409 notDraft when discarding a non-draft credit note", async () => {
    discardCreditNoteDraft.mockRejectedValue(new AppError(409, "notDraft"));
    const { DELETE } = await import("@/app/api/invoices/[id]/credit-notes/[cnId]/route");
    const res = await DELETE(reqQuery("acme"), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("notDraft");
  });

  it("401 unauthorized before any DB access", async () => {
    getCurrentUser.mockResolvedValue(null);
    const { DELETE } = await import("@/app/api/invoices/[id]/credit-notes/[cnId]/route");
    const res = await DELETE(reqQuery("acme"), cnParams("inv-1", "cn-1"));
    expect(res.status).toBe(401);
    expect(discardCreditNoteDraft).not.toHaveBeenCalled();
  });
});
