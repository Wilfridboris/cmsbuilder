import { describe, expect, it } from "vitest";

import {
  buildRelationResolver,
  displayFieldKey,
  orderTablesByRelations,
  resolveSeedRelationRefs,
  resolvedDisplayFieldKey,
} from "@/lib/schema/relations";
import type {
  FieldDefinition,
  RecordData,
  SchemaDefinition,
  TableDefinition,
} from "@/types/db";

/**
 * Unit coverage for the pure relation + display-field helpers (Story 1.8). No
 * network, no DB — mirrors the I/O matrix: displayField defaulting, topological
 * insert order (referenced-first, cycle-tolerant), seed-value → id resolution
 * (drop-on-miss), and read-time label resolution.
 */

function field(
  key: string,
  type: FieldDefinition["type"],
  extra: Partial<FieldDefinition> = {},
): FieldDefinition {
  return { key, label: key, type, ...extra };
}

describe("displayFieldKey", () => {
  it("prefers the first non-hidden text field", () => {
    const table: TableDefinition = {
      key: "t",
      label: "T",
      fields: [
        field("amount", "currency"),
        field("name", "text"),
        field("nickname", "text"),
      ],
    };
    expect(displayFieldKey(table)).toBe("name");
  });

  it("falls back to the first non-hidden field of any type when no text field", () => {
    const table: TableDefinition = {
      key: "t",
      label: "T",
      fields: [field("amount", "currency"), field("paid", "boolean")],
    };
    expect(displayFieldKey(table)).toBe("amount");
  });

  it("skips hidden fields", () => {
    const table: TableDefinition = {
      key: "t",
      label: "T",
      fields: [
        field("secret", "text", { hidden: true }),
        field("name", "text"),
      ],
    };
    expect(displayFieldKey(table)).toBe("name");
  });

  it("returns undefined when there is no visible field", () => {
    const table: TableDefinition = {
      key: "t",
      label: "T",
      fields: [field("secret", "text", { hidden: true })],
    };
    expect(displayFieldKey(table)).toBeUndefined();
  });
});

describe("resolvedDisplayFieldKey", () => {
  it("uses an explicit displayField when it names a visible field", () => {
    const table: TableDefinition = {
      key: "t",
      label: "T",
      displayField: "nickname",
      fields: [field("name", "text"), field("nickname", "text")],
    };
    expect(resolvedDisplayFieldKey(table)).toBe("nickname");
  });

  it("falls back to the default rule when displayField names a hidden field", () => {
    const table: TableDefinition = {
      key: "t",
      label: "T",
      displayField: "nickname",
      fields: [
        field("name", "text"),
        field("nickname", "text", { hidden: true }),
      ],
    };
    expect(resolvedDisplayFieldKey(table)).toBe("name");
  });
});

describe("orderTablesByRelations", () => {
  function rel(target: string): FieldDefinition {
    return field(`ref_${target}`, "relation", {
      relationConfig: { targetTable: target, cardinality: "one" },
    });
  }

  it("orders a referenced table before its referencing table", () => {
    const clients: TableDefinition = {
      key: "clients",
      label: "Clients",
      fields: [field("name", "text")],
    };
    const jobs: TableDefinition = {
      key: "jobs",
      label: "Jobs",
      fields: [field("service", "text"), rel("clients")],
    };
    // Declared referencing-first; expect referenced-first out.
    const ordered = orderTablesByRelations([jobs, clients]);
    expect(ordered.map((t) => t.key)).toEqual(["clients", "jobs"]);
  });

  it("orders a 3-table chain referenced-first (clients, jobs, invoices)", () => {
    const clients: TableDefinition = {
      key: "clients",
      label: "Clients",
      fields: [field("name", "text")],
    };
    const jobs: TableDefinition = {
      key: "jobs",
      label: "Jobs",
      fields: [field("service", "text"), rel("clients")],
    };
    const invoices: TableDefinition = {
      key: "invoices",
      label: "Invoices",
      fields: [field("num", "text"), rel("jobs")],
    };
    const ordered = orderTablesByRelations([invoices, jobs, clients]);
    expect(ordered.map((t) => t.key)).toEqual(["clients", "jobs", "invoices"]);
  });

  it("ignores self-references (a table can precede itself)", () => {
    const t: TableDefinition = {
      key: "clients",
      label: "Clients",
      fields: [field("name", "text"), rel("clients")],
    };
    const ordered = orderTablesByRelations([t]);
    expect(ordered.map((x) => x.key)).toEqual(["clients"]);
  });

  it("does not drop or duplicate tables on a cycle A->B->A", () => {
    const a: TableDefinition = {
      key: "a",
      label: "A",
      fields: [field("x", "text"), rel("b")],
    };
    const b: TableDefinition = {
      key: "b",
      label: "B",
      fields: [field("y", "text"), rel("a")],
    };
    const ordered = orderTablesByRelations([a, b]);
    expect(ordered.map((t) => t.key).sort()).toEqual(["a", "b"]);
    expect(ordered).toHaveLength(2);
  });
});

describe("resolveSeedRelationRefs", () => {
  const jobs: TableDefinition = {
    key: "jobs",
    label: "Jobs",
    displayField: "service",
    fields: [
      field("service", "text"),
      field("client", "relation", {
        relationConfig: { targetTable: "clients", cardinality: "one" },
      }),
    ],
  };

  it("rewrites a relation value from display value to the inserted target id", () => {
    const inserted = new Map([
      ["clients", new Map([["Maple Ridge", "id-maple"]])],
    ]);
    const rows = resolveSeedRelationRefs(
      jobs,
      [{ service: "HVAC", client: "Maple Ridge" }],
      inserted,
    );
    expect(rows[0].client).toBe("id-maple");
    expect(rows[0].service).toBe("HVAC");
  });

  it("matches by trimmed value", () => {
    const inserted = new Map([
      ["clients", new Map([["Maple Ridge", "id-maple"]])],
    ]);
    const rows = resolveSeedRelationRefs(
      jobs,
      [{ service: "HVAC", client: "  Maple Ridge  " }],
      inserted,
    );
    expect(rows[0].client).toBe("id-maple");
  });

  it("drops an unresolved relation value but keeps the row", () => {
    const inserted = new Map([["clients", new Map<string, string>()]]);
    const rows = resolveSeedRelationRefs(
      jobs,
      [{ service: "HVAC", client: "Unknown Co" }],
      inserted,
    );
    expect(rows[0].client).toBeUndefined();
    expect(rows[0].service).toBe("HVAC");
  });

  it("returns rows untouched when the table has no relation fields", () => {
    const clients: TableDefinition = {
      key: "clients",
      label: "Clients",
      fields: [field("name", "text")],
    };
    const input = [{ name: "Acme" }];
    expect(resolveSeedRelationRefs(clients, input, new Map())).toEqual(input);
  });
});

describe("buildRelationResolver", () => {
  const schema: SchemaDefinition = {
    tables: [
      {
        key: "clients",
        label: "Clients",
        displayField: "name",
        fields: [field("name", "text")],
      },
      {
        key: "jobs",
        label: "Jobs",
        displayField: "service",
        fields: [
          field("service", "text"),
          field("client", "relation", {
            relationConfig: { targetTable: "clients", cardinality: "one" },
          }),
        ],
      },
    ],
  };

  const records: Record<string, RecordData[]> = {
    clients: [
      { id: "id-maple", version: 1, data: { name: "Maple Ridge" } },
      { id: "id-bytown", version: 1, data: { name: "Bytown Bakery" } },
    ],
    jobs: [
      { id: "job-1", version: 1, data: { service: "HVAC", client: "id-maple" } },
    ],
  };

  const clientField = schema.tables[1].fields[1];

  it("resolves a relation id to the target displayField label", () => {
    const resolve = buildRelationResolver(schema, records);
    expect(resolve(clientField, "id-maple")).toBe("Maple Ridge");
    expect(resolve(clientField, "id-bytown")).toBe("Bytown Bakery");
  });

  it("returns null for an unresolved id (empty placeholder upstream)", () => {
    const resolve = buildRelationResolver(schema, records);
    expect(resolve(clientField, "id-missing")).toBeNull();
  });

  it("returns null for a null/blank value", () => {
    const resolve = buildRelationResolver(schema, records);
    expect(resolve(clientField, null)).toBeNull();
    expect(resolve(clientField, "")).toBeNull();
  });

  it("returns null for a non-relation field", () => {
    const resolve = buildRelationResolver(schema, records);
    const textField = schema.tables[1].fields[0];
    expect(resolve(textField, "HVAC")).toBeNull();
  });
});
