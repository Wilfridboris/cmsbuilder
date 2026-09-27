import { describe, expect, it, vi } from "vitest";

import { validateRelationField } from "@/lib/schema/validator";
import type { SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for the focused relation-field validator (Story 3.7) — the Admin
 * "add relationship field" gate. No network, no DB: it validates ONE new relation
 * field against a stored schema, reusing the shared key primitives
 * (`normalizeTableName`, `keyIsBlockedVerb`, `RESERVED_KEYS`, target-exists) and
 * is deliberately separate from the whole-schema generation validator (which
 * strips `hidden` and would un-hide 3.5 columns).
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
        ],
      },
      {
        key: "archived_table",
        label: "Archived",
        hidden: true,
        fields: [{ key: "note", label: "Note", type: "text" }],
      },
    ],
  };
}

describe("validateRelationField", () => {
  it("accepts a valid single-reference field, forcing cardinality 'one'", () => {
    const result = validateRelationField(schema(), "jobs", {
      label: "Client",
      targetTable: "clients",
    });
    expect(result).toEqual({
      valid: true,
      field: {
        key: "client",
        label: "Client",
        type: "relation",
        relationConfig: { targetTable: "clients", cardinality: "one" },
      },
    });
  });

  it("normalizes both the derived key and the target table", () => {
    const result = validateRelationField(schema(), "jobs", {
      label: "Primary Client!",
      targetTable: "Clients",
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.field.key).toBe("primary_client");
      expect(result.field.relationConfig.targetTable).toBe("clients");
    }
  });

  it("rejects an unknown target table", () => {
    const result = validateRelationField(schema(), "jobs", {
      label: "Vendor",
      targetTable: "vendors",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects a hidden target table", () => {
    const result = validateRelationField(schema(), "jobs", {
      label: "Archived link",
      targetTable: "archived_table",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects an unknown table to add the field to", () => {
    const result = validateRelationField(schema(), "nope", {
      label: "Client",
      targetTable: "clients",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects a derived key colliding with an existing field", () => {
    const result = validateRelationField(schema(), "jobs", {
      // normalizes to "service", which already exists on jobs
      label: "Service",
      targetTable: "clients",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects a blocked SQL verb key", () => {
    const result = validateRelationField(schema(), "jobs", {
      label: "drop",
      targetTable: "clients",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects a reserved key", () => {
    const result = validateRelationField(schema(), "jobs", {
      label: "created_at",
      targetTable: "clients",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("rejects an empty label", () => {
    const result = validateRelationField(schema(), "jobs", {
      label: "   ",
      targetTable: "clients",
    });
    expect(result).toEqual({ valid: false, reason: "addFieldFailed" });
  });

  it("accepts a self-reference (a table linking to itself)", () => {
    const result = validateRelationField(schema(), "jobs", {
      label: "Parent job",
      targetTable: "jobs",
    });
    expect(result.valid).toBe(true);
  });
});
