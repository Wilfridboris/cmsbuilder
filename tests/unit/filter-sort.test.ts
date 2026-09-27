import { describe, expect, it } from "vitest";

import {
  applyFilterSort,
  compareValues,
  eligibleFields,
  matchesFilter,
  operatorsForType,
  type FilterState,
  type SortState,
} from "@/lib/data/filter-sort";
import type { FieldDefinition, RecordData } from "@/types/db";

/**
 * Unit coverage for the pure filter/sort module (Story 3.4). Locks every
 * reachable I/O & Edge-Case Matrix row without a DOM: eligible-field selection,
 * per-type predicates and comparators, single/multi (AND) filters, the sort
 * cycle, deterministic blank ordering, and non-mutation / stability. Interactive
 * DOM (toolbar, header buttons, filtered-empty state) is Playwright-verified.
 */

function field(
  key: string,
  type: FieldDefinition["type"],
  extra: Partial<FieldDefinition> = {},
): FieldDefinition {
  return { key, label: key, type, ...extra };
}

function row(id: string, data: Record<string, unknown>): RecordData {
  return { id, version: 1, data };
}

describe("eligibleFields", () => {
  it("excludes hidden fields but INCLUDES relation fields (Story 3.8), preserving order", () => {
    const fields = [
      field("name", "text"),
      field("secret", "text", { hidden: true }),
      field("owner", "relation"),
      field("amount", "currency"),
    ];
    // Story 3.8: relation fields are now eligible filter/sort targets (relation
    // filter is server-side; relation sort is by resolved label). Hidden stays out.
    expect(eligibleFields(fields).map((f) => f.key)).toEqual([
      "name",
      "owner",
      "amount",
    ]);
  });
});

describe("operatorsForType", () => {
  it("caps operators per type", () => {
    expect(operatorsForType("text")).toEqual(["contains", "equals"]);
    expect(operatorsForType("email")).toEqual(["contains", "equals"]);
    expect(operatorsForType("number")).toEqual(["eq", "lt", "gt", "between"]);
    expect(operatorsForType("currency")).toEqual(["eq", "lt", "gt", "between"]);
    expect(operatorsForType("date")).toEqual([
      "before",
      "after",
      "on",
      "between",
    ]);
    expect(operatorsForType("datetime")).toEqual([
      "before",
      "after",
      "on",
      "between",
    ]);
    expect(operatorsForType("boolean")).toEqual(["is"]);
    // Story 3.8: a relation is matched only by exact target ("is").
    expect(operatorsForType("relation")).toEqual(["is"]);
  });
});

describe("matchesFilter", () => {
  it("text: contains / equals are case-insensitive", () => {
    expect(
      matchesFilter("Ottawa Job", { field: "x", operator: "contains", value: "job" }, "text"),
    ).toBe(true);
    expect(
      matchesFilter("Ottawa", { field: "x", operator: "equals", value: "ottawa" }, "text"),
    ).toBe(true);
    expect(
      matchesFilter("Ottawa", { field: "x", operator: "equals", value: "ott" }, "text"),
    ).toBe(false);
    // Blank cell never matches.
    expect(
      matchesFilter(null, { field: "x", operator: "contains", value: "a" }, "text"),
    ).toBe(false);
  });

  it("number/currency: =, <, >, between", () => {
    expect(matchesFilter(5, { field: "x", operator: "eq", value: "5" }, "number")).toBe(true);
    expect(matchesFilter(5, { field: "x", operator: "lt", value: "6" }, "number")).toBe(true);
    expect(matchesFilter(5, { field: "x", operator: "gt", value: "6" }, "number")).toBe(false);
    expect(
      matchesFilter(5, { field: "x", operator: "between", value: "1", value2: "10" }, "currency"),
    ).toBe(true);
    // Reversed bounds still work.
    expect(
      matchesFilter(5, { field: "x", operator: "between", value: "10", value2: "1" }, "number"),
    ).toBe(true);
    // Blank / non-numeric cell never matches, never throws.
    expect(matchesFilter(null, { field: "x", operator: "eq", value: "5" }, "number")).toBe(false);
    expect(matchesFilter("abc", { field: "x", operator: "gt", value: "1" }, "number")).toBe(false);
  });

  it("date/datetime: before, after, on, between", () => {
    const may = "2026-05-01";
    expect(
      matchesFilter(may, { field: "x", operator: "before", value: "2026-06-01" }, "date"),
    ).toBe(true);
    expect(
      matchesFilter(may, { field: "x", operator: "after", value: "2026-04-01" }, "date"),
    ).toBe(true);
    expect(
      matchesFilter(may, { field: "x", operator: "on", value: "2026-05-01" }, "date"),
    ).toBe(true);
    expect(
      matchesFilter(may, { field: "x", operator: "between", value: "2026-04-01", value2: "2026-06-01" }, "date"),
    ).toBe(true);
    // Unparseable cell never matches, never throws.
    expect(
      matchesFilter("not-a-date", { field: "x", operator: "on", value: "2026-05-01" }, "date"),
    ).toBe(false);
  });

  it("datetime 'on': matches the whole calendar day, not an exact instant", () => {
    // Regression: a datetime cell (a real timestamp) filtered "on" a date-only
    // value must match the day. Exact-ms equality made this always false.
    const at0923 = "2026-05-01T09:23:00Z";
    expect(
      matchesFilter(at0923, { field: "x", operator: "on", value: "2026-05-01" }, "datetime"),
    ).toBe(true);
    // A different UTC day does not match.
    expect(
      matchesFilter(at0923, { field: "x", operator: "on", value: "2026-05-02" }, "datetime"),
    ).toBe(false);
  });

  it("boolean: is, coercing string 'true'/'false'", () => {
    expect(matchesFilter(true, { field: "x", operator: "is", value: "true" }, "boolean")).toBe(true);
    expect(matchesFilter(false, { field: "x", operator: "is", value: "true" }, "boolean")).toBe(false);
    expect(matchesFilter("true", { field: "x", operator: "is", value: "true" }, "boolean")).toBe(true);
    // Missing → false, matches "is false".
    expect(matchesFilter(undefined, { field: "x", operator: "is", value: "false" }, "boolean")).toBe(true);
  });
});

describe("compareValues", () => {
  it("orders numbers, dates, booleans, and text without throwing", () => {
    expect(compareValues(1, 2, "number")).toBeLessThan(0);
    expect(compareValues("2026-05-01", "2026-04-01", "date")).toBeGreaterThan(0);
    expect(compareValues(false, true, "boolean")).toBeLessThan(0);
    expect(compareValues("apple", "Banana", "text")).toBeLessThan(0);
  });

  it("groups blanks last in ascending order deterministically", () => {
    expect(compareValues(null, 5, "number")).toBeGreaterThan(0);
    expect(compareValues(5, null, "number")).toBeLessThan(0);
    expect(compareValues(null, null, "number")).toBe(0);
    expect(compareValues("", "x", "text")).toBeGreaterThan(0);
  });
});

describe("applyFilterSort", () => {
  const fields = [
    field("name", "text"),
    field("amount", "currency"),
    field("done", "boolean"),
    field("secret", "text", { hidden: true }),
  ];
  const rows = [
    row("a", { name: "Alpha", amount: 30, done: false }),
    row("b", { name: "Bravo", amount: 10, done: true }),
    row("c", { name: "Charlie", amount: 20, done: false }),
    row("d", { name: "Delta" }), // amount + done blank
  ];

  it("returns a new array and never mutates inputs", () => {
    const filters: FilterState[] = [];
    const sort: SortState = { field: "amount", direction: "asc" };
    const snapshot = JSON.stringify(rows);
    const out = applyFilterSort(rows, filters, sort, fields);
    expect(out).not.toBe(rows);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it("single filter shows only matching rows", () => {
    const out = applyFilterSort(
      rows,
      [{ field: "amount", operator: "gt", value: "15" }],
      null,
      fields,
    );
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("multiple filters combine with AND", () => {
    const out = applyFilterSort(
      rows,
      [
        { field: "amount", operator: "gt", value: "15" },
        { field: "done", operator: "is", value: "false" },
        { field: "name", operator: "contains", value: "a" },
      ],
      null,
      fields,
    );
    expect(out.map((r) => r.id)).toEqual(["a", "c"]);
  });

  it("sorts ascending then descending, with blanks grouped at one end", () => {
    const asc = applyFilterSort(rows, [], { field: "amount", direction: "asc" }, fields);
    expect(asc.map((r) => r.id)).toEqual(["b", "c", "a", "d"]); // blank last
    const desc = applyFilterSort(rows, [], { field: "amount", direction: "desc" }, fields);
    expect(desc.map((r) => r.id)).toEqual(["a", "c", "b", "d"]); // blank still last
  });

  it("no sort preserves incoming (created_at) order", () => {
    const out = applyFilterSort(rows, [], null, fields);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("is a stable sort — equal keys keep incoming order", () => {
    const tie = [
      row("x", { name: "same", amount: 5 }),
      row("y", { name: "same", amount: 9 }),
      row("z", { name: "same", amount: 1 }),
    ];
    const out = applyFilterSort(tie, [], { field: "name", direction: "asc" }, fields);
    expect(out.map((r) => r.id)).toEqual(["x", "y", "z"]);
  });

  it("ignores a filter/sort targeting an ineligible (hidden) field", () => {
    const out = applyFilterSort(
      rows,
      [{ field: "secret", operator: "contains", value: "anything" }],
      { field: "secret", direction: "asc" },
      fields,
    );
    // Hidden-field filter ignored → all rows; hidden-field sort ignored → order kept.
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c", "d"]);
  });

  // --- Story 3.8: relation filter is server-side; relation sort is by label ---

  const relFields = [
    field("title", "text"),
    field("client", "relation", {
      relationConfig: { targetTable: "clients", cardinality: "one" },
    }),
  ];
  const relRows = [
    row("r1", { title: "One", client: "c-charlie" }),
    row("r2", { title: "Two", client: "c-alpha" }),
    row("r3", { title: "Three", client: "c-bravo" }),
    row("r4", { title: "Four", client: "c-archived" }), // unresolvable → sorts last
    row("r5", { title: "Five" }), // no relation value → sorts last
  ];
  // Resolver: three live labels; the archived id resolves to null; missing → null.
  const labels: Record<string, string> = {
    "c-alpha": "Alpha",
    "c-bravo": "Bravo",
    "c-charlie": "Charlie",
  };
  const resolveRelationLabel = (
    _f: FieldDefinition,
    value: unknown,
  ): string | null => labels[String(value)] ?? null;

  it("ignores a relation filter client-side (applied server-side) — no rows dropped", () => {
    const out = applyFilterSort(
      relRows,
      [{ field: "client", operator: "is", value: "c-alpha" }],
      null,
      relFields,
      resolveRelationLabel,
    );
    // The relation filter is a no-op in `matchesFilter`; every row stays.
    expect(out.map((r) => r.id)).toEqual(["r1", "r2", "r3", "r4", "r5"]);
  });

  it("sorts a relation column by the RESOLVED label; unresolved/archived sort last", () => {
    const asc = applyFilterSort(
      relRows,
      [],
      { field: "client", direction: "asc" },
      relFields,
      resolveRelationLabel,
    );
    // Alpha < Bravo < Charlie by label; the archived + missing rows trail (in order).
    expect(asc.map((r) => r.id)).toEqual(["r2", "r3", "r1", "r4", "r5"]);

    const desc = applyFilterSort(
      relRows,
      [],
      { field: "client", direction: "desc" },
      relFields,
      resolveRelationLabel,
    );
    // Descending reorders only the resolved labels; blanks stay grouped last.
    expect(desc.map((r) => r.id)).toEqual(["r1", "r3", "r2", "r4", "r5"]);
  });
});
