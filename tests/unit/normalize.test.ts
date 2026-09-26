import { describe, expect, it } from "vitest";

import { normalizeTableName } from "@/lib/utils";

/**
 * Unit coverage for `normalizeTableName` (Story 2.6 / retro F8).
 *
 * Locks the diacritic-folding fix: accented Latin (French) names must normalize
 * to readable ASCII keys instead of being mangled (`num_ro`) or emptied, ASCII
 * inputs must stay byte-identical to the pre-change behavior (regression guard),
 * and a purely non-Latin name must yield a deterministic, non-empty `[a-z0-9_]`
 * synthetic key rather than the empty string that would reject the schema.
 *
 * Every row of the spec's I/O & Edge-Case Matrix is covered below.
 */

describe("normalizeTableName", () => {
  describe("French / accented Latin names fold to readable ASCII keys", () => {
    it("folds é → e (numéro → numero, not num_ro)", () => {
      expect(normalizeTableName("numéro")).toBe("numero");
    });

    it("folds û → u (coût → cout)", () => {
      expect(normalizeTableName("coût")).toBe("cout");
    });

    it("folds diacritics and collapses punctuation (Réf. client → ref_client)", () => {
      expect(normalizeTableName("Réf. client")).toBe("ref_client");
    });

    it("folds è/à/ç/ï and other common French accents", () => {
      expect(normalizeTableName("région")).toBe("region");
      expect(normalizeTableName("à payer")).toBe("a_payer");
      expect(normalizeTableName("garçon")).toBe("garcon");
      expect(normalizeTableName("naïve")).toBe("naive");
    });

    it("handles a mixed accented + numeric + punctuation label", () => {
      expect(normalizeTableName("Coût 2024 (CAD)")).toBe("cout_2024_cad");
    });
  });

  describe("two distinct accented siblings yield distinct keys (no false duplicate)", () => {
    it("région and regionalisation do not collapse to the same key", () => {
      const a = normalizeTableName("région");
      const b = normalizeTableName("regionalisation");
      expect(a).toBe("region");
      expect(b).toBe("regionalisation");
      expect(a).not.toBe(b);
    });
  });

  describe("ASCII inputs are unchanged (regression guard)", () => {
    // These MUST remain byte-identical to the pre-Story-2.6 behavior so the demo
    // template, fallback template, and existing fixtures/tests stay green.
    it.each([
      ["Client Name", "client_name"],
      ["clients", "clients"],
      ["Jobs", "jobs"],
      ["Invoices", "invoices"],
      ["Invoice #", "invoice"],
      ["  Trailing/Leading  ", "trailing_leading"],
      ["Total $ Amount", "total_amount"],
      ["already_snake_case", "already_snake_case"],
      ["Mixed CASE 123", "mixed_case_123"],
      ["it's a name", "its_a_name"],
      ['say "hi"', "say_hi"],
    ])("%s → %s", (input, expected) => {
      expect(normalizeTableName(input)).toBe(expected);
    });

    it("reproduces the pre-change pipeline exactly for pure-ASCII input", () => {
      // The legacy implementation (folding step is a no-op on ASCII).
      const legacy = (input: string) =>
        input
          .trim()
          .toLowerCase()
          .replace(/['"]/g, "")
          .replace(/[^a-z0-9]+/g, "_")
          .replace(/^_+|_+$/g, "");
      for (const s of [
        "Client Name",
        "Jobs",
        "Invoice #4",
        "  spaced  out  ",
        "UPPER_lower-123",
        "Total $ Amount",
      ]) {
        expect(normalizeTableName(s)).toBe(legacy(s));
      }
    });
  });

  describe("non-Latin names get a deterministic, non-empty synthetic key", () => {
    it("never returns empty for CJK / Arabic input", () => {
      expect(normalizeTableName("顧客")).not.toBe("");
      expect(normalizeTableName("العميل")).not.toBe("");
    });

    it("yields a [a-z0-9_] key with no leading/trailing underscore", () => {
      for (const input of ["顧客", "العميل", "Кириллица", "日本語のフィールド"]) {
        const key = normalizeTableName(input);
        expect(key).toMatch(/^[a-z0-9_]+$/);
        expect(key).not.toMatch(/^_/);
        expect(key).not.toMatch(/_$/);
      }
    });

    it("is deterministic — the same input always maps to the same key", () => {
      expect(normalizeTableName("顧客")).toBe(normalizeTableName("顧客"));
      expect(normalizeTableName("العميل")).toBe(normalizeTableName("العميل"));
    });

    it("distinct non-Latin inputs get distinct keys (no false duplicate)", () => {
      expect(normalizeTableName("顧客")).not.toBe(normalizeTableName("العميل"));
    });

    it("also synthesizes for punctuation-only input that would strip to empty", () => {
      const key = normalizeTableName("!!!");
      expect(key).not.toBe("");
      expect(key).toMatch(/^[a-z0-9_]+$/);
    });
  });
});
