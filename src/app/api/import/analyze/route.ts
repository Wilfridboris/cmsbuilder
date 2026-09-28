import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { resolveOrgIdentity, json, handleError } from "@/lib/api/route-helpers";
import { parseSpreadsheet, ParseError, SAMPLE_ROW_CAP } from "@/lib/import/parse";
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
 * Auth mirrors the records routes: `getCurrentUser()` (JWT-validated) → 401 if
 * none; `resolveOrgIdentity(slug, actorId)` resolves the org UNDER RLS (a
 * non-member sees no row → 403); `requireAdmin` then re-checks the role
 * authoritatively (a Member of the org → 403). A cross-org Admin (role admin but a
 * different slug) is likewise 403.
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
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    // The addressed org travels as a `slug` form field alongside the file, so the
    // whole request is a single multipart POST (no query string on an upload).
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError(400, "genericError");
    }

    const slug = form.get("slug");
    if (typeof slug !== "string" || slug.trim() === "") {
      throw new AppError(400, "genericError");
    }

    // Resolve the org UNDER RLS (non-member → 403), then re-enforce Admin
    // authoritatively from org_members (a Member → 403). The RLS resolution is
    // the membership gate; `requireAdmin` is the role gate. A cross-org Admin
    // whose most-recent membership isn't this slug is also rejected.
    await resolveOrgIdentity(slug.trim(), user.id);
    const membership = await requireAdmin(user, createAdminClient());
    if (membership.slug !== slug.trim()) {
      throw new AppError(403, "forbidden");
    }

    const sheetRaw = form.get("sheet");
    const parsed = analyzeInputSchema.safeParse({
      file: form.get("file"),
      sheet: typeof sheetRaw === "string" ? sheetRaw : undefined,
    });
    if (!parsed.success) {
      // Map the first refinement message (a frozen matrix KEY) to its status.
      const key = parsed.error.issues[0]?.message ?? "Import.error.unreadable";
      throw errorForKey(key);
    }

    const file = parsed.data.file as File;
    const chosenSheet = parsed.data.sheet;

    // Read the bytes SERVER-SIDE and parse there — client rows are never trusted.
    const buffer = Buffer.from(await file.arrayBuffer());

    let result;
    try {
      result = parseSpreadsheet(buffer, file.name, chosenSheet);
    } catch (err) {
      if (err instanceof ParseError) {
        throw errorForKey(err.key);
      }
      // A parser that throws something else is masked as unreadable (never leak).
      throw new AppError(400, "Import.error.unreadable");
    }

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

/**
 * Map a frozen matrix translation KEY to an `AppError` with the matrix status.
 * Keeps status selection in one place so the route body reads as intent.
 */
function errorForKey(key: string): AppError {
  switch (key) {
    case "Import.error.tooLarge":
      return new AppError(413, "Import.error.tooLarge");
    case "Import.error.empty":
      return new AppError(400, "Import.error.empty");
    case "Import.error.noFile":
      return new AppError(400, "Import.error.noFile");
    case "Import.error.unreadable":
    default:
      return new AppError(400, "Import.error.unreadable");
  }
}
