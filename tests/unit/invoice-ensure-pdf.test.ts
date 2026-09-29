import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { InvoiceWithLineItems } from "@/lib/data/invoices";
import type { SupplierSnapshot } from "@/types/db";

/**
 * Unit coverage for the freeze-failure contract of `ensureInvoicePdf` (Story 12.5,
 * the I/O matrix "Freeze failure" row): when the PDF render OR the storage upload
 * throws, the best-effort freeze must NEVER throw — the already-committed issued
 * invoice stays issued, `pdf_path` stays null (retryable), the failure is reported
 * through the observability seam, and NO `pdf_path` write is attempted (the render/
 * upload failed before the update). Lives in its own file because it module-mocks
 * `@/lib/invoicing/pdf` / storage / the read layer / the report seam, whereas
 * `invoice-pdf.test.ts` exercises the REAL `renderInvoicePdf`.
 *
 * `vi.hoisted` provides the shared mock fns so the (hoisted) `vi.mock` factories can
 * reference them without tripping the out-of-scope-variable rule.
 */

const { getInvoiceWithLineItems, renderInvoicePdf, uploadInvoicePdf, reportError } =
  vi.hoisted(() => ({
    getInvoiceWithLineItems: vi.fn(),
    renderInvoicePdf: vi.fn(),
    uploadInvoicePdf: vi.fn(),
    reportError: vi.fn(),
  }));

vi.mock("@/lib/data/invoices", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/data/invoices")>();
  return { ...actual, getInvoiceWithLineItems };
});
vi.mock("@/lib/invoicing/pdf", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/invoicing/pdf")>();
  return { ...actual, renderInvoicePdf };
});
vi.mock("@/lib/invoicing/storage", async (importActual) => {
  const actual = await importActual<typeof import("@/lib/invoicing/storage")>();
  return { ...actual, uploadInvoicePdf };
});
vi.mock("@/lib/observability/report", () => ({ reportError }));

import { ensureInvoicePdf } from "@/lib/data/invoice-mutate";

const ORG = "org-1";
const INVOICE_ID = "inv-1";
const ACTOR = "actor-1";

/** A frozen supplier snapshot as an issued invoice carries it (I6). */
const SUPPLIER_SNAPSHOT: SupplierSnapshot = {
  legal_name: "Maple Leaf Plumbing Ltd.",
  operating_name: "Maple Leaf Plumbing",
  entity_type: "corporation",
  jurisdiction: "ON",
  gst_hst_number: "123456789 RT0001",
  gst_hst_effective_date: "2026-01-01",
  logo_path: null,
  business_address: "1 King St W, Toronto, ON",
  mailing_address: null,
  default_payment_terms: "Net 30",
  payment_etransfer_email: "pay@mapleleaf.example",
  payment_cheque_payable_to: "Maple Leaf Plumbing Ltd.",
  payment_cheque_address: null,
  payment_card_link: null,
  language: "en",
};

/**
 * An ISSUED invoice with `pdf_path: null` and one line item — the exact shape the
 * read layer returns for a just-issued invoice (numeric money columns come back as
 * strings from PostgREST, so they are strings here). No customer snapshot (standalone).
 */
function issuedLoaded(): InvoiceWithLineItems {
  return {
    invoice: {
      id: INVOICE_ID,
      organization_id: ORG,
      customer_record_id: null,
      place_of_supply_province: "ON",
      language: "en",
      status: "issued",
      version: 1,
      actor_id: ACTOR,
      subtotal: "200.00",
      tax_total: "26.00",
      total: "226.00",
      invoice_number: "1",
      issue_date: "2026-09-29",
      due_date: null,
      supplier_snapshot: SUPPLIER_SNAPSHOT,
      customer_snapshot: null,
      share_token: "0123456789ABCDEFGHIJKL",
      pdf_path: null,
      created_at: "2026-09-29T00:00:00.000Z",
      updated_at: "2026-09-29T00:00:00.000Z",
    },
    lineItems: [
      {
        id: "line-1",
        invoice_id: INVOICE_ID,
        organization_id: ORG,
        description: "Emergency call-out",
        quantity: "2",
        unit_price: "100.00",
        amount: "200.00",
        sort_order: 0,
        created_at: "2026-09-29T00:00:00.000Z",
        updated_at: "2026-09-29T00:00:00.000Z",
      },
    ],
    taxLines: [
      {
        id: "tax-1",
        invoice_id: INVOICE_ID,
        organization_id: ORG,
        label: "HST",
        rate: "0.13",
        base: "200.00",
        tax_amount: "26.00",
        sort_order: 0,
        created_at: "2026-09-29T00:00:00.000Z",
        updated_at: "2026-09-29T00:00:00.000Z",
      },
    ],
    customerLabel: null,
  };
}

/**
 * A minimal fake identity. `client.from` is a `vi.fn()` so we can assert the freeze
 * NEVER reached the `pdf_path` update after a render/upload failure; `client.storage`
 * is stubbed only so an accidental upload path wouldn't crash the fake.
 */
function makeIdentity() {
  const from = vi.fn();
  const client = {
    from,
    storage: { from: vi.fn() },
  } as unknown as SupabaseClient;
  return { identity: { client, actorId: ACTOR, orgId: ORG }, from };
}

describe("ensureInvoicePdf failure handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getInvoiceWithLineItems.mockResolvedValue({
      data: issuedLoaded(),
      error: null,
    });
  });

  it("swallows a render failure: resolves, reports, writes no pdf_path", async () => {
    renderInvoicePdf.mockRejectedValue(new Error("render boom"));
    const { identity, from } = makeIdentity();

    // Must not throw / reject — the issue is already committed and irreversible.
    await expect(
      ensureInvoicePdf(identity, INVOICE_ID),
    ).resolves.toBeUndefined();

    // The failure is reported through the observability seam ...
    expect(reportError).toHaveBeenCalledTimes(1);
    // ... upload was never reached (render threw first) ...
    expect(uploadInvoicePdf).not.toHaveBeenCalled();
    // ... and NO pdf_path write was attempted (client.from never invoked).
    expect(from).not.toHaveBeenCalled();
  });

  it("swallows an upload failure: resolves, reports, writes no pdf_path", async () => {
    renderInvoicePdf.mockResolvedValue(Buffer.from("%PDF-1.7 fake"));
    uploadInvoicePdf.mockRejectedValue(new Error("upload boom"));
    const { identity, from } = makeIdentity();

    await expect(
      ensureInvoicePdf(identity, INVOICE_ID),
    ).resolves.toBeUndefined();

    expect(renderInvoicePdf).toHaveBeenCalledTimes(1);
    expect(reportError).toHaveBeenCalledTimes(1);
    // The upload threw before the update, so no pdf_path write was attempted.
    expect(from).not.toHaveBeenCalled();
  });
});
