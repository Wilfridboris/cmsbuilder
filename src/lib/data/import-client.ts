import type { ApiResponse } from "@/types/api";
import type { CommitResult, ImportProposal } from "@/types/import";
import type { DecisionMap } from "@/lib/import/resolve";

/**
 * Client-side fetch wrapper for the Import analyze route (Story 4.1). Mirrors
 * `records-client.ts`: it posts the file (plus the org slug and an optional chosen
 * sheet) as multipart form data, parses the `{ data, error }` envelope, and on
 * failure throws an `ImportApiError` carrying the server's translated error CODE
 * (a frozen `Import.error.*` key). The UI catches this and resolves the code to a
 * translated message — a raw error, stack, or SQL never reaches here.
 *
 * The response is a discriminated union: a multi-sheet workbook returns a
 * sheet-selection payload (the client shows a picker and re-posts with `sheet`);
 * everything else returns the column + sample-row preview.
 */

/** Carries the server error code so the UI can resolve a translated message. */
export class ImportApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "ImportApiError";
    this.code = code;
  }
}

/** The multi-sheet "pick a sheet" response — no preview yet. */
export type SheetSelection = {
  sheetNames: string[];
  needsSheetSelection: true;
};

/** The column + sample-row preview for a parsed sheet. */
export type ImportPreview = {
  columns: string[];
  rowCount: number;
  sampleRows: Array<Record<string, string>>;
  sheetName: string;
};

export type AnalyzeResult = SheetSelection | ImportPreview;

/** Narrow an `AnalyzeResult` to the sheet-selection branch. */
export function needsSheetSelection(
  result: AnalyzeResult,
): result is SheetSelection {
  return (result as SheetSelection).needsSheetSelection === true;
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new ImportApiError("genericError");
  }
  if (!res.ok || body.error !== null || body.data === null) {
    throw new ImportApiError(body.error ?? "genericError");
  }
  return body.data;
}

/**
 * POST a spreadsheet to `/api/import/analyze` for the given org. Pass a `sheet`
 * name to parse a specific sheet of a multi-sheet workbook (after the picker).
 * Returns either the preview or the sheet-selection payload, or throws
 * `ImportApiError(code)` on any failure.
 */
export async function analyzeSpreadsheet(
  slug: string,
  file: File,
  sheet?: string,
): Promise<AnalyzeResult> {
  const form = new FormData();
  form.set("slug", slug);
  form.set("file", file);
  if (sheet !== undefined) {
    form.set("sheet", sheet);
  }

  const res = await fetch("/api/import/analyze", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
  });
  return parseEnvelope<AnalyzeResult>(res);
}

/**
 * POST a spreadsheet to `/api/import/propose` (Story 4.2) for the given org, to get
 * the AI-proposed column mapping. Pass the same `sheet` the preview resolved to so
 * a multi-sheet workbook is re-parsed for the chosen sheet. Returns the read-only
 * `ImportProposal`, or throws `ImportApiError(code)` on any failure — including
 * `Import.error.mappingUnavailable` when auto-mapping is unavailable after retry.
 * Nothing is written server-side; this is an analyze-phase call.
 */
export async function proposeMapping(
  slug: string,
  file: File,
  sheet?: string,
): Promise<ImportProposal> {
  const form = new FormData();
  form.set("slug", slug);
  form.set("file", file);
  if (sheet !== undefined) {
    form.set("sheet", sheet);
  }

  const res = await fetch("/api/import/propose", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
  });
  return parseEnvelope<ImportProposal>(res);
}

/**
 * POST the confirmed import to `/api/import/commit` (Story 4.4) — the ONLY write
 * call. Re-sends the same `file` (plus slug and optional `sheet`) so the route
 * re-parses server-side, the confirmed `decisions` as a JSON string, and the
 * client's stable `importId` (regenerated only on a fresh import, reused on every
 * Retry) so a retried commit dedupes to the same logical rows. Returns the
 * `CommitResult` per-table summary, or throws `ImportApiError(code)` on any failure
 * (a frozen `Import.error.*` key) — including `Import.error.commitFailed`, which the
 * UI surfaces with a Retry. Nothing but this call writes tenant data.
 */
export async function commitImport(
  slug: string,
  file: File,
  decisions: DecisionMap,
  importId: string,
  sheet?: string,
): Promise<CommitResult> {
  const form = new FormData();
  form.set("slug", slug);
  form.set("file", file);
  form.set("decisions", JSON.stringify(decisions));
  form.set("import_id", importId);
  if (sheet !== undefined) {
    form.set("sheet", sheet);
  }

  const res = await fetch("/api/import/commit", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
  });
  return parseEnvelope<CommitResult>(res);
}
