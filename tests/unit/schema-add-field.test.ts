import { describe, expect, it, vi } from "vitest";

import { RESERVED_KEYS, validateAddField } from "@/lib/schema/validator";
import { addField } from "@/lib/schema/overrides";
import type { FieldDefinition, SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for the conversational "add a column via chat" primitives (Story
 * 5.1): the focused `validateAddField` gate and the pure `addField` transform. No
 * network, no DB, no LLM — both are pure functions. Covers the I/O & Edge-Case
 * Matrix validator rows (happy scalar add, reserved key, existing-field collision,
 * each blocked keyword incl. mixed-case/embedded, non-scalar/unknown type,
 * nonexistent/hidden table) plus the transform's append + immutability.
 */

vi.mock("@/lib/observability/report", () => ({
  reportRejection: vi.fn(),
  reportError: vi.fn(),
}));

function schema(): SchemaDefinition {
  return {
    tables: [
      {
        key: "clients",
        label: "Clients",
        fields: [{ key: "name", label: "Name", type: "text" }],
      },
      {
        key: "jobs",
        label: "Jobs",
        fields: [
          { key: "service", label: "Service", type: "text" },
          { key: "price", label: "Price", type: "currency" },
          { key: "archived_note", label: "Archived note", type: "text", hidden: true },
        ],
      },
      {
        key: "hidden_table",
        label: "Hidden",
        hidden: true,
        fields: [{ key: "note", label: "Note", type: "text" }],
      },
    ],
  };
}

function snapshot(s: SchemaDefinition): string {
  return JSON.stringify(s);
}

describe("validateAddField (Story 5.1)", () => {
  it("accepts a valid scalar add, deriving the key from the label", () => {
    const result = validateAddField(schema(), "jobs", {
      label: "Warranty date",
      type: "date",
    });
    expect(result).toEqual({
      valid: true,
      field: { key: "warranty_date", label: "Warranty date", type: "date" },
    });
  });

  it("normalizes the incoming table key so an un-normalized key still matches", () => {
    const result = validateAddField(schema(), "Jobs", {
      label: "Total cost",
      type: "currency",
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.field.key).toBe("total_cost");
      expect(result.field.type).toBe("currency");
    }
  });

  it("accepts every scalar type", () => {
    const types = [
      "text",
      "number",
      "date",
      "datetime",
      "boolean",
      "currency",
      "email",
      "phone",
    ] as const;
    types.forEach((type, i) => {
      const result = validateAddField(schema(), "jobs", {
        label: `Field ${i}`,
        type,
      });
      expect(result.valid).toBe(true);
    });
  });

  it("rejects a reserved key (e.g. created_at)", () => {
    const result = validateAddField(schema(), "jobs", {
      label: "created_at",
      type: "text",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects every reserved key (iterating the exported RESERVED_KEYS so coverage can't silently drift)", () => {
    expect(RESERVED_KEYS.length).toBeGreaterThan(0);
    for (const key of RESERVED_KEYS) {
      const result = validateAddField(schema(), "jobs", { label: key, type: "text" });
      expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
    }
  });

  it("rejects a collision with an existing field", () => {
    const result = validateAddField(schema(), "jobs", {
      // normalizes to "service", which already exists on jobs
      label: "Service",
      type: "text",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects a collision with a HIDDEN existing field (never silently overwrite)", () => {
    const result = validateAddField(schema(), "jobs", {
      label: "Archived note",
      type: "text",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects each blocked SQL verb as a bare key", () => {
    for (const verb of ["drop", "grant", "truncate", "delete", "exec"]) {
      const result = validateAddField(schema(), "jobs", { label: verb, type: "text" });
      expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
    }
  });

  it("rejects EVERY blocked verb in mixed-case (e.g. DrOp, GrAnt, TrUnCaTe, DeLeTe, ExEc)", () => {
    // Capitalize the first letter, lowercase the rest — a distinct mixed-case
    // variant per verb (GRANT mixed-case was the identified gap).
    for (const verb of ["DROP", "GRANT", "TRUNCATE", "DELETE", "EXEC"]) {
      const mixed = verb.charAt(0) + verb.slice(1).toLowerCase();
      const result = validateAddField(schema(), "jobs", { label: mixed, type: "text" });
      expect(result, `mixed-case ${mixed} must reject`).toEqual({
        valid: false,
        reason: "addFieldFailed",
      });
    }
  });

  it("rejects EVERY blocked verb surrounded by punctuation that strips away (e.g. 'DELETE!', 'EXEC;')", () => {
    // Each wrapped in stray punctuation that `normalizeTableName` strips, leaving
    // the bare verb key the whole-word guard catches. Covers the DELETE/EXEC
    // punctuation variants that were the identified gap.
    for (const label of ["DROP!", "GRANT.", "TRUNCATE?", "DELETE!", "EXEC;"]) {
      const result = validateAddField(schema(), "jobs", { label, type: "text" });
      expect(result, `punctuated ${label} must reject`).toEqual({
        valid: false,
        reason: "addFieldFailed",
      });
    }
  });

  it("does NOT reject a legitimate label that merely contains a blocked substring", () => {
    // "dropoff" is one word and does not match the whole-word `drop` guard.
    const result = validateAddField(schema(), "jobs", {
      label: "Dropoff",
      type: "text",
    });
    expect(result.valid).toBe(true);
  });

  it("rejects a relation type (scalar only via chat)", () => {
    const result = validateAddField(schema(), "jobs", {
      label: "Client",
      type: "relation",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects an unknown type", () => {
    const result = validateAddField(schema(), "jobs", {
      label: "Mystery",
      type: "json",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects a nonexistent table", () => {
    const result = validateAddField(schema(), "vendors", {
      label: "Rating",
      type: "number",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects a hidden target table", () => {
    const result = validateAddField(schema(), "hidden_table", {
      label: "Rating",
      type: "number",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects an empty label", () => {
    const result = validateAddField(schema(), "jobs", { label: "   ", type: "text" });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("does not mutate the input schema", () => {
    const s = schema();
    const before = snapshot(s);
    validateAddField(s, "jobs", { label: "Warranty date", type: "date" });
    expect(snapshot(s)).toBe(before);
  });
});

describe("addField transform (Story 5.1)", () => {
  const field: FieldDefinition = {
    key: "warranty_date",
    label: "Warranty date",
    type: "date",
  };

  it("appends the field to the target table's fields", () => {
    const next = addField(schema(), "jobs", field);
    const jobs = next.tables.find((t) => t.key === "jobs");
    expect(jobs?.fields.map((f) => f.key)).toEqual([
      "service",
      "price",
      "archived_note",
      "warranty_date",
    ]);
    expect(jobs?.fields.find((f) => f.key === "warranty_date")).toEqual(field);
  });

  it("leaves other tables untouched", () => {
    const next = addField(schema(), "jobs", field);
    expect(next.tables.find((t) => t.key === "clients")?.fields).toEqual(
      schema().tables.find((t) => t.key === "clients")?.fields,
    );
  });

  it("does not mutate the input schema (immutability)", () => {
    const s = schema();
    const before = snapshot(s);
    addField(s, "jobs", field);
    expect(snapshot(s)).toBe(before);
  });

  it("is a no-op for an unknown table key", () => {
    const s = schema();
    const next = addField(s, "nope", field);
    expect(snapshot(next)).toBe(snapshot(s));
  });
});
