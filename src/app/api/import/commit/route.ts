import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { CommitResult } from "@/types/import";
import { json, handleError } from "@/lib/api/route-helpers";
import { getSchema } from "@/lib/data/records";
import {
  bulkInsertRecords,
  SYSTEM_ACTOR_ID,
  type MutateIdentity,
} from "@/lib/data/mutate";
import { planCommit, CommitPlanError } from "@/lib/import/commit";
import { assertWritable } from "@/lib/billing/access";
import { normalizeTableName } from "@/lib/utils";
import { resolveImportRequest, importErrorForKey, parseUpload } from "../_lib";
import {
  commitInputSchema,
  parseDecisions,
  MAX_IMPORT_ROWS,
} from "../schemas";

/**
 * `POST /api/import/commit` — Story 4.4 confirm import (non-destructive replace).
 *
 * The ONLY write phase of the import pipeline. It runs after 4.3's client gate is
 * satisfied and re-validates independently: it re-parses the re-uploaded bytes
 * SERVER-SIDE (never trusting client rows), re-reads the org schema, re-resolves
 * every confirmed `{table, field}` against it (rejecting schema drift), enforces
 * the row cap, then — for crash-safety — bulk-INSERTS the mapped rows FIRST and
 * only then soft-deletes the affected tables' remaining synthetic rows. Both steps
 * are idempotent (per-row idempotency keys derived from the client's stable
 * `import_id`; the synthetic clear is a re-runnable soft-delete), so a retried
 * commit dedupes to the same logical write and returns the same summary.
 *
 * Auth + the server-side re-parse run through the shared `resolveImportRequest` /
 * `parseUpload` helpers (see `../_lib`): 401 with no session, 403 for a non-member /
 * Member / cross-org Admin, all before any parse or write. Every write flows through
 * the guarded mutation layer under the caller's RLS-scoped client with explicit
 * identity; the service-role client is used ONLY for the narrow membership read
 * inside `requireAdmin`, never for tenant rows.
 *
 * Failures collapse to the frozen matrix translation KEYs: unresolved decision →
 * 400, schema drift → 409, too many rows → 413, file/parse → their analyze keys,
 * a mid-write throw → `Import.error.commitFailed` (500). Raw stacks, SQL, and
 * schema JSON never leak.
 */

export const dynamic = "force-dynamic";

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<CommitResult>>> {
  try {
    const { form, client, actorId, orgId, subscriptionStatus, trialExpiresAt } =
      await resolveImportRequest(req);

    // Story 7.4: the commit is the only write phase of the import pipeline. Reject a
    // read_only / expired-trial org before any parse or write (analyze/propose are
    // reads and stay ungated).
    assertWritable({
      subscription_status: subscriptionStatus,
      trial_expires_at: trialExpiresAt,
    });

    const sheetRaw = form.get("sheet");
    const parsed = commitInputSchema.safeParse({
      file: form.get("file"),
      sheet: typeof sheetRaw === "string" ? sheetRaw : undefined,
      decisions: form.get("decisions"),
      import_id: form.get("import_id"),
    });
    if (!parsed.success) {
      const key = parsed.error.issues[0]?.message ?? "Import.error.unreadable";
      throw importErrorForKey(key);
    }

    const file = parsed.data.file as File;
    const chosenSheet = parsed.data.sheet;
    const decisions = parseDecisions(parsed.data.decisions);
    const importId = parsed.data.import_id.trim();

    // Re-parse the bytes SERVER-SIDE — client-parsed columns/rows are never trusted.
    const result = await parseUpload(file, chosenSheet);

    // A multi-sheet workbook with no chosen sheet cannot be committed — surface the
    // same retryable unreadable error as propose.
    if (result.sheetNames) {
      throw new AppError(400, "Import.error.unreadable");
    }

    // Server-side row bound: reject before any write when the parsed data-row count
    // exceeds the cap (matching the epic performance guarantee).
    if (result.rows.length > MAX_IMPORT_ROWS) {
      throw new AppError(413, "Import.error.tooManyRows");
    }

    // READ the org's current schema under the RLS-scoped client (never a write) so
    // the planner re-validates every decision target against the LIVE schema.
    const schemaResult = await getSchema(client, orgId);
    if (schemaResult.error || !schemaResult.data) {
      throw new AppError(500, "genericError", schemaResult.error ?? "no schema");
    }
    const schema = schemaResult.data;

    // Plan the commit: group mapped columns by table, drop skip + relation targets,
    // re-reject any unresolved decision (400) or schema drift (409).
    let plan;
    try {
      plan = planCommit(result.rows, decisions, schema);
    } catch (err) {
      if (err instanceof CommitPlanError) {
        if (err.key === "Import.error.unresolvedColumns") {
          throw new AppError(400, err.key);
        }
        throw new AppError(409, err.key);
      }
      throw err;
    }

    const identity: MutateIdentity = { client, actorId, orgId };

    // Crash-safe ordering: INSERT first (each table is one atomic array upsert with
    // per-row idempotency), then clear synthetic. A failure between them leaves data
    // visible (never an emptied table); a retry dedupes the inserts and re-runs the
    // idempotent clear.
    const tables: CommitResult["tables"] = [];
    let importedCount = 0;
    try {
      for (const table of plan.tables) {
        const insertResult = await bulkInsertRecords(
          identity,
          table.tableKey,
          table.rows.map((data, rowIndex) => ({
            data,
            idempotencyKey: `import-${importId}-${table.tableKey}-${rowIndex}`,
          })),
        );
        if (insertResult.error || !insertResult.data) {
          throw new AppError(
            500,
            "Import.error.commitFailed",
            insertResult.error ?? "bulk insert failed",
          );
        }
        tables.push({
          tableKey: table.tableKey,
          count: insertResult.data.insertedCount,
        });
        importedCount += insertResult.data.insertedCount;
      }

      // Clear the affected tables' remaining synthetic rows (soft-delete, scoped to
      // SYSTEM_ACTOR_ID + deleted_at IS NULL). Real rows (human actor_id) are never
      // touched; a no-op once claim has already cleared demo data. Idempotent.
      if (plan.affectedTables.length > 0) {
        const affectedKeys = plan.affectedTables.map((key) =>
          normalizeTableName(key),
        );
        const { error: clearError } = await client
          .from("records")
          .update({
            deleted_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("organization_id", orgId)
          .eq("actor_id", SYSTEM_ACTOR_ID)
          .is("deleted_at", null)
          .in("table_key", affectedKeys);
        if (clearError) {
          throw new AppError(
            500,
            "Import.error.commitFailed",
            clearError.message,
          );
        }
      }
    } catch (err) {
      if (err instanceof AppError) {
        throw err;
      }
      throw new AppError(
        500,
        "Import.error.commitFailed",
        err instanceof Error ? err.message : "commit failed",
      );
    }

    return json<CommitResult>(
      { data: { importedCount, tables }, error: null },
      200,
    );
  } catch (err) {
    return handleError<CommitResult>(err, "/api/import/commit");
  }
}
