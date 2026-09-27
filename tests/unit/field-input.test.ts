import { describe, expect, it } from "vitest";

import {
  applyOptimisticAdd,
  applyOptimisticDelete,
  applyOptimisticUpdate,
  blankDraftForFields,
  coerceAddValue,
  inputModeFor,
} from "@/lib/forms/field-input";
import type { FieldDefinition, RecordData } from "@/types/db";

/**
 * Unit coverage for the pure add-form helpers (Story 3.2). Locks the I/O &
 * Edge-Case Matrix rows reachable without a DOM: value coercion (empty→omit,
 * valid/invalid number, currency, text trim, boolean-not-here) and the pure
 * optimistic cache updaters (add prepends, delete filters, both immutable).
 * Interactive DOM (dialog open/submit/confirm) is manual/Playwright-verified.
 */

describe("inputModeFor", () => {
  it("maps numeric-ish types to decimal, email/phone to their modes, else text", () => {
    expect(inputModeFor("number")).toBe("decimal");
    expect(inputModeFor("currency")).toBe("decimal");
    expect(inputModeFor("email")).toBe("email");
    expect(inputModeFor("phone")).toBe("tel");
    expect(inputModeFor("text")).toBe("text");
    expect(inputModeFor("date")).toBe("text");
    expect(inputModeFor("datetime")).toBe("text");
    expect(inputModeFor("boolean")).toBe("text");
  });
});

describe("coerceAddValue", () => {
  it("empty (and whitespace-only) input → omit (blank fields are not written)", () => {
    expect(coerceAddValue("text", "")).toEqual({ kind: "omit" });
    expect(coerceAddValue("text", "   ")).toEqual({ kind: "omit" });
    expect(coerceAddValue("number", "")).toEqual({ kind: "omit" });
    expect(coerceAddValue("currency", "  ")).toEqual({ kind: "omit" });
  });

  it("valid number/currency → coerced finite number", () => {
    expect(coerceAddValue("number", "42")).toEqual({ kind: "ok", value: 42 });
    expect(coerceAddValue("number", " -3.5 ")).toEqual({
      kind: "ok",
      value: -3.5,
    });
    expect(coerceAddValue("currency", "1200.99")).toEqual({
      kind: "ok",
      value: 1200.99,
    });
  });

  it("invalid number/currency → invalidNumber error code (no value)", () => {
    expect(coerceAddValue("number", "abc")).toEqual({
      kind: "error",
      errorKey: "invalidNumber",
    });
    // 1e999 parses to Infinity — must be rejected, not accepted.
    expect(coerceAddValue("currency", "1e999")).toEqual({
      kind: "error",
      errorKey: "invalidNumber",
    });
    expect(coerceAddValue("number", "12abc")).toEqual({
      kind: "error",
      errorKey: "invalidNumber",
    });
  });

  it("text-like types → trimmed text", () => {
    expect(coerceAddValue("text", "  hello  ")).toEqual({
      kind: "ok",
      value: "hello",
    });
    expect(coerceAddValue("email", " a@b.ca ")).toEqual({
      kind: "ok",
      value: "a@b.ca",
    });
    expect(coerceAddValue("phone", " 613-555-0000 ")).toEqual({
      kind: "ok",
      value: "613-555-0000",
    });
    expect(coerceAddValue("date", "2026-09-26")).toEqual({
      kind: "ok",
      value: "2026-09-26",
    });
  });
});

describe("blankDraftForFields", () => {
  it("seeds each field empty, booleans defaulting to the 'false' choice", () => {
    const fields: FieldDefinition[] = [
      { key: "name", label: "Name", type: "text" },
      { key: "paid", label: "Paid", type: "boolean" },
      { key: "amount", label: "Amount", type: "currency" },
    ];
    expect(blankDraftForFields(fields)).toEqual({
      name: "",
      paid: "false",
      amount: "",
    });
  });

  it("returns an empty draft for no fields", () => {
    expect(blankDraftForFields([])).toEqual({});
  });
});

describe("applyOptimisticAdd", () => {
  it("appends the record (matching created_at-asc order) and does not mutate the input list", () => {
    const list: RecordData[] = [{ id: "a", version: 1, data: {} }];
    const record: RecordData = { id: "temp", version: 1, data: { x: 1 } };
    const next = applyOptimisticAdd(list, record);
    expect(next).toEqual([{ id: "a", version: 1, data: {} }, record]);
    expect(next).not.toBe(list);
    expect(list).toHaveLength(1);
  });

  it("adds to an empty list", () => {
    const record: RecordData = { id: "temp", version: 1, data: {} };
    expect(applyOptimisticAdd([], record)).toEqual([record]);
  });
});

describe("applyOptimisticDelete", () => {
  it("removes the matching id and does not mutate the input list", () => {
    const list: RecordData[] = [
      { id: "a", version: 1, data: {} },
      { id: "b", version: 2, data: {} },
    ];
    const next = applyOptimisticDelete(list, "a");
    expect(next).toEqual([{ id: "b", version: 2, data: {} }]);
    expect(next).not.toBe(list);
    expect(list).toHaveLength(2);
  });

  it("is a no-op for a missing id (returns a new array)", () => {
    const list: RecordData[] = [{ id: "a", version: 1, data: {} }];
    const next = applyOptimisticDelete(list, "missing");
    expect(next).toEqual(list);
    expect(next).not.toBe(list);
  });
});

describe("applyOptimisticUpdate", () => {
  it("replaces the matching row's data, leaving version untouched when none given", () => {
    const list: RecordData[] = [
      { id: "a", version: 1, data: { name: "Ada" } },
      { id: "b", version: 2, data: { name: "Bo" } },
    ];
    const next = applyOptimisticUpdate(list, "a", { name: "Grace" });
    expect(next).toEqual([
      { id: "a", version: 1, data: { name: "Grace" } },
      { id: "b", version: 2, data: { name: "Bo" } },
    ]);
  });

  it("sets the version when one is given (server reconcile on success)", () => {
    const list: RecordData[] = [{ id: "a", version: 1, data: { name: "Ada" } }];
    const next = applyOptimisticUpdate(list, "a", { name: "Grace" }, 2);
    expect(next).toEqual([{ id: "a", version: 2, data: { name: "Grace" } }]);
  });

  it("is a no-op for a missing id (returns a new array, unchanged rows)", () => {
    const list: RecordData[] = [{ id: "a", version: 1, data: { name: "Ada" } }];
    const next = applyOptimisticUpdate(list, "missing", { name: "X" }, 9);
    expect(next).toEqual(list);
    expect(next).not.toBe(list);
  });

  it("does not mutate the input list or the untouched rows", () => {
    const rowA: RecordData = { id: "a", version: 1, data: { name: "Ada" } };
    const rowB: RecordData = { id: "b", version: 2, data: { name: "Bo" } };
    const list = [rowA, rowB];
    const next = applyOptimisticUpdate(list, "a", { name: "Grace" }, 2);
    expect(next).not.toBe(list);
    expect(list).toEqual([
      { id: "a", version: 1, data: { name: "Ada" } },
      { id: "b", version: 2, data: { name: "Bo" } },
    ]);
    // The edited row is a new object; the untouched row is the same reference.
    expect(next[0]).not.toBe(rowA);
    expect(next[1]).toBe(rowB);
  });
});
