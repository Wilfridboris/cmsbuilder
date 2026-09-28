import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { ImportProposal } from "@/types/import";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { resolveOrgIdentity, json, handleError } from "@/lib/api/route-helpers";
import { parseSpreadsheet, ParseError, SAMPLE_ROW_CAP } from "@/lib/import/parse";
import { getSchema } from "@/lib/data/records";
import { defaultLocale, isLocale, LOCALE_COOKIE } from "@/lib/i18n/config";
import { callGeminiWithTimeout } from "@/lib/gemini/client";
import {
  buildMappingPrompt,
  MAPPING_RESPONSE_SCHEMA,
  sanitizeProposal,
  type RawMappingOutput,
} from "@/lib/import/mapping";
import { reportError } from "@/lib/observability/report";
import { analyzeInputSchema } from "../schemas";

/**
 * `POST /api/import/propose` — Story 4.2 AI-proposed column mapping (analyze phase
 * ONLY, shown before any write).
 *
 * The second read-only step of import: an Admin's uploaded spreadsheet is re-parsed
 * strictly server-side, the org's existing schema is READ (never modified), and
 * Gemini proposes a source-column → existing-target-field mapping with a per-column
 * confidence and one-line reason. Every proposed target is validated against the
 * real non-hidden schema — a hallucinated table/field is downgraded to `null` and
 * flagged — and low-confidence / unmatched columns are surfaced in `unmapped`.
 *
 * Two-phase invariant: this writes NOTHING to `records`, `org_schemas`, or any
 * tenant table. It only READS the schema via `getSchema` under the RLS-scoped
 * client. Editing/resolving (4.3) and commit (4.4) build on this; 4.2 is stateless
 * (re-parse per call, no fileId) and never persists the file or the proposal.
 *
 * Auth mirrors analyze exactly: `getCurrentUser()` → 401; `resolveOrgIdentity`
 * (non-member → 403) resolves the RLS-scoped client + orgId; `requireAdmin` (a
 * Member → 403); and a `membership.slug === slug` check (cross-org Admin → 403) —
 * ALL before any parse or AI work. The service-role client is used ONLY for the
 * narrow membership read inside `requireAdmin`, never for tenant data.
 *
 * On a Gemini mapping failure (timeout or unparseable output) after ONE retry, the
 * route throws `AppError` carrying `Import.error.mappingUnavailable`; the UI shows
 * an "auto-mapping unavailable" state with a Retry and still lets the Admin
 * continue to manual mapping (4.3). Nothing is written and no column is silently
 * guessed. Raw LLM output, stacks, SQL, and schema JSON never leak.
 */

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<ImportProposal>>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    // The addressed org travels as a `slug` form field alongside the file.
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

    // Auth chain (mirror analyze): resolve the org UNDER RLS (non-member → 403),
    // re-enforce Admin authoritatively (a Member → 403), and reject a cross-org
    // Admin whose most-recent membership isn't this slug. All BEFORE any parse/AI.
    const { client, orgId } = await resolveOrgIdentity(slug.trim(), user.id);
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
      const key = parsed.error.issues[0]?.message ?? "Import.error.unreadable";
      throw errorForKey(key);
    }

    const file = parsed.data.file as File;
    const chosenSheet = parsed.data.sheet;

    // Re-parse the bytes SERVER-SIDE — client-parsed columns/rows are never trusted.
    const buffer = Buffer.from(await file.arrayBuffer());

    let result;
    try {
      result = parseSpreadsheet(buffer, file.name, chosenSheet);
    } catch (err) {
      if (err instanceof ParseError) {
        throw errorForKey(err.key);
      }
      throw new AppError(400, "Import.error.unreadable");
    }

    // A multi-sheet workbook with no chosen sheet cannot be mapped yet — mirror
    // analyze's picker contract by surfacing the same unreadable retryable error
    // (the client re-analyzes with a chosen sheet before proposing).
    if (result.sheetNames) {
      throw new AppError(400, "Import.error.unreadable");
    }

    // READ the org's existing schema under the RLS-scoped client (never the
    // service-role client, never a write). An empty schema is valid: all columns
    // will resolve to `target: null` and be flagged unmapped.
    const schemaResult = await getSchema(client, orgId);
    if (schemaResult.error || !schemaResult.data) {
      throw new AppError(500, "genericError", schemaResult.error ?? "no schema");
    }
    const schema = schemaResult.data;

    // Resolve the request locale from the NEXT_LOCALE cookie exactly as
    // `request.ts` does (isLocale else defaultLocale) so the model writes each
    // `reason` in the user's language. This is the only propose change; the
    // envelope, auth chain, sanitizer, and retry contract are unchanged.
    const cookieStore = await cookies();
    const cookieLocale = cookieStore.get?.(LOCALE_COOKIE)?.value;
    const locale = isLocale(cookieLocale) ? cookieLocale : defaultLocale;

    // Build the mapping prompt from the bounded columns + sample rows, then call
    // Gemini through the shared hardened client, retrying EXACTLY once on failure.
    const prompt = buildMappingPrompt(
      result.columns,
      result.rows.slice(0, SAMPLE_ROW_CAP),
      schema,
      locale,
    );

    let rawOutput: RawMappingOutput;
    try {
      rawOutput = await callGeminiWithTimeout<RawMappingOutput>(
        prompt,
        MAPPING_RESPONSE_SCHEMA,
      );
    } catch (firstErr) {
      reportError(firstErr, { route: "/api/import/propose", attempt: 1 });
      try {
        rawOutput = await callGeminiWithTimeout<RawMappingOutput>(
          prompt,
          MAPPING_RESPONSE_SCHEMA,
        );
      } catch (secondErr) {
        reportError(secondErr, { route: "/api/import/propose", attempt: 2 });
        // Auto-mapping unavailable after retry-once: an explicit translated error
        // with a Retry. Nothing is written; no column is silently guessed. The UI
        // still lets the Admin continue to manual mapping (4.3).
        throw new AppError(502, "Import.error.mappingUnavailable");
      }
    }

    // The sanitizer is the trust boundary: it downgrades any hallucinated target
    // to null, clamps confidence, flags unmapped, and guarantees one entry per
    // source column. No hallucination reaches the client as a real mapping.
    const proposal = sanitizeProposal(
      rawOutput,
      schema,
      result.columns,
      result.rows.length,
    );

    return json<ImportProposal>({ data: proposal, error: null }, 200);
  } catch (err) {
    return handleError<ImportProposal>(err, "/api/import/propose");
  }
}

/**
 * Map a frozen matrix translation KEY to an `AppError` with the matrix status.
 * Mirrors analyze so file/parse failures resolve to the same translated keys.
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
