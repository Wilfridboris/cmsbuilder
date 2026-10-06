import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import { getSchema, listAllRecords } from "@/lib/data/records";
import {
  requireUser,
  resolveAdminIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { buildExport } from "@/lib/export/build-export";
import { zipBundle } from "@/lib/export/zip";
import type { RecordData } from "@/types/db";
import { exportQuerySchema } from "./schemas";

/**
 * `GET /api/export?slug=` — "Download My Data" (Story 8.4, FR37 / PIPEDA
 * data portability). Returns a single downloadable ZIP of the caller's org data:
 * `export.json` at the archive root (complete, faithful) plus one
 * `tables/<table_key>.csv` per logical table (human-readable).
 *
 * Pattern mirrors `api/records/route.ts`: `requireUser()` (401 if no session) ->
 * zod-validate `slug` -> `resolveAdminIdentity(slug, user)` (admin gate + RLS +
 * cross-org check; a non-admin or cross-org slug yields 403 BEFORE any data work)
 * -> read the schema + every table's records UNDER the caller's RLS-scoped client
 * -> serialize -> zip -> return it. All failures collapse to the `{ data, error }`
 * envelope's code via `handleError`; raw SQL/stacks are never leaked.
 *
 * This is a READ, so it uses the admin-but-not-writable gate (`resolveAdminIdentity`,
 * never `resolveWritableAdminIdentity`): the export MUST remain available to a
 * `read_only` org — it is the owner's lifeboat during the Epic 8.5 grace period.
 * It never uses the service-role admin client and never trusts a client-supplied
 * org id (the org is resolved from `slug` under RLS). Read-only; nothing is mutated.
 */

export const dynamic = "force-dynamic";

/** `YYYY-MM-DD` in UTC for the archive filename (stable, locale-independent). */
function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    // 401 before any work: `requireUser` throws `unauthorized` when there is no
    // session. Single-sourced with the sibling admin routes, one session read.
    const user = await requireUser();

    const parsed = exportQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug } = parsed.data;

    // Admin + RLS + cross-org gate (a non-admin or cross-org slug -> 403 forbidden)
    // BEFORE any data read. NOT the writable variant: reads are never gated, so a
    // read_only/grace-period org still exports.
    const identity = await resolveAdminIdentity(slug, user);

    // Read the org's logical schema (every table, including hidden ones).
    const schemaResult = await getSchema(identity.client, identity.orgId);
    if (schemaResult.error || !schemaResult.data) {
      throw new AppError(500, "genericError");
    }
    const tables = schemaResult.data.tables ?? [];

    // Read ALL live records per table under the caller's RLS-scoped client,
    // paginating to completeness (never silently truncated at the default cap).
    const recordsByTable: Record<string, RecordData[]> = {};
    for (const table of tables) {
      const result = await listAllRecords(
        identity.client,
        identity.orgId,
        table.key,
      );
      if (result.error || !result.data) {
        throw new AppError(500, "genericError");
      }
      recordsByTable[table.key] = result.data;
    }

    const exportedAt = new Date();
    const { jsonText, csvs } = buildExport({
      slug,
      exportedAt: exportedAt.toISOString(),
      tables,
      recordsByTable,
    });

    const zip = zipBundle([
      { name: "export.json", content: jsonText },
      ...csvs,
    ]);

    const filename = `scheza-${slug}-${isoDate(exportedAt)}.zip`;
    // Return the raw archive bytes. `Buffer.from(zip)` gives a Node Buffer body
    // NextResponse streams verbatim; the Content-Disposition triggers a download.
    return new NextResponse(Buffer.from(zip), {
      status: 200,
      headers: {
        "Content-Type": "application/zip",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    return handleError(err, "/api/export");
  }
}
