/**
 * Pure, immutable relation + display-field helpers (Story 1.8).
 *
 * The single, node-testable source of the relation/display logic reused by
 * provisioning (`provision.ts`) and the demo dashboard's read-time label
 * resolution (`DemoDashboard.tsx` / `RecordDetail.tsx`). No React / next-intl /
 * network imports, so it unit-tests in the node env (per the 1.3–1.7 precedent).
 *
 * A `relation` field stores the TARGET record's UUID in `records.data`, never
 * the label. The label always resolves at read time from the target table's
 * `displayField`, so renaming a target row never breaks a reference.
 */

import type {
  FieldDefinition,
  RecordData,
  SchemaDefinition,
  TableDefinition,
} from "@/types/db";

/**
 * The default `displayField` for a table: the first non-hidden `text` field,
 * else the first non-hidden field of any type, else `undefined` (no visible
 * field to represent the table). Used both to default an omitted `displayField`
 * at provisioning time and to fall back when a stored `displayField` names a
 * field that no longer resolves.
 */
export function displayFieldKey(table: TableDefinition): string | undefined {
  const visible = table.fields.filter((field) => !field.hidden);
  const firstText = visible.find((field) => field.type === "text");
  return (firstText ?? visible[0])?.key;
}

/**
 * The resolved `displayField` key for a table: prefers the explicitly stored
 * `displayField` when it names a non-hidden field, otherwise the default rule.
 */
export function resolvedDisplayFieldKey(
  table: TableDefinition,
): string | undefined {
  if (table.displayField) {
    const named = table.fields.find(
      (field) => field.key === table.displayField && !field.hidden,
    );
    if (named) {
      return named.key;
    }
  }
  return displayFieldKey(table);
}

/**
 * Order tables so that a referenced table is inserted BEFORE any table that
 * references it — a topological sort over the relation edges (referencing →
 * referenced), returned referenced-first. Self-references are ignored (a table
 * can seed against itself only via already-inserted rows). On a cycle (A→B→A)
 * the sort cannot fully order the involved tables, so it falls back to the
 * declared order for the remaining tables (cycles are legal by design; an
 * unresolved cross-ref inside a cycle simply drops that seed value later).
 */
export function orderTablesByRelations(
  tables: TableDefinition[],
): TableDefinition[] {
  const byKey = new Map(tables.map((table) => [table.key, table]));

  // Edges: table -> set of tables it references (its relation targets), minus
  // self-references and targets outside this batch.
  const dependencies = new Map<string, Set<string>>();
  for (const table of tables) {
    const targets = new Set<string>();
    for (const field of table.fields) {
      if (
        field.type === "relation" &&
        field.relationConfig &&
        field.relationConfig.targetTable !== table.key &&
        byKey.has(field.relationConfig.targetTable)
      ) {
        targets.add(field.relationConfig.targetTable);
      }
    }
    dependencies.set(table.key, targets);
  }

  const ordered: TableDefinition[] = [];
  const placed = new Set<string>();

  // Kahn-style: repeatedly place tables whose dependencies are all placed,
  // preserving declared order among ready tables. If a full pass places nothing
  // (a cycle), place the next unplaced table in declared order and continue.
  let progress = true;
  while (placed.size < tables.length) {
    progress = false;
    for (const table of tables) {
      if (placed.has(table.key)) continue;
      const deps = dependencies.get(table.key) ?? new Set<string>();
      const ready = [...deps].every((dep) => placed.has(dep));
      if (ready) {
        ordered.push(table);
        placed.add(table.key);
        progress = true;
      }
    }
    if (!progress) {
      // Cycle: break it by placing the first unplaced table in declared order.
      const next = tables.find((table) => !placed.has(table.key));
      if (!next) break;
      ordered.push(next);
      placed.add(next.key);
    }
  }

  return ordered;
}

/**
 * Rewrite a table's seed rows so each `relation` cell that references a target
 * row by its human-readable `displayField` VALUE is replaced with that target
 * row's inserted UUID. `insertedIdsByTable` maps a target table key to a map of
 * (trimmed display value → inserted id) built as referenced tables seed first.
 *
 * Matching is by trimmed string value, first match wins. A relation value that
 * resolves to no target row is DROPPED from that row (the row still writes) —
 * a malformed reference is never fatal, mirroring `filterSeedRows` tolerance.
 * Non-relation cells pass through untouched.
 */
export function resolveSeedRelationRefs(
  table: TableDefinition,
  rows: Array<Record<string, unknown>>,
  insertedIdsByTable: Map<string, Map<string, string>>,
): Array<Record<string, unknown>> {
  const relationFields = table.fields.filter(
    (field): field is FieldDefinition & {
      relationConfig: NonNullable<FieldDefinition["relationConfig"]>;
    } => field.type === "relation" && Boolean(field.relationConfig),
  );

  if (relationFields.length === 0) {
    return rows;
  }

  return rows.map((row) => {
    const next: Record<string, unknown> = { ...row };
    for (const field of relationFields) {
      const raw = next[field.key];
      if (raw === undefined || raw === null) {
        continue;
      }
      const targetMap = insertedIdsByTable.get(field.relationConfig.targetTable);
      const lookup = String(raw).trim();
      const resolvedId = targetMap?.get(lookup);
      if (resolvedId) {
        next[field.key] = resolvedId;
      } else {
        // Unresolved reference: drop the value, keep the rest of the row.
        delete next[field.key];
      }
    }
    return next;
  });
}

/**
 * Build a read-time relation-label resolver over the in-session records: given a
 * `relation` field and a stored value (a target UUID), return the target row's
 * `displayField` label, or `null` when the id does not resolve (unresolved →
 * the caller shows the empty placeholder).
 *
 * Builds a per-target `Map<id, label>` from the passed records. Tiny by design
 * (≤8 rows/table in session state); the batched server lookup for the account
 * dashboard is a separate Epic 3 concern.
 */
export function buildRelationResolver(
  schema: SchemaDefinition,
  records: Record<string, RecordData[]>,
): (field: FieldDefinition, value: unknown) => string | null {
  const tableByKey = new Map(schema.tables.map((table) => [table.key, table]));

  // Per-target: id → display label.
  const labelsByTable = new Map<string, Map<string, string>>();
  for (const table of schema.tables) {
    const displayKey = resolvedDisplayFieldKey(table);
    const rows = records[table.key] ?? [];
    const map = new Map<string, string>();
    for (const row of rows) {
      const label =
        displayKey !== undefined ? row.data[displayKey] : undefined;
      if (label !== undefined && label !== null && String(label).trim() !== "") {
        map.set(row.id, String(label));
      }
    }
    labelsByTable.set(table.key, map);
  }

  return (field, value) => {
    if (field.type !== "relation" || !field.relationConfig) {
      return null;
    }
    if (value === undefined || value === null || String(value).trim() === "") {
      return null;
    }
    const targetTable = tableByKey.get(field.relationConfig.targetTable);
    if (!targetTable) {
      return null;
    }
    const label = labelsByTable
      .get(field.relationConfig.targetTable)
      ?.get(String(value));
    return label ?? null;
  };
}
