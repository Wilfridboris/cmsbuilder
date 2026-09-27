import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSchema, countReferencingRecords } from "@/lib/data/records";
import { reportError } from "@/lib/observability/report";
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

function json<T>(
  body: ApiResponse<T>,
  status: number,
): NextResponse<ApiResponse<T>> {
  return NextResponse.json(body, { status });
}

async function resolveIdentity(slug: string, actorId: string) {
  const cookieStore = await cookies();
  const client = createServerSupabaseClient(cookieStore);

  const { data: org, error } = await client
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw new AppError(500, "genericError", error.message);
  }
  if (!org) {
    throw new AppError(403, "forbidden");
  }

  return { client, actorId, orgId: org.id as string };
}

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

    const identity = await resolveIdentity(slug, user.id);

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
    return handleError<ReferencesResponse>(err);
  }
}

function handleError<T>(err: unknown): NextResponse<ApiResponse<T>> {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      reportError(err, { route: "/api/records/[id]/references" });
    }
    return json<T>({ data: null, error: err.userMessage }, err.statusCode);
  }
  reportError(err, { route: "/api/records/[id]/references" });
  return json<T>({ data: null, error: "genericError" }, 500);
}
