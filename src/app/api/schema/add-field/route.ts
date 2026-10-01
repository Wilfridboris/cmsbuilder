import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { getSchema } from "@/lib/data/records";
import { visibleTables } from "@/lib/schema/overrides";
import { addField } from "@/lib/data/schema-mutate";
import { callGeminiWithTimeout } from "@/lib/gemini/client";
import {
  ADD_FIELD_RESPONSE_SCHEMA,
  buildAddFieldPrompt,
  type ChatTableSummary,
} from "@/lib/gemini/prompts";
import {
  json,
  resolveWritableOrgIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { reportError } from "@/lib/observability/report";
import { addFieldChatSchema } from "./schemas";

/**
 * `POST /api/schema/add-field` (Story 5.1) — the Admin-only conversational
 * "add a column via chat" endpoint.
 *
 * Flow (every guard server-side; the LLM is NEVER a dependency for core CRUD):
 *   1. `getCurrentUser()` (JWT-validated) → 401 if no session;
 *   2. Zod-validate `{ slug, message, currentTableKey?, conversation? }`;
 *   3. `requireAdmin(user, createAdminClient())` → 403 for a Member — the
 *      service-role admin client reads `org_members` ONLY inside the guard; a
 *      direct call by a Member returns 403 (the chat is also hidden client-side);
 *   4. `membership.slug === slug` cross-check (no cross-org schema edits);
 *   5. `resolveWritableOrgIdentity(slug)` builds the RLS-scoped client + org id
 *      (and rejects a read_only / expired-trial org before any write);
 *   6. load the org's CURRENT schema (the table list the model may target);
 *   7. ONE `callGeminiWithTimeout` with `buildAddFieldPrompt` (the hardened system
 *      prompt is injected by the client on 100% of calls; hard 15s timeout);
 *   8. branch on the model's `kind`:
 *        - `add_field`          → `schema-mutate.addField` (focused validator +
 *                                 append-only write). A validator rejection becomes
 *                                 the fixed plain-language rejection copy; a 5xx
 *                                 degrades gracefully. On success → `applied` with
 *                                 the tableKey/fieldKey so the client can drive Undo;
 *        - `needs_clarification` → `clarify` with the model's question;
 *        - `out_of_scope`/other → `declined` with a friendly non-technical decline.
 *   9. On ANY LLM timeout/failure → `degraded` with a translated message; CRUD is
 *      untouched. No raw JSON, SQL, schema, error, or stack ever reaches the user.
 *
 * All user-facing copy comes from the `ChatAssistant` next-intl namespace (en+fr).
 */

export const dynamic = "force-dynamic";

/** The server result contract (model -> route -> client). `assistantText` is always a translated human string. */
export type AddFieldChatResult = {
  kind: "applied" | "clarify" | "declined" | "rejected" | "degraded";
  /** Present on `applied`: the table the column was added to (drives Undo). */
  tableKey?: string;
  /** Present on `applied`: the added field key (drives Undo). */
  fieldKey?: string;
  /** Present on `applied`: the added column's label, for the success message. */
  label?: string;
  /** Always a translated, human-readable sentence. Never raw JSON/SQL/errors. */
  assistantText: string;
};

/** Shape returned by the single Gemini call (flat — the route reads by `kind`). */
type GeminiAddFieldOutput = {
  kind?: "add_field" | "needs_clarification" | "out_of_scope";
  tableKey?: unknown;
  label?: unknown;
  type?: unknown;
  question?: unknown;
  reply?: unknown;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<AddFieldChatResult>>> {
  try {
    // 1. Identify the caller. No session → 401.
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    // 2. Validate the chat request body.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }
    const parsed = addFieldChatSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug, message, currentTableKey, conversation } = parsed.data;

    // 3. Admin gate — server-side, the real security boundary. A Member is
    //    rejected with 403 before any LLM call. The admin client reads
    //    `org_members` ONLY here, never on the write path.
    const membership = await requireAdmin(user, createAdminClient());

    // 3b. Cross-org guard: the resolved membership must be the org named by `slug`.
    if (membership.slug !== slug) {
      throw new AppError(403, "forbidden");
    }

    // 4. Build the caller's RLS-scoped identity; the writable variant also rejects
    //    a read_only / expired-trial org before any write.
    const identity = await resolveWritableOrgIdentity(slug, user.id);

    // 5. Copy catalog (translated, no raw internals ever shown to the user).
    const t = await getTranslations("ChatAssistant");

    // 6. Load the org's CURRENT visible schema — the table list the model targets.
    const schemaResult = await getSchema(identity.client, identity.orgId);
    if (schemaResult.error || !schemaResult.data) {
      throw new AppError(500, "writeFailed");
    }
    const tables: ChatTableSummary[] = visibleTables(schemaResult.data).map(
      (table) => ({ key: table.key, label: table.label }),
    );

    // 7. ONE hardened, timeout-wrapped Gemini call. Any failure (timeout, parse,
    //    network) is caught below and degrades gracefully — CRUD is never blocked.
    let output: GeminiAddFieldOutput;
    try {
      const prompt = buildAddFieldPrompt(message, {
        tables,
        currentTableKey: currentTableKey ?? null,
        conversation,
      });
      output = await callGeminiWithTimeout<GeminiAddFieldOutput>(
        prompt,
        ADD_FIELD_RESPONSE_SCHEMA,
      );
    } catch (llmErr) {
      // Degrade gracefully with a translated message; no write, nothing leaked.
      reportError(llmErr, { route: "/api/schema/add-field", stage: "llm" });
      return json(
        { data: { kind: "degraded", assistantText: t("degraded") }, error: null },
        200,
      );
    }

    // 8. Branch on the model's decision.
    if (output.kind === "needs_clarification") {
      const question = isNonEmptyString(output.question)
        ? output.question.trim()
        : t("clarifyFallback");
      return json(
        { data: { kind: "clarify", assistantText: question }, error: null },
        200,
      );
    }

    if (output.kind === "add_field") {
      // A malformed add_field (missing table/label/type) is treated as a rejection
      // rather than trusted — the model must name an exact target + scalar type.
      if (
        !isNonEmptyString(output.tableKey) ||
        !isNonEmptyString(output.label) ||
        !isNonEmptyString(output.type)
      ) {
        return json(
          { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
          200,
        );
      }

      try {
        const result = await addField(
          identity,
          output.tableKey.trim(),
          { label: output.label.trim(), type: output.type.trim() },
          { rawOutput: output },
        );

        if (!result.data) {
          // Defensive: the guarded layer throws on failure, so this is unreachable
          // in practice — treat as a rejection rather than leak anything.
          return json(
            {
              data: { kind: "rejected", assistantText: t("rejection") },
              error: null,
            },
            200,
          );
        }

        // Resolve the target table's human label for the success message.
        const targetTable = tables.find(
          (table) => table.key === result.data!.tableKey,
        );
        return json(
          {
            data: {
              kind: "applied",
              tableKey: result.data.tableKey,
              fieldKey: result.data.fieldKey,
              label: output.label.trim(),
              assistantText: t("successApplied", {
                field: output.label.trim(),
                table: targetTable?.label ?? result.data.tableKey,
              }),
            },
            error: null,
          },
          200,
        );
      } catch (mutateErr) {
        // A validator rejection (reserved/blocked/colliding key, non-scalar type,
        // unknown table) is `AppError(400, "addFieldFailed")` — it was already
        // logged with the org id + raw output by `validateAddField`. Show the fixed
        // plain-language rejection copy; nothing was written.
        if (mutateErr instanceof AppError && mutateErr.statusCode === 400) {
          return json(
            {
              data: { kind: "rejected", assistantText: t("rejection") },
              error: null,
            },
            200,
          );
        }
        // A 5xx (write failure) degrades gracefully — CRUD stays available.
        reportError(mutateErr, {
          route: "/api/schema/add-field",
          stage: "mutate",
        });
        return json(
          {
            data: { kind: "degraded", assistantText: t("degraded") },
            error: null,
          },
          200,
        );
      }
    }

    // out_of_scope (or any unexpected kind) → friendly, non-technical decline.
    const reply = isNonEmptyString(output.reply)
      ? output.reply.trim()
      : t("declineFallback");
    return json(
      { data: { kind: "declined", assistantText: reply }, error: null },
      200,
    );
  } catch (err) {
    return handleError<AddFieldChatResult>(err, "/api/schema/add-field");
  }
}
