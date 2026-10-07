import { AppError } from "@/types/api";

/**
 * Server-side `data`-vs-schema conformance seam (Story 3.10) — first slice.
 *
 * A pure, synchronous value inspection: it needs only the write payload, never
 * the org schema or the DB. This is the non-empty guard; schema-aware
 * key-existence, value-type, and per-field-required conformance remain deferred
 * (see the `deferred-work.md` spec-3-2 / spec-3-3 entries).
 */

/**
 * "Blank" mirrors the client coercion EXACTLY (`AddRecordForm` +
 * `coerceAddValue`): a value is blank when it is `null`, `undefined`, or an
 * empty / whitespace-only string. Boolean `false` and number `0` are real
 * values (never blank), as is any other non-string value.
 */
export function isBlankValue(value: unknown): boolean {
  if (value === null || value === undefined) {
    return true;
  }
  if (typeof value === "string") {
    return value.trim() === "";
  }
  return false;
}

/**
 * Reject a write whose `data` has no non-blank value — i.e. every value is
 * blank, including `{}` (an absent key is blank too). Throws
 * `AppError(400, "emptyRecord")`, which propagates straight to the existing
 * `handleError` `{ data, error }` envelope (no `result.error` remap, since this
 * runs BEFORE any `mutate()` call). Invoked in both write routes AFTER identity
 * resolution so a non-member still gets 403, never an "empty" hint (FR99).
 */
export function assertRecordNotEmpty(data: Record<string, unknown>): void {
  const hasValue = Object.values(data).some((value) => !isBlankValue(value));
  if (!hasValue) {
    throw new AppError(400, "emptyRecord");
  }
}
