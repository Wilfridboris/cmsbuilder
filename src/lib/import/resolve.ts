import type { FieldCatalog, ImportProposal } from "@/types/import";

/**
 * Pure, framework-free resolution helpers for the Import edit/resolve phase
 * (Story 4.3). This module owns the client-side decision model layered over the
 * immutable 4.2 proposal and NOTHING that talks to the network, cookies, or a
 * database — so every edge-case-matrix row is unit-testable with no React/HTTP
 * harness.
 *
 * Why a separate decision state instead of mutating the proposal: the frozen
 * `ColumnMapping.target` cannot distinguish "null = unresolved" from
 * "null = skipped". A confident column seeds `{kind:"map"}`; a flagged column
 * (one in `proposal.unmapped` — null target OR below threshold) seeds
 * `{kind:"unresolved"}` so an explicit Admin action (map or skip) is required
 * even when a tentative target exists. The Import gate is
 * `unresolvedColumns(...).length === 0`.
 *
 * This is analyze-phase logic: it computes readiness over client state and writes
 * NOTHING to any tenant table. The commit is Story 4.4.
 */

/**
 * One source column's resolution decision, keyed by `sourceColumn` in the parent
 * map. `map` carries the chosen `{table, field}` target (either the AI's confident
 * proposal, confirmed as-is, or a remap); `skip` means the Admin excluded the
 * column from the import; `unresolved` is the seed state for a flagged column that
 * still needs an explicit decision.
 */
export type MappingDecision =
  | { kind: "map"; table: string; field: string }
  | { kind: "skip" }
  | { kind: "unresolved" };

/** A per-column decision map, keyed by the exact `sourceColumn` string. */
export type DecisionMap = Record<string, MappingDecision>;

/**
 * Seed the per-column decisions from a fresh proposal. A confident column (a real
 * target that is NOT flagged in `unmapped`) starts `{kind:"map"}` with its
 * proposed target; every flagged column (in `unmapped` — null target OR
 * below-threshold, even one carrying a tentative target) starts `{kind:"unresolved"}`
 * so it requires an explicit Admin action. Called on each new proposal / retry.
 */
export function initialDecisions(proposal: ImportProposal): DecisionMap {
  const flagged = new Set(proposal.unmapped);
  const decisions: DecisionMap = {};
  for (const mapping of proposal.mappings) {
    if (!flagged.has(mapping.sourceColumn) && mapping.target) {
      decisions[mapping.sourceColumn] = {
        kind: "map",
        table: mapping.target.table,
        field: mapping.target.field,
      };
    } else {
      decisions[mapping.sourceColumn] = { kind: "unresolved" };
    }
  }
  return decisions;
}

/**
 * The source columns that are still flagged AND unresolved, in the proposal's
 * column order. A column counts as remaining exactly when it is in the proposal's
 * `unmapped` set (the flagged definition) and its current decision is
 * `unresolved` — a confident column never blocks; a flagged column stops blocking
 * once the Admin maps or skips it. Used to gate the Import action and to name what
 * remains.
 */
export function unresolvedColumns(
  proposal: ImportProposal,
  decisions: DecisionMap,
): string[] {
  const flagged = new Set(proposal.unmapped);
  return proposal.mappings
    .map((m) => m.sourceColumn)
    .filter((col) => flagged.has(col) && decisions[col]?.kind === "unresolved");
}

/** Ready to import exactly when no flagged column remains unresolved. */
export function isReadyToImport(
  proposal: ImportProposal,
  decisions: DecisionMap,
): boolean {
  return unresolvedColumns(proposal, decisions).length === 0;
}

/**
 * Resolve a target's human label from the catalog by `{table, field}` key. Falls
 * back to the raw `field` key when the table or field is absent from the catalog
 * (e.g. an empty/unreadable schema, or a key with no catalog match), so a label
 * lookup never renders blank.
 */
export function resolveFieldLabel(
  catalog: FieldCatalog,
  table: string,
  field: string,
): string {
  const tableEntry = catalog.find((t) => t.tableKey === table);
  const fieldEntry = tableEntry?.fields.find((f) => f.key === field);
  return fieldEntry?.label ?? field;
}
