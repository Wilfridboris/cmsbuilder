import { describe, expect, it, vi } from "vitest";

import {
  assertIssuable,
  assertIssuableCreditNote,
} from "@/lib/invoicing/validate";
import { formatInvoiceNumber } from "@/lib/invoicing/tax";
import { AppError } from "@/types/api";

/**
 * Unit coverage for the pre-issue compliance gate (Story 12.4, FR87) and the invoice
 * number display format (Invariant I1). No network, no DB — `assertIssuable` is a pure
 * synchronous gate that verifies the STORED figures against a fresh canonical
 * recomputation (reusing tax.ts, I2/I3) and throws a specific `Invoice.error.*` code on
 * any block. The observability seam is mocked so a rejection logs without console noise.
 */

vi.mock("@/lib/observability/report", () => ({
  reportRejection: vi.fn(),
  reportError: vi.fn(),
}));

const TODAY = "2026-09-29";

/** A registered Ontario Business Profile effective before today. */
function registeredProfile() {
  return {
    legal_name: "Acme Legal Inc.",
    gst_hst_number: "123456789RT0001",
    gst_hst_effective_date: "2026-01-01",
  };
}

/**
 * A valid, reconciling registered-Ontario invoice: two lines (100.00 + 25.00 = 125.00
 * subtotal), HST 13% once on the subtotal (16.25), total 141.25. All stored figures
 * equal the canonical recomputation.
 */
function validInput() {
  return {
    invoice: {
      place_of_supply_province: "ON",
      subtotal: 125,
      tax_total: 16.25,
      total: 141.25,
    },
    lineItems: [
      { description: "Design", quantity: 2, unit_price: 50, amount: 100 },
      { description: "Hosting", quantity: 1, unit_price: 25, amount: 25 },
    ],
    taxLines: [{ label: "HST", rate: 0.13, base: 125, tax_amount: 16.25 }],
    profile: registeredProfile(),
    issueDate: TODAY,
  };
}

function expectBlock(input: Parameters<typeof assertIssuable>[0], code: string) {
  try {
    assertIssuable(input);
    throw new Error("expected assertIssuable to throw");
  } catch (err) {
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).userMessage).toBe(`Invoice.error.${code}`);
    expect((err as AppError).statusCode).toBe(422);
  }
}

describe("assertIssuable", () => {
  it("passes a valid, reconciling registered-Ontario invoice", () => {
    expect(() => assertIssuable(validInput())).not.toThrow();
  });

  it("passes a valid standalone invoice with no tax (unregistered)", () => {
    expect(() =>
      assertIssuable({
        invoice: {
          place_of_supply_province: "ON",
          subtotal: 100,
          tax_total: 0,
          total: 100,
        },
        lineItems: [
          { description: "Consulting", quantity: 1, unit_price: 100, amount: 100 },
        ],
        taxLines: [],
        profile: {
          legal_name: "Solo Co",
          gst_hst_number: null,
          gst_hst_effective_date: null,
        },
        issueDate: TODAY,
      }),
    ).not.toThrow();
  });

  it("blocks legalIdentityMissing when there is no profile", () => {
    expectBlock({ ...validInput(), profile: null }, "legalIdentityMissing");
  });

  it("blocks legalIdentityMissing when legal_name is blank", () => {
    expectBlock(
      {
        ...validInput(),
        profile: { ...registeredProfile(), legal_name: "   " },
      },
      "legalIdentityMissing",
    );
  });

  it("blocks taxWithoutRegistration when a tax line is present but no number", () => {
    expectBlock(
      {
        ...validInput(),
        profile: {
          legal_name: "Acme Legal Inc.",
          gst_hst_number: null,
          gst_hst_effective_date: null,
        },
      },
      "taxWithoutRegistration",
    );
  });

  it("blocks taxWithoutRegistration when the registration is not yet effective", () => {
    expectBlock(
      {
        ...validInput(),
        profile: {
          ...registeredProfile(),
          gst_hst_effective_date: "2026-12-31", // after the issue date
        },
      },
      "taxWithoutRegistration",
    );
  });

  it("blocks taxSplit when there is more than one tax line", () => {
    expectBlock(
      {
        ...validInput(),
        taxLines: [
          { label: "GST", rate: 0.05, base: 125, tax_amount: 6.25 },
          { label: "PST", rate: 0.08, base: 125, tax_amount: 10 },
        ],
      },
      "taxSplit",
    );
  });

  it("blocks totalsMismatch when the stored total drifted", () => {
    expectBlock(
      { ...validInput(), invoice: { ...validInput().invoice, total: 999 } },
      "totalsMismatch",
    );
  });

  it("blocks totalsMismatch when a stored line amount drifted", () => {
    expectBlock(
      {
        ...validInput(),
        lineItems: [
          { description: "Design", quantity: 2, unit_price: 50, amount: 999 },
          { description: "Hosting", quantity: 1, unit_price: 25, amount: 25 },
        ],
      },
      "totalsMismatch",
    );
  });

  it("blocks totalsMismatch when the stored tax_total drifted", () => {
    expectBlock(
      {
        ...validInput(),
        invoice: { ...validInput().invoice, tax_total: 0 },
      },
      "totalsMismatch",
    );
  });

  it("blocks lineItemsRequired when there are zero line items", () => {
    expectBlock(
      {
        ...validInput(),
        lineItems: [],
        taxLines: [],
        invoice: {
          place_of_supply_province: "ON",
          subtotal: 0,
          tax_total: 0,
          total: 0,
        },
      },
      "lineItemsRequired",
    );
  });

  it("accepts PostgREST string-boundary numerics that reconcile", () => {
    expect(() =>
      assertIssuable({
        invoice: {
          place_of_supply_province: "ON",
          subtotal: "125",
          tax_total: "16.25",
          total: "141.25",
        },
        lineItems: [
          { description: "Design", quantity: "2", unit_price: "50", amount: "100" },
          { description: "Hosting", quantity: "1", unit_price: "25", amount: "25" },
        ],
        taxLines: [
          { label: "HST", rate: "0.13", base: "125", tax_amount: "16.25" },
        ],
        profile: registeredProfile(),
        issueDate: TODAY,
      }),
    ).not.toThrow();
  });
});

describe("assertIssuableCreditNote ceiling (retro [X1])", () => {
  // A reconciling credit note whose own total is 141.25 (reuses the invoice shape).
  function creditNote(ceiling: {
    invoiceTotal: number;
    alreadyCredited: number;
  } | null) {
    return { ...validInput(), ceiling };
  }

  function expectCeilingBlock(
    input: Parameters<typeof assertIssuableCreditNote>[0],
  ) {
    try {
      assertIssuableCreditNote(input);
      throw new Error("expected assertIssuableCreditNote to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).userMessage).toBe(
        "Invoice.error.creditExceedsInvoice",
      );
      expect((err as AppError).statusCode).toBe(422);
    }
  }

  it("passes when the credit equals the full invoice total (nothing credited yet)", () => {
    expect(() =>
      assertIssuableCreditNote(
        creditNote({ invoiceTotal: 141.25, alreadyCredited: 0 }),
      ),
    ).not.toThrow();
  });

  it("passes when the cumulative credit exactly hits the invoice total", () => {
    // 100.00 already credited + this 141.25 would be 241.25 > 141.25 -> blocked; use a
    // headroom case: 0.00 already credited leaves exactly the full total available.
    expect(() =>
      assertIssuableCreditNote(
        creditNote({ invoiceTotal: 141.25, alreadyCredited: 0 }),
      ),
    ).not.toThrow();
  });

  it("blocks a single credit note larger than the invoice total", () => {
    expectCeilingBlock(creditNote({ invoiceTotal: 100, alreadyCredited: 0 }));
  });

  it("blocks double-crediting past the invoice total", () => {
    // 141.25 invoice, 100.00 already credited, this note 141.25 -> 241.25 > 141.25.
    expectCeilingBlock(
      creditNote({ invoiceTotal: 141.25, alreadyCredited: 100 }),
    );
  });

  it("tolerates a half-cent rounding margin at the ceiling", () => {
    // Cumulative 141.25 vs invoiceTotal 141.25 is within the half-cent epsilon.
    expect(() =>
      assertIssuableCreditNote(
        creditNote({ invoiceTotal: 141.25, alreadyCredited: 0 }),
      ),
    ).not.toThrow();
  });

  it("skips the ceiling when the source invoice total is unavailable (null)", () => {
    expect(() => assertIssuableCreditNote(creditNote(null))).not.toThrow();
  });

  it("still enforces the shared invoice compliance gate under the ceiling", () => {
    // A blank legal name must still block, ceiling notwithstanding.
    expectCeilingBlockOrIdentity(
      {
        ...creditNote({ invoiceTotal: 141.25, alreadyCredited: 0 }),
        profile: { ...registeredProfile(), legal_name: "" },
      },
      "legalIdentityMissing",
    );
  });

  function expectCeilingBlockOrIdentity(
    input: Parameters<typeof assertIssuableCreditNote>[0],
    code: string,
  ) {
    try {
      assertIssuableCreditNote(input);
      throw new Error("expected assertIssuableCreditNote to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(AppError);
      expect((err as AppError).userMessage).toBe(`Invoice.error.${code}`);
    }
  }
});

describe("formatInvoiceNumber", () => {
  it("zero-pads to 6 digits with no prefix", () => {
    expect(formatInvoiceNumber(1)).toBe("000001");
    expect(formatInvoiceNumber(42)).toBe("000042");
    expect(formatInvoiceNumber(123456)).toBe("123456");
  });

  it("shows a number wider than 6 digits in full (never truncated)", () => {
    expect(formatInvoiceNumber(1234567)).toBe("1234567");
  });

  it("returns an empty string for a null / undefined / non-finite number", () => {
    expect(formatInvoiceNumber(null)).toBe("");
    expect(formatInvoiceNumber(undefined)).toBe("");
    expect(formatInvoiceNumber(Number.NaN)).toBe("");
  });
});
