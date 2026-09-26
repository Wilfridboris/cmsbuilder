import type { FieldDefinition, RecordData } from "@/types/db";

/**
 * Pure, node-testable helpers for the schema-typed add-record form (Story 3.2).
 *
 * These mirror the demo `RecordDetail`'s field-input shapes (`inputModeFor`,
 * `validateAndCoerce`) but live here — framework-agnostic and unit-tested —
 * rather than being imported from that pre-auth demo component. The add flow
 * differs from the demo edit in one way: EMPTY input is allowed (the field is
 * simply omitted from `data`), because the schema has no `required` flag.
 *
 * Also holds the pure optimistic cache updaters used by the TanStack Query
 * mutation hooks so the optimistic `setQueryData` logic is testable in isolation.
 */

/** The mobile keyboard hint per field type (mirrors `RecordDetail`). */
export function inputModeFor(
  type: FieldDefinition["type"],
): "decimal" | "email" | "tel" | "text" {
  switch (type) {
    case "number":
    case "currency":
      return "decimal";
    case "email":
      return "email";
    case "phone":
      return "tel";
    default:
      return "text";
  }
}

/**
 * The result of coercing one raw draft value for the add form:
 *  - `omit`  → the field was left blank; drop it from `data` (no value written);
 *  - `ok`    → a coerced value ready to write;
 *  - `error` → invalid input (only numbers/currency can fail); render inline.
 */
export type CoerceResult =
  | { kind: "omit" }
  | { kind: "ok"; value: unknown }
  | { kind: "error"; errorKey: "invalidNumber" };

/**
 * Validate + coerce a raw text draft for a scalar field on the ADD path.
 *
 * Empty (after trim) → `omit`, because the schema has no `required` flag, so a
 * blank field is simply not written (differs from the demo's `validateAndCoerce`,
 * which rejects empty). `boolean` never reaches here — the toggle supplies a real
 * boolean directly. Numbers/currency must parse to a finite number, else an
 * `invalidNumber` error code; everything else is accepted as trimmed text.
 */
export function coerceAddValue(
  type: FieldDefinition["type"],
  raw: string,
): CoerceResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return { kind: "omit" };
  }

  if (type === "number" || type === "currency") {
    const parsed = Number(trimmed);
    // `!isFinite` rejects NaN AND Infinity/-Infinity (e.g. "1e999" → Infinity),
    // which `Number.isNaN` alone would let through as a valid number.
    if (!Number.isFinite(parsed)) {
      return { kind: "error", errorKey: "invalidNumber" };
    }
    return { kind: "ok", value: parsed };
  }

  return { kind: "ok", value: trimmed };
}

/** A per-field draft string map (booleans stored as "true"/"false" strings). */
export type Draft = Record<string, string>;

/**
 * A blank draft for the given fields: every visible field starts as an empty
 * string, and `boolean` fields default to the "false" choice so the two-choice
 * toggle always has a defined selection.
 */
export function blankDraftForFields(fields: FieldDefinition[]): Draft {
  const draft: Draft = {};
  for (const field of fields) {
    draft[field.key] = field.type === "boolean" ? "false" : "";
  }
  return draft;
}

/**
 * Optimistic add: append the (temporary) record to the END of the list so its
 * position matches the authoritative order — `listRecords` sorts `created_at`
 * ascending (oldest-first), so a newly-created row settles at the bottom. Adding
 * it there optimistically avoids a visible top→bottom jump when the post-settle
 * refetch reconciles. Returns a NEW array — never mutates the input list.
 */
export function applyOptimisticAdd(
  list: RecordData[],
  record: RecordData,
): RecordData[] {
  return [...list, record];
}

/**
 * Optimistic delete: drop the record with `id` from the list. Returns a NEW
 * array — never mutates the input list. A missing id is a no-op.
 */
export function applyOptimisticDelete(
  list: RecordData[],
  id: string,
): RecordData[] {
  return list.filter((record) => record.id !== id);
}
