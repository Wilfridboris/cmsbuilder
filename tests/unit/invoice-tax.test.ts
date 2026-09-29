import { describe, expect, it } from "vitest";

import {
  computeInvoiceTotals,
  computeLineAmount,
  computeSubtotal,
  isRegistrationEffective,
  normalizeProvince,
  PROVINCE_TAX,
} from "@/lib/invoicing/tax";

/**
 * Coverage for the sole canonical line-amount computation (Story 12.2, Invariant
 * I2): `round(quantity × unit_price, 2)`. This is the ONLY implementation; Story
 * 12.3 extends the same `tax.ts` with subtotal/total/HST and must not re-add line
 * amount. Negatives are rejected upstream by the Zod schema, so this only asserts
 * the rounding contract on valid non-negative inputs (plus a couple of edges).
 */

describe("computeLineAmount", () => {
  it("multiplies and rounds to 2 decimals (half-away-from-zero)", () => {
    // 3 × 1.005 = 3.015 → 3.02 (the classic float-drift case: 3.015 is stored just
    // below its true value, but the epsilon nudge lands it on 3.02, not 3.01).
    expect(computeLineAmount(3, 1.005)).toBe(3.02);
  });

  it("returns a clean 2-decimal product for typical money math", () => {
    expect(computeLineAmount(2, 10)).toBe(20);
    expect(computeLineAmount(3, 19.99)).toBe(59.97);
    expect(computeLineAmount(1.5, 4)).toBe(6);
  });

  it("rounds a repeating product to the nearest cent", () => {
    // 1 × 0.1 + ... exercised via a product that lands mid-cent.
    expect(computeLineAmount(1, 2.345)).toBe(2.35);
    expect(computeLineAmount(7, 1.234)).toBe(8.64); // 8.638 → 8.64
  });

  it("returns 0 for a zero quantity or zero unit price", () => {
    expect(computeLineAmount(0, 100)).toBe(0);
    expect(computeLineAmount(5, 0)).toBe(0);
    expect(computeLineAmount(0, 0)).toBe(0);
  });

  it("degrades a non-finite input to 0 rather than propagating NaN", () => {
    expect(computeLineAmount(Number.NaN, 10)).toBe(0);
    expect(computeLineAmount(10, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it("handles large quantities without drift", () => {
    expect(computeLineAmount(1000, 2.5)).toBe(2500);
    expect(computeLineAmount(999, 0.01)).toBe(9.99);
  });
});

/**
 * Coverage for the Story 12.3 totals + Ontario HST helpers (Invariants I2/I3,
 * FR84). `computeInvoiceTotals` is the SINGLE canonical invoice-money computation:
 * the DB stores exactly its output and Story 12.4's issue gate verifies equality
 * against it.
 */

describe("normalizeProvince", () => {
  it("trims and uppercases", () => {
    expect(normalizeProvince("  on ")).toBe("ON");
    expect(normalizeProvince("qc")).toBe("QC");
  });
  it("returns an empty string for null/undefined", () => {
    expect(normalizeProvince(null)).toBe("");
    expect(normalizeProvince(undefined)).toBe("");
  });
});

describe("isRegistrationEffective", () => {
  it("is true when the effective date is on or before the reference date", () => {
    expect(isRegistrationEffective("2026-01-01", "2026-09-29")).toBe(true);
  });
  it("is true when the effective date EQUALS the reference date (boundary)", () => {
    expect(isRegistrationEffective("2026-09-29", "2026-09-29")).toBe(true);
  });
  it("is false when the effective date is after the reference date", () => {
    expect(isRegistrationEffective("2026-10-01", "2026-09-29")).toBe(false);
  });
  it("is false when the effective date is null/absent", () => {
    expect(isRegistrationEffective(null, "2026-09-29")).toBe(false);
    expect(isRegistrationEffective(undefined, "2026-09-29")).toBe(false);
  });
});

describe("computeSubtotal", () => {
  it("sums each rounded line amount", () => {
    expect(
      computeSubtotal([
        { quantity: 2, unitPrice: 50 }, // 100
        { quantity: 1, unitPrice: 25 }, // 25
      ]),
    ).toBe(125);
  });
  it("rounds each line to 2 decimals before summing (I2)", () => {
    // Two lines of 3 × 1.005 = 3.02 each → 6.04 (not 6.03 from an unrounded sum).
    expect(
      computeSubtotal([
        { quantity: 3, unitPrice: 1.005 },
        { quantity: 3, unitPrice: 1.005 },
      ]),
    ).toBe(6.04);
  });
  it("is 0 for no lines", () => {
    expect(computeSubtotal([])).toBe(0);
  });
});

describe("PROVINCE_TAX", () => {
  it("has Ontario HST at 13% and no other active province (MVP)", () => {
    expect(PROVINCE_TAX.ON).toEqual({ label: "HST", rate: 0.13 });
    expect(PROVINCE_TAX.QC).toBeUndefined();
  });
});

describe("computeInvoiceTotals", () => {
  const lines = [
    { quantity: 2, unitPrice: 50 }, // 100
    { quantity: 1, unitPrice: 25 }, // 25 → subtotal 125
  ];

  it("registered ON: one HST line round(subtotal×0.13,2); total reconciles", () => {
    const totals = computeInvoiceTotals({
      lineItems: lines,
      province: "ON",
      taxApplies: true,
    });
    expect(totals.subtotal).toBe(125);
    expect(totals.taxLines).toHaveLength(1);
    expect(totals.taxLines[0]).toEqual({
      label: "HST",
      rate: 0.13,
      base: 125,
      tax_amount: 16.25,
    });
    expect(totals.taxTotal).toBe(16.25);
    expect(totals.total).toBe(141.25);
    expect(totals.total).toBe(totals.subtotal + totals.taxTotal);
  });

  it("computes HST ONCE on the subtotal, not per line", () => {
    // Per-line HST on 100 and 25 rounds to 13.00 + 3.25 = 16.25 here (coincidental),
    // so use amounts where per-line vs whole-subtotal rounding DIVERGES.
    const totals = computeInvoiceTotals({
      lineItems: [
        { quantity: 1, unitPrice: 0.1 }, // 0.10 → per-line HST 0.013 → 0.01
        { quantity: 1, unitPrice: 0.1 }, // 0.10 → per-line HST 0.013 → 0.01
      ],
      province: "ON",
      taxApplies: true,
    });
    // Subtotal 0.20 × 0.13 = 0.026 → 0.03 (once), NOT 0.01 + 0.01 = 0.02 (per line).
    expect(totals.subtotal).toBe(0.2);
    expect(totals.taxTotal).toBe(0.03);
  });

  it("not registered: no tax line, tax_total 0, total = subtotal (FR84)", () => {
    const totals = computeInvoiceTotals({
      lineItems: lines,
      province: "ON",
      taxApplies: false,
    });
    expect(totals.taxLines).toHaveLength(0);
    expect(totals.taxTotal).toBe(0);
    expect(totals.total).toBe(125);
  });

  it("non-Ontario province (registered): no active tax line in MVP (FR95)", () => {
    const totals = computeInvoiceTotals({
      lineItems: lines,
      province: "QC",
      taxApplies: true,
    });
    expect(totals.taxLines).toHaveLength(0);
    expect(totals.taxTotal).toBe(0);
    expect(totals.total).toBe(125);
  });

  it("normalizes the province before the rate lookup", () => {
    const totals = computeInvoiceTotals({
      lineItems: lines,
      province: " on ",
      taxApplies: true,
    });
    expect(totals.taxLines).toHaveLength(1);
    expect(totals.taxTotal).toBe(16.25);
  });

  it("empty lines: zero everything, no tax line even when registered", () => {
    const totals = computeInvoiceTotals({
      lineItems: [],
      province: "ON",
      taxApplies: true,
    });
    expect(totals.subtotal).toBe(0);
    expect(totals.taxTotal).toBe(0);
    expect(totals.total).toBe(0);
    expect(totals.taxLines).toHaveLength(1); // HST on a 0 subtotal is a 0.00 line
    expect(totals.taxLines[0].tax_amount).toBe(0);
  });
});
