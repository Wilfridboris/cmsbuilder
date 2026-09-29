import { describe, expect, it } from "vitest";

import { computeLineAmount } from "@/lib/invoicing/tax";

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
