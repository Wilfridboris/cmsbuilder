import type { SchemaDefinition, SelectOption } from "@/types/db";
import type { DecisionMap } from "@/lib/import/resolve";
import { matchSelectValue } from "@/lib/forms/select-input";
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
    | "Import.error.schemaChanged"
    | "Import.error.selectValueInvalid";
  /**
   * Human-readable interpolation values for `selectValueInvalid` (the field label
   * and the distinct unmatched source values), so the route can surface WHICH
   * field and WHICH values failed. Absent on the other, parameter-free keys.
   */
  readonly params?: { field: string; values: string };
  constructor(
    key:
      | "Import.error.unresolvedColumns"
      | "Import.error.schemaChanged"
      | "Import.error.selectValueInvalid",
    params?: { field: string; values: string },
  ) {
    super(key);
    this.name = "CommitPlanError";
    this.key = key;
    this.params = params;
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
  /** The target field's options, carried for `select` targets (Story 13.6). */
  fieldLabel: string;
  options?: SelectOption[];
};

/** Boolean spreadsheet tokens (en + fr), matched case-insensitively after trim. */
const BOOLEAN_TRUE = new Set(["true", "1", "yes", "y", "oui", "o"]);
const BOOLEAN_FALSE = new Set(["false", "0", "no", "n", "non"]);

/**
 * The result of coercing one raw imported cell to its target field type:
 *  - `omit`  → the cell is blank; the field is dropped from that row's payload;
 *  - `value` → the coerced value to write.
 */
export type ImportCoercion = { kind: "omit" } | { kind: "value"; value: unknown };

/**
 * Coerce one raw imported cell to match how the ADD form stores the same field
 * type (`src/lib/forms/field-input.ts`), so imported rows and hand-entered rows
 * share one storage shape and the Epic-3 filter/sort + typed rendering behave the
 * same for both. Parsed cells arrive as strings (`parse.ts` stringifies every
 * value, coercing Excel dates to ISO), so:
 *
 *   - blank (after trim) → `omit` (the add form omits blank; no `required` flag);
 *   - `number` / `currency` → a finite `Number`; a non-numeric cell is PRESERVED
 *     as its trimmed string rather than dropped or failing the whole import
 *     (5,000-row commits must not die on one stray "N/A") — visible, not silent;
 *   - `boolean` → a real boolean for recognized en/fr tokens, else the preserved
 *     trimmed string;
 *   - `date` / `datetime` / `text` / `email` / `phone` (and any relation, though
 *     relation targets are dropped upstream) → the trimmed string, exactly as the
 *     add form stores a date/text input.
 *
 * Pure and total: it never throws and never validates beyond the numeric parse.
 */
export function coerceImportValue(type: string, raw: unknown): ImportCoercion {
  const trimmed =
    typeof raw === "string"
      ? raw.trim()
      : raw === null || raw === undefined
        ? ""
        : String(raw).trim();
  if (trimmed === "") {
    return { kind: "omit" };
  }

  if (type === "number" || type === "currency") {
    const parsed = Number(trimmed);
    // `Number.isFinite` rejects NaN AND Infinity (e.g. "1e999"), matching the add
    // form. A non-numeric cell is kept as text so no data is silently lost.
    if (Number.isFinite(parsed)) {
      return { kind: "value", value: parsed };
    }
    return { kind: "value", value: trimmed };
  }

  if (type === "boolean") {
    const lower = trimmed.toLowerCase();
    if (BOOLEAN_TRUE.has(lower)) return { kind: "value", value: true };
    if (BOOLEAN_FALSE.has(lower)) return { kind: "value", value: false };
    return { kind: "value", value: trimmed };
  }

  // text, email, phone, date, datetime (dates already ISO strings from parse.ts).
  return { kind: "value", value: trimmed };
}

/**
 * Build a lookup of the real, non-hidden `{table, field}` targets from the schema,
 * keyed by `normalizeTableName(table)::normalizeTableName(field)` (matching the
 * 4.2 sanitizer's index), so a decision's stored keys resolve to the canonical
 * keys + the field type — or do not resolve at all (schema drift).
 */
function buildTargetIndex(
  schema: SchemaDefinition,
): Map<
  string,
  {
    table: string;
    field: string;
    type: string;
    label: string;
    options?: SelectOption[];
  }
> {
  const index = new Map<
    string,
    {
      table: string;
      field: string;
      type: string;
      label: string;
      options?: SelectOption[];
    }
  >();
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
        label: field.label,
        options: field.options,
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
 * Row values are coerced per target field type via `coerceImportValue` so imported
 * rows share the storage shape of hand-entered rows (numbers/currency → number,
 * boolean tokens → boolean, dates/text → trimmed string, blank → omitted). A table
 * whose every mapped field ends up dropped (all relation targets) yields no planned
 * rows and does not appear in `affectedTables`.
 *
 * A `select` target is validated instead of coerced (Story 13.6): every non-blank
 * cell must match one of the field's NON-archived options (by `value` token, then
 * case-insensitively by `label`) via the shared `matchSelectValue`; a matched cell
 * stores the canonical `value`, a blank is omitted, and ANY unmatched non-blank
 * value throws `selectValueInvalid` naming the field + the distinct bad values so
 * NOTHING is written (zero invalid/archived tokens, zero partial write).
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
      fieldLabel: match.label,
      options: match.options,
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

  // Collect every unmatched select cell across all rows BEFORE throwing, so the
  // rejection names the field and the distinct bad values in one pass (Story 13.6).
  // Keyed by field label → the ordered-unique set of its unmatched raw values.
  const invalidSelect = new Map<string, Set<string>>();

  const tables: PlannedTable[] = [];
  for (const [tableKey, targets] of byTable) {
    const tableRows = rows.map((row) => {
      const payload: Record<string, unknown> = {};
      for (const {
        sourceColumn,
        fieldKey,
        fieldType,
        fieldLabel,
        options,
      } of targets) {
        if (fieldType === "select") {
          // A select cell must resolve to one of the field's NON-archived option
          // tokens/labels via the shared matcher: blank → omit, a match → write
          // the canonical `value`, anything else → collect for the typed throw.
          const match = matchSelectValue(options, row[sourceColumn] ?? "");
          if (match.kind === "ok") {
            payload[fieldKey] = match.value;
          } else if (match.kind === "invalid") {
            let set = invalidSelect.get(fieldLabel);
            if (!set) {
              set = new Set<string>();
              invalidSelect.set(fieldLabel, set);
            }
            set.add((row[sourceColumn] ?? "").trim());
          }
          // `omit` → left out of the payload.
          continue;
        }
        // Coerce each non-select cell to its target field type so imported values
        // match hand-entered ones (a blank cell is omitted, not written as "").
        const coerced = coerceImportValue(fieldType, row[sourceColumn]);
        if (coerced.kind === "value") {
          payload[fieldKey] = coerced.value;
        }
      }
      return payload;
    });
    tables.push({ tableKey, rows: tableRows });
  }

  // Any unmatched select cell rejects the WHOLE commit (nothing is written): the
  // Admin fixes the source values or skips/remaps the column, then re-imports.
  if (invalidSelect.size > 0) {
    const [field, values] = [...invalidSelect.entries()][0];
    throw new CommitPlanError("Import.error.selectValueInvalid", {
      field,
      values: [...values].join(", "),
    });
  }

  return {
    tables,
    affectedTables: tables.map((t) => t.tableKey),
  };
}
