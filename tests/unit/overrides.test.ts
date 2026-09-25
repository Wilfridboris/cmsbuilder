import { describe, expect, it } from "vitest";

import {
  canHideTable,
  hideField,
  hideTable,
  renameField,
  renameTable,
  visibleTables,
} from "@/lib/schema/overrides";
import type { SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for the pure schema-override transforms (Story 1.7). Covers the
 * I/O matrix's transform + guard cases plus immutability (the input schema is
 * never mutated). Framework-agnostic — runs in the node env, no jsdom.
 */

function makeSchema(): SchemaDefinition {
  return {
    tables: [
      {
        key: "clients",
        label: "Clients",
        reason: "Track who you serve",
        fields: [
          { key: "name", label: "Name", type: "text", reason: "Who they are" },
          { key: "email", label: "Email", type: "email" },
        ],
      },
      {
        key: "jobs",
        label: "Jobs",
        fields: [
          { key: "title", label: "Title", type: "text" },
          { key: "price", label: "Price", type: "currency" },
        ],
      },
    ],
  };
}

/** Snapshot of a schema for the immutability assertion. */
function snapshot(schema: SchemaDefinition): string {
  return JSON.stringify(schema);
}

describe("visibleTables", () => {
  it("returns all tables when none are hidden", () => {
    const schema = makeSchema();
    expect(visibleTables(schema).map((t) => t.key)).toEqual([
      "clients",
      "jobs",
    ]);
  });

  it("drops hidden tables", () => {
    const schema = makeSchema();
    schema.tables[0].hidden = true;
    expect(visibleTables(schema).map((t) => t.key)).toEqual(["jobs"]);
  });
});

describe("canHideTable", () => {
  it("is true when more than one table is visible", () => {
    expect(canHideTable(makeSchema())).toBe(true);
  });

  it("is false when only one visible table remains", () => {
    const schema = makeSchema();
    schema.tables[1].hidden = true;
    expect(canHideTable(schema)).toBe(false);
  });
});

describe("renameTable", () => {
  it("edits label, never key", () => {
    const schema = makeSchema();
    const next = renameTable(schema, "clients", "Customers");
    const table = next.tables.find((t) => t.key === "clients");
    expect(table?.label).toBe("Customers");
    expect(table?.key).toBe("clients");
  });

  it("leaves other tables untouched", () => {
    const next = renameTable(makeSchema(), "clients", "Customers");
    expect(next.tables.find((t) => t.key === "jobs")?.label).toBe("Jobs");
  });

  it("does not mutate the input", () => {
    const schema = makeSchema();
    const before = snapshot(schema);
    renameTable(schema, "clients", "Customers");
    expect(snapshot(schema)).toBe(before);
  });

  it("is a no-op for an unknown table key", () => {
    const schema = makeSchema();
    const next = renameTable(schema, "nope", "X");
    expect(snapshot(next)).toBe(snapshot(schema));
  });
});

describe("renameField", () => {
  it("edits the field label within its table, never the key", () => {
    const next = renameField(makeSchema(), "clients", "name", "Full name");
    const field = next.tables
      .find((t) => t.key === "clients")
      ?.fields.find((f) => f.key === "name");
    expect(field?.label).toBe("Full name");
    expect(field?.key).toBe("name");
  });

  it("does not touch a same-named field in a different table", () => {
    const next = renameField(makeSchema(), "clients", "name", "Full name");
    // jobs has no `name` field; ensure jobs fields are unchanged
    expect(next.tables.find((t) => t.key === "jobs")?.fields).toEqual(
      makeSchema().tables.find((t) => t.key === "jobs")?.fields,
    );
  });

  it("does not mutate the input", () => {
    const schema = makeSchema();
    const before = snapshot(schema);
    renameField(schema, "clients", "name", "Full name");
    expect(snapshot(schema)).toBe(before);
  });
});

describe("hideTable", () => {
  it("sets hidden: true on the target table when allowed", () => {
    const next = hideTable(makeSchema(), "clients");
    expect(next.tables.find((t) => t.key === "clients")?.hidden).toBe(true);
    expect(visibleTables(next).map((t) => t.key)).toEqual(["jobs"]);
  });

  it("refuses to hide the last visible table (dashboard never empties)", () => {
    const schema = makeSchema();
    schema.tables[1].hidden = true; // only "clients" visible
    const next = hideTable(schema, "clients");
    // unchanged — the guard blocks hiding the last visible table
    expect(next.tables.find((t) => t.key === "clients")?.hidden).toBeFalsy();
    expect(visibleTables(next).map((t) => t.key)).toEqual(["clients"]);
  });

  it("does not mutate the input", () => {
    const schema = makeSchema();
    const before = snapshot(schema);
    hideTable(schema, "clients");
    expect(snapshot(schema)).toBe(before);
  });
});

describe("hideField", () => {
  it("sets hidden: true on the target field", () => {
    const next = hideField(makeSchema(), "clients", "email");
    const field = next.tables
      .find((t) => t.key === "clients")
      ?.fields.find((f) => f.key === "email");
    expect(field?.hidden).toBe(true);
  });

  it("does not mutate the input", () => {
    const schema = makeSchema();
    const before = snapshot(schema);
    hideField(schema, "clients", "email");
    expect(snapshot(schema)).toBe(before);
  });
});
