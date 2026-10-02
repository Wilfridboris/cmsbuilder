import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { setTableVisibility } from "@/lib/data/schema-mutate";
import {
  json,
  resolveWritableOrgIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { schemaTablesSchema } from "./schemas";

/**
 * `POST /api/schema/tables` (Story 5.7) — the Admin-only, direct, NON-LLM table
 * hide/restore path for the chat hide-table confirm button, the add-table chat
 * Undo, the chat show-again Undo, and the Settings "Hidden tables" Restore control.
 *
 * A button click / Undo / Restore carries no natural language and must not spend a
 * Gemini call, so this mirrors `/api/schema/views` (Story 5.6) exactly — session →
 * zod → `requireAdmin` + `membership.slug === slug` → `resolveWritableOrgIdentity`
 * → guarded mutator — rather than routing through the conversational editor:
 *
 *   1. `getCurrentUser()` (JWT-validated) → 401 if no session;
 *   2. Zod-validate `{ slug, action: "hide" | "restore", tableKey }`;
 *   3. `requireAdmin(user, createAdminClient())` → 403 for a Member — the
 *      service-role admin client is used ONLY to read `org_members` inside the
 *      guard, NEVER on the write path;
 *   4. `membership.slug === slug` cross-check (no cross-org schema edits);
 *   5. `resolveWritableOrgIdentity(slug)` builds the RLS-scoped client + org id
 *      (and rejects a read_only / expired-trial org before any write);
 *   6. `setTableVisibility(identity, tableKey, action === "hide")` — the guarded
 *      read-verify-transform-write mutator. Hiding re-checks the "never empty the
 *      dashboard" guard; restore simply flips the flag back.
 *
 * Every failure resolves to a translated error CODE via the `{ data, error }`
 * envelope; raw SQL/schema/stacks are never leaked. Only the table-level `hidden`
 * flag ever changes — every `records` row is retained, so a hidden table restores
 * unchanged.
 */

export const dynamic = "force-dynamic";

type SchemaTablesResponse = {
  action: "hide" | "restore";
  tableKey: string;
  hidden: boolean;
};

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<SchemaTablesResponse>>> {
  try {
    // 1. Identify the caller. No session → 401.
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    // 2. Validate the targeted action body.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }
    const parsed = schemaTablesSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const body = parsed.data;

    // 3. Admin gate — server-side, the real security boundary. A Member is
    //    rejected with 403 before any write. The admin client is used ONLY to
    //    read `org_members` here, never on the write path below.
    const membership = await requireAdmin(user, createAdminClient());

    // 3b. Cross-org guard (mirrors `/api/schema/views`): the resolved membership
    //     must be the org named by `slug` so an Admin of a different org cannot
    //     edit THIS org's schema.
    if (membership.slug !== body.slug) {
      throw new AppError(403, "forbidden");
    }

    // 4. Build the caller's RLS-scoped identity. The writable variant also rejects
    //    a read_only / expired-trial org before the write.
    const identity = await resolveWritableOrgIdentity(body.slug, user.id);

    // 5. Apply the guarded hide/restore (both go through the one mutator).
    const result = await setTableVisibility(
      identity,
      body.tableKey,
      body.action === "hide",
    );
    return json(
      {
        data: {
          action: body.action,
          tableKey: result.data!.tableKey,
          hidden: result.data!.hidden,
        },
        error: null,
      },
      200,
    );
  } catch (err) {
    return handleError<SchemaTablesResponse>(err, "/api/schema/tables");
  }
}
