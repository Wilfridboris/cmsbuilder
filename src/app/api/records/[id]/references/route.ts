import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { getSchema, countReferencingRecords } from "@/lib/data/records";
import { json, resolveOrgIdentity, handleError } from "@/lib/api/route-helpers";
import { referencesQuerySchema } from "./schemas";

/**
 * `GET /api/records/[id]/references?slug=&table=` (Story 3.8) — the delete-guard
 * reference count the confirm dialog fetches before a soft-delete.
 *
 * Mirrors `GET /api/records`: `getCurrentUser()` (JWT-validated) → 401 → Zod →
 * resolve the org by `slug` UNDER the caller's RLS client (member-only, else 403)
 * → read the org schema → `countReferencingRecords` (enumerates the schema's
 * inbound `(table_key, field)` relation pairs and counts, via JSONB containment,
 * the non-deleted rows that reference `[id]`, capped at `REFERENCE_COUNT_CAP`).
 *
 * Returns `{ data: { count }, error }`; raw SQL/stacks are never leaked. The
 * dialog degrades gracefully on any 5xx (shows a neutral "couldn't verify" note),
 * so a failure here never blocks the delete.
 */

export const dynamic = "force-dynamic";

type ReferencesResponse = { count: number };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<ReferencesResponse>>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    const { id } = await params;
    if (!id) {
      throw new AppError(400, "genericError");
    }

    const parsed = referencesQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
      table: req.nextUrl.searchParams.get("table"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug, table } = parsed.data;

    const identity = await resolveOrgIdentity(slug, user.id);

    const schemaResult = await getSchema(identity.client, identity.orgId);
    if (schemaResult.error || !schemaResult.data) {
      throw new AppError(500, "loadFailed");
    }

    const result = await countReferencingRecords(
      identity.client,
      identity.orgId,
      schemaResult.data,
      table,
      id,
    );
    if (result.error || result.data === null) {
      throw new AppError(500, "loadFailed");
    }

    return json({ data: { count: result.data }, error: null }, 200);
  } catch (err) {
    return handleError<ReferencesResponse>(err, "/api/records/[id]/references");
  }
}
