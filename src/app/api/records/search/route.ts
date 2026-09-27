import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getSchema, searchRelationRecords, type RecordLabel } from "@/lib/data/records";
import { resolvedDisplayFieldKey } from "@/lib/schema/relations";
import { reportError } from "@/lib/observability/report";
import { searchQuerySchema } from "./schemas";

/**
 * `GET /api/records/search?slug=&table=&query=` (Story 3.7) — the server-side
 * relation typeahead the record picker calls.
 *
 * Mirrors `GET /api/records`: `getCurrentUser()` (JWT-validated) → 401 → Zod
 * → resolve the org by `slug` UNDER the caller's RLS client (member-only, else
 * 403) → read the org schema to find the TARGET table's `resolvedDisplayFieldKey`
 * → `searchRelationRecords` (bounded ILIKE + LIMIT, `deleted_at IS NULL`).
 *
 * Returns `{ data: { results }, error }`; a target table absent from the schema
 * (or with no display field) yields an empty result rather than an error. Raw
 * SQL/stacks are never leaked; `reportError` logs 5xx detail.
 */

export const dynamic = "force-dynamic";

type SearchResponse = { results: RecordLabel[] };

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
): Promise<NextResponse<ApiResponse<SearchResponse>>> {
  try {
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    const parsed = searchQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
      table: req.nextUrl.searchParams.get("table"),
      query: req.nextUrl.searchParams.get("query") ?? "",
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug, table, query } = parsed.data;

    const identity = await resolveIdentity(slug, user.id);

    // Find the target table's resolved display field from the org schema.
    const schemaResult = await getSchema(identity.client, identity.orgId);
    if (schemaResult.error || !schemaResult.data) {
      throw new AppError(500, "loadFailed");
    }
    const targetTable = schemaResult.data.tables.find((t) => t.key === table);
    const displayFieldKey = targetTable
      ? resolvedDisplayFieldKey(targetTable)
      : undefined;

    // A target table with no resolvable display field can't be searched by label;
    // return an empty candidate list rather than an error (the picker shows its
    // empty state).
    if (!targetTable || !displayFieldKey) {
      return json({ data: { results: [] }, error: null }, 200);
    }

    const result = await searchRelationRecords(
      identity.client,
      identity.orgId,
      table,
      displayFieldKey,
      query,
    );
    if (result.error) {
      throw new AppError(500, "loadFailed");
    }

    return json({ data: { results: result.data ?? [] }, error: null }, 200);
  } catch (err) {
    return handleError<SearchResponse>(err);
  }
}

function handleError<T>(err: unknown): NextResponse<ApiResponse<T>> {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      reportError(err, { route: "/api/records/search" });
    }
    return json<T>({ data: null, error: err.userMessage }, err.statusCode);
  }
  reportError(err, { route: "/api/records/search" });
  return json<T>({ data: null, error: "genericError" }, 500);
}
