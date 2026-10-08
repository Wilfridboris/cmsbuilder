import { describe, expect, it } from "vitest";

import { formatMoney } from "@/lib/invoicing/tax";

/**
 * Story 15.3 issued-money formatting: the on-screen invoice / credit-note money
 * now renders through the SAME `formatMoney(amount, language)` the frozen PDF
 * uses, keyed off the document's frozen `language`, so the screen matches the PDF
 * exactly. Asserts the two Canadian-locale shapes (en `$1,234.50`, fr
 * `1 234,50 $`) on the salient parts, resilient to non-breaking-space / symbol
 * placement variations.
 */

describe("formatMoney (issued on-screen money)", () => {
  it("formats en as $1,234.50 (symbol-leading, comma grouping)", () => {
    const out = formatMoney(1234.5, "en");
    expect(out).toContain("1,234.50");
    expect(out).toContain("$");
  });

  it("formats fr as 1 234,50 $ (trailing symbol, comma decimal)", () => {
    const out = formatMoney(1234.5, "fr");
    // fr-CA uses a (non-breaking) space group separator and a comma decimal,
    // with a trailing currency symbol.
    expect(out).toMatch(/1.?234,50/);
    expect(out).toContain("$");
    expect(out.trimEnd().endsWith("$")).toBe(true);
  });

  it("always shows two fraction digits", () => {
    expect(formatMoney(5, "en")).toContain("5.00");
  });

  it("degrades a non-finite amount to a formatted 0 (never NaN)", () => {
    const out = formatMoney(Number.NaN, "en");
    expect(out).toContain("0.00");
    expect(out.includes("NaN")).toBe(false);
  });
});
