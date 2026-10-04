import type { SelectOption } from "@/types/db";

/**
 * Pure, node-testable decision logic for the single-select (`select`) edit
 * controls (Story 13.2), extracted from `SelectDropdown` / `InlineEditCell` /
 * `AddRecordForm` so the I/O-matrix edit behaviors are unit-tested without
 * driving the Radix `Select` portal in jsdom — the same split the add-record
 * form uses for `coerceAddValue` in `field-input.ts`.
 */

/**
 * Sentinel value the dropdown's "Clear" item carries. Radix `Select` items need
 * a non-empty value, so clearing an optional select can't use `""`; this token
 * stands in and is mapped back to `null` by {@link fromDropdownValue}.
 */
export const SELECT_CLEAR_SENTINEL = "__clear__";

/** Map a raw dropdown change to the logical value: the clear sentinel → `null`. */
export function fromDropdownValue(next: string): string | null {
  return next === SELECT_CLEAR_SENTINEL ? null : next;
}

/**
 * Split a select field's options for the dropdown: the selectable NON-archived
 * `active` options, plus `archivedCurrent` — the currently-selected option when
 * it is archived. The archived current option is surfaced (as a disabled item)
 * so the trigger still shows its label (an existing cell keeps resolving) while
 * never being offered as a new choice. A blank/null value has no archived
 * current.
 */
export function partitionSelectOptions(
  options: SelectOption[],
  value: string | null,
): { active: SelectOption[]; archivedCurrent?: SelectOption } {
  const active = options.filter((opt) => !opt.archived);
  const archivedCurrent =
    value !== null && value !== ""
      ? options.find((opt) => opt.value === value && opt.archived)
      : undefined;
  return { active, archivedCurrent };
}

/**
 * The outcome of an inline select pick (the control commits immediately):
 *  - `noop`  → the current value was re-picked; close the editor, no write;
 *  - `omit`  → the value was cleared; drop the key from `data`;
 *  - `ok`    → a new option `value` to write.
 */
export type SelectCommit =
  | { kind: "noop" }
  | { kind: "omit" }
  | { kind: "ok"; value: string };

/** Decide the inline-edit outcome for a select pick. */
export function resolveSelectCommit(
  next: string | null,
  current: string | null,
): SelectCommit {
  if (next === current) {
    return { kind: "noop" };
  }
  if (next === null) {
    return { kind: "omit" };
  }
  return { kind: "ok", value: next };
}

/**
 * Map an add-form select draft token to its write outcome: blank (after trim) →
 * `omit` the key (the schema has no `required` flag), else write the option
 * `value` token.
 */
export function selectDraftToData(
  raw: string | undefined,
): { kind: "omit" } | { kind: "ok"; value: string } {
  const token = (raw ?? "").trim();
  return token === "" ? { kind: "omit" } : { kind: "ok", value: token };
}

/**
 * The single source of truth for "is this a valid select value", reused by BOTH
 * the public intake write (`/api/intake/[slug]`) and the import commit planner
 * (Story 13.6). Pure and total — it only READS the field's `options`, never
 * mutates the schema.
 *
 * Trims `raw`, then:
 *  - blank → `omit` (the schema has no `required` flag; the key is dropped);
 *  - matches a NON-archived option by exact `value` token first, then by
 *    case-insensitive `label`, returning that option's canonical `value`;
 *  - anything else (including an archived option's value/label) → `invalid`.
 *
 * Archived options never match: intake/import create NEW records, and an archived
 * option is not selectable for new records (Story 13.4). Matching by `label`
 * (case-insensitive) as well as by `value` lets import resolve external
 * spreadsheet labels ("In progress") to the stored token ("in_progress"); the
 * intake client only ever sends tokens, but one matcher keeps a single rule.
 */
export function matchSelectValue(
  options: SelectOption[] | undefined,
  raw: string,
): { kind: "omit" } | { kind: "ok"; value: string } | { kind: "invalid" } {
  const token = raw.trim();
  if (token === "") {
    return { kind: "omit" };
  }
  const active = (options ?? []).filter((opt) => !opt.archived);
  const byValue = active.find((opt) => opt.value === token);
  if (byValue) {
    return { kind: "ok", value: byValue.value };
  }
  const lower = token.toLowerCase();
  const byLabel = active.find((opt) => opt.label.toLowerCase() === lower);
  if (byLabel) {
    return { kind: "ok", value: byLabel.value };
  }
  return { kind: "invalid" };
}
