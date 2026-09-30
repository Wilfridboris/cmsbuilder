import { describe, expect, it } from "vitest";

import {
  renderInvoicePdf,
  resolveInvoicePdfStrings,
  type InvoiceDocumentModel,
} from "@/lib/invoicing/pdf";

/**
 * Unit coverage for the credit-note branch of the SHARED render path (Story 12.8, I8).
 * `renderInvoicePdf` renders both invoices and credit notes from the neutral
 * `InvoiceDocumentModel`; a credit note (`documentType: "creditNote"`) titles the document
 * "Credit Note" and shows a "Corrects invoice N" reference line. The rendered PDF binary
 * hides which branch fired, so `resolveInvoicePdfStrings` is asserted directly (the same
 * pattern the invoice tests use) so the document-type / language / reference branches are
 * pinned deterministically.
 */

function creditNoteModel(
  overrides: Partial<InvoiceDocumentModel> = {},
): InvoiceDocumentModel {
  return {
    documentType: "creditNote",
    number: "000001",
    creditNoteReference: "000042",
    issueDate: "2026-09-29",
    language: "en",
    supplier: {
      legalName: "Maple Leaf Plumbing Ltd.",
      operatingName: "Maple Leaf Plumbing",
      gstHstNumber: "123456789 RT0001",
      businessAddress: "1 King St W, Toronto, ON",
      logoDataUrl: null,
      paymentTerms: "Net 30",
      paymentEtransferEmail: "pay@mapleleaf.example",
      paymentChequePayableTo: "Maple Leaf Plumbing Ltd.",
      paymentChequeAddress: "PO Box 1, Toronto, ON",
      paymentCardLink: "https://pay.example/mapleleaf",
    },
    customer: { displayLabel: "Big Client Inc." },
    lineItems: [
      { description: "Overcharged call-out", quantity: 1, unitPrice: 100, amount: 100 },
    ],
    taxLine: { label: "HST", rate: 0.13, amount: 13 },
    subtotal: 100,
    total: 113,
    ...overrides,
  };
}

const PDF_MAGIC = "%PDF-";

describe("renderInvoicePdf (credit note)", () => {
  it("renders an English credit note as a valid %PDF buffer", async () => {
    const buf = await renderInvoicePdf(creditNoteModel({ language: "en" }));
    expect(buf.subarray(0, 5).toString("latin1")).toBe(PDF_MAGIC);
    expect(buf.byteLength).toBeGreaterThan(0);
  }, 30_000);

  it("renders a French credit note as a valid %PDF buffer", async () => {
    const buf = await renderInvoicePdf(creditNoteModel({ language: "fr" }));
    expect(buf.subarray(0, 5).toString("latin1")).toBe(PDF_MAGIC);
    expect(buf.byteLength).toBeGreaterThan(0);
  }, 30_000);

  it("renders a standalone credit note (null customer) as a valid %PDF buffer", async () => {
    const buf = await renderInvoicePdf(
      creditNoteModel({ customer: null, taxLine: null, subtotal: 100, total: 100 }),
    );
    expect(buf.subarray(0, 5).toString("latin1")).toBe(PDF_MAGIC);
  }, 30_000);
});

describe("resolveInvoicePdfStrings (credit-note branches)", () => {
  it("titles the document 'Credit Note' and labels the number for an en credit note", () => {
    const s = resolveInvoicePdfStrings(creditNoteModel({ language: "en" }));
    expect(s.documentTitle).toBe("Credit Note");
    expect(s.numberLabel).toBe("Credit note number");
    expect(s.creditNoteReferenceText).toBe("Corrects invoice 000042");
  });

  it("titles the document 'Note de crédit' for a fr credit note", () => {
    const s = resolveInvoicePdfStrings(creditNoteModel({ language: "fr" }));
    expect(s.documentTitle).toBe("Note de crédit");
    expect(s.numberLabel).toBe("Numéro de note de crédit");
    expect(s.creditNoteReferenceText).toBe("Corrige la facture 000042");
  });

  it("still titles an invoice model 'Invoice' with no reference line", () => {
    const s = resolveInvoicePdfStrings(
      creditNoteModel({ documentType: "invoice", creditNoteReference: null }),
    );
    expect(s.documentTitle).toBe("Invoice");
    expect(s.numberLabel).toBe("Invoice number");
    expect(s.creditNoteReferenceText).toBe("");
  });

  it("omits the reference line when a credit note has no reference number", () => {
    const s = resolveInvoicePdfStrings(
      creditNoteModel({ creditNoteReference: "" }),
    );
    expect(s.creditNoteReferenceText).toBe("");
  });
});
