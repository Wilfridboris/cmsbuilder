import { describe, expect, it, vi } from "vitest";

import { RESERVED_KEYS, validateAddTable } from "@/lib/schema/validator";
import { addTable } from "@/lib/schema/overrides";
import { reportRejection } from "@/lib/observability/report";
import type { SchemaDefinition, TableDefinition } from "@/types/db";

/**
 * Unit coverage for the conversational "add a table via chat" primitives (Story
 * 5.2): the focused `validateAddTable` gate and the pure `addTable` transform. No
 * network, no DB, no LLM — both are pure functions. Covers the I/O & Edge-Case
 * Matrix validator rows (happy multi-field add, reserved/existing-table collision →
 * disambiguated, each blocked keyword incl. mixed-case/embedded in table AND field
 * names → reject, non-scalar/relation field → reject, duplicate field keys →
 * disambiguated, displayField defaulting) plus the transform's append + immutability.
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
        fields: [{ key: "service", label: "Service", type: "text" }],
      },
      {
        key: "archived",
        label: "Archived",
        hidden: true,
        fields: [{ key: "note", label: "Note", type: "text" }],
      },
    ],
  };
}

function snapshot(s: SchemaDefinition): string {
  return JSON.stringify(s);
}

describe("validateAddTable (Story 5.2)", () => {
  it("accepts a valid multi-field add, deriving keys from labels and defaulting displayField", () => {
    const result = validateAddTable(schema(), {
      label: "Employee timesheets",
      fields: [
        { label: "Employee name", type: "text" },
        { label: "Hours worked", type: "number" },
        { label: "Work date", type: "date" },
      ],
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.table.key).toBe("employee_timesheets");
      expect(result.table.label).toBe("Employee timesheets");
      expect(result.table.fields).toEqual([
        { key: "employee_name", label: "Employee name", type: "text" },
        { key: "hours_worked", label: "Hours worked", type: "number" },
        { key: "work_date", label: "Work date", type: "date" },
      ]);
      // displayField defaults to the first non-hidden text field.
      expect(result.table.displayField).toBe("employee_name");
    }
  });

  it("defaults displayField to the first field when there is no text field", () => {
    const result = validateAddTable(schema(), {
      label: "Readings",
      fields: [
        { label: "Meter value", type: "number" },
        { label: "Taken on", type: "date" },
      ],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.table.displayField).toBe("meter_value");
    }
  });

  it("accepts every scalar field type", () => {
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
    const result = validateAddTable(schema(), {
      label: "Kitchen sink",
      fields: types.map((type, i) => ({ label: `Field ${i}`, type })),
    });
    expect(result.valid).toBe(true);
  });

  it("disambiguates a key colliding with an existing (visible) table, never overwriting", () => {
    const result = validateAddTable(schema(), {
      label: "Jobs",
      fields: [{ label: "Title", type: "text" }],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.table.key).toBe("jobs_2");
    }
  });

  it("disambiguates a key colliding with a HIDDEN existing table", () => {
    const result = validateAddTable(schema(), {
      label: "Archived",
      fields: [{ label: "Title", type: "text" }],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.table.key).toBe("archived_2");
    }
  });

  it("disambiguates a key colliding with a reserved key", () => {
    const result = validateAddTable(schema(), {
      label: "Data",
      fields: [{ label: "Title", type: "text" }],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.table.key).toBe("data_2");
    }
  });

  it("chooses the next free suffix when the first disambiguated key is also taken", () => {
    const s = schema();
    s.tables.push({
      key: "jobs_2",
      label: "Jobs 2",
      fields: [{ key: "x", label: "X", type: "text" }],
    });
    const result = validateAddTable(s, {
      label: "Jobs",
      fields: [{ label: "Title", type: "text" }],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.table.key).toBe("jobs_3");
    }
  });

  it("rejects each blocked SQL verb as a bare table name (incl. mixed-case/embedded-stripped)", () => {
    for (const name of ["drop", "DELETE", "Truncate", "exec", "GRANT!"]) {
      const result = validateAddTable(schema(), {
        label: name,
        fields: [{ label: "Title", type: "text" }],
      });
      expect(result).toEqual({ valid: false, reason: "addTableFailed" });
    }
  });

  it("rejects a blocked SQL verb as a bare field name (incl. mixed-case)", () => {
    for (const name of ["drop", "DELETE", "TrUnCaTe"]) {
      const result = validateAddTable(schema(), {
        label: "Timesheets",
        fields: [{ label: name, type: "text" }],
      });
      expect(result).toEqual({ valid: false, reason: "addTableFailed" });
    }
  });

  it("does NOT reject a table/field name that merely contains a blocked substring", () => {
    const result = validateAddTable(schema(), {
      label: "Dropoff logs",
      fields: [{ label: "Dropoff time", type: "datetime" }],
    });
    expect(result.valid).toBe(true);
  });

  it("logs every rejection via reportRejection with the org id + raw LLM output", () => {
    vi.mocked(reportRejection).mockClear();
    const rawOutput = { kind: "add_table", label: "drop", fields: [] };
    const result = validateAddTable(
      schema(),
      { label: "drop", fields: [{ label: "Title", type: "text" }] },
      { id: "org-1", rawOutput },
    );
    expect(result).toEqual({ valid: false, reason: "addTableFailed" });
    expect(reportRejection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportRejection).mock.calls[0][1]).toEqual({
      id: "org-1",
      rawOutput,
    });
  });

  it("rejects a relation field type (scalar only via chat)", () => {
    const result = validateAddTable(schema(), {
      label: "Timesheets",
      fields: [{ label: "Client", type: "relation" }],
    });
    expect(result).toEqual({ valid: false, reason: "addTableFailed" });
  });

  it("rejects an unknown field type", () => {
    const result = validateAddTable(schema(), {
      label: "Timesheets",
      fields: [{ label: "Blob", type: "json" }],
    });
    expect(result).toEqual({ valid: false, reason: "addTableFailed" });
  });

  it("rejects a reserved key as a FIELD key (never disambiguated)", () => {
    for (const key of RESERVED_KEYS) {
      const result = validateAddTable(schema(), {
        label: "Timesheets",
        fields: [{ label: key, type: "text" }],
      });
      expect(result).toEqual({ valid: false, reason: "addTableFailed" });
    }
  });

  it("disambiguates duplicate field keys within the new table (never drops a column)", () => {
    const result = validateAddTable(schema(), {
      label: "Timesheets",
      fields: [
        { label: "Note", type: "text" },
        { label: "Note", type: "text" },
        { label: "Note", type: "text" },
      ],
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.table.fields.map((f) => f.key)).toEqual([
        "note",
        "note_2",
        "note_3",
      ]);
    }
  });

  it("rejects an empty table label", () => {
    const result = validateAddTable(schema(), {
      label: "   ",
      fields: [{ label: "Title", type: "text" }],
    });
    expect(result).toEqual({ valid: false, reason: "addTableFailed" });
  });

  it("rejects an empty field label", () => {
    const result = validateAddTable(schema(), {
      label: "Timesheets",
      fields: [{ label: "   ", type: "text" }],
    });
    expect(result).toEqual({ valid: false, reason: "addTableFailed" });
  });

  it("rejects a table with no fields", () => {
    const result = validateAddTable(schema(), { label: "Timesheets", fields: [] });
    expect(result).toEqual({ valid: false, reason: "addTableFailed" });
  });

  it("does not mutate the input schema", () => {
    const s = schema();
    const before = snapshot(s);
    validateAddTable(s, {
      label: "Timesheets",
      fields: [{ label: "Title", type: "text" }],
    });
    expect(snapshot(s)).toBe(before);
  });
});

describe("addTable transform (Story 5.2)", () => {
  const table: TableDefinition = {
    key: "employee_timesheets",
    label: "Employee timesheets",
    displayField: "employee_name",
    fields: [{ key: "employee_name", label: "Employee name", type: "text" }],
  };

  it("appends the new table to the schema's tables", () => {
    const next = addTable(schema(), table);
    expect(next.tables.map((t) => t.key)).toEqual([
      "clients",
      "jobs",
      "archived",
      "employee_timesheets",
    ]);
    expect(next.tables.at(-1)).toEqual(table);
  });

  it("leaves existing tables untouched", () => {
    const next = addTable(schema(), table);
    expect(next.tables.find((t) => t.key === "jobs")).toEqual(
      schema().tables.find((t) => t.key === "jobs"),
    );
  });

  it("does not mutate the input schema (immutability)", () => {
    const s = schema();
    const before = snapshot(s);
    addTable(s, table);
    expect(snapshot(s)).toBe(before);
  });

  it("preserves top-level schema fields (e.g. isFallback)", () => {
    const s: SchemaDefinition = { ...schema(), isFallback: true };
    const next = addTable(s, table);
    expect(next.isFallback).toBe(true);
  });
});
