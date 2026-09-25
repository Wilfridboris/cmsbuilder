/**
 * Pure, immutable schema-override transforms (Story 1.7).
 *
 * The anonymous demo dashboard lets a visitor Rename or Remove a generated
 * table/field. These transforms are the single, tested source of that override
 * logic: each returns a NEW `SchemaDefinition` (input never mutated) so the
 * dashboard can drive them through `setSchema` exactly as Story 1.6 drives its
 * record edits through `setRecords`.
 *
 * Semantics (mirrors the epic's "frontend display flag" framing):
 * - Rename edits only `label`, never `key` (the persisted identity).
 * - Remove sets the append-only `hidden` flag — no destructive migration, the
 *   definition and any `records.data` are preserved and simply drop out of the
 *   existing `!hidden` render filters.
 *
 * Framework-agnostic (no React / next-intl imports) so it unit-tests in the
 * node env, and reusable by Epic 2 (carry overrides into the live schema at
 * claim) and Story 3.5 (column hide).
 */

import type { SchemaDefinition, TableDefinition } from "@/types/db";

/** The tables the dashboard should render — hidden ones dropped. */
export function visibleTables(schema: SchemaDefinition): TableDefinition[] {
  return schema.tables.filter((table) => !table.hidden);
}

/**
 * Whether a table may still be hidden. Guards the frozen "never leave the
 * dashboard empty" rule: a table can be removed only while more than one table
 * is still visible.
 */
export function canHideTable(schema: SchemaDefinition): boolean {
  return visibleTables(schema).length > 1;
}

/** Rename a table's `label` (never its `key`). No-op if the key is absent. */
export function renameTable(
  schema: SchemaDefinition,
  tableKey: string,
  label: string,
): SchemaDefinition {
  return {
    ...schema,
    tables: schema.tables.map((table) =>
      table.key === tableKey ? { ...table, label } : table,
    ),
  };
}

/** Rename a field's `label` within a table (never its `key`). */
export function renameField(
  schema: SchemaDefinition,
  tableKey: string,
  fieldKey: string,
  label: string,
): SchemaDefinition {
  return {
    ...schema,
    tables: schema.tables.map((table) =>
      table.key === tableKey
        ? {
            ...table,
            fields: table.fields.map((field) =>
              field.key === fieldKey ? { ...field, label } : field,
            ),
          }
        : table,
    ),
  };
}

/**
 * Hide a table (append-only `hidden: true`). Refuses to hide the last visible
 * table (returns the schema unchanged) so the dashboard never empties — callers
 * should gate the affordance with `canHideTable` and rely on this as a backstop.
 */
export function hideTable(
  schema: SchemaDefinition,
  tableKey: string,
): SchemaDefinition {
  if (!canHideTable(schema)) {
    return schema;
  }
  return {
    ...schema,
    tables: schema.tables.map((table) =>
      table.key === tableKey ? { ...table, hidden: true } : table,
    ),
  };
}

/** Hide a field within a table (append-only `hidden: true`). */
export function hideField(
  schema: SchemaDefinition,
  tableKey: string,
  fieldKey: string,
): SchemaDefinition {
  return {
    ...schema,
    tables: schema.tables.map((table) =>
      table.key === tableKey
        ? {
            ...table,
            fields: table.fields.map((field) =>
              field.key === fieldKey ? { ...field, hidden: true } : field,
            ),
          }
        : table,
    ),
  };
}
