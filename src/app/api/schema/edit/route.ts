import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { getSchema } from "@/lib/data/records";
import { visibleTables, visibleViews } from "@/lib/schema/overrides";
import {
  addField,
  addTable,
  addView,
  removeView,
  setFieldVisibility,
} from "@/lib/data/schema-mutate";
import { assertEditorOperationAllowed } from "@/lib/schema/validator";
import { callGeminiWithTimeout } from "@/lib/gemini/client";
import {
  EDITOR_RESPONSE_SCHEMA,
  buildEditorPrompt,
  type ChatTableSummary,
  type ChatViewSummary,
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
 *   8. the explicit operation-allowlist + raw-SQL discard fence (Story 5.4, 5.5):
 *        `assertEditorOperationAllowed` rejects any `kind` outside
 *        `add_field`/`add_table`/`add_view`/`hide_field`/`remove_view` and any
 *        output containing raw SQL before any write, logging each via `reportRejection` with the org
 *        id + raw output. `needs_clarification`/`out_of_scope` are conversational
 *        kinds, not operations, and bypass the fence into their own flows below;
 *      then branch on the model's `kind`:
 *        - `add_field`          → `schema-mutate.addField` (focused validator +
 *                                 append-only write). On success → `applied` with
 *                                 the tableKey/fieldKey so the client can drive Undo;
 *        - `add_table`          → `schema-mutate.addTable` (focused validator +
 *                                 append-only write). On success → `applied` with
 *                                 ONLY the tableKey (no fieldKey → the client shows
 *                                 no Undo; Story 5.5 owns table visibility);
 *        - `add_view`           → `schema-mutate.addView` (focused validator +
 *                                 append-only write). On success → `applied` with
 *                                 the viewKey + undo:"remove" so the client offers
 *                                 an Undo that removes the just-added view (Story
 *                                 5.6; a view holds no rows, so removal is safe);
 *        - `remove_view`        → `schema-mutate.removeView` (resolve the viewKey
 *                                 against the shown views summary before any write;
 *                                 out-of-summary → reassuring `declined`). On
 *                                 success → `applied` naming the removed view. The
 *                                 one permitted true removal (a view stores no
 *                                 rows); view HIDE is never built;
 *        - `hide_field`         → `schema-mutate.setFieldVisibility(..., true)` —
 *                                 the SAFE answer to "delete/remove this column"
 *                                 (Story 5.5): hides one column via the append-only
 *                                 visibility flag (data intact). On success →
 *                                 `applied` with tableKey/fieldKey + undo:"show" so
 *                                 the client offers a show-again Undo. A missing
 *                                 table/field (`AppError(400)`) maps to a reassuring
 *                                 `declined`, never an error;
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
  /** Present on `applied`: the table the change targets (an add-field target, a hidden column's table, or the new table). */
  tableKey?: string;
  /** Present on an `applied` ADD-FIELD or HIDE-FIELD: the field key (drives Undo). Absent for an add-table/add-view. */
  fieldKey?: string;
  /** Present on an `applied` ADD-VIEW or REMOVE-VIEW: the created / removed view key. Absent for an add-field/add-table/hide-field. */
  viewKey?: string;
  /**
   * Present on an `applied` column change OR add-view: which way the inline Undo
   * reverses the change. `"hide"` means the change SHOWED a column (an add-field;
   * Undo hides it), `"show"` means the change HID a column (a hide-field; Undo
   * shows it again), `"remove"` means the change ADDED a view (an add-view; Undo
   * removes that just-added view via the `remove_view` path, keyed by `viewKey`).
   * The client drives the matching Undo from this direction. Absent → no Undo.
   */
  undo?: "hide" | "show" | "remove";
  /** Present on `applied`: the added column's / hidden column's / new table's / new view's label, for the success message. */
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
    | "hide_field"
    | "remove_view"
    | "needs_clarification"
    | "out_of_scope";
  tableKey?: unknown;
  fieldKey?: unknown;
  viewKey?: unknown;
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
    // The existing views the model may be asked to REMOVE (Story 5.6) — exact
    // key + label + source table, so a remove request resolves to one real view.
    const views: ChatViewSummary[] = visibleViews(schemaResult.data).map(
      (view) => ({
        key: view.key,
        label: view.label,
        sourceTableKey: view.sourceTableKey,
      }),
    );

    // 7. ONE hardened, timeout-wrapped Gemini call. Any failure (timeout, parse,
    //    network) is caught below and degrades gracefully — CRUD is never blocked.
    let output: GeminiEditorOutput;
    try {
      const prompt = buildEditorPrompt(message, {
        tables,
        views,
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

    // 8b. The explicit operation allowlist + raw-SQL discard fence (Story 5.4).
    //     `out_of_scope` is a conversational kind, not an operation — it falls
    //     through to the friendly `declined` path below and is NOT a rejection.
    //     Everything else must be one of the three permitted ops with no raw SQL
    //     in its output; anything else is rejected before any write and logged
    //     via `reportRejection` with the org id + raw output (the fixed copy is
    //     all the user ever sees).
    if (output.kind !== "out_of_scope") {
      const guard = assertEditorOperationAllowed(output, {
        id: identity.orgId,
        rawOutput: output,
      });
      if (!guard.allowed) {
        return json(
          { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
          200,
        );
      }
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
              // Undo of an add-field HIDES the just-added column.
              undo: "hide",
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
        // fieldKey/undo is set → the client shows no Undo. Story 5.5 added only
        // COLUMN hide; whole-table hide (and an add-table Undo) are deferred.
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
        // view in the switcher (the client's router.refresh makes it appear). The
        // result now carries `undo: "remove"` + the created `viewKey` so the chat
        // bubble offers a one-tap Undo that removes the just-added view via the
        // `remove_view` path (Story 5.6). A view holds no rows, so its removal is
        // non-destructive and the freed key re-derives identically on re-add.
        return json(
          {
            data: {
              kind: "applied",
              viewKey: result.data.viewKey,
              undo: "remove",
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

    if (output.kind === "hide_field") {
      // The safe answer to "delete/remove this column" (Story 5.5): hide that one
      // column via the append-only visibility flag — the field definition and all
      // row data stay intact, and the hide is reversible from the chat. A shapeless
      // hide_field (missing an exact table/field key) is treated as a rejection
      // rather than trusted — the model must name an exact, existing target.
      if (!isNonEmptyString(output.tableKey) || !isNonEmptyString(output.fieldKey)) {
        return json(
          { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
          200,
        );
      }

      const tableKey = output.tableKey.trim();
      const fieldKey = output.fieldKey.trim();

      // Enforce the hide target against the VISIBLE-SCALAR summary the model was
      // actually shown (`tables`), not just the model's obedience. The summary
      // excludes relation columns and already-hidden fields, so a fieldKey outside
      // it (a relation, an already-hidden column, or a hallucinated key) is NOT a
      // hideable target: reassure and write nothing. This keeps the frozen "never
      // expose a relation/already-hidden column as a hide target" invariant a
      // route-side check (matching the distrust-the-model posture of Story 5.4),
      // and guarantees the labels below resolve (so the message never shows a raw
      // key).
      const targetTable = tables.find((table) => table.key === tableKey);
      const targetField = targetTable?.fields?.find(
        (field) => field.key === fieldKey,
      );
      if (!targetTable || !targetField) {
        return json(
          {
            data: { kind: "declined", assistantText: t("declineFallback") },
            error: null,
          },
          200,
        );
      }

      try {
        const result = await setFieldVisibility(identity, tableKey, fieldKey, true);

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

        return json(
          {
            data: {
              kind: "applied",
              tableKey: result.data.tableKey,
              fieldKey: result.data.fieldKey,
              // Undo of a hide SHOWS the column again (the inverse of add-field).
              undo: "show",
              label: targetField.label,
              assistantText: t("columnHidden", {
                field: targetField.label,
                table: targetTable.label,
              }),
            },
            error: null,
          },
          200,
        );
      } catch (hideErr) {
        // A missing table/field is `AppError(400)` from the mutator — map it to a
        // reassuring decline (nothing was written), NOT a rejection/error screen.
        // A 5xx degrades gracefully. No raw detail ever reaches the user.
        if (hideErr instanceof AppError && hideErr.statusCode === 400) {
          return json(
            {
              data: { kind: "declined", assistantText: t("declineFallback") },
              error: null,
            },
            200,
          );
        }
        reportError(hideErr, { route: "/api/schema/edit", stage: "hide-field" });
        return json(
          { data: { kind: "degraded", assistantText: t("degraded") }, error: null },
          200,
        );
      }
    }

    if (output.kind === "remove_view") {
      // Remove a saved view (Story 5.6) — the ONE permitted true removal, because
      // a view holds no rows. A shapeless remove_view (missing an exact viewKey)
      // is treated as a rejection rather than trusted — the model must name an
      // exact, existing view.
      if (!isNonEmptyString(output.viewKey)) {
        return json(
          { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
          200,
        );
      }

      const viewKey = output.viewKey.trim();

      // Resolve-before-write guard (mirrors the Story 5.5 hide_field guard):
      // enforce the viewKey against the VIEWS summary the model was actually shown
      // (`views`), not just the model's obedience. A key outside it (a hallucinated
      // or stale key) is NOT a removable target: reassure and write nothing. This
      // also guarantees the label below resolves (the message never shows a raw key).
      const targetView = views.find((view) => view.key === viewKey);
      if (!targetView) {
        return json(
          {
            data: { kind: "declined", assistantText: t("declineFallback") },
            error: null,
          },
          200,
        );
      }

      try {
        const result = await removeView(identity, viewKey);

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

        return json(
          {
            data: {
              kind: "applied",
              viewKey,
              label: targetView.label,
              assistantText: t("viewRemoved", { view: targetView.label }),
            },
            error: null,
          },
          200,
        );
      } catch (removeErr) {
        // A missing view is `AppError(400)` from the mutator — map it to a
        // reassuring decline (nothing was written), NOT a rejection/error screen.
        // A 5xx degrades gracefully. No raw detail ever reaches the user.
        if (removeErr instanceof AppError && removeErr.statusCode === 400) {
          return json(
            {
              data: { kind: "declined", assistantText: t("declineFallback") },
              error: null,
            },
            200,
          );
        }
        reportError(removeErr, { route: "/api/schema/edit", stage: "remove-view" });
        return json(
          { data: { kind: "degraded", assistantText: t("degraded") }, error: null },
          200,
        );
      }
    }

    // out_of_scope → friendly, non-technical decline. (The 8b fence above already
    // rejected every other non-permitted kind, so only out_of_scope reaches here.)
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
