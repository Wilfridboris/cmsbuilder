import type {
  FieldDefinition,
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
