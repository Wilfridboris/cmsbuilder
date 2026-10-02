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
import { addField, addTable, addView } from "@/lib/data/schema-mutate";
import { callGeminiWithTimeout } from "@/lib/gemini/client";
import {
  EDITOR_RESPONSE_SCHEMA,
  buildEditorPrompt,
  type ChatTableSummary,
} from "@/lib/gemini/prompts";
import {
  json,
  resolveWritableOrgIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { reportError } from "@/lib/observability/report";
import { editorChatSchema } from "./schemas";

/**
 * `POST /api/schema/edit` (Story 5.1 add a column, 5.2 add a table, 5.3 add a view)
 * — the Admin-only conversational schema editor endpoint.
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
 *   7. ONE `callGeminiWithTimeout` with `buildEditorPrompt` (the hardened system
 *      prompt is injected by the client on 100% of calls; hard 15s timeout);
 *   8. branch on the model's `kind`:
 *        - `add_field`          → `schema-mutate.addField` (focused validator +
 *                                 append-only write). On success → `applied` with
 *                                 the tableKey/fieldKey so the client can drive Undo;
 *        - `add_table`          → `schema-mutate.addTable` (focused validator +
 *                                 append-only write). On success → `applied` with
 *                                 ONLY the tableKey (no fieldKey → the client shows
 *                                 no Undo; Story 5.5 owns table visibility);
 *        - `add_view`           → `schema-mutate.addView` (focused validator +
 *                                 append-only write). On success → `applied` with
 *                                 ONLY the viewKey (no fieldKey → no Undo; Story 5.5
 *                                 owns view visibility);
 *        - `needs_clarification` → `clarify` with the model's question;
 *        - `out_of_scope`/other → `declined` with a friendly non-technical decline.
 *      A validator rejection (either branch) → the fixed plain-language `rejected`
 *      copy; a 5xx degrades gracefully.
 *   9. On ANY LLM timeout/failure → `degraded` with a translated message; CRUD is
 *      untouched. No raw JSON, SQL, schema, error, or stack ever reaches the user.
 *
 * All user-facing copy comes from the `ChatAssistant` next-intl namespace (en+fr).
 */

export const dynamic = "force-dynamic";

/** The server result contract (model -> route -> client). `assistantText` is always a translated human string. */
export type EditorChatResult = {
  kind: "applied" | "clarify" | "declined" | "rejected" | "degraded";
  /** Present on `applied`: the table the change targets (an add-field target, or the new table). */
  tableKey?: string;
  /** Present on an `applied` ADD-FIELD only: the added field key (drives Undo). Absent for an add-table/add-view. */
  fieldKey?: string;
  /** Present on an `applied` ADD-VIEW only: the created view key. Absent for an add-field/add-table. */
  viewKey?: string;
  /** Present on `applied`: the added column's / new table's / new view's label, for the success message. */
  label?: string;
  /** Always a translated, human-readable sentence. Never raw JSON/SQL/errors. */
  assistantText: string;
};

/** Shape returned by the single Gemini call (flat — the route reads by `kind`). */
type GeminiEditorOutput = {
  kind?:
    | "add_field"
    | "add_table"
    | "add_view"
    | "needs_clarification"
    | "out_of_scope";
  tableKey?: unknown;
  sourceTableKey?: unknown;
  label?: unknown;
  type?: unknown;
  fields?: unknown;
  filters?: unknown;
  sort?: unknown;
  question?: unknown;
  reply?: unknown;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<EditorChatResult>>> {
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
    const parsed = editorChatSchema.safeParse(raw);
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
      (table) => ({
        key: table.key,
        label: table.label,
        // Expose only VISIBLE SCALAR fields so the model builds a view's
        // filters/sort against real, filterable keys (relations are chat-excluded).
        fields: table.fields
          .filter((field) => !field.hidden && field.type !== "relation")
          .map((field) => ({
            key: field.key,
            label: field.label,
            type: field.type,
          })),
      }),
    );

    // 7. ONE hardened, timeout-wrapped Gemini call. Any failure (timeout, parse,
    //    network) is caught below and degrades gracefully — CRUD is never blocked.
    let output: GeminiEditorOutput;
    try {
      const prompt = buildEditorPrompt(message, {
        tables,
        currentTableKey: currentTableKey ?? null,
        conversation,
      });
      output = await callGeminiWithTimeout<GeminiEditorOutput>(
        prompt,
        EDITOR_RESPONSE_SCHEMA,
      );
    } catch (llmErr) {
      // Degrade gracefully with a translated message; no write, nothing leaked.
      reportError(llmErr, { route: "/api/schema/edit", stage: "llm" });
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
        return handleMutateError(mutateErr, t, "mutate");
      }
    }

    if (output.kind === "add_table") {
      // A malformed add_table (missing label or no fields) is treated as a rejection
      // rather than trusted — the validator does the real gating, but a shapeless
      // output never reaches it.
      if (!isNonEmptyString(output.label) || !Array.isArray(output.fields)) {
        return json(
          { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
          200,
        );
      }

      // Project the model's fields down to the `{ label, type }` scalar input; the
      // validator rejects any malformed/non-scalar entry.
      const fields = output.fields.map((field) => {
        const f = (field ?? {}) as { label?: unknown; type?: unknown };
        return {
          label: typeof f.label === "string" ? f.label : "",
          type: typeof f.type === "string" ? f.type : "",
        };
      });

      try {
        const result = await addTable(
          identity,
          { label: output.label.trim(), fields },
          { rawOutput: output },
        );

        if (!result.data) {
          return json(
            {
              data: { kind: "rejected", assistantText: t("rejection") },
              error: null,
            },
            200,
          );
        }

        // Surface-only navigation: the success copy points the Admin to the new
        // table in the switcher (the client's router.refresh makes it appear). No
        // fieldKey is set → the client shows no Undo (Story 5.5 owns table hide).
        return json(
          {
            data: {
              kind: "applied",
              tableKey: result.data.tableKey,
              label: output.label.trim(),
              assistantText: t("successTableAdded", {
                table: output.label.trim(),
              }),
            },
            error: null,
          },
          200,
        );
      } catch (mutateErr) {
        return handleMutateError(mutateErr, t, "mutate-table");
      }
    }

    if (output.kind === "add_view") {
      // A shapeless add_view (missing label / source table, or non-array filters)
      // is treated as a rejection rather than trusted — the validator does the real
      // gating, but a shapeless output never reaches it.
      if (
        !isNonEmptyString(output.label) ||
        !isNonEmptyString(output.sourceTableKey) ||
        !Array.isArray(output.filters)
      ) {
        return json(
          { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
          200,
        );
      }

      // Project the model's filters/sort down to the validator input; the validator
      // rejects any malformed/non-scalar/invalid-operator entry (nothing trusted).
      const filters = output.filters.map((filter) => {
        const f = (filter ?? {}) as {
          field?: unknown;
          operator?: unknown;
          value?: unknown;
          value2?: unknown;
        };
        return {
          field: typeof f.field === "string" ? f.field : "",
          operator: typeof f.operator === "string" ? f.operator : "",
          value: f.value,
          value2: f.value2,
        };
      });
      const rawSort = output.sort as
        | { field?: unknown; direction?: unknown }
        | null
        | undefined;
      const sort =
        rawSort && typeof rawSort === "object" && isNonEmptyString(rawSort.field)
          ? {
              field: String(rawSort.field),
              direction:
                typeof rawSort.direction === "string" ? rawSort.direction : "",
            }
          : null;

      try {
        const result = await addView(
          identity,
          {
            label: output.label.trim(),
            sourceTableKey: output.sourceTableKey.trim(),
            filters,
            sort,
          },
          { rawOutput: output },
        );

        if (!result.data) {
          return json(
            {
              data: { kind: "rejected", assistantText: t("rejection") },
              error: null,
            },
            200,
          );
        }

        // Surface-only navigation: the success copy points the Admin to the new
        // view in the switcher (the client's router.refresh makes it appear). No
        // fieldKey → the client shows no Undo (Story 5.5 owns view visibility).
        return json(
          {
            data: {
              kind: "applied",
              viewKey: result.data.viewKey,
              label: output.label.trim(),
              assistantText: t("successViewAdded", {
                view: output.label.trim(),
              }),
            },
            error: null,
          },
          200,
        );
      } catch (mutateErr) {
        return handleMutateError(mutateErr, t, "mutate-view");
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
    return handleError<EditorChatResult>(err, "/api/schema/edit");
  }
}

/**
 * Map a guarded-write failure to a safe chat result. A validator rejection
 * (`AppError(400, ...)` — reserved/blocked/colliding key, non-scalar type, unknown
 * table) was already logged with the org id + raw output by the validator; show the
 * fixed plain-language rejection copy (nothing was written). A 5xx (write failure)
 * degrades gracefully so CRUD stays available. A raw error/stack/SQL never leaks.
 */
function handleMutateError(
  err: unknown,
  t: Awaited<ReturnType<typeof getTranslations>>,
  stage: "mutate" | "mutate-table" | "mutate-view",
): NextResponse<ApiResponse<EditorChatResult>> {
  if (err instanceof AppError && err.statusCode === 400) {
    return json(
      { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
      200,
    );
  }
  reportError(err, { route: "/api/schema/edit", stage });
  return json(
    { data: { kind: "degraded", assistantText: t("degraded") }, error: null },
    200,
  );
}
