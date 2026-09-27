import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/rbac";
import { addRelationField } from "@/lib/data/schema-mutate";
import { reportError } from "@/lib/observability/report";
import { addRelationFieldSchema } from "./schemas";

/**
 * `POST /api/schema/fields` (Story 3.7) — the Admin-only "add relationship field"
 * write. Adds ONE single-reference `relation` field to a table of the caller's
 * org schema, targeting another table in the same org.
 *
 * Mirrors `POST /api/schema/columns` exactly (the real Admin schema-write
 * boundary):
 *   1. `getCurrentUser()` (JWT-validated) → 401 if no session;
 *   2. Zod-validate `{ slug, tableKey, label, targetTable }`;
 *   3. `requireAdmin(user, createAdminClient())` → 403 for a Member — the
 *      service-role admin client reads `org_members` ONLY inside the guard,
 *      NEVER on the write path (mirrors `/api/schema/columns`);
 *   4. `membership.slug === slug` so an Admin of a DIFFERENT org can't edit this
 *      org's schema (org_schemas RLS only checks membership, not admin);
 *   5. `resolveIdentity(slug)` builds the caller's RLS-scoped client + org id;
 *   6. `addRelationField` reads-validates-writes `org_schemas` under that RLS
 *      client (focused validator; whole-schema generation validator is NOT used).
 *
 * Every failure resolves to a translated error CODE via the `{ data, error }`
 * envelope; raw SQL/stacks are never leaked. `reportError` logs 5xx detail.
 */

export const dynamic = "force-dynamic";

type AddRelationFieldResponse = {
  tableKey: string;
  fieldKey: string;
  targetTable: string;
};

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

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<AddRelationFieldResponse>>> {
  try {
    // 1. Identify the caller. No session → 401.
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    // 2. Validate the add-field request.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }
    const parsed = addRelationFieldSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug, tableKey, label, targetTable } = parsed.data;

    // 3. Admin gate — server-side, the real security boundary. The admin client
    //    reads `org_members` ONLY here, never on the write path below.
    const membership = await requireAdmin(user, createAdminClient());

    // 3b. Assert the resolved membership is the org named by `slug` — an Admin of
    //     a different org cannot edit THIS org's schema.
    if (membership.slug !== slug) {
      throw new AppError(403, "forbidden");
    }

    // 4. Build the caller's RLS-scoped identity for the org.
    const identity = await resolveIdentity(slug, user.id);

    // 5. Guarded read-validate-write on `org_schemas` under the RLS client.
    const result = await addRelationField(identity, tableKey, {
      label,
      targetTable,
    });

    return json({ data: result.data, error: null }, 200);
  } catch (err) {
    return handleError<AddRelationFieldResponse>(err);
  }
}

function handleError<T>(err: unknown): NextResponse<ApiResponse<T>> {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      reportError(err, { route: "/api/schema/fields" });
    }
    return json<T>({ data: null, error: err.userMessage }, err.statusCode);
  }
  reportError(err, { route: "/api/schema/fields" });
  return json<T>({ data: null, error: "genericError" }, 500);
}
