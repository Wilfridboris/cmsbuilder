import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { ViewDefinition } from "@/types/db";
import { addView, removeView } from "@/lib/data/schema-mutate";
import {
  json,
  requireUser,
  resolveWritableAdminIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { schemaViewsSchema } from "./schemas";

/**
 * `POST /api/schema/views` (Story 5.6) — the Admin-only, direct, NON-LLM view
 * mutation path for the view-tab "Remove view" control and both Undo flows (the
 * tab-surface Undo and the add-view chat-bubble Undo).
 *
 * A button click / Undo carries no natural language and must not spend a Gemini
 * call, so this mirrors `/api/schema/columns` (Story 3.5) exactly — session → zod
 * → `requireAdmin` + `membership.slug === slug` → `resolveWritableOrgIdentity` →
 * guarded mutator — rather than routing through the conversational editor:
 *
 *   1. `requireUser()` (JWT-validated) → 401 if no session;
 *   2. Zod-validate `{ slug, action: "remove" | "restore", ... }`;
 *   3. `resolveWritableAdminIdentity(slug, user)` (retro [A1]) — one helper for the
 *      admin gate (403 for a Member), the `membership.slug === slug` cross-org
 *      check (403), the RLS-scoped client + org id, and the read_only /
 *      expired-trial writable assertion, all before any write;
 *   4. `remove`  → `removeView(identity, viewKey)` returns the removed def (so the
 *                  client can restore it); `restore` → `addView(identity, view)`
 *                  returns `{ viewKey }` (the freed key re-derives identically).
 *
 * Every failure resolves to a translated error CODE via the `{ data, error }`
 * envelope; raw SQL/schema/stacks are never leaked. A view holds no rows, so a
 * `remove` touches no `records` row; `restore` is pure append-only metadata.
 */

export const dynamic = "force-dynamic";

type SchemaViewsResponse =
  | { action: "remove"; view: ViewDefinition }
  | { action: "restore"; viewKey: string };

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<SchemaViewsResponse>>> {
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
    const parsed = schemaViewsSchema.safeParse(raw);
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

    // 5. Dispatch on the action (both go through the guarded schema-mutate layer).
    if (body.action === "remove") {
      const result = await removeView(identity, body.viewKey);
      return json(
        { data: { action: "remove", view: result.data!.view }, error: null },
        200,
      );
    }

    // restore (Undo of a removal): re-add the view through the already-validated
    // addView; the freed key re-derives identically, so the view returns unchanged.
    const result = await addView(identity, {
      label: body.view.label,
      sourceTableKey: body.view.sourceTableKey,
      filters: body.view.filters,
      sort: body.view.sort,
    });
    return json(
      { data: { action: "restore", viewKey: result.data!.viewKey }, error: null },
      200,
    );
  } catch (err) {
    return handleError<SchemaViewsResponse>(err, "/api/schema/views");
  }
}
