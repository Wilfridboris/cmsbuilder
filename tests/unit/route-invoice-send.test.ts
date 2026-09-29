import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import { AppError } from "@/types/api";

/**
 * Unit coverage for `POST /api/invoices/[id]/send` (Story 12.6) WITHOUT a live DB,
 * auth provider, storage, or Resend — mirroring `route-invoices.test.ts`: the REAL
 * `resolveOrgIdentity` runs (org resolved under a mocked RLS client), while the caller
 * identity, the admin check, the read layer, the PDF freeze/download, and the email
 * send are mocked. Closes the frozen I/O-matrix rows that live in this handler:
 *   - happy: 200; `sendInvoiceEmail` called with reply-to the admin's own email and the
 *     `{origin}/i/{token}` link;
 *   - bad recipient -> 400 recipientInvalid, no send;
 *   - a draft/void invoice -> 409 notDraft, no send;
 *   - freeze missing and un-repairable (`pdf_path` still null) -> 500, no send;
 *   - freeze repaired by `ensureInvoicePdf` -> 200 send;
 *   - a Resend failure -> 502 sendFailed;
 *   - 401 / 403 before any DB access.
 */

const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();
const getInvoiceWithLineItems = vi.fn();
const ensureInvoicePdf = vi.fn();
const downloadInvoicePdf = vi.fn();
const sendInvoiceEmail = vi.fn();

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
vi.mock("@/lib/data/invoices", () => ({ getInvoiceWithLineItems }));
vi.mock("@/lib/data/invoice-mutate", () => ({ ensureInvoicePdf }));
vi.mock("@/lib/invoicing/storage", () => ({ downloadInvoicePdf }));
vi.mock("@/lib/resend/send", () => ({ sendInvoiceEmail }));
vi.mock("@/lib/observability/report", () => ({ reportError: vi.fn() }));

function sendReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: { origin: "http://localhost:3000" },
  } as unknown as NextRequest;
}

const idParams = (id: string) => ({ params: Promise.resolve({ id }) });

const ISSUED_INVOICE = {
  id: "inv-1",
  status: "issued",
  pdf_path: "org-1/inv-1.pdf",
  invoice_number: 42,
  share_token: "tok_abc123",
  language: "en",
};

const VALID_BODY = { slug: "acme", to: "customer@example.com" };

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "admin-1", email: "owner@example.ca" });
  orgRead = { data: { id: "org-1" }, error: null };
  requireAdmin.mockResolvedValue({ organization_id: "org-1", role: "admin", slug: "acme" });
  getInvoiceWithLineItems.mockResolvedValue({
    data: { invoice: { ...ISSUED_INVOICE }, lineItems: [], taxLines: [], customerLabel: null },
    error: null,
  });
  ensureInvoicePdf.mockResolvedValue(undefined);
  downloadInvoicePdf.mockResolvedValue(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
  sendInvoiceEmail.mockResolvedValue(undefined);
});

describe("POST /api/invoices/[id]/send", () => {
  it("emails an issued invoice: 200, reply-to the admin, {origin}/i/{token} link", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/send/route");
    const res = await POST(sendReq(VALID_BODY), idParams("inv-1"));

    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ id: "inv-1" });

    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
    const [arg] = sendInvoiceEmail.mock.calls[0];
    expect(arg.to).toBe("customer@example.com");
    expect(arg.replyTo).toBe("owner@example.ca");
    expect(arg.language).toBe("en");
    expect(arg.link).toBe("http://localhost:3000/i/tok_abc123");
    expect(arg.pdfBytes).toBeInstanceOf(Uint8Array);
    // No re-freeze needed when pdf_path is already set.
    expect(ensureInvoicePdf).not.toHaveBeenCalled();
  });

  it("400 recipientInvalid for a non-email recipient, before any send", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/send/route");
    const res = await POST(sendReq({ slug: "acme", to: "not-an-email" }), idParams("inv-1"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("recipientInvalid");
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("409 notDraft for a draft (non-deliverable) invoice, no send", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/send/route");
    getInvoiceWithLineItems.mockResolvedValue({
      data: { invoice: { ...ISSUED_INVOICE, status: "draft" }, lineItems: [], taxLines: [], customerLabel: null },
      error: null,
    });
    const res = await POST(sendReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(409);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("500 when the freeze is missing and cannot be repaired (pdf_path still null), no send", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/send/route");
    // Both the initial load and the post-`ensureInvoicePdf` reload return a null pdf_path.
    getInvoiceWithLineItems.mockResolvedValue({
      data: { invoice: { ...ISSUED_INVOICE, pdf_path: null }, lineItems: [], taxLines: [], customerLabel: null },
      error: null,
    });
    const res = await POST(sendReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(500);
    expect(ensureInvoicePdf).toHaveBeenCalledTimes(1);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("repairs a missing freeze via ensureInvoicePdf, then sends (200)", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/send/route");
    getInvoiceWithLineItems
      .mockResolvedValueOnce({
        data: { invoice: { ...ISSUED_INVOICE, pdf_path: null }, lineItems: [], taxLines: [], customerLabel: null },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { invoice: { ...ISSUED_INVOICE }, lineItems: [], taxLines: [], customerLabel: null },
        error: null,
      });
    const res = await POST(sendReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(200);
    expect(ensureInvoicePdf).toHaveBeenCalledTimes(1);
    expect(sendInvoiceEmail).toHaveBeenCalledTimes(1);
  });

  it("502 sendFailed when the provider send fails", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/send/route");
    sendInvoiceEmail.mockRejectedValue(new AppError(502, "sendFailed"));
    const res = await POST(sendReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(502);
    expect((await res.json()).error).toBe("sendFailed");
  });

  it("401 unauthorized before any DB access", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/send/route");
    getCurrentUser.mockResolvedValue(null);
    const res = await POST(sendReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(401);
    expect(getInvoiceWithLineItems).not.toHaveBeenCalled();
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("403 forbidden for a Member before any DB access", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/send/route");
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const res = await POST(sendReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(403);
    expect(getInvoiceWithLineItems).not.toHaveBeenCalled();
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });

  it("403 forbidden for a cross-org Admin (slug mismatch)", async () => {
    const { POST } = await import("@/app/api/invoices/[id]/send/route");
    requireAdmin.mockResolvedValue({ organization_id: "org-2", role: "admin", slug: "other" });
    const res = await POST(sendReq(VALID_BODY), idParams("inv-1"));
    expect(res.status).toBe(403);
    expect(sendInvoiceEmail).not.toHaveBeenCalled();
  });
});
