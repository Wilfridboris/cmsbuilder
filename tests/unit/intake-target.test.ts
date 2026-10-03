import { describe, expect, it } from "vitest";

import type {
  FieldDefinition,
  SchemaDefinition,
  TableDefinition,
} from "@/types/db";
import { selectIntakeTable, intakeFields } from "@/lib/intake/target";

/**
 * Unit coverage for the pure intake-table selection + field derivation (Story 6.1).
 * No React / next-intl / DB — these are framework-agnostic helpers, exactly like
 * `overrides.ts` / `filter-sort.ts`. Asserts the decided selection strategy (intake
 * term over visible tables, first-visible fallback, else null), that hidden tables
 * never participate, and that `intakeFields` drops hidden + relation fields while
 * preserving definition order — plus the I/O-matrix edge cases.
 */

function field(partial: Partial<FieldDefinition> & { key: string }): FieldDefinition {
  return {
    label: partial.key,
    type: "text",
    ...partial,
  };
}

function table(
  partial: Partial<TableDefinition> & { key: string },
): TableDefinition {
  return {
    label: partial.key,
    fields: [],
    ...partial,
  };
}

function schema(tables: TableDefinition[]): SchemaDefinition {
  return { tables };
}

describe("selectIntakeTable — chosen strategy", () => {
  it("picks the first visible table whose key/label matches an intake term", () => {
    const s = schema([
      table({ key: "jobs", label: "Jobs" }),
      table({ key: "leads", label: "Leads" }),
    ]);
    // "jobs" matches the intake-term pattern (`job`) and comes first.
    expect(selectIntakeTable(s)?.key).toBe("jobs");
  });

  it("matches an intake term in the LABEL even when the key does not", () => {
    const s = schema([
      table({ key: "t_widgets", label: "Widgets" }),
      table({ key: "t_a1b2", label: "New Inquiries" }),
    ]);
    expect(selectIntakeTable(s)?.key).toBe("t_a1b2");
  });

  it("matches case-insensitively", () => {
    const s = schema([
      table({ key: "widgets", label: "Widgets" }),
      table({ key: "PROSPECTS", label: "PROSPECTS" }),
    ]);
    expect(selectIntakeTable(s)?.key).toBe("PROSPECTS");
  });

  it("matches French intake terms (demande, rendez, client, contact)", () => {
    for (const label of ["Demandes", "Rendez-vous", "Clients", "Contacts"]) {
      const s = schema([
        table({ key: "t_x", label: "Produits" }),
        table({ key: "t_y", label }),
      ]);
      expect(selectIntakeTable(s)?.label).toBe(label);
    }
  });

  it("falls back to the first visible table when none matches an intake term", () => {
    const s = schema([
      table({ key: "widgets", label: "Widgets" }),
      table({ key: "gadgets", label: "Gadgets" }),
    ]);
    expect(selectIntakeTable(s)?.key).toBe("widgets");
  });
});

describe("selectIntakeTable — hidden tables never participate", () => {
  it("skips a hidden intake-term table and chooses the next visible match", () => {
    const s = schema([
      table({ key: "leads", label: "Leads", hidden: true }),
      table({ key: "contacts", label: "Contacts" }),
    ]);
    expect(selectIntakeTable(s)?.key).toBe("contacts");
  });

  it("skips a hidden intake-term table and falls back to the first visible table", () => {
    const s = schema([
      table({ key: "leads", label: "Leads", hidden: true }),
      table({ key: "widgets", label: "Widgets" }),
    ]);
    expect(selectIntakeTable(s)?.key).toBe("widgets");
  });
});

describe("selectIntakeTable — no visible table", () => {
  it("returns null for an empty schema", () => {
    expect(selectIntakeTable(schema([]))).toBeNull();
  });

  it("returns null when every table is hidden", () => {
    const s = schema([
      table({ key: "leads", label: "Leads", hidden: true }),
      table({ key: "widgets", label: "Widgets", hidden: true }),
    ]);
    expect(selectIntakeTable(s)).toBeNull();
  });
});

describe("intakeFields — drops hidden + relation, preserves order", () => {
  it("keeps non-hidden scalar fields in definition order", () => {
    const t = table({
      key: "leads",
      fields: [
        field({ key: "name", type: "text" }),
        field({ key: "email", type: "email" }),
        field({ key: "phone", type: "phone" }),
      ],
    });
    expect(intakeFields(t).map((f) => f.key)).toEqual([
      "name",
      "email",
      "phone",
    ]);
  });

  it("drops hidden fields", () => {
    const t = table({
      key: "leads",
      fields: [
        field({ key: "name", type: "text" }),
        field({ key: "internal_note", type: "text", hidden: true }),
        field({ key: "email", type: "email" }),
      ],
    });
    expect(intakeFields(t).map((f) => f.key)).toEqual(["name", "email"]);
  });

  it("drops relation fields (never reach the public surface)", () => {
    const t = table({
      key: "jobs",
      fields: [
        field({ key: "title", type: "text" }),
        field({
          key: "client",
          type: "relation",
          relationConfig: { targetTable: "clients", cardinality: "one" },
        }),
        field({ key: "due", type: "date" }),
      ],
    });
    const keys = intakeFields(t).map((f) => f.key);
    expect(keys).toEqual(["title", "due"]);
    expect(keys).not.toContain("client");
  });

  it("returns an empty array when every field is hidden or a relation", () => {
    const t = table({
      key: "jobs",
      fields: [
        field({ key: "hidden_scalar", type: "text", hidden: true }),
        field({
          key: "client",
          type: "relation",
          relationConfig: { targetTable: "clients", cardinality: "one" },
        }),
      ],
    });
    expect(intakeFields(t)).toEqual([]);
  });

  it("returns an empty array for a table with no fields", () => {
    expect(intakeFields(table({ key: "empty" }))).toEqual([]);
  });

  it("does not mutate the input table's fields", () => {
    const fields = [
      field({ key: "name", type: "text" }),
      field({
        key: "client",
        type: "relation",
        relationConfig: { targetTable: "clients", cardinality: "one" },
      }),
    ];
    const t = table({ key: "leads", fields });
    intakeFields(t);
    expect(t.fields).toHaveLength(2);
    expect(fields).toHaveLength(2);
  });
});
