import { describe, expect, it, vi } from "vitest";

import { validateAddView } from "@/lib/schema/validator";
import { addView, visibleViews } from "@/lib/schema/overrides";
import { reportRejection } from "@/lib/observability/report";
import type { SchemaDefinition, ViewDefinition } from "@/types/db";

/**
 * Unit coverage for the conversational "create a view via chat" primitives (Story
 * 5.3): the focused `validateAddView` gate, the pure `addView` transform, and
 * `visibleViews`. No network, no DB, no LLM — all pure functions. Covers the I/O &
 * Edge-Case Matrix validator rows (happy filter+sort, sort-only, reserved/existing
 * table/view-key collision → disambiguated, each blocked keyword incl. mixed-case/
 * embedded → reject, unknown/relation/hidden filter field → reject, operator invalid
 * for type → reject, missing value / missing value2 → reject, degenerate no-filter-
 * no-sort → reject) plus the transform's append + immutability and `visibleViews`.
 */

vi.mock("@/lib/observability/report", () => ({
  reportRejection: vi.fn(),
  reportError: vi.fn(),
}));

function schema(): SchemaDefinition {
  return {
    tables: [
      {
        key: "invoices",
        label: "Invoices",
        fields: [
          { key: "status", label: "Status", type: "text" },
          { key: "amount", label: "Amount", type: "currency" },
          { key: "due_date", label: "Due date", type: "date" },
          { key: "paid", label: "Paid", type: "boolean" },
          { key: "client", label: "Client", type: "relation" },
          { key: "secret", label: "Secret", type: "text", hidden: true },
        ],
      },
      {
        key: "jobs",
        label: "Jobs",
        fields: [
          { key: "service", label: "Service", type: "text" },
          { key: "due_date", label: "Due date", type: "date" },
        ],
      },
      {
        key: "archived",
        label: "Archived",
        hidden: true,
        fields: [{ key: "note", label: "Note", type: "text" }],
      },
    ],
    views: [
      {
        key: "unpaid_invoices",
        label: "Unpaid invoices",
        sourceTableKey: "invoices",
        filters: [{ field: "status", operator: "equals", value: "unpaid" }],
        sort: null,
      },
    ],
  };
}

function snapshot(s: SchemaDefinition): string {
  return JSON.stringify(s);
}

describe("validateAddView (Story 5.3)", () => {
  it("accepts a filter + sort view, normalizing the key and sanitizing fields", () => {
    const result = validateAddView(schema(), {
      label: "Overdue invoices",
      sourceTableKey: "invoices",
      filters: [{ field: "status", operator: "equals", value: "unpaid" }],
      sort: { field: "due_date", direction: "desc" },
    });

    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.view).toEqual({
        key: "overdue_invoices",
        label: "Overdue invoices",
        sourceTableKey: "invoices",
        filters: [{ field: "status", operator: "equals", value: "unpaid" }],
        sort: { field: "due_date", direction: "desc" },
      });
    }
  });

  it("accepts a sort-only view (empty filters)", () => {
    const result = validateAddView(schema(), {
      label: "Jobs by due date",
      sourceTableKey: "jobs",
      filters: [],
      sort: { field: "due_date", direction: "asc" },
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.view.filters).toEqual([]);
      expect(result.view.sort).toEqual({ field: "due_date", direction: "asc" });
    }
  });

  it("accepts a filter-only view (no sort)", () => {
    const result = validateAddView(schema(), {
      label: "Paid invoices",
      sourceTableKey: "invoices",
      filters: [{ field: "paid", operator: "is", value: "true" }],
      sort: null,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.view.sort).toBeNull();
    }
  });

  it("carries value2 for a between filter and requires it", () => {
    const ok = validateAddView(schema(), {
      label: "Mid-range invoices",
      sourceTableKey: "invoices",
      filters: [
        { field: "amount", operator: "between", value: "100", value2: "500" },
      ],
      sort: null,
    });
    expect(ok.valid).toBe(true);
    if (ok.valid) {
      expect(ok.view.filters[0]).toEqual({
        field: "amount",
        operator: "between",
        value: "100",
        value2: "500",
      });
    }

    const missingValue2 = validateAddView(schema(), {
      label: "Mid-range invoices",
      sourceTableKey: "invoices",
      filters: [{ field: "amount", operator: "between", value: "100" }],
      sort: null,
    });
    expect(missingValue2).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("resolves a source table + filter field given by LABEL (normalized)", () => {
    const result = validateAddView(schema(), {
      label: "A view",
      sourceTableKey: "Invoices",
      filters: [{ field: "Status", operator: "contains", value: "paid" }],
      sort: null,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.view.sourceTableKey).toBe("invoices");
      expect(result.view.filters[0].field).toBe("status");
    }
  });

  it("disambiguates a key colliding with an existing table", () => {
    const result = validateAddView(schema(), {
      label: "Jobs",
      sourceTableKey: "jobs",
      filters: [],
      sort: { field: "due_date", direction: "asc" },
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.view.key).toBe("jobs_2");
    }
  });

  it("disambiguates a key colliding with an existing VIEW", () => {
    const result = validateAddView(schema(), {
      label: "Unpaid invoices",
      sourceTableKey: "invoices",
      filters: [{ field: "status", operator: "equals", value: "unpaid" }],
      sort: null,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.view.key).toBe("unpaid_invoices_2");
    }
  });

  it("disambiguates a key colliding with a reserved key", () => {
    const result = validateAddView(schema(), {
      label: "Data",
      sourceTableKey: "invoices",
      filters: [{ field: "status", operator: "equals", value: "x" }],
      sort: null,
    });
    expect(result.valid).toBe(true);
    if (result.valid) {
      expect(result.view.key).toBe("data_2");
    }
  });

  it("rejects each blocked SQL verb as the view name (incl. mixed-case/embedded-stripped)", () => {
    for (const name of ["drop", "DELETE", "Truncate", "exec", "GRANT!"]) {
      const result = validateAddView(schema(), {
        label: name,
        sourceTableKey: "invoices",
        filters: [{ field: "status", operator: "equals", value: "x" }],
        sort: null,
      });
      expect(result).toEqual({ valid: false, reason: "addViewFailed" });
    }
  });

  it("does NOT reject a view name that merely contains a blocked substring", () => {
    const result = validateAddView(schema(), {
      label: "Dropoff logs",
      sourceTableKey: "invoices",
      filters: [{ field: "status", operator: "equals", value: "x" }],
      sort: null,
    });
    expect(result.valid).toBe(true);
  });

  it("rejects an unknown source table", () => {
    const result = validateAddView(schema(), {
      label: "Vendors view",
      sourceTableKey: "vendors",
      filters: [{ field: "status", operator: "equals", value: "x" }],
      sort: null,
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("rejects a HIDDEN source table", () => {
    const result = validateAddView(schema(), {
      label: "Archived view",
      sourceTableKey: "archived",
      filters: [{ field: "note", operator: "equals", value: "x" }],
      sort: null,
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("rejects a filter on an unknown field", () => {
    const result = validateAddView(schema(), {
      label: "A view",
      sourceTableKey: "invoices",
      filters: [{ field: "nonexistent", operator: "equals", value: "x" }],
      sort: null,
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("rejects a filter on a RELATION field (scalar-only)", () => {
    const result = validateAddView(schema(), {
      label: "A view",
      sourceTableKey: "invoices",
      filters: [{ field: "client", operator: "is", value: "some-id" }],
      sort: null,
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("rejects a filter on a HIDDEN field", () => {
    const result = validateAddView(schema(), {
      label: "A view",
      sourceTableKey: "invoices",
      filters: [{ field: "secret", operator: "equals", value: "x" }],
      sort: null,
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("rejects an operator invalid for the field's type", () => {
    // 'contains' is a text operator, invalid for a currency field.
    const result = validateAddView(schema(), {
      label: "A view",
      sourceTableKey: "invoices",
      filters: [{ field: "amount", operator: "contains", value: "100" }],
      sort: null,
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("rejects a filter missing its value", () => {
    const result = validateAddView(schema(), {
      label: "A view",
      sourceTableKey: "invoices",
      filters: [{ field: "status", operator: "equals", value: "   " }],
      sort: null,
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("rejects a sort on an unknown field", () => {
    const result = validateAddView(schema(), {
      label: "A view",
      sourceTableKey: "invoices",
      filters: [],
      sort: { field: "nonexistent", direction: "asc" },
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("rejects a sort on a relation field", () => {
    const result = validateAddView(schema(), {
      label: "A view",
      sourceTableKey: "invoices",
      filters: [],
      sort: { field: "client", direction: "asc" },
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("rejects an invalid sort direction", () => {
    const result = validateAddView(schema(), {
      label: "A view",
      sourceTableKey: "invoices",
      filters: [],
      sort: { field: "due_date", direction: "sideways" },
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("rejects a degenerate view with no filter and no sort", () => {
    const result = validateAddView(schema(), {
      label: "Empty view",
      sourceTableKey: "invoices",
      filters: [],
      sort: null,
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("rejects an empty label", () => {
    const result = validateAddView(schema(), {
      label: "   ",
      sourceTableKey: "invoices",
      filters: [{ field: "status", operator: "equals", value: "x" }],
      sort: null,
    });
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
  });

  it("logs every rejection via reportRejection with the org id + raw LLM output", () => {
    vi.mocked(reportRejection).mockClear();
    const rawOutput = { kind: "add_view", label: "drop" };
    const result = validateAddView(
      schema(),
      {
        label: "drop",
        sourceTableKey: "invoices",
        filters: [{ field: "status", operator: "equals", value: "x" }],
        sort: null,
      },
      { id: "org-1", rawOutput },
    );
    expect(result).toEqual({ valid: false, reason: "addViewFailed" });
    expect(reportRejection).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reportRejection).mock.calls[0][1]).toEqual({
      id: "org-1",
      rawOutput,
    });
  });

  it("does not mutate the input schema", () => {
    const s = schema();
    const before = snapshot(s);
    validateAddView(s, {
      label: "Overdue invoices",
      sourceTableKey: "invoices",
      filters: [{ field: "status", operator: "equals", value: "unpaid" }],
      sort: { field: "due_date", direction: "desc" },
    });
    expect(snapshot(s)).toBe(before);
  });
});

describe("addView transform (Story 5.3)", () => {
  const view: ViewDefinition = {
    key: "overdue_invoices",
    label: "Overdue invoices",
    sourceTableKey: "invoices",
    filters: [{ field: "status", operator: "equals", value: "unpaid" }],
    sort: { field: "due_date", direction: "desc" },
  };

  it("appends the new view to the schema's views", () => {
    const next = addView(schema(), view);
    expect((next.views ?? []).map((v) => v.key)).toEqual([
      "unpaid_invoices",
      "overdue_invoices",
    ]);
    expect(next.views?.at(-1)).toEqual(view);
  });

  it("creates the views array when the schema has none", () => {
    const s: SchemaDefinition = { tables: schema().tables };
    const next = addView(s, view);
    expect(next.views).toEqual([view]);
  });

  it("leaves existing tables untouched", () => {
    const next = addView(schema(), view);
    expect(next.tables).toEqual(schema().tables);
  });

  it("does not mutate the input schema (immutability)", () => {
    const s = schema();
    const before = snapshot(s);
    addView(s, view);
    expect(snapshot(s)).toBe(before);
  });

  it("preserves top-level schema fields (e.g. isFallback)", () => {
    const s: SchemaDefinition = { ...schema(), isFallback: true };
    const next = addView(s, view);
    expect(next.isFallback).toBe(true);
  });
});

describe("visibleViews (Story 5.3)", () => {
  // A view is removed outright (removeView), never hidden — there is no view
  // visibility flag. So visibleViews returns every view in the schema.
  it("returns all views in the schema", () => {
    const s = schema();
    s.views = [
      ...(s.views ?? []),
      {
        key: "second_view",
        label: "Second",
        sourceTableKey: "invoices",
        filters: [{ field: "status", operator: "equals", value: "x" }],
        sort: null,
      },
    ];
    expect(visibleViews(s).map((v) => v.key)).toEqual([
      "unpaid_invoices",
      "second_view",
    ]);
  });

  it("returns an empty array when the schema has no views", () => {
    expect(visibleViews({ tables: [] })).toEqual([]);
  });
});
