import type {
  FieldDefinition,
  FormFieldConfig,
  SchemaDefinition,
  TableDefinition,
} from "@/types/db";
import { visibleTables } from "@/lib/schema/overrides";
import { eligibleFields } from "@/lib/data/filter-sort";

/**
 * Pure, node-testable intake-table selection + field derivation (Story 6.1).
 *
 * The public intake form at `/forms/{slug}` is DERIVED from the org's existing
 * logical schema — there is no new table, column, or migration. This module is the
 * single, tested source of two decisions the public page depends on:
 *
 *  - WHICH table the form collects into (`selectIntakeTable`), and
 *  - WHICH of its fields become inputs (`intakeFields`).
 *
 * Framework-agnostic (no React / next-intl / Supabase imports) so it unit-tests in
 * the node env, mirroring `overrides.ts` / `filter-sort.ts`.
 */

/**
 * Case-insensitive intake-term patterns matched against a visible table's `key`
 * and `label` (decided boundary). Covers English and French lead-capture terms:
 * lead/job/inquir(y)/request/intake/contact/prospect/client plus French
 * demande/rendez(-vous). A single alternation keeps the heuristic declarative and
 * testable.
 */
const INTAKE_TERM =
  /lead|job|inquir|request|intake|contact|prospect|client|demande|rendez/i;

/**
 * Pick the table the public intake form collects into (decided boundary):
 *
 *  1. the FIRST `visibleTables()` entry whose `key` or `label` matches an
 *     intake-term pattern (case-insensitive, English + French), else
 *  2. the FIRST visible table (any org has something to collect), else
 *  3. `null` — the org has no visible tables, so there is nothing to collect.
 *
 * Hidden tables never participate (they are excluded by `visibleTables`), so a
 * hidden "leads" table is skipped and the next visible match (or the first visible
 * table) is chosen. Pure — never mutates the input schema.
 */
export function selectIntakeTable(
  schema: SchemaDefinition,
): TableDefinition | null {
  const visible = visibleTables(schema);
  if (visible.length === 0) {
    return null;
  }

  const byTerm = visible.find((table) =>
    INTAKE_TERM.test(`${table.key} ${table.label}`),
  );

  return byTerm ?? visible[0];
}

/**
 * The fields the public form renders as inputs: the table's `eligibleFields`
 * (every non-`hidden` field, in definition order) MINUS every `relation` field.
 *
 * Relation fields never reach the public surface (frozen boundary; pre-aligns with
 * Story 6.5): no target-table ids, labels, counts, or pickers appear in markup or
 * payload. Definition order is preserved so the form reads as authored. Pure —
 * never mutates the input table.
 */
export function intakeFields(table: TableDefinition): FieldDefinition[] {
  return eligibleFields(table.fields).filter(
    (field) => field.type !== "relation",
  );
}

/**
 * A public intake field: a resolved {@link FieldDefinition} whose `label` may have been
 * overridden with the form's public label, carrying an optional `helpText` rider. The
 * public render component and the write-allowlist both consume this exact shape.
 */
export type PublicIntakeField = FieldDefinition & { helpText?: string };

/**
 * Apply a form's per-field customization (Story 14.5) over the base intake field list —
 * the SINGLE place config semantics live. Pure, framework-agnostic (node-testable),
 * mirroring {@link intakeFields}; never mutates its inputs.
 *
 * `base` is ALWAYS `intakeFields(table)` (already non-hidden, non-relation), so no hidden
 * or relation field can ever reach this function or leak out of it (FR78 upstream).
 *
 * Semantics:
 *  - EMPTY config -> return `base` unchanged (today's behavior: all intake fields in
 *    definition order, raw labels, no help text). This is the backward-compatible path
 *    every pre-14.5 and newly-created form keeps taking until an Admin saves a config.
 *  - NON-EMPTY config -> for each base field, look up its entry by `key`:
 *      - an entry with `included === false` excludes the field (dropped from render AND
 *        the write-allowlist);
 *      - a field with NO entry defaults to visible (fail-open), appended after all
 *        configured fields — scoped to `base` only, so no hidden field can leak;
 *      - a configured field's `label` overrides the field's label in place (shallow copy);
 *        a blank/absent public label keeps the schema label;
 *      - `helpText` rides along as the optional property when present and non-blank.
 *    Configured fields sort by `order` (ascending; stable by base position on ties);
 *    unconfigured visible fields keep their definition order after them.
 *
 * Config entries whose `key` is not a current `base` field are ignored (a stale or
 * relation key never surfaces), so the resolver inherits drop-stale + FR78 for free.
 */
export function applyFieldConfig(
  base: FieldDefinition[],
  config: FormFieldConfig[],
): PublicIntakeField[] {
  // Empty config -> unchanged passthrough (backward-compatible default).
  if (config.length === 0) {
    return base;
  }

  // Index the config by key for O(1) lookup; a later duplicate key wins (last write).
  const byKey = new Map<string, FormFieldConfig>();
  config.forEach((entry) => byKey.set(entry.key, entry));

  // Keep each base field's definition index so we can stable-tiebreak the sort and keep
  // unconfigured fields in definition order.
  const configured: { field: PublicIntakeField; order: number; index: number }[] = [];
  const unconfigured: PublicIntakeField[] = [];

  base.forEach((field, index) => {
    const entry = byKey.get(field.key);

    // No entry for this base field -> fail-open visible, appended after configured fields.
    if (!entry) {
      unconfigured.push(field);
      return;
    }

    // An explicit `included: false` drops the field entirely.
    if (entry.included === false) {
      return;
    }

    // Shallow-copy so the override never mutates the shared schema field. A non-blank
    // public label overrides the schema label in place; help text rides along.
    const label =
      typeof entry.label === "string" && entry.label.trim() !== ""
        ? entry.label
        : field.label;
    const resolved: PublicIntakeField = { ...field, label };
    if (typeof entry.helpText === "string" && entry.helpText.trim() !== "") {
      resolved.helpText = entry.helpText;
    }

    configured.push({
      field: resolved,
      order: typeof entry.order === "number" ? entry.order : index,
      index,
    });
  });

  // Stable sort configured fields by `order`, breaking ties by base position.
  configured.sort((a, b) => a.order - b.order || a.index - b.index);

  return [...configured.map((item) => item.field), ...unconfigured];
}
