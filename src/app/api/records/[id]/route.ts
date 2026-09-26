import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { mutate } from "@/lib/data/mutate";
import { reportError } from "@/lib/observability/report";
import { deleteQuerySchema } from "../schemas";

/**
 * `DELETE /api/records/[id]?slug=&expectedVersion=` — Story 3.2 soft-delete.
 *
 * Same auth + org-by-slug-under-RLS resolution as `POST /api/records`. Deletes
 * through the guarded `mutate.ts` layer, which soft-deletes (`deleted_at`) and
 * gates on `expectedVersion` (0 rows → 409-style concurrency error). A version
 * mismatch is mapped to the `versionConflict` code so the client can show the
 * "record changed" message and refetch; any other write failure → `writeFailed`.
 * Never hard-deletes, never leaks raw SQL.
 */

export const dynamic = "force-dynamic";

export type DeleteResponse = { deleted: true };

// The guarded layer surfaces its 409 concurrency case as this exact message
// (it collapses the thrown AppError into `userMessage`); match on it to remap
// to the translated `versionConflict` code rather than the generic write error.
const CONCURRENCY_MESSAGE =
  "This record changed since you loaded it. Please refresh and try again.";

function json(
  body: ApiResponse<DeleteResponse>,
  status: number,
): NextResponse<ApiResponse<DeleteResponse>> {
  return NextResponse.json(body, { status });
}

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

    // Resolve the org UNDER the caller's RLS client (member-only) — mirrors the
    // collection route. A non-member / bad slug → forbidden.
    const cookieStore = await cookies();
    const client = createServerSupabaseClient(cookieStore);
    const { data: org, error: orgError } = await client
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (orgError) {
      throw new AppError(500, "genericError", orgError.message);
    }
    if (!org) {
      throw new AppError(403, "forbidden");
    }

    const identity = { client, actorId: user.id, orgId: org.id as string };
    // `tableKey` is irrelevant to a delete — `mutate`'s delete branch targets
    // the row by id + org + version and never reads it. Pass a non-empty
    // placeholder so the shared "valid table required" guard is satisfied.
    const result = await mutate(identity, "delete", "record", {}, {
      recordId: id,
      expectedVersion,
    });

    if (result.error) {
      if (result.error === CONCURRENCY_MESSAGE) {
        throw new AppError(409, "versionConflict");
      }
      throw new AppError(500, "writeFailed");
    }

    return json({ data: { deleted: true }, error: null }, 200);
  } catch (err) {
    if (err instanceof AppError) {
      if (err.statusCode >= 500) {
        reportError(err, { route: "/api/records/[id]" });
      }
      return json({ data: null, error: err.userMessage }, err.statusCode);
    }
    reportError(err, { route: "/api/records/[id]" });
    return json({ data: null, error: "genericError" }, 500);
  }
}
