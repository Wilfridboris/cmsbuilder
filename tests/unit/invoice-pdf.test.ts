import { describe, expect, it } from "vitest";

import {
  renderInvoicePdf,
  resolveInvoicePdfStrings,
  type InvoiceDocumentModel,
} from "@/lib/invoicing/pdf";
import { formatMoney } from "@/lib/invoicing/tax";

/**
 * Unit coverage for the shared invoice-PDF render path (Story 12.5, I8) and the
 * client-safe CAD money formatter. No DB, no storage — `renderInvoicePdf` renders
 * purely from the neutral `InvoiceDocumentModel` (I6) and must return a valid `%PDF`
 * buffer for en, fr, and a standalone (null customer) model; `formatMoney` must
 * format en-CA and fr-CA CAD amounts correctly.
 */

function baseModel(
  overrides: Partial<InvoiceDocumentModel> = {},
): InvoiceDocumentModel {
  return {
    documentType: "invoice",
    number: "000001",
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
      { description: "Emergency call-out", quantity: 2, unitPrice: 100, amount: 200 },
    ],
    taxLine: { label: "HST", rate: 0.13, amount: 26 },
    subtotal: 200,
    total: 226,
    ...overrides,
  };
}

/** The 5-byte `%PDF-` header every PDF document starts with. */
const PDF_MAGIC = "%PDF-";

describe("renderInvoicePdf", () => {
  it("renders an English invoice as a valid %PDF buffer", async () => {
    const buf = await renderInvoicePdf(baseModel({ language: "en" }));
    expect(Buffer.isBuffer(buf)).toBe(true);
    expect(buf.byteLength).toBeGreaterThan(0);
    expect(buf.subarray(0, 5).toString("latin1")).toBe(PDF_MAGIC);
  }, 30_000);

  it("renders a French invoice as a valid %PDF buffer", async () => {
    const buf = await renderInvoicePdf(baseModel({ language: "fr" }));
    expect(buf.subarray(0, 5).toString("latin1")).toBe(PDF_MAGIC);
    expect(buf.byteLength).toBeGreaterThan(0);
  }, 30_000);

  it("renders a standalone invoice (null customer) as a valid %PDF buffer", async () => {
    const buf = await renderInvoicePdf(
      baseModel({ customer: null, taxLine: null, subtotal: 200, total: 200 }),
    );
    expect(buf.subarray(0, 5).toString("latin1")).toBe(PDF_MAGIC);
    expect(buf.byteLength).toBeGreaterThan(0);
  }, 30_000);

  it("actually embeds a supplier logo as an image XObject (not just renders)", async () => {
    // A 1x1 PNG data URL — enough to exercise the <Image> path.
    const png =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";
    const withLogo = await renderInvoicePdf(
      baseModel({ supplier: { ...baseModel().supplier, logoDataUrl: png } }),
    );
    const noLogo = await renderInvoicePdf(
      baseModel({ supplier: { ...baseModel().supplier, logoDataUrl: null } }),
    );
    expect(withLogo.subarray(0, 5).toString("latin1")).toBe(PDF_MAGIC);
    // The logo must produce an image XObject in the PDF and add real bytes —
    // proving the <Image> is embedded, not silently dropped.
    expect(withLogo.toString("latin1")).toContain("/Image");
    expect(withLogo.byteLength).toBeGreaterThan(noLogo.byteLength);
  }, 30_000);
});

describe("formatMoney", () => {
  it("formats en-CA CAD as $1,234.56", () => {
    expect(formatMoney(1234.56, "en")).toBe("$1,234.56");
  });

  it("formats a whole amount with two fraction digits (en-CA)", () => {
    expect(formatMoney(226, "en")).toBe("$226.00");
  });

  it("formats fr-CA CAD with a trailing symbol, comma decimal, and grouped thousands", () => {
    const out = formatMoney(1234.56, "fr");
    // fr-CA: "1 234,56 $" — comma decimal, symbol trailing, grouped. The group and
    // pre-symbol separators are non-breaking spaces, so assert on structure rather than
    // a literal ASCII space.
    expect(out).toContain(",56");
    expect(out.trimEnd().endsWith("$")).toBe(true);
    expect(out).toMatch(/^1.234,56/);
  });

  it("degrades a non-finite amount to zero rather than NaN", () => {
    expect(formatMoney(Number.NaN, "en")).toBe("$0.00");
  });
});

/**
 * The rendered PDF binary hides which branch fired, so a regression that ignored
 * `model.language`, always rendered the standalone line, or dropped the tax label
 * would still emit a valid `%PDF` and pass the smoke tests above. These assert the
 * branch-dependent display strings directly (deterministic, no binary decoding) so
 * AC4's language / standalone-customer / tax-presence behaviors are actually pinned.
 */
describe("resolveInvoicePdfStrings (render branches)", () => {
  it("selects the English catalog and HST label for an en invoice", () => {
    const s = resolveInvoicePdfStrings(baseModel({ language: "en" }));
    expect(s.documentTitle).toBe("Invoice");
    expect(s.taxLabelText).toBe("HST (13%)");
    expect(s.customerLabel).toBe("Big Client Inc.");
  });

  it("selects the French catalog and TVH label for a fr invoice", () => {
    const s = resolveInvoicePdfStrings(baseModel({ language: "fr" }));
    expect(s.documentTitle).toBe("Facture");
    expect(s.taxLabelText).toContain("TVH");
    expect(s.taxLabelText).toContain("13");
  });

  it("renders the localized standalone line when there is no customer", () => {
    expect(resolveInvoicePdfStrings(baseModel({ customer: null, language: "en" })).customerLabel).toBe(
      "No linked customer",
    );
    expect(resolveInvoicePdfStrings(baseModel({ customer: null, language: "fr" })).customerLabel).toBe(
      "Aucun client lié",
    );
  });

  it("emits no tax label when the invoice has no tax line", () => {
    expect(resolveInvoicePdfStrings(baseModel({ taxLine: null })).taxLabelText).toBe("");
  });

  it("combines legal + operating name in the supplier heading", () => {
    expect(resolveInvoicePdfStrings(baseModel()).supplierName).toBe(
      "Maple Leaf Plumbing Ltd. (Maple Leaf Plumbing)",
    );
  });
});
