import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  FALLBACK_SEED_ROWS,
  UNIVERSAL_FIELD_SERVICE_TEMPLATE,
} from "@/lib/generation/fallback";
import { getSchema } from "@/lib/data/records";
import {
  BLOCKED_KEYWORDS,
  MAX_SEED_ROWS,
  RESERVED_KEYS,
  filterSeedRows,
  validateGeneratedSchema,
} from "@/lib/schema/validator";

/**
 * Unit coverage for the hard fallback template (Story 1.5). No network, no DB.
 *
 * The template is hardcoded, NOT LLM output — but it MUST pass the SAME safety
 * gate (`validateGeneratedSchema` / `filterSeedRows`) that the LLM output passes:
 * the fallback is only safe if it clears the exact bar generation does. These
 * tests assert that invariant plus the story's structural promises: exactly
 * three tables (clients/jobs/invoices), a `reason` on every table and field,
 * only MVP scalar types (never `relation`), no reserved/blocked keys, and 5–8
 * seed rows per table.
 */

vi.mock("@/lib/observability/report", () => ({
  reportRejection: vi.fn(),
  reportError: vi.fn(),
}));

const ALLOWED_TYPES = new Set([
  "text",
  "number",
  "boolean",
  "date",
  "datetime",
  "currency",
  "email",
  "phone",
]);

describe("UNIVERSAL_FIELD_SERVICE_TEMPLATE — structure", () => {
  it("has exactly the three tables clients/jobs/invoices", () => {
    const keys = UNIVERSAL_FIELD_SERVICE_TEMPLATE.tables.map((t) => t.key);
    expect(keys).toEqual(["clients", "jobs", "invoices"]);
  });

  it("carries a plain-language reason on every table AND every field", () => {
    for (const table of UNIVERSAL_FIELD_SERVICE_TEMPLATE.tables) {
      expect(table.reason && table.reason.trim().length).toBeTruthy();
      for (const field of table.fields) {
        expect(field.reason && field.reason.trim().length).toBeTruthy();
      }
    }
  });

  it("uses only MVP scalar field types — never relation", () => {
    for (const table of UNIVERSAL_FIELD_SERVICE_TEMPLATE.tables) {
      for (const field of table.fields) {
        expect(ALLOWED_TYPES.has(field.type)).toBe(true);
        expect(field.type).not.toBe("relation");
      }
    }
  });

  it("has no reserved-column collisions and no blocked keywords in keys/labels", () => {
    for (const table of UNIVERSAL_FIELD_SERVICE_TEMPLATE.tables) {
      expect(RESERVED_KEYS).not.toContain(table.key);
      const tableText = `${table.key} ${table.label}`.toUpperCase();
      for (const kw of BLOCKED_KEYWORDS) {
        expect(tableText.includes(kw.toUpperCase())).toBe(false);
      }
      for (const field of table.fields) {
        expect(RESERVED_KEYS).not.toContain(field.key);
        const fieldText = `${field.key} ${field.label}`.toUpperCase();
        for (const kw of BLOCKED_KEYWORDS) {
          expect(fieldText.includes(kw.toUpperCase())).toBe(false);
        }
      }
    }
  });
});

describe("UNIVERSAL_FIELD_SERVICE_TEMPLATE — passes the safety gate", () => {
  it("validateGeneratedSchema accepts it unchanged (same shape in, same shape out)", () => {
    const result = validateGeneratedSchema(UNIVERSAL_FIELD_SERVICE_TEMPLATE);
    expect(result.valid).toBe(true);
    if (result.valid) {
      // Keys are already normalized, so the sanitized schema round-trips 1:1.
      expect(result.sanitized.tables.map((t) => t.key)).toEqual([
        "clients",
        "jobs",
        "invoices",
      ]);
      for (const table of result.sanitized.tables) {
        expect(table.reason).toBeTruthy();
        for (const field of table.fields) {
          expect(field.reason).toBeTruthy();
        }
      }
    }
  });

  it("also validates with isFallback:true set (the provisioned shape)", () => {
    const result = validateGeneratedSchema({
      ...UNIVERSAL_FIELD_SERVICE_TEMPLATE,
      isFallback: true,
    });
    expect(result.valid).toBe(true);
  });
});

describe("FALLBACK_SEED_ROWS — 5–8 rows per table, all survive filtering", () => {
  it("has a seed-row entry for every template table", () => {
    for (const table of UNIVERSAL_FIELD_SERVICE_TEMPLATE.tables) {
      expect(Array.isArray(FALLBACK_SEED_ROWS[table.key])).toBe(true);
    }
  });

  it("provides 5–8 rows per table", () => {
    for (const table of UNIVERSAL_FIELD_SERVICE_TEMPLATE.tables) {
      const rows = FALLBACK_SEED_ROWS[table.key];
      expect(rows.length).toBeGreaterThanOrEqual(5);
      expect(rows.length).toBeLessThanOrEqual(8);
      expect(rows.length).toBeLessThanOrEqual(MAX_SEED_ROWS);
    }
  });

  it("every row passes filterSeedRows cleanly (no bad rows dropped)", () => {
    for (const table of UNIVERSAL_FIELD_SERVICE_TEMPLATE.tables) {
      const raw = FALLBACK_SEED_ROWS[table.key];
      const kept = filterSeedRows(table, raw);
      // No row is dropped, and the row count stays within the cap.
      expect(kept).toHaveLength(raw.length);
      // Every kept cell projects onto a known field key.
      const fieldKeys = new Set(table.fields.map((f) => f.key));
      for (const row of kept) {
        for (const key of Object.keys(row)) {
          expect(fieldKeys.has(key)).toBe(true);
        }
      }
    }
  });
});

/**
 * The frozen boundary/AC requires `isFallback` to persist into
 * `org_schemas.definition` AND survive read-back (so Story 1.6's independent
 * render and Epic 2 claim can reconstruct the banner). Provisioning stores the
 * definition verbatim, but `getSchema` is the ONLY read path — it must not strip
 * the flag while normalizing `tables`. A minimal fake client stands in for the
 * `org_schemas` row so this exercises the real `getSchema`.
 */
function fakeSchemaClient(definition: unknown): SupabaseClient {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: () => Promise.resolve({ data: { definition }, error: null }),
        }),
      }),
    }),
  } as unknown as SupabaseClient;
}

describe("isFallback durability — getSchema preserves the flag on read-back", () => {
  it("returns isFallback:true when the stored fallback definition carries it", async () => {
    const stored = { ...UNIVERSAL_FIELD_SERVICE_TEMPLATE, isFallback: true };
    const result = await getSchema(fakeSchemaClient(stored), "org-fallback");
    expect(result.error).toBeNull();
    expect(result.data?.isFallback).toBe(true);
    expect(result.data?.tables.map((t) => t.key)).toEqual([
      "clients",
      "jobs",
      "invoices",
    ]);
  });

  it("omits isFallback for a normal (non-fallback) definition, tables still an array", async () => {
    const result = await getSchema(
      fakeSchemaClient({ tables: [] }),
      "org-generated",
    );
    expect(result.data?.isFallback).toBeUndefined();
    expect(result.data?.tables).toEqual([]);
  });
});
