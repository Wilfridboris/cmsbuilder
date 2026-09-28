import type { SchemaDefinition } from "@/types/db";
import type { DecisionMap } from "@/lib/import/resolve";
import { normalizeTableName } from "@/lib/utils";

/**
 * Pure, framework-free commit planner for the Import commit phase (Story 4.4).
 *
 * `planCommit(rows, decisions, schema)` turns the Admin's confirmed per-column
 * decisions plus the freshly-parsed rows into the exact set of per-table row
 * payloads to insert — grouping mapped columns by their target table so one
 * source row can yield a record per distinct table. It owns NOTHING that talks to
 * the network, cookies, or a database (mirroring `parse.ts` / `mapping.ts`), so
 * every edge-case-matrix row is unit-testable with no HTTP/DB harness.
 *
 * The trust boundary re-runs here even though 4.3 already gated readiness:
 *   - an `unresolved` decision throws `unresolvedColumns` (the route rejects 400);
 *   - a mapped `{table, field}` that no longer resolves to a real, non-hidden
 *     field throws `schemaChanged` (schema drift → the route rejects 409);
 *   - a `skip` decision contributes no field to any row;
 *   - a mapped target whose resolved field is a `relation` is DROPPED from the
 *     write (relationship-aware import is Epic 9) so no dangling reference lands.
 *
 * It never writes, never validates row values, and never emits DDL.
 */

/** A typed planner failure carrying the frozen matrix translation KEY. */
export class CommitPlanError extends Error {
  readonly key:
    | "Import.error.unresolvedColumns"
    | "Import.error.schemaChanged";
  constructor(
    key: "Import.error.unresolvedColumns" | "Import.error.schemaChanged",
  ) {
    super(key);
    this.name = "CommitPlanError";
    this.key = key;
  }
}

/** The planned insert for one logical table: its stored key + the row payloads. */
export type PlannedTable = {
  tableKey: string;
  rows: Array<Record<string, unknown>>;
};

export type CommitPlan = {
  /** One entry per distinct target table, each with its mapped row payloads. */
  tables: PlannedTable[];
  /** The distinct target table keys touched by this commit (soft-delete scope). */
  affectedTables: string[];
};

/**
 * A resolved mapped target: the canonical stored `{table, field}` keys plus the
 * source column that feeds it and the resolved field type (so relation targets
 * can be dropped). Built once per confirmed `map` decision.
 */
type ResolvedTarget = {
  sourceColumn: string;
  tableKey: string;
  fieldKey: string;
  fieldType: string;
};

/**
 * Build a lookup of the real, non-hidden `{table, field}` targets from the schema,
 * keyed by `normalizeTableName(table)::normalizeTableName(field)` (matching the
 * 4.2 sanitizer's index), so a decision's stored keys resolve to the canonical
 * keys + the field type — or do not resolve at all (schema drift).
 */
function buildTargetIndex(
  schema: SchemaDefinition,
): Map<string, { table: string; field: string; type: string }> {
  const index = new Map<string, { table: string; field: string; type: string }>();
  for (const table of schema.tables ?? []) {
    if (table.hidden) continue;
    const tableKey = normalizeTableName(table.key);
    for (const field of table.fields ?? []) {
      if (field.hidden) continue;
      const fieldKey = normalizeTableName(field.key);
      index.set(`${tableKey}::${fieldKey}`, {
        table: table.key,
        field: field.key,
        type: field.type,
      });
    }
  }
  return index;
}

/**
 * Plan the commit from the confirmed decisions and the freshly-parsed rows.
 *
 * Iterates the confirmed `map` decisions, resolves each `{table, field}` against a
 * fresh schema read, drops `skip` + relation targets, groups the surviving mapped
 * columns by target table, then projects every source row into one payload per
 * distinct table (carrying only that table's mapped fields). Throws a typed
 * `CommitPlanError` on any `unresolved` decision or schema drift.
 *
 * Row values are carried through verbatim as the parsed string cell values — this
 * story does not coerce or validate value types (deferred with the record-write
 * validator). A table whose every mapped field ends up dropped (all relation
 * targets) yields no planned rows and does not appear in `affectedTables`.
 */
export function planCommit(
  rows: Array<Record<string, string>>,
  decisions: DecisionMap,
  schema: SchemaDefinition,
): CommitPlan {
  const targetIndex = buildTargetIndex(schema);

  const resolved: ResolvedTarget[] = [];
  for (const [sourceColumn, decision] of Object.entries(decisions)) {
    if (decision.kind === "unresolved") {
      // A flagged column reached commit without an explicit map/skip — the route's
      // gate should have blocked this, but re-reject authoritatively (no write).
      throw new CommitPlanError("Import.error.unresolvedColumns");
    }
    if (decision.kind === "skip") {
      continue;
    }
    // decision.kind === "map": resolve against the live, non-hidden schema.
    const match = targetIndex.get(
      `${normalizeTableName(decision.table)}::${normalizeTableName(decision.field)}`,
    );
    if (!match) {
      // The mapped target no longer resolves to a real non-hidden field — schema
      // drift since the proposal. Reject; never silently write.
      throw new CommitPlanError("Import.error.schemaChanged");
    }
    // Relation targets are dropped (relationship-aware import is Epic 9): storing
    // a raw source value would create a dangling reference. Other columns still
    // import — this column simply contributes no field.
    if (match.type === "relation") {
      continue;
    }
    resolved.push({
      sourceColumn,
      tableKey: match.table,
      fieldKey: match.field,
      fieldType: match.type,
    });
  }

  // Group the surviving mapped columns by their target table, preserving first-seen
  // table order for a stable per-table summary.
  const byTable = new Map<string, ResolvedTarget[]>();
  for (const target of resolved) {
    let list = byTable.get(target.tableKey);
    if (!list) {
      list = [];
      byTable.set(target.tableKey, list);
    }
    list.push(target);
  }

  const tables: PlannedTable[] = [];
  for (const [tableKey, targets] of byTable) {
    const tableRows = rows.map((row) => {
      const payload: Record<string, unknown> = {};
      for (const { sourceColumn, fieldKey } of targets) {
        payload[fieldKey] = row[sourceColumn] ?? "";
      }
      return payload;
    });
    tables.push({ tableKey, rows: tableRows });
  }

  return {
    tables,
    affectedTables: tables.map((t) => t.tableKey),
  };
}
