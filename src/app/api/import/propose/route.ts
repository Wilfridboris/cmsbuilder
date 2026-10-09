import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { ImportProposal } from "@/types/import";
import { json, handleError } from "@/lib/api/route-helpers";
import { SAMPLE_ROW_CAP } from "@/lib/import/parse";
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
import { resolveImportRequest, importErrorForKey, parseUpload } from "../_lib";
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
 * Auth + the server-side re-parse run through the shared `resolveImportRequest` /
 * `parseUpload` helpers (see `../_lib`): 401 with no session, 403 for a non-member /
 * Member / cross-org Admin, all before any parse or AI work. The service-role client
 * is used ONLY for the narrow membership read inside `requireAdmin`.
 *
 * On a Gemini mapping failure (timeout or unparseable output) after ONE retry, the
 * route throws `AppError` carrying `Import.error.mappingUnavailable`; the UI shows
 * an "auto-mapping unavailable" state with a Retry and still lets the Admin
 * continue to manual mapping (4.3). Nothing is written and no column is silently
 * guessed. Raw LLM output, stacks, SQL, and schema JSON never leak.
 */

export const dynamic = "force-dynamic";

// Shares the generation pipeline's Gemini client (45s per-call wall) and retries the
// mapping call EXACTLY once, so the worst case is ~2x45s. Set an explicit ceiling so
// a genuinely slow mapping is never cut mid-retry by Vercel's default duration.
export const maxDuration = 120;

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<ImportProposal>>> {
  try {
    const { form, client, orgId } = await resolveImportRequest(req);

    const sheetRaw = form.get("sheet");
    const parsed = analyzeInputSchema.safeParse({
      file: form.get("file"),
      sheet: typeof sheetRaw === "string" ? sheetRaw : undefined,
    });
    if (!parsed.success) {
      const key = parsed.error.issues[0]?.message ?? "Import.error.unreadable";
      throw importErrorForKey(key);
    }

    const file = parsed.data.file as File;
    const chosenSheet = parsed.data.sheet;

    const result = await parseUpload(file, chosenSheet);

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
