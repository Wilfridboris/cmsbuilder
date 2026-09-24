import { describe, expect, it } from "vitest";

import { formatCell, type CellStrings } from "@/lib/format";

/**
 * Unit coverage for the shared typed cell formatter (Story 1.6). Pure logic, no
 * DOM / next-intl — the three locale strings are injected. Covers the I/O
 * matrix's per-type formatting for every scalar type plus null/blank, so the
 * list view and detail view are guaranteed to render each type identically.
 */

const STRINGS: CellStrings = {
  empty: "—",
  yes: "Yes",
  no: "No",
};

describe("formatCell", () => {
  describe("null / blank → empty placeholder", () => {
    it("returns the empty string for null", () => {
      expect(formatCell(null, "text", STRINGS)).toBe("—");
    });

    it("returns the empty string for undefined", () => {
      expect(formatCell(undefined, "text", STRINGS)).toBe("—");
    });

    it("returns the empty string for a blank/whitespace string", () => {
      expect(formatCell("", "text", STRINGS)).toBe("—");
      expect(formatCell("   ", "text", STRINGS)).toBe("—");
    });

    it("does not treat the number 0 or false as empty", () => {
      expect(formatCell(0, "number", STRINGS)).toBe("0");
      expect(formatCell(false, "boolean", STRINGS)).toBe("No");
    });
  });

  describe("boolean → i18n yes/no", () => {
    it("formats true and false", () => {
      expect(formatCell(true, "boolean", STRINGS)).toBe("Yes");
      expect(formatCell(false, "boolean", STRINGS)).toBe("No");
    });
  });

  describe("currency → CAD", () => {
    it("formats a numeric value as CAD", () => {
      const out = formatCell(1234.5, "currency", STRINGS);
      // Intl output: "$1,234.50" (en-CA). Assert the salient parts to stay
      // resilient to non-breaking-space / symbol placement variations.
      expect(out).toContain("1,234.50");
      expect(out).toContain("$");
    });

    it("falls back to text for a non-numeric currency value", () => {
      expect(formatCell("N/A", "currency", STRINGS)).toBe("N/A");
    });
  });

  describe("date / datetime", () => {
    it("formats a parseable date", () => {
      const out = formatCell("2026-01-15", "date", STRINGS);
      expect(out).toContain("2026");
      expect(out).not.toBe("2026-01-15"); // reformatted, not raw
    });

    it("formats a parseable datetime", () => {
      const out = formatCell("2026-01-15T14:30:00Z", "datetime", STRINGS);
      expect(out).toContain("2026");
    });

    it("returns the raw value for an unparseable date", () => {
      expect(formatCell("not-a-date", "date", STRINGS)).toBe("not-a-date");
    });
  });

  describe("text / number / email / phone → plain text", () => {
    it("returns text verbatim", () => {
      expect(formatCell("Maple Ridge HVAC", "text", STRINGS)).toBe(
        "Maple Ridge HVAC",
      );
    });

    it("stringifies a number", () => {
      expect(formatCell(42, "number", STRINGS)).toBe("42");
    });

    it("returns an email as plain text (no linkification)", () => {
      expect(formatCell("owner@example.ca", "email", STRINGS)).toBe(
        "owner@example.ca",
      );
    });

    it("returns a phone as plain text", () => {
      expect(formatCell("613-555-0142", "phone", STRINGS)).toBe(
        "613-555-0142",
      );
    });
  });
});
