import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { CommitResult } from "@/types/import";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { resolveOrgIdentity, json, handleError } from "@/lib/api/route-helpers";
import { parseSpreadsheet, ParseError } from "@/lib/import/parse";
import { getSchema } from "@/lib/data/records";
import {
  bulkInsertRecords,
  SYSTEM_ACTOR_ID,
  type MutateIdentity,
} from "@/lib/data/mutate";
import { planCommit, CommitPlanError } from "@/lib/import/commit";
import { normalizeTableName } from "@/lib/utils";
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
 * Auth mirrors propose/analyze exactly: `getCurrentUser()` → 401;
 * `resolveOrgIdentity` (non-member → 403) resolves the RLS-scoped client + orgId +
 * actorId; `requireAdmin` (a Member → 403); a `membership.slug === slug` check
 * (cross-org Admin → 403) — ALL before any parse or write. Every write flows
 * through the guarded mutation layer under the caller's RLS-scoped client with
 * explicit identity; the service-role client is used ONLY for the narrow
 * membership read inside `requireAdmin`, never for tenant rows.
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
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

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

    // Auth chain (mirror propose): resolve the org UNDER RLS (non-member → 403),
    // re-enforce Admin authoritatively (a Member → 403), and reject a cross-org
    // Admin whose most-recent membership isn't this slug. All BEFORE any parse/write.
    const { client, actorId, orgId } = await resolveOrgIdentity(
      slug.trim(),
      user.id,
    );
    const membership = await requireAdmin(user, createAdminClient());
    if (membership.slug !== slug.trim()) {
      throw new AppError(403, "forbidden");
    }

    const sheetRaw = form.get("sheet");
    const parsed = commitInputSchema.safeParse({
      file: form.get("file"),
      sheet: typeof sheetRaw === "string" ? sheetRaw : undefined,
      decisions: form.get("decisions"),
      import_id: form.get("import_id"),
    });
    if (!parsed.success) {
      const key = parsed.error.issues[0]?.message ?? "Import.error.unreadable";
      throw errorForKey(key);
    }

    const file = parsed.data.file as File;
    const chosenSheet = parsed.data.sheet;
    const decisions = parseDecisions(parsed.data.decisions);
    const importId = parsed.data.import_id.trim();

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

/**
 * Map a frozen matrix translation KEY to an `AppError` with the matrix status.
 * Mirrors propose so file/parse failures resolve to the same translated keys.
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
