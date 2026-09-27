import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { getSchema, resolveRecordLabels, type RecordLabel } from "@/lib/data/records";
import { resolvedDisplayFieldKey } from "@/lib/schema/relations";
import { json, resolveOrgIdentity, handleError } from "@/lib/api/route-helpers";
import { labelsQuerySchema } from "./schemas";

/**
 * `GET /api/records/labels?slug=&table=&ids=` (Story 3.7) — batched read-time
 * relation-label resolution for the records surface.
 *
 * Mirrors `GET /api/records`: auth → Zod (caps the id count) → resolve the org by
 * `slug` UNDER the caller's RLS client (member-only, else 403) → read the org
 * schema to find the TARGET table's `resolvedDisplayFieldKey` → one batched
 * `resolveRecordLabels` (`id IN (...)`, `deleted_at IS NULL`).
 *
 * Returns `{ data: { labels }, error }`. An id that is soft-deleted, foreign, or
 * belongs to a table with no display field simply does not appear in `labels`;
 * the client renders the translated "archived" placeholder for any absent id.
 */

export const dynamic = "force-dynamic";

type LabelsResponse = { labels: RecordLabel[] };

export async function GET(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<LabelsResponse>>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    const parsed = labelsQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
      table: req.nextUrl.searchParams.get("table"),
      ids: req.nextUrl.searchParams.get("ids"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug, table, ids } = parsed.data;

    const identity = await resolveOrgIdentity(slug, user.id);

    const schemaResult = await getSchema(identity.client, identity.orgId);
    if (schemaResult.error || !schemaResult.data) {
      throw new AppError(500, "loadFailed");
    }
    const targetTable = schemaResult.data.tables.find((t) => t.key === table);
    const displayFieldKey = targetTable
      ? resolvedDisplayFieldKey(targetTable)
      : undefined;

    // No resolvable display field → nothing to resolve; every id renders as the
    // archived placeholder on the client.
    if (!targetTable || !displayFieldKey) {
      return json({ data: { labels: [] }, error: null }, 200);
    }

    const result = await resolveRecordLabels(
      identity.client,
      identity.orgId,
      table,
      displayFieldKey,
      ids,
    );
    if (result.error) {
      throw new AppError(500, "loadFailed");
    }

    return json({ data: { labels: result.data ?? [] }, error: null }, 200);
  } catch (err) {
    return handleError<LabelsResponse>(err, "/api/records/labels");
  }
}
