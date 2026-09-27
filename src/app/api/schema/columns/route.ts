import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { setFieldVisibility } from "@/lib/data/schema-mutate";
import { json, resolveOrgIdentity, handleError } from "@/lib/api/route-helpers";
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
    const identity = await resolveOrgIdentity(slug, user.id);

    // 5. Guarded read-modify-write on `org_schemas` under the RLS client.
    const result = await setFieldVisibility(identity, tableKey, fieldKey, hidden);

    return json({ data: result.data, error: null }, 200);
  } catch (err) {
    return handleError<SetColumnVisibilityResponse>(err, "/api/schema/columns");
  }
}
