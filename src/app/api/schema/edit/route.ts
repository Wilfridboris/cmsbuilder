import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { getTranslations } from "next-intl/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { getSchema } from "@/lib/data/records";
import { canHideTable, visibleTables, visibleViews } from "@/lib/schema/overrides";
import {
  addField,
  addSelectOption,
  addTable,
  addView,
  archiveSelectOption,
  removeView,
  renameSelectOption,
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
  requireUser,
  resolveWritableAdminIdentity,
  handleError,
  type OrgIdentity,
} from "@/lib/api/route-helpers";
import { reportError } from "@/lib/observability/report";
import { editorChatSchema } from "./schemas";

/**
 * `POST /api/schema/edit` (Story 5.1 add a column, 5.2 add a table, 5.3 add a view)
 * — the Admin-only conversational schema editor endpoint.
 *
 * Flow (every guard server-side; the LLM is NEVER a dependency for core CRUD):
 *   1. `requireUser()` (JWT-validated) → 401 if no session;
 *   2. Zod-validate `{ slug, message, currentTableKey?, conversation? }`;
 *   3. `resolveWritableAdminIdentity(slug, user)` (retro [A1]) — one helper for the
 *      admin gate (403 for a Member; the chat is also hidden client-side), the
 *      `membership.slug === slug` cross-org check (403), the RLS-scoped client +
 *      org id, and the read_only / expired-trial writable assertion, all before any
 *      write. The service-role admin client reads `org_members` ONLY inside it;
 *   6. load the org's CURRENT schema (the table list the model may target);
 *   7. ONE `callGeminiWithTimeout` with `buildEditorPrompt` (the hardened system
 *      prompt is injected by the client on 100% of calls; hard 15s timeout);
 *   8. the explicit operation-allowlist + raw-SQL discard fence (Story 5.4, 5.5):
 *        `assertEditorOperationAllowed` rejects any `kind` outside
 *        `add_field`/`add_table`/`add_view`/`hide_field`/`remove_view` and any
 *        output containing raw SQL before any write, logging each via `reportRejection` with the org
 *        id + raw output. `needs_clarification`/`out_of_scope` are conversational
 *        kinds, not operations, and bypass the fence into their own flows below;
 *      then a per-kind handler (retro [A3]) runs for the model's `kind`:
 *        - `add_field`          → `schema-mutate.addField` (focused validator +
 *                                 append-only write). On success → `applied` with
 *                                 the tableKey/fieldKey so the client can drive Undo;
 *        - `add_table`          → `schema-mutate.addTable` (focused validator +
 *                                 append-only write). On success → `applied` with
 *                                 the tableKey + undo:"hide-table" so the client
 *                                 offers an Undo that hides the just-added table;
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
 *        - `hide_table`         → resolve + validate the target and return a
 *                                 `confirm` OFFER (no mutation; Story 5.7). The real
 *                                 write runs on the button click via the direct
 *                                 `/api/schema/tables` path;
 *        - `needs_clarification` → `clarify` with the model's question;
 *        - `out_of_scope`/other → `declined` with a friendly non-technical decline.
 *      A validator rejection (any branch) → the fixed plain-language `rejected`
 *      copy; a 5xx degrades gracefully.
 *   9. On ANY LLM timeout/failure → `degraded` with a translated message; CRUD is
 *      untouched. No raw JSON, SQL, schema, error, or stack ever reaches the user.
 *
 * All user-facing copy comes from the `ChatAssistant` next-intl namespace (en+fr).
 */

export const dynamic = "force-dynamic";

/** The server result contract (model -> route -> client). `assistantText` is always a translated human string. */
export type EditorChatResult = {
  kind: "applied" | "clarify" | "confirm" | "declined" | "rejected" | "degraded";
  /** Present on `applied`: the table the change targets (an add-field target, a hidden column's table, or the new table). Present on a `confirm` hide-table OFFER: the table proposed for hiding. */
  tableKey?: string;
  /** Present on an `applied` ADD-FIELD or HIDE-FIELD: the field key (drives Undo). Absent for an add-table/add-view. */
  fieldKey?: string;
  /** Present on an `applied` ADD-VIEW or REMOVE-VIEW: the created / removed view key. Absent for an add-field/add-table/hide-field. */
  viewKey?: string;
  /**
   * Present on an `applied` column change, add-view, OR add-table: which way the
   * inline Undo reverses the change. `"hide"` means the change SHOWED a column (an
   * add-field; Undo hides it), `"show"` means the change HID a column (a
   * hide-field; Undo shows it again), `"remove"` means the change ADDED a view (an
   * add-view; Undo removes that just-added view via the `remove_view` path, keyed
   * by `viewKey`), `"hide-table"` means the change ADDED a table (an add-table;
   * Undo hides that just-added table via the direct `/api/schema/tables` path,
   * keyed by `tableKey`). The client drives the matching Undo from this direction.
   * Absent → no Undo.
   */
  undo?: "hide" | "show" | "remove" | "hide-table";
  /**
   * Present on a `confirm` hide-table OFFER: which direct confirm action the inline
   * button drives. `"hide-table"` means clicking "Hide the table" calls the direct
   * `/api/schema/tables` `{action:"hide"}` path for the `tableKey`. No mutation ran
   * server-side — the model's `hide_table` only yields this offer.
   */
  confirm?: "hide-table";
  /** Present on `applied`: the added column's / hidden column's / new table's / new view's label, for the success message. Present on a `confirm` hide-table OFFER: the proposed table's label. */
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
    | "hide_table"
    | "add_select_option"
    | "rename_select_option"
    | "archive_select_option"
    | "needs_clarification"
    | "out_of_scope";
  tableKey?: unknown;
  fieldKey?: unknown;
  /**
   * Present when `kind` is `rename_select_option` or `archive_select_option`
   * (Story 13.4): the stored `value` token of the existing select option to
   * rename/archive. The route resolves it against the stored schema in the mutator.
   */
  optionValue?: unknown;
  viewKey?: unknown;
  sourceTableKey?: unknown;
  label?: unknown;
  type?: unknown;
  /**
   * Present when `kind` is `add_field` and `type` is `select` (Story 13.3): the
   * owner-stated choices as `{ label, value }` objects. Forwarded verbatim into
   * `AddFieldInput.options`, where `validateSelectOptions` normalizes, dedupes,
   * and rejects empty/duplicate/unlabelled entries. Ignored for scalar types.
   */
  options?: unknown;
  fields?: unknown;
  filters?: unknown;
  sort?: unknown;
  question?: unknown;
  reply?: unknown;
};

/**
 * Everything a per-kind handler (retro [A3]) needs: the model output, the resolved
 * writable admin identity, the VISIBLE-SCALAR table + view summaries the model was
 * shown (used to resolve targets before any write), the raw current schema (for the
 * `canHideTable` backstop), and the translator. Built once in `POST` after the
 * Story-5.4 fence, so every mutating handler runs AFTER the allowlist + raw-SQL
 * gate and none can reach a mutator ungated.
 */
type EditorContext = {
  output: GeminiEditorOutput;
  identity: OrgIdentity;
  tables: ChatTableSummary[];
  views: ChatViewSummary[];
  schemaData: NonNullable<Awaited<ReturnType<typeof getSchema>>["data"]>;
  t: Awaited<ReturnType<typeof getTranslations>>;
};

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<EditorChatResult>>> {
  try {
    // 1. Identify the caller. No session → 401.
    const user = await requireUser();

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

    // 3. Admin gate + cross-org + writable in one helper (retro [A1]): resolve the
    //    org under the caller's RLS client, require the caller be an admin of the
    //    SAME org (a Member → 403 before any LLM call; an admin of a different org
    //    → 403), and reject a read_only / expired-trial org before any write. The
    //    service-role admin client reads `org_members` ONLY inside the guard.
    const identity = await resolveWritableAdminIdentity(slug, user);

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
          .map((field) =>
            // A select field carries its current options so the model can target
            // one by its stored value for a rename/archive op (Story 13.4).
            field.type === "select"
              ? {
                  key: field.key,
                  label: field.label,
                  type: field.type,
                  options: field.options ?? [],
                }
              : {
                  key: field.key,
                  label: field.label,
                  type: field.type,
                },
          ),
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
    //     Everything else must be one of the permitted ops with no raw SQL
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

    // 9. Dispatch the validated op to its focused handler (retro [A3]). Every
    //    mutating handler runs AFTER the 8b fence above, so none can reach a
    //    mutator ungated. `out_of_scope` is the only kind that skipped the fence;
    //    it falls through to the friendly decline below.
    const ctx: EditorContext = {
      output,
      identity,
      tables,
      views,
      schemaData: schemaResult.data,
      t,
    };
    switch (output.kind) {
      case "add_field":
        return handleAddField(ctx);
      case "add_table":
        return handleAddTable(ctx);
      case "add_view":
        return handleAddView(ctx);
      case "hide_field":
        return handleHideField(ctx);
      case "remove_view":
        return handleRemoveView(ctx);
      case "hide_table":
        return handleHideTable(ctx);
      case "add_select_option":
        return handleAddSelectOption(ctx);
      case "rename_select_option":
        return handleRenameSelectOption(ctx);
      case "archive_select_option":
        return handleArchiveSelectOption(ctx);
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
 * `add_field` → guarded append-only column add (Story 5.1). A shapeless output
 * (missing table/label/type) is a rejection rather than trusted — the model must
 * name an exact target + scalar type. On success → `applied` + `undo:"hide"`.
 */
async function handleAddField(
  ctx: EditorContext,
): Promise<NextResponse<ApiResponse<EditorChatResult>>> {
  const { output, identity, tables, t } = ctx;
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
    const type = output.type.trim();
    // A `select` field carries the owner-stated choices through to the already-
    // ready validator/mutator (Story 13.1): `validateSelectOptions` normalizes,
    // dedupes, and rejects empty/duplicate/unlabelled options. Scalar types pass
    // no `options` and the field is unchanged.
    const result = await addField(
      identity,
      output.tableKey.trim(),
      type === "select"
        ? { label: output.label.trim(), type, options: output.options }
        : { label: output.label.trim(), type },
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

/**
 * `add_table` → guarded append-only table add (Story 5.2). A shapeless output
 * (missing label or no fields) is a rejection. On success → `applied` with ONLY the
 * tableKey + `undo:"hide-table"` (the Undo hides the just-added table; Story 5.7).
 */
async function handleAddTable(
  ctx: EditorContext,
): Promise<NextResponse<ApiResponse<EditorChatResult>>> {
  const { output, identity, t } = ctx;
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
    // table in the switcher (the client's router.refresh makes it appear). The
    // result now carries `undo: "hide-table"` + the created `tableKey` so the
    // chat bubble offers a one-tap Undo that HIDES the just-added table via the
    // direct `/api/schema/tables` path (Story 5.7). An Undo click is itself the
    // confirmation (no offer step), and a hide is non-destructive — the table
    // and every row stay intact and can be restored from Settings.
    return json(
      {
        data: {
          kind: "applied",
          tableKey: result.data.tableKey,
          undo: "hide-table",
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

/**
 * `add_view` → guarded append-only view add (Story 5.3). A shapeless output
 * (missing label / source table, or non-array filters) is a rejection. On success →
 * `applied` with the viewKey + `undo:"remove"` (the Undo removes the just-added
 * view; Story 5.6 — a view holds no rows, so its removal is non-destructive).
 */
async function handleAddView(
  ctx: EditorContext,
): Promise<NextResponse<ApiResponse<EditorChatResult>>> {
  const { output, identity, t } = ctx;
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

/**
 * `hide_field` → the SAFE answer to "delete/remove this column" (Story 5.5): hide
 * that one column via the append-only visibility flag — the field definition and
 * all row data stay intact, and the hide is reversible from the chat. The target is
 * enforced against the VISIBLE-SCALAR summary the model was shown (so a relation,
 * already-hidden, or hallucinated key → reassuring `declined`, no write). A missing
 * table/field at the mutator (`AppError(400)`) also maps to `declined`; a 5xx
 * degrades. On success → `applied` + `undo:"show"`.
 */
async function handleHideField(
  ctx: EditorContext,
): Promise<NextResponse<ApiResponse<EditorChatResult>>> {
  const { output, identity, tables, t } = ctx;
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

/**
 * `remove_view` → remove a saved view (Story 5.6), the ONE permitted true removal
 * because a view holds no rows. A shapeless output (missing viewKey) is a rejection;
 * a viewKey outside the shown views summary → reassuring `declined` (no write); a
 * missing view at the mutator (`AppError(400)`) also → `declined`; a 5xx degrades.
 */
async function handleRemoveView(
  ctx: EditorContext,
): Promise<NextResponse<ApiResponse<EditorChatResult>>> {
  const { output, identity, views, t } = ctx;
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

/**
 * `hide_table` → the SAFE answer to "delete/remove a whole TABLE" (Story 5.7).
 * Unlike hide_field (which applies immediately), a table hide is consequential — it
 * removes a dashboard tab — so this performs NO mutation: it resolves + validates
 * the target against the shown tables summary and returns an OFFER (`confirm`). A
 * button click then drives the real write through the direct, non-LLM
 * `/api/schema/tables` path. A shapeless output (missing tableKey) is a rejection;
 * an out-of-summary key → `declined`; the LAST visible table → `declined`
 * (`tableHideLast`).
 */
async function handleHideTable(
  ctx: EditorContext,
): Promise<NextResponse<ApiResponse<EditorChatResult>>> {
  const { output, tables, schemaData, t } = ctx;
  if (!isNonEmptyString(output.tableKey)) {
    return json(
      { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
      200,
    );
  }

  const tableKey = output.tableKey.trim();

  // Resolve-before-write guard (mirrors the hide_field / remove_view guards):
  // enforce the tableKey against the VISIBLE tables summary the model was
  // actually shown (`tables`), not just the model's obedience. A key outside it
  // (a hallucinated or stale key, or an already-hidden table) is NOT a hideable
  // target: reassure and offer nothing. This also guarantees the label below
  // resolves (the message never shows a raw key).
  const targetTable = tables.find((table) => table.key === tableKey);
  if (!targetTable) {
    return json(
      {
        data: { kind: "declined", assistantText: t("declineFallback") },
        error: null,
      },
      200,
    );
  }

  // Never offer to hide the LAST visible table (it would empty the dashboard).
  // The mutator re-checks this as the real backstop, but checking here lets us
  // decline with a good, specific message instead of making a dead-end offer.
  if (!canHideTable(schemaData)) {
    return json(
      {
        data: { kind: "declined", assistantText: t("tableHideLast") },
        error: null,
      },
      200,
    );
  }

  // Return the OFFER. No mutation ran — the client renders a reassuring prompt
  // with a "Hide the table" confirm button that calls `/api/schema/tables`.
  return json(
    {
      data: {
        kind: "confirm",
        tableKey,
        confirm: "hide-table",
        label: targetTable.label,
        assistantText: t("tableHideOffer", { table: targetTable.label }),
      },
      error: null,
    },
    200,
  );
}

/**
 * Shared `applied` response for the three select-option ops (Story 13.4). Resolves
 * the target field's human label (from the summary the model was shown) for the
 * success message and echoes the applied op. `value` is the human value shown to
 * the owner — already resolved by the caller (archive resolves the option label
 * from the pre-mutation options; add/rename use the new label). Keeps the three
 * handlers to their distinct validation + mutator heads (Epic 13 retro F8).
 */
function appliedSelectOption(
  ctx: EditorContext,
  result: { tableKey: string; fieldKey: string },
  successKey: "successValueAdded" | "successValueRenamed" | "successValueArchived",
  value: string,
): NextResponse<ApiResponse<EditorChatResult>> {
  const { tables, t } = ctx;
  const targetTable = tables.find((table) => table.key === result.tableKey);
  const targetField = targetTable?.fields?.find(
    (field) => field.key === result.fieldKey,
  );
  return json(
    {
      data: {
        kind: "applied",
        tableKey: result.tableKey,
        fieldKey: result.fieldKey,
        label: value,
        assistantText: t(successKey, {
          value,
          field: targetField?.label ?? result.fieldKey,
        }),
      },
      error: null,
    },
    200,
  );
}

/**
 * `add_select_option` → guarded append-only select-value add (Story 13.4). A
 * shapeless output (missing table/field/label) is a rejection. The target is
 * enforced inside the guarded mutator by `validateAddSelectOption`/`findSelectField`
 * (a non-select / hallucinated / hidden field → `AppError(400)` → reassuring
 * `rejected`, never trusted) — not by this handler. On success → `applied` naming
 * the value + field.
 */
async function handleAddSelectOption(
  ctx: EditorContext,
): Promise<NextResponse<ApiResponse<EditorChatResult>>> {
  const { output, identity, t } = ctx;
  if (
    !isNonEmptyString(output.tableKey) ||
    !isNonEmptyString(output.fieldKey) ||
    !isNonEmptyString(output.label)
  ) {
    return json(
      { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
      200,
    );
  }

  const tableKey = output.tableKey.trim();
  const fieldKey = output.fieldKey.trim();
  const label = output.label.trim();

  try {
    const result = await addSelectOption(
      identity,
      tableKey,
      fieldKey,
      { label },
      { rawOutput: output },
    );

    if (!result.data) {
      return json(
        { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
        200,
      );
    }

    return appliedSelectOption(ctx, result.data, "successValueAdded", result.data.label);
  } catch (mutateErr) {
    return handleMutateError(mutateErr, t, "mutate-select-option");
  }
}

/**
 * `rename_select_option` → guarded label-only rename of an existing select value
 * (Story 13.4). A shapeless output (missing table/field/optionValue/label) is a
 * rejection. The stored value is never changed, so existing records are untouched.
 * On success → `applied` naming the new label + field.
 */
async function handleRenameSelectOption(
  ctx: EditorContext,
): Promise<NextResponse<ApiResponse<EditorChatResult>>> {
  const { output, identity, t } = ctx;
  if (
    !isNonEmptyString(output.tableKey) ||
    !isNonEmptyString(output.fieldKey) ||
    !isNonEmptyString(output.optionValue) ||
    !isNonEmptyString(output.label)
  ) {
    return json(
      { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
      200,
    );
  }

  const tableKey = output.tableKey.trim();
  const fieldKey = output.fieldKey.trim();
  const value = output.optionValue.trim();
  const label = output.label.trim();

  try {
    const result = await renameSelectOption(
      identity,
      tableKey,
      fieldKey,
      { value, label },
      { rawOutput: output },
    );

    if (!result.data) {
      return json(
        { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
        200,
      );
    }

    return appliedSelectOption(
      ctx,
      result.data,
      "successValueRenamed",
      result.data.label,
    );
  } catch (mutateErr) {
    return handleMutateError(mutateErr, t, "mutate-select-option");
  }
}

/**
 * `archive_select_option` → guarded archive (soft-hide) of an existing select
 * value (Story 13.4). A shapeless output (missing table/field/optionValue) is a
 * rejection. The option is never removed (existing records still render its
 * label); the last-active / already-archived guards live in the validator (400 →
 * `rejected`). On success → `applied` naming the archived value's field.
 */
async function handleArchiveSelectOption(
  ctx: EditorContext,
): Promise<NextResponse<ApiResponse<EditorChatResult>>> {
  const { output, identity, tables, t } = ctx;
  if (
    !isNonEmptyString(output.tableKey) ||
    !isNonEmptyString(output.fieldKey) ||
    !isNonEmptyString(output.optionValue)
  ) {
    return json(
      { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
      200,
    );
  }

  const tableKey = output.tableKey.trim();
  const fieldKey = output.fieldKey.trim();
  const value = output.optionValue.trim();

  try {
    const result = await archiveSelectOption(
      identity,
      tableKey,
      fieldKey,
      { value },
      { rawOutput: output },
    );

    if (!result.data) {
      return json(
        { data: { kind: "rejected", assistantText: t("rejection") }, error: null },
        200,
      );
    }

    // Resolve the archived option's human label (for the message) from the
    // summary the model was shown — never echo a raw value token.
    const targetField = tables
      .find((table) => table.key === result.data!.tableKey)
      ?.fields?.find((field) => field.key === result.data!.fieldKey);
    const optionLabel =
      targetField?.options?.find((o) => o.value === result.data!.value)?.label ??
      result.data.value;
    return appliedSelectOption(
      ctx,
      result.data,
      "successValueArchived",
      optionLabel,
    );
  } catch (mutateErr) {
    return handleMutateError(mutateErr, t, "mutate-select-option");
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
  stage: "mutate" | "mutate-table" | "mutate-view" | "mutate-select-option",
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
