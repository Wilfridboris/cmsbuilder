import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { RecordData } from "@/types/db";
import { getCurrentUser } from "@/lib/auth/session";
import { mutate } from "@/lib/data/mutate";
import { assertRecordNotEmpty } from "@/lib/data/record-conformance";
import {
  json,
  resolveWritableOrgIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { deleteQuerySchema, updateBodySchema } from "../schemas";

/**
 * `DELETE /api/records/[id]?slug=&expectedVersion=` — Story 3.2 soft-delete —
 * and `PATCH /api/records/[id]` — Story 3.3 inline edit.
 *
 * Both share the auth + org-by-slug-under-RLS resolution of `POST /api/records`
 * and write through the guarded `mutate.ts` layer, which gates on
 * `expectedVersion` (0 rows → 409-style concurrency error) and bumps `version`.
 * A version mismatch is mapped to the `versionConflict` code so the client can
 * show the "record changed" message and refetch; any other write failure →
 * `writeFailed`. DELETE soft-deletes (`deleted_at`); PATCH replaces the row's
 * full `data`. Never hard-deletes, never leaks raw SQL.
 */

export const dynamic = "force-dynamic";

export type DeleteResponse = { deleted: true };
export type UpdateResponse = { id: string; version: number; data: RecordData["data"] };

// The guarded layer surfaces its 409 concurrency case as the stable
// `versionConflict` code (collapsed into the envelope's `error`); match on the
// code — not a prose message — to remap to a 409 rather than a generic write error.
const CONCURRENCY_CODE = "versionConflict";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<DeleteResponse>>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    const { id } = await params;
    if (!id) {
      throw new AppError(400, "genericError");
    }

    const parsed = deleteQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
      expectedVersion: req.nextUrl.searchParams.get("expectedVersion"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug, expectedVersion } = parsed.data;

    const identity = await resolveWritableOrgIdentity(slug, user.id);
    // `tableKey` is irrelevant to a delete — `mutate`'s delete branch targets
    // the row by id + org + version and never reads it. Pass a non-empty
    // placeholder so the shared "valid table required" guard is satisfied.
    const result = await mutate(identity, "delete", "record", {}, {
      recordId: id,
      expectedVersion,
    });

    if (result.error) {
      if (result.error === CONCURRENCY_CODE) {
        throw new AppError(409, "versionConflict");
      }
      throw new AppError(500, "writeFailed");
    }

    return json({ data: { deleted: true }, error: null }, 200);
  } catch (err) {
    return handleError<DeleteResponse>(err, "/api/records/[id]");
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<UpdateResponse>>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    const { id } = await params;
    if (!id) {
      throw new AppError(400, "genericError");
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }
    const parsed = updateBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug, table, data, expectedVersion } = parsed.data;

    const identity = await resolveWritableOrgIdentity(slug, user.id);
    // Story 3.10 (FR99): the PATCH payload is the FULL merged row `data`, so
    // clearing the last populated field (merged → `{}`) is rejected here, before
    // `mutate`, and the optimistic edit rolls back via the existing sequence.
    assertRecordNotEmpty(data);
    const result = await mutate(identity, "update", table, data, {
      recordId: id,
      expectedVersion,
    });

    if (result.error || !result.data) {
      if (result.error === CONCURRENCY_CODE) {
        throw new AppError(409, "versionConflict");
      }
      // A relation referential-integrity rejection (Story 3.8) surfaces its own
      // translated code rather than the generic write failure.
      if (result.error === "invalidReference") {
        throw new AppError(400, "invalidReference");
      }
      // A select-option membership rejection (Epic 13 retro A1) surfaces its own
      // translated code rather than the generic write failure.
      if (result.error === "invalidSelectValue") {
        throw new AppError(400, "invalidSelectValue");
      }
      throw new AppError(500, "writeFailed");
    }

    // `mutate`'s update replaces `records.data` wholesale with what we sent and
    // bumps `version`; reconcile the optimistic row to the returned id/version.
    return json(
      {
        data: { id: result.data.id, version: result.data.version, data },
        error: null,
      },
      200,
    );
  } catch (err) {
    return handleError<UpdateResponse>(err, "/api/records/[id]");
  }
}
