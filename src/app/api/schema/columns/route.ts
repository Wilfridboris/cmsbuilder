import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/rbac";
import { setFieldVisibility } from "@/lib/data/schema-mutate";
import { reportError } from "@/lib/observability/report";
import { setColumnVisibilitySchema } from "./schemas";

/**
 * `POST /api/schema/columns` (Story 3.5) — the Admin-only column show/hide write.
 *
 * The single authenticated schema-write path: it persists an append-only
 * `hidden` flag on ONE field of the caller's org schema. Modeled on
 * `api/records/route.ts` (session → RLS client → guarded data layer) with the
 * `api/invite` Admin gate layered in:
 *
 *   1. `getCurrentUser()` (JWT-validated) → 401 if no session;
 *   2. Zod-validate the targeted patch `{ slug, tableKey, fieldKey, hidden }`;
 *   3. `requireAdmin(user, createAdminClient())` → 403 for a Member — the
 *      service-role admin client is used ONLY to read `org_members` inside the
 *      guard (exactly as `api/invite` does), NEVER on the write path;
 *   4. `resolveIdentity(slug)` builds the caller's RLS-scoped client + org id;
 *   5. `setFieldVisibility` reads-modifies-writes `org_schemas` under that RLS
 *      client (the real tenant-scoping boundary).
 *
 * Every failure resolves to a translated error CODE via the `{ data, error }`
 * envelope; raw SQL/stacks are never leaked. `reportError` logs 5xx detail.
 */

export const dynamic = "force-dynamic";

type SetColumnVisibilityResponse = {
  tableKey: string;
  fieldKey: string;
  hidden: boolean;
};

function json<T>(
  body: ApiResponse<T>,
  status: number,
): NextResponse<ApiResponse<T>> {
  return NextResponse.json(body, { status });
}

/**
 * Resolve the org id for `slug` under the caller's RLS-scoped client. RLS returns
 * the row only for a member, so a non-member (or bad slug) yields nothing → a
 * `forbidden` AppError. Mirrors `api/records/route.ts`.
 */
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
    // RLS hid the org (non-member) or the slug does not exist — same outcome.
    throw new AppError(403, "forbidden");
  }

  return { client, actorId, orgId: org.id as string };
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<SetColumnVisibilityResponse>>> {
  try {
    // 1. Identify the caller. No session → 401.
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    // 2. Validate the targeted patch.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }
    const parsed = setColumnVisibilitySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug, tableKey, fieldKey, hidden } = parsed.data;

    // 3. Admin gate — server-side, the real security boundary. A Member is
    //    rejected with 403 before any write. The admin client is used ONLY to
    //    read `org_members` here, never on the write path below.
    const membership = await requireAdmin(user, createAdminClient());

    // 3b. `requireAdmin` resolves the caller's MOST-RECENT membership, which is
    //     slug-agnostic; assert it is the org named by `slug` so an Admin of a
    //     different org cannot edit THIS org's schema (org_schemas RLS only
    //     checks membership, not admin). Mirrors the `membership.slug === slug`
    //     check that `[slug]/page.tsx` already applies for the UI gate.
    if (membership.slug !== slug) {
      throw new AppError(403, "forbidden");
    }

    // 4. Build the caller's RLS-scoped identity for the org.
    const identity = await resolveIdentity(slug, user.id);

    // 5. Guarded read-modify-write on `org_schemas` under the RLS client.
    const result = await setFieldVisibility(identity, tableKey, fieldKey, hidden);

    return json({ data: result.data, error: null }, 200);
  } catch (err) {
    return handleError<SetColumnVisibilityResponse>(err);
  }
}

function handleError<T>(err: unknown): NextResponse<ApiResponse<T>> {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      reportError(err, { route: "/api/schema/columns" });
    }
    return json<T>({ data: null, error: err.userMessage }, err.statusCode);
  }
  reportError(err, { route: "/api/schema/columns" });
  return json<T>({ data: null, error: "genericError" }, 500);
}
