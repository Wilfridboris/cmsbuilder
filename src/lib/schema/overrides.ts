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

import type {
  FieldDefinition,
  SchemaDefinition,
  TableDefinition,
  ViewDefinition,
} from "@/types/db";

/** The tables the dashboard should render — hidden ones dropped. */
export function visibleTables(schema: SchemaDefinition): TableDefinition[] {
  return schema.tables.filter((table) => !table.hidden);
}

/**
 * The views the dashboard should render as sibling tabs (Story 5.3) — hidden ones
 * dropped. A schema with no `views` yields an empty array (backward-compatible).
 */
export function visibleViews(schema: SchemaDefinition): ViewDefinition[] {
  return (schema.views ?? []).filter((view) => !view.hidden);
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

/**
 * Unhide a field within a table (flips the append-only flag back to
 * `hidden: false`). The inverse of `hideField` and the second half of Story
 * 3.5's Admin column show/hide: unhiding is fully reversible — the field
 * definition and every stored value are preserved, so the column simply
 * reappears through the existing `!hidden` render filters. No-op for an unknown
 * table/field. Pure and immutable (the input schema is never mutated).
 */
export function showField(
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
              field.key === fieldKey ? { ...field, hidden: false } : field,
            ),
          }
        : table,
    ),
  };
}

/**
 * Append a (validated) relation field to a table's `fields` (Story 3.7). Pure and
 * immutable — returns a NEW `SchemaDefinition` with a NEW `fields` array for the
 * target table; the input schema and every other table are never mutated. No-op
 * for an unknown table key (returns an equivalent new schema). Callers MUST pass
 * a field already sanitized by `validateRelationField` — this transform does no
 * validation of its own (mirrors `hideField`/`showField`).
 */
export function addRelationField(
  schema: SchemaDefinition,
  tableKey: string,
  field: FieldDefinition,
): SchemaDefinition {
  return {
    ...schema,
    tables: schema.tables.map((table) =>
      table.key === tableKey
        ? { ...table, fields: [...table.fields, field] }
        : table,
    ),
  };
}

/**
 * Append a (validated) scalar field to a table's `fields` (Story 5.1 — add a
 * column via chat). Pure and immutable — returns a NEW `SchemaDefinition` with a
 * NEW `fields` array for the target table; the input schema and every other table
 * are never mutated. No-op for an unknown table key (returns an equivalent new
 * schema). Callers MUST pass a field already sanitized by `validateAddField` —
 * this transform does no validation of its own (mirrors `addRelationField`). It is
 * a thin, deliberately separate alias so the add-column intent reads clearly at
 * the call site even though the append shape matches `addRelationField`.
 */
export function addField(
  schema: SchemaDefinition,
  tableKey: string,
  field: FieldDefinition,
): SchemaDefinition {
  return addRelationField(schema, tableKey, field);
}

/**
 * Append a (validated) new table to the schema's `tables` (Story 5.2 — add a table
 * via chat). Pure and immutable — returns a NEW `SchemaDefinition` with a NEW
 * `tables` array (the new table appended last); the input schema and every existing
 * table are never mutated, so existing tables and all `records` rows are untouched.
 * Callers MUST pass a table already sanitized/disambiguated by `validateAddTable` —
 * this transform does no validation of its own (mirrors `addField`/`addRelationField`).
 */
export function addTable(
  schema: SchemaDefinition,
  table: TableDefinition,
): SchemaDefinition {
  return {
    ...schema,
    tables: [...schema.tables, table],
  };
}

/**
 * Append a (validated) new view to the schema's `views` (Story 5.3 — create a view
 * via chat). Pure and immutable — returns a NEW `SchemaDefinition` with a NEW
 * `views` array (the new view appended last); the input schema, every existing
 * view, and every table + `records` row are never mutated. A view is append-only
 * presentation metadata over an existing table — no row is copied or modified.
 * Callers MUST pass a view already sanitized/disambiguated by `validateAddView` —
 * this transform does no validation of its own (mirrors `addTable`/`addField`).
 */
export function addView(
  schema: SchemaDefinition,
  view: ViewDefinition,
): SchemaDefinition {
  return {
    ...schema,
    views: [...(schema.views ?? []), view],
  };
}
