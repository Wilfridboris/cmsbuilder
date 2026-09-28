/**
 * Import mapping types (Story 4.2) — the shared shapes for the AI-proposed
 * column mapping surface, consumed by the propose route, the import client, the
 * mapping components, and the later edit/resolve (4.3) + commit (4.4) stories.
 *
 * These are pure data types with no framework or I/O coupling. API bodies use
 * `snake_case` on the wire, but this app-side model is `camelCase` per the epic's
 * data-model convention.
 */

/**
 * One source column's proposed mapping. `target` is `null` when the AI found no
 * confident, real match (or a hallucinated target was downgraded) — a `null`
 * target means "unmapped" and is listed in `ImportProposal.unmapped`. `confidence`
 * is the model's [0,1] confidence for the proposed target (clamped); `reason` is
 * the one-line "shows its work" explanation.
 */
export type ColumnMapping = {
  /** The exact source column name from the parsed sheet. */
  sourceColumn: string;
  /** The resolved, real target field, or `null` when unmapped. */
  target: { table: string; field: string } | null;
  /** The model's confidence for `target`, clamped to [0, 1]. */
  confidence: number;
  /** A one-line plain-language reason for the proposed match. */
  reason?: string;
};

/**
 * The read-only mapping proposal returned by `/api/import/propose`. Every source
 * column appears exactly once in `mappings`; `unmapped` lists the source columns
 * that still need resolution (null target OR below the confidence threshold).
 * Story 4.2 writes nothing — this is a proposal, not a commit.
 */
export type ImportProposal = {
  /** Total data rows in the parsed sheet (header excluded). */
  rowCount: number;
  /** One entry per source column, in the sheet's column order. */
  mappings: ColumnMapping[];
  /** Source columns needing resolution (null target or below threshold). */
  unmapped: string[];
};

/**
 * The client-safe field catalog (Story 4.3), built by the import server page from
 * the org's schema (non-hidden tables/fields only). It carries the human labels
 * and the grouped picker options the editable mapping surface needs, so the
 * propose response can keep returning key-only targets. Safe metadata only — no
 * row data, no hidden entries.
 */
export type FieldCatalog = Array<{
  /** The logical table's stored key. */
  tableKey: string;
  /** The table's human-facing label. */
  tableLabel: string;
  /** The table's non-hidden fields as picker options. */
  fields: Array<{ key: string; label: string; type: string }>;
}>;

/**
 * A single column's client-side resolution decision (Story 4.3), layered over the
 * immutable 4.2 proposal. A confident column seeds `{kind:"map"}`; a flagged column
 * (in `proposal.unmapped`) seeds `{kind:"unresolved"}` and requires an explicit
 * Admin action (map or skip) before it counts as resolved. Re-exported from the
 * pure `resolve` module so components and the resolve logic share one shape.
 */
export type { MappingDecision } from "@/lib/import/resolve";

/**
 * The success payload of a confirmed import (Story 4.4), returned by
 * `POST /api/import/commit`. `importedCount` is the total rows inserted across all
 * affected tables; `tables` carries the per-table inserted-row counts (one entry
 * per distinct target table in the confirmed mapping) so the UI can render a
 * per-table success summary. Structure/metadata only — no row data leaks.
 */
export type CommitResult = {
  /** Total rows inserted across every affected table. */
  importedCount: number;
  /** Per-table inserted-row counts, one entry per distinct target table. */
  tables: Array<{ tableKey: string; count: number }>;
};
