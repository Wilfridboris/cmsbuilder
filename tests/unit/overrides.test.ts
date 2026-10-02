import { describe, expect, it } from "vitest";

import {
  addRelationField,
  canHideTable,
  hideField,
  hideTable,
  removeView,
  renameField,
  renameTable,
  showField,
  showTable,
  visibleTables,
} from "@/lib/schema/overrides";
import type {
  FieldDefinition,
  SchemaDefinition,
  ViewDefinition,
} from "@/types/db";

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

describe("showTable (Story 5.7)", () => {
  it("sets hidden: false on the target table", () => {
    const hidden = hideTable(makeSchema(), "clients");
    const next = showTable(hidden, "clients");
    expect(next.tables.find((t) => t.key === "clients")?.hidden).toBe(false);
    expect(visibleTables(next).map((t) => t.key)).toEqual(["clients", "jobs"]);
  });

  it("round-trips: hide then show restores the table (and its fields) exactly", () => {
    const base = makeSchema();
    const roundTripped = showTable(hideTable(base, "clients"), "clients");
    const table = roundTripped.tables.find((t) => t.key === "clients");
    expect(table?.hidden).toBe(false);
    // Every field (so every row's data shape) is retained unchanged.
    expect(table?.fields.map((f) => f.key)).toEqual(["name", "email"]);
  });

  it("has no canHideTable gate — showing never empties, so it applies even to the only table", () => {
    const schema = makeSchema();
    schema.tables[1].hidden = true; // only "clients" visible
    // jobs is hidden; show it back. (showTable has no last-table guard.)
    const next = showTable(schema, "jobs");
    expect(next.tables.find((t) => t.key === "jobs")?.hidden).toBe(false);
  });

  it("is a no-op for an unknown table", () => {
    const schema = makeSchema();
    const next = showTable(schema, "nope");
    expect(snapshot(next)).toBe(snapshot(schema));
  });

  it("does not mutate the input", () => {
    const schema = hideTable(makeSchema(), "clients");
    const before = snapshot(schema);
    showTable(schema, "clients");
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

describe("showField", () => {
  it("sets hidden: false on the target field", () => {
    // Start from a schema where the field is hidden, then unhide it.
    const hidden = hideField(makeSchema(), "clients", "email");
    const next = showField(hidden, "clients", "email");
    const field = next.tables
      .find((t) => t.key === "clients")
      ?.fields.find((f) => f.key === "email");
    expect(field?.hidden).toBe(false);
  });

  it("round-trips: hide then show restores visibility exactly", () => {
    const base = makeSchema();
    const roundTripped = showField(
      hideField(base, "clients", "email"),
      "clients",
      "email",
    );
    const field = roundTripped.tables
      .find((t) => t.key === "clients")
      ?.fields.find((f) => f.key === "email");
    // The definition (key/label/type) is preserved; only the flag is cleared.
    expect(field).toMatchObject({
      key: "email",
      label: "Email",
      type: "email",
      hidden: false,
    });
  });

  it("does not mutate the input", () => {
    const schema = hideField(makeSchema(), "clients", "email");
    const before = snapshot(schema);
    showField(schema, "clients", "email");
    expect(snapshot(schema)).toBe(before);
  });

  it("is a no-op for an unknown table", () => {
    const schema = makeSchema();
    const next = showField(schema, "nope", "email");
    expect(snapshot(next)).toBe(snapshot(schema));
  });

  it("is a no-op for an unknown field", () => {
    const schema = makeSchema();
    const next = showField(schema, "clients", "nope");
    expect(snapshot(next)).toBe(snapshot(schema));
  });
});

describe("addRelationField (Story 3.7)", () => {
  const relationField: FieldDefinition = {
    key: "client",
    label: "Client",
    type: "relation",
    relationConfig: { targetTable: "clients", cardinality: "one" },
  };

  it("appends the relation field to the target table's fields", () => {
    const next = addRelationField(makeSchema(), "jobs", relationField);
    const jobs = next.tables.find((t) => t.key === "jobs");
    expect(jobs?.fields.map((f) => f.key)).toEqual(["title", "price", "client"]);
    const added = jobs?.fields.find((f) => f.key === "client");
    expect(added).toMatchObject({
      key: "client",
      type: "relation",
      relationConfig: { targetTable: "clients", cardinality: "one" },
    });
  });

  it("forces cardinality 'one' (no multi-select at MVP)", () => {
    const next = addRelationField(makeSchema(), "jobs", relationField);
    const added = next.tables
      .find((t) => t.key === "jobs")
      ?.fields.find((f) => f.key === "client");
    expect(added?.relationConfig?.cardinality).toBe("one");
  });

  it("leaves other tables untouched", () => {
    const next = addRelationField(makeSchema(), "jobs", relationField);
    expect(next.tables.find((t) => t.key === "clients")?.fields).toEqual(
      makeSchema().tables.find((t) => t.key === "clients")?.fields,
    );
  });

  it("does not mutate the input schema", () => {
    const schema = makeSchema();
    const before = snapshot(schema);
    addRelationField(schema, "jobs", relationField);
    expect(snapshot(schema)).toBe(before);
  });

  it("is a no-op for an unknown table key", () => {
    const schema = makeSchema();
    const next = addRelationField(schema, "nope", relationField);
    expect(snapshot(next)).toBe(snapshot(schema));
  });
});

describe("removeView (Story 5.6)", () => {
  const views: ViewDefinition[] = [
    {
      key: "unpaid",
      label: "Unpaid",
      sourceTableKey: "jobs",
      filters: [{ field: "title", operator: "contains", value: "x" }],
      sort: null,
    },
    {
      key: "recent",
      label: "Recent",
      sourceTableKey: "jobs",
      filters: [],
      sort: { field: "price", direction: "desc" },
    },
  ];

  function schemaWithViews(): SchemaDefinition {
    return { ...makeSchema(), views: views.map((v) => ({ ...v })) };
  }

  it("filters out ONLY the matching view (a true removal, not a flag)", () => {
    const next = removeView(schemaWithViews(), "unpaid");
    expect(next.views?.map((v) => v.key)).toEqual(["recent"]);
    // The removed view is gone entirely — no hidden flag is set on it.
    expect(next.views?.find((v) => v.key === "unpaid")).toBeUndefined();
  });

  it("leaves tables and rows metadata untouched", () => {
    const next = removeView(schemaWithViews(), "unpaid");
    expect(next.tables).toEqual(makeSchema().tables);
  });

  it("does not mutate the input schema", () => {
    const schema = schemaWithViews();
    const before = snapshot(schema);
    removeView(schema, "unpaid");
    expect(snapshot(schema)).toBe(before);
  });

  it("is a no-op for an unknown view key (keeps all views)", () => {
    const next = removeView(schemaWithViews(), "nope");
    expect(next.views?.map((v) => v.key)).toEqual(["unpaid", "recent"]);
  });

  it("is safe on a schema with no views", () => {
    const next = removeView(makeSchema(), "unpaid");
    expect(next.views).toEqual([]);
  });
});
