import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import type { ApiResponse } from "@/types/api";
import { json, handleError } from "@/lib/api/route-helpers";
import { SAMPLE_ROW_CAP } from "@/lib/import/parse";
import { resolveImportRequest, importErrorForKey, parseUpload } from "../_lib";
import { analyzeInputSchema } from "../schemas";

/**
 * `POST /api/import/analyze` — Story 4.1 upload & parse (analyze phase ONLY).
 *
 * This is the read-only first step of import: an Admin uploads a `.csv`/`.xls`/
 * `.xlsx`, it is parsed strictly server-side, and a preview of detected columns +
 * up to the first {@link SAMPLE_ROW_CAP} sample rows is returned. NOTHING is
 * written to `records`, `org_schemas`, or any tenant table (that is 4.2–4.4);
 * Gemini is never called; the service-role client is used ONLY for the narrow
 * membership read inside `requireAdmin`, never for tenant data.
 *
 * Auth + the server-side re-parse run through the shared `resolveImportRequest` /
 * `parseUpload` helpers (see `../_lib`): 401 with no session, 403 for a non-member /
 * Member / cross-org Admin, all before any parse.
 *
 * The multipart body carries a `file` and an optional `sheet` (which sheet of a
 * multi-sheet workbook to parse). A within-bounds single-sheet file returns the
 * preview directly; a multi-sheet workbook with no `sheet` chosen returns
 * `{ sheetNames, needsSheetSelection: true }` so the client can present a picker
 * and re-analyze. Every failure resolves to a translated error KEY via the
 * `{ data, error }` envelope — raw parser output, stacks, and SQL never leak.
 */

export const dynamic = "force-dynamic";

/** The multi-sheet "pick a sheet" payload (no preview yet). */
type SheetSelectionPayload = {
  sheetNames: string[];
  needsSheetSelection: true;
};

/** The column + sample-row preview payload for a parsed sheet. */
type PreviewPayload = {
  columns: string[];
  rowCount: number;
  sampleRows: Array<Record<string, string>>;
  sheetName: string;
};

type AnalyzePayload = SheetSelectionPayload | PreviewPayload;

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<AnalyzePayload>>> {
  try {
    // Auth + Admin gate + RLS identity (analyze only needs the membership gate; the
    // resolved client/identity is unused here since nothing is written or read).
    const { form } = await resolveImportRequest(req);

    const sheetRaw = form.get("sheet");
    const parsed = analyzeInputSchema.safeParse({
      file: form.get("file"),
      sheet: typeof sheetRaw === "string" ? sheetRaw : undefined,
    });
    if (!parsed.success) {
      // Map the first refinement message (a frozen matrix KEY) to its status.
      const key = parsed.error.issues[0]?.message ?? "Import.error.unreadable";
      throw importErrorForKey(key);
    }

    const file = parsed.data.file as File;
    const chosenSheet = parsed.data.sheet;

    const result = await parseUpload(file, chosenSheet);

    // Multi-sheet workbook, no sheet chosen yet → return the picker payload.
    if (result.sheetNames) {
      return json<AnalyzePayload>(
        {
          data: { sheetNames: result.sheetNames, needsSheetSelection: true },
          error: null,
        },
        200,
      );
    }

    // Single-sheet / chosen-sheet / CSV → the column + sample-row preview.
    return json<AnalyzePayload>(
      {
        data: {
          columns: result.columns,
          rowCount: result.rows.length,
          sampleRows: result.rows.slice(0, SAMPLE_ROW_CAP),
          sheetName: result.sheetName,
        },
        error: null,
      },
      200,
    );
  } catch (err) {
    return handleError<AnalyzePayload>(err, "/api/import/analyze");
  }
}
