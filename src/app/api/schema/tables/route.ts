import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { setTableVisibility } from "@/lib/data/schema-mutate";
import {
  json,
  requireUser,
  resolveWritableAdminIdentity,
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
 *   1. `requireUser()` (JWT-validated) → 401 if no session;
 *   2. Zod-validate `{ slug, action: "hide" | "restore", tableKey }`;
 *   3. `resolveWritableAdminIdentity(slug, user)` (retro [A1]) — one helper for the
 *      admin gate (403 for a Member), the `membership.slug === slug` cross-org
 *      check (403), the RLS-scoped client + org id, and the read_only /
 *      expired-trial writable assertion, all before any write;
 *   4. `setTableVisibility(identity, tableKey, action === "hide")` — the guarded
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
    const user = await requireUser();

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

    // 3. Admin gate + cross-org + writable in one helper (retro [A1]): resolve the
    //    org under the caller's RLS client, require the caller be an admin of the
    //    SAME org (a Member → 403; an admin of a different org → 403), and reject a
    //    read_only / expired-trial org before any write. The admin client reads
    //    `org_members` ONLY inside the guard, never on the write path below.
    const identity = await resolveWritableAdminIdentity(body.slug, user);

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
