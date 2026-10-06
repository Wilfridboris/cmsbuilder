import Papa from "papaparse";

import type { FieldDefinition, RecordData, TableDefinition } from "@/types/db";

/**
 * Pure, server-safe serializer for the "Download My Data" export (Story 8.4).
 *
 * Intentionally FRAMEWORK-FREE — no Next.js, no Supabase, no I/O. The route owns
 * HTTP/auth/the RLS-scoped reads and the pagination to completeness; this module
 * owns only "schema + records in -> JSON text + per-table CSV out," so it is
 * unit-testable against the I/O matrix with no HTTP harness.
 *
 * JSON is the complete, faithful representation: field `key`s are preserved and
 * every value is emitted EXACTLY as stored in `data` (a relation value stays the
 * raw stored target id — never resolved to a display label in this story). CSV is
 * the human-readable view: columns are ordered by the schema's `FieldDefinition`
 * order with an `id` column FIRST, and the header row uses each field's `label`.
 *
 * File-internal names (CSV header labels, JSON keys derived from the schema) are
 * DATA, not localized UI copy, so nothing here is translated.
 */

/** One serialized file in the bundle: its archive-relative name + text content. */
export type ExportFile = {
  name: string;
  content: string;
};

/** The complete JSON representation of one logical table. */
type JsonTable = {
  key: string;
  label: string;
  fields: FieldDefinition[];
  records: Array<{ id: string; data: Record<string, unknown> }>;
};

/** The complete JSON representation of the whole export. */
type ExportJson = {
  organizationSlug: string;
  exportedAt: string;
  tables: JsonTable[];
};

export type BuildExportInput = {
  /** The org's url slug (used in the JSON body + the archive filename upstream). */
  slug: string;
  /** ISO timestamp stamped into the JSON (server-authoritative, passed in). */
  exportedAt: string;
  /** Every logical table in schema order, including `hidden` ones. */
  tables: TableDefinition[];
  /** All live records per table, keyed by the table's `key`. */
  recordsByTable: Record<string, RecordData[]>;
};

export type BuildExportResult = {
  /** The complete, faithful JSON document as pretty-printed text. */
  jsonText: string;
  /** One CSV per logical table (schema order), each `{ name, content }`. */
  csvs: ExportFile[];
};

/**
 * UTF-8 byte-order mark prepended to every CSV. Without it, Excel on Windows
 * mis-decodes UTF-8 and corrupts accented French data (e.g. e-acute, a-grave,
 * c-cedilla). The app's own CSV importer strips a leading BOM on read, so the
 * exported CSVs still round-trip cleanly back through import.
 */
const UTF8_BOM = "﻿";

/**
 * Serialize one logical table to a CSV string. Columns are the field `key`s in
 * `FieldDefinition` order with a leading `id` column; the header row shows the
 * field `label`s (with `id` for the id column). Rows are built POSITIONALLY
 * (record id first, then each field value in schema order), so a field whose key
 * is literally `id` is emitted as its own column and can never overwrite the
 * record-id column. Each cell is the raw stored value; papaparse stringifies it
 * (a non-Date object via `toString()`, not JSON), keeping the CSV the
 * human-readable view while the JSON carries the faithful representation. A table
 * with zero records still produces a header-only CSV so the column shape is
 * self-documenting. The output is prefixed with a UTF-8 BOM for Excel.
 */
function tableToCsv(table: TableDefinition, records: RecordData[]): string {
  const fields = table.fields ?? [];
  // Header row uses labels; the leading id column keeps the literal "id".
  const header = ["id", ...fields.map((f) => f.label)];

  // Positional rows: record id first, then each field value in schema order.
  // Building by position (not an object keyed by field key) means a field keyed
  // "id" becomes its own column rather than clobbering the record id.
  const data = records.map((record) => [
    record.id,
    ...fields.map((field) => {
      const value = record.data?.[field.key];
      // Preserve a missing key faithfully: an absent value becomes an empty cell.
      return value === undefined ? "" : value;
    }),
  ]);

  return (
    UTF8_BOM +
    Papa.unparse(
      { fields: header, data },
      // Keep CRLF off so the bytes are stable/diffable; papaparse quotes as needed.
      { newline: "\n" },
    )
  );
}

/**
 * Build the complete export payload from the org's schema + its fully-paginated
 * records. Returns the JSON text and one CSV per table. Handles a zero-table org
 * (empty `tables`, no CSVs) and zero-record tables (header-only CSV) cleanly.
 */
export function buildExport(input: BuildExportInput): BuildExportResult {
  const { slug, exportedAt, tables, recordsByTable } = input;

  const jsonTables: JsonTable[] = tables.map((table) => {
    const records = recordsByTable[table.key] ?? [];
    return {
      key: table.key,
      label: table.label,
      fields: table.fields ?? [],
      records: records.map((record) => ({ id: record.id, data: record.data })),
    };
  });

  const exportJson: ExportJson = {
    organizationSlug: slug,
    exportedAt,
    tables: jsonTables,
  };

  const csvs: ExportFile[] = tables.map((table) => ({
    name: `tables/${table.key}.csv`,
    content: tableToCsv(table, recordsByTable[table.key] ?? []),
  }));

  return {
    jsonText: JSON.stringify(exportJson, null, 2),
    csvs,
  };
}
