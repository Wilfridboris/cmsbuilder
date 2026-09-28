import { describe, expect, it } from "vitest";

import type { SchemaDefinition } from "@/types/db";
import type { DecisionMap } from "@/lib/import/resolve";
import { planCommit, CommitPlanError } from "@/lib/import/commit";

/**
 * Unit coverage for the pure commit planner (Story 4.4). Exercises the whole I/O
 * matrix over `planCommit`: map (single + multi-table), skip, relation-target drop,
 * unresolved rejection, and schema-drift rejection. No HTTP/DB harness — the module
 * is framework-free.
 */

const SCHEMA: SchemaDefinition = {
  tables: [
    {
      key: "clients",
      label: "Clients",
      fields: [
        { key: "name", label: "Name", type: "text" },
        { key: "email", label: "Email", type: "email" },
        {
          key: "owner",
          label: "Owner",
          type: "relation",
          relationConfig: { targetTable: "staff", cardinality: "one" },
        },
      ],
    },
    {
      key: "invoices",
      label: "Invoices",
      fields: [{ key: "total", label: "Total", type: "currency" }],
    },
    {
      key: "hidden_table",
      label: "Hidden",
      hidden: true,
      fields: [{ key: "secret", label: "Secret", type: "text" }],
    },
  ],
};

const ROWS = [
  { "Full Name": "Ada", Email: "ada@x.io", Amount: "100", Rep: "Bob" },
  { "Full Name": "Bea", Email: "bea@x.io", Amount: "200", Rep: "Cid" },
];

describe("planCommit — mapping & grouping", () => {
  it("maps a single-table confirmed mapping into per-row payloads", () => {
    const decisions: DecisionMap = {
      "Full Name": { kind: "map", table: "clients", field: "name" },
      Email: { kind: "map", table: "clients", field: "email" },
    };
    const plan = planCommit(ROWS, decisions, SCHEMA);
    expect(plan.affectedTables).toEqual(["clients"]);
    expect(plan.tables).toHaveLength(1);
    expect(plan.tables[0].tableKey).toBe("clients");
    expect(plan.tables[0].rows).toEqual([
      { name: "Ada", email: "ada@x.io" },
      { name: "Bea", email: "bea@x.io" },
    ]);
  });

  it("groups a multi-table mapping into one payload set per distinct table", () => {
    const decisions: DecisionMap = {
      "Full Name": { kind: "map", table: "clients", field: "name" },
      Amount: { kind: "map", table: "invoices", field: "total" },
    };
    const plan = planCommit(ROWS, decisions, SCHEMA);
    expect(new Set(plan.affectedTables)).toEqual(new Set(["clients", "invoices"]));
    const clients = plan.tables.find((t) => t.tableKey === "clients");
    const invoices = plan.tables.find((t) => t.tableKey === "invoices");
    expect(clients?.rows).toEqual([{ name: "Ada" }, { name: "Bea" }]);
    expect(invoices?.rows).toEqual([{ total: "100" }, { total: "200" }]);
  });

  it("drops a skip decision from every inserted row", () => {
    const decisions: DecisionMap = {
      "Full Name": { kind: "map", table: "clients", field: "name" },
      Email: { kind: "skip" },
    };
    const plan = planCommit(ROWS, decisions, SCHEMA);
    expect(plan.tables[0].rows).toEqual([{ name: "Ada" }, { name: "Bea" }]);
  });

  it("drops a relation-type target from the write (others import normally)", () => {
    const decisions: DecisionMap = {
      "Full Name": { kind: "map", table: "clients", field: "name" },
      Rep: { kind: "map", table: "clients", field: "owner" }, // relation → dropped
    };
    const plan = planCommit(ROWS, decisions, SCHEMA);
    expect(plan.affectedTables).toEqual(["clients"]);
    expect(plan.tables[0].rows).toEqual([{ name: "Ada" }, { name: "Bea" }]);
  });

  it("carries a missing source cell through as an empty string", () => {
    const decisions: DecisionMap = {
      Missing: { kind: "map", table: "clients", field: "name" },
    };
    const plan = planCommit([{ Other: "x" }], decisions, SCHEMA);
    expect(plan.tables[0].rows).toEqual([{ name: "" }]);
  });
});

describe("planCommit — rejections", () => {
  it("throws unresolvedColumns when any decision is unresolved", () => {
    const decisions: DecisionMap = {
      "Full Name": { kind: "map", table: "clients", field: "name" },
      Email: { kind: "unresolved" },
    };
    expect(() => planCommit(ROWS, decisions, SCHEMA)).toThrowError(
      CommitPlanError,
    );
    try {
      planCommit(ROWS, decisions, SCHEMA);
    } catch (err) {
      expect((err as CommitPlanError).key).toBe(
        "Import.error.unresolvedColumns",
      );
    }
  });

  it("throws schemaChanged when a mapped target no longer resolves", () => {
    const decisions: DecisionMap = {
      "Full Name": { kind: "map", table: "clients", field: "gone" },
    };
    try {
      planCommit(ROWS, decisions, SCHEMA);
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(CommitPlanError);
      expect((err as CommitPlanError).key).toBe("Import.error.schemaChanged");
    }
  });

  it("throws schemaChanged when a mapped target is a hidden field", () => {
    const decisions: DecisionMap = {
      "Full Name": { kind: "map", table: "hidden_table", field: "secret" },
    };
    try {
      planCommit(ROWS, decisions, SCHEMA);
      throw new Error("expected throw");
    } catch (err) {
      expect((err as CommitPlanError).key).toBe("Import.error.schemaChanged");
    }
  });
});
