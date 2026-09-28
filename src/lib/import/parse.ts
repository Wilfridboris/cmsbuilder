import Papa from "papaparse";
import * as XLSX from "xlsx";

/**
 * Pure spreadsheet parsing for the Import analyze phase (Story 4.1).
 *
 * `parseSpreadsheet(buffer, filename)` dispatches on the file extension: CSV via
 * papaparse (first row = headers) and `.xls`/`.xlsx` via SheetJS (`xlsx`). It is
 * intentionally FRAMEWORK-FREE — no Next.js, no Supabase, no I/O — so the route
 * owns HTTP/auth/limits and this module owns only "bytes in → structured columns
 * + rows out." That keeps it unit-testable against every edge-case matrix row
 * with no HTTP harness.
 *
 * The analyze phase is read-only: this returns a structural view of the file and
 * NEVER writes anywhere. It throws a typed `ParseError` carrying the matrix
 * translation KEY (`Import.error.*`) on empty / unreadable input so the route can
 * map it straight onto the `{ data, error }` envelope without leaking raw parser
 * output.
 */

/** Max sample data rows returned to the preview (frozen matrix: "up to 10"). */
export const SAMPLE_ROW_CAP = 10;

/** Extensions the analyze phase accepts. */
export type SpreadsheetExtension = "csv" | "xls" | "xlsx";

/**
 * The translation KEYs a parse failure can carry. These are the analyze-phase
 * subset of the frozen error matrix; the route maps them to an `AppError` status.
 */
export type ParseErrorKey = "Import.error.empty" | "Import.error.unreadable";

/**
 * A parse failure that carries a translation KEY (never raw copy / parser output).
 * The route collapses this into the `{ data, error }` envelope.
 */
export class ParseError extends Error {
  readonly key: ParseErrorKey;
  constructor(key: ParseErrorKey) {
    super(key);
    this.name = "ParseError";
    this.key = key;
  }
}

/**
 * The structural result of a single-sheet parse. `sheetNames` is present ONLY for
 * a multi-sheet Excel workbook where the caller has not yet chosen a sheet; in
 * that case `columns`/`rows` are empty and the caller must re-analyze with a
 * chosen sheet. For CSV and single-sheet / chosen-sheet Excel, `sheetNames` is
 * absent and the preview fields are populated.
 */
export type ParseResult = {
  /** Detected column names from the header row (in order). */
  columns: string[];
  /** All data rows (header excluded), each keyed by column name. */
  rows: Array<Record<string, string>>;
  /** The sheet that was parsed (the CSV filename stem, or the Excel sheet name). */
  sheetName: string;
  /** Only set when a multi-sheet workbook needs a sheet choice — signals "pick one". */
  sheetNames?: string[];
};

/** Lower-cased extension (no dot) of a filename, or `null` when there is none. */
function extensionOf(filename: string): string | null {
  const dot = filename.lastIndexOf(".");
  if (dot < 0 || dot === filename.length - 1) return null;
  return filename.slice(dot + 1).toLowerCase();
}

/** The CSV filename without its directory or extension — used as `sheetName`. */
function stemOf(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}

/**
 * Normalize a raw header cell to a trimmed string. Blank / duplicate headers are
 * disambiguated by the caller so every column has a distinct, non-empty key.
 */
function normalizeHeaders(rawHeaders: unknown[]): string[] {
  const seen = new Map<string, number>();
  return rawHeaders.map((raw, index) => {
    let name = typeof raw === "string" ? raw.trim() : String(raw ?? "").trim();
    if (name === "") {
      name = `Column ${index + 1}`;
    }
    // Disambiguate duplicates deterministically (papaparse/xlsx can hand us
    // repeated headers) so row objects don't silently collapse columns.
    const priorCount = seen.get(name) ?? 0;
    seen.set(name, priorCount + 1);
    if (priorCount > 0) {
      const deduped = `${name} (${priorCount + 1})`;
      seen.set(deduped, 1);
      return deduped;
    }
    return name;
  });
}

/** A cell value coerced to a display string; `null`/`undefined` → empty string. */
function cellToString(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

/** Build row objects from a header list + a matrix of data rows. */
function toRowObjects(
  columns: string[],
  matrix: unknown[][],
): Array<Record<string, string>> {
  return matrix.map((cells) => {
    const row: Record<string, string> = {};
    columns.forEach((col, i) => {
      row[col] = cellToString(cells[i]);
    });
    return row;
  });
}

/** True when a matrix row is entirely blank (all cells empty after trim). */
function isBlankRow(cells: unknown[]): boolean {
  return cells.every((c) => cellToString(c).trim() === "");
}

function parseCsv(buffer: Buffer, filename: string): ParseResult {
  const text = buffer.toString("utf8").replace(/^﻿/, "");
  const result = Papa.parse<string[]>(text, {
    skipEmptyLines: "greedy",
  });

  // papaparse tolerates row-level quirks (field-count warnings, ragged rows); we
  // don't inspect result.errors. The only rejection here is "nothing usable
  // parsed": a file with no non-blank rows is treated as empty (matrix "empty").
  const rows = (result.data as unknown[][]).filter(
    (r) => Array.isArray(r) && !isBlankRow(r),
  );
  if (rows.length === 0) {
    throw new ParseError("Import.error.empty");
  }

  const columns = normalizeHeaders(rows[0]);
  const dataRows = rows.slice(1);
  if (dataRows.length === 0) {
    // Header row present but no data rows — matrix "empty file" case.
    throw new ParseError("Import.error.empty");
  }

  return {
    columns,
    rows: toRowObjects(columns, dataRows),
    sheetName: stemOf(filename),
  };
}

function parseExcel(
  buffer: Buffer,
  chosenSheet: string | undefined,
): ParseResult {
  let workbook: XLSX.WorkBook;
  try {
    // cellDates so date-formatted cells arrive as JS Dates (coerced to ISO by
    // cellToString) instead of raw serial numbers like "44197" in the preview.
    workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
  } catch {
    throw new ParseError("Import.error.unreadable");
  }

  const sheetNames = workbook.SheetNames.filter((name) => name.length > 0);
  if (sheetNames.length === 0) {
    throw new ParseError("Import.error.empty");
  }

  // Multi-sheet workbook with no explicit choice → do NOT guess. Signal the
  // caller to present a sheet picker and re-analyze with a chosen sheet.
  if (sheetNames.length > 1 && chosenSheet === undefined) {
    return { columns: [], rows: [], sheetName: "", sheetNames };
  }

  const targetName =
    chosenSheet !== undefined ? chosenSheet : sheetNames[0];
  if (!sheetNames.includes(targetName)) {
    // A chosen sheet that isn't in the workbook is a bad request against this
    // file — treat as unreadable rather than silently falling back.
    throw new ParseError("Import.error.unreadable");
  }

  const sheet = workbook.Sheets[targetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    blankrows: false,
    defval: "",
  });

  const nonBlank = matrix.filter((r) => Array.isArray(r) && !isBlankRow(r));
  if (nonBlank.length === 0) {
    throw new ParseError("Import.error.empty");
  }

  const columns = normalizeHeaders(nonBlank[0]);
  const dataRows = nonBlank.slice(1);
  if (dataRows.length === 0) {
    throw new ParseError("Import.error.empty");
  }

  return {
    columns,
    rows: toRowObjects(columns, dataRows),
    sheetName: targetName,
  };
}

/**
 * Parse a spreadsheet buffer into a structural preview. Dispatches CSV vs Excel
 * on the filename extension.
 *
 * - CSV / single-sheet or chosen-sheet Excel → `{ columns, rows, sheetName }`.
 * - Multi-sheet Excel with no `chosenSheet` → `{ columns: [], rows: [], sheetName: "", sheetNames }`
 *   (the caller must present a picker and re-call with a chosen sheet).
 *
 * Throws `ParseError` (translation KEY) on empty / unreadable / unsupported input.
 */
export function parseSpreadsheet(
  buffer: Buffer,
  filename: string,
  chosenSheet?: string,
): ParseResult {
  if (buffer.length === 0) {
    throw new ParseError("Import.error.empty");
  }

  const ext = extensionOf(filename);
  if (ext === "csv") {
    return parseCsv(buffer, filename);
  }
  if (ext === "xls" || ext === "xlsx") {
    return parseExcel(buffer, chosenSheet);
  }
  // Any other extension reaching the pure parser is unreadable/unsupported. The
  // route's Zod guard already rejects non-spreadsheet extensions first.
  throw new ParseError("Import.error.unreadable");
}
