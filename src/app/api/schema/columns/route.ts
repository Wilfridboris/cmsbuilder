import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { setFieldVisibility } from "@/lib/data/schema-mutate";
import {
  json,
  requireUser,
  resolveWritableAdminIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { setColumnVisibilitySchema } from "./schemas";

/**
 * `POST /api/schema/columns` (Story 3.5) — the Admin-only column show/hide write.
 *
 * The single authenticated schema-write path: it persists an append-only
 * `hidden` flag on ONE field of the caller's org schema. Modeled on
 * `api/records/route.ts` (session → RLS client → guarded data layer) with the
 * `api/invite` Admin gate layered in:
 *
 *   1. `requireUser()` (JWT-validated) → 401 if no session;
 *   2. Zod-validate the targeted patch `{ slug, tableKey, fieldKey, hidden }`;
 *   3. `resolveWritableAdminIdentity(slug, user)` (retro [A1]) — one helper for the
 *      admin gate (403 for a Member), the `membership.slug === slug` cross-org
 *      check (403), the RLS-scoped client + org id, and the read_only /
 *      expired-trial writable assertion, all before any write;
 *   4. `setFieldVisibility` reads-modifies-writes `org_schemas` under that RLS
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
    const user = await requireUser();

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

    // 3. Admin gate + cross-org + writable in one helper (retro [A1]): resolve the
    //    org under the caller's RLS client, require the caller be an admin of the
    //    SAME org (a Member → 403; an admin of a different org → 403), and reject a
    //    read_only / expired-trial org before the write. The admin client reads
    //    `org_members` ONLY inside the guard, never on the write path below.
    const identity = await resolveWritableAdminIdentity(slug, user);

    // 5. Guarded read-modify-write on `org_schemas` under the RLS client.
    const result = await setFieldVisibility(identity, tableKey, fieldKey, hidden);

    return json({ data: result.data, error: null }, 200);
  } catch (err) {
    return handleError<SetColumnVisibilityResponse>(err, "/api/schema/columns");
  }
}
