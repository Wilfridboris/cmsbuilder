import type { EditorChatResult } from "@/app/api/schema/edit/route";
import type { ChatTurn } from "@/lib/gemini/prompts";
import type { ViewDefinition } from "@/types/db";

/**
 * Client-side fetch wrapper for the conversational schema editor endpoint (Story
 * 5.1 add a column, 5.2 add a table, 5.3 add a view). Posts the ephemeral chat turn
 * to `POST /api/schema/edit` and returns the typed server result envelope's `data`
 * (the `{ kind, assistantText, tableKey?, fieldKey?, viewKey?, label? }` contract).
 *
 * The endpoint already maps every outcome — success, clarification, decline,
 * validator rejection, and LLM degradation — to a translated, human `assistantText`
 * with a 200 status, so the only thing left for the client is a true transport /
 * auth failure (401/403/5xx or a network error). Those surface through a thrown
 * `SchemaChatError` carrying the server error CODE, which the panel maps to the
 * degraded message — a raw error, stack, or SQL never reaches the UI.
 */

/** Carries the server error code (or `genericError`) for a true transport failure. */
export class SchemaChatError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "SchemaChatError";
    this.code = code;
  }
}

/**
 * The one POST path every schema-chat action shares (retro [A5]): fetch the
 * endpoint, parse the `{ data, error }` envelope, and throw a `SchemaChatError`
 * carrying the server error CODE (or `genericError`) on any true transport /
 * parse / `!ok` / server-error failure — so a raw error, stack, or SQL never
 * reaches the UI. Returns the envelope's `data` (which is `undefined` for the
 * void-returning endpoints; data-returning callers null-check it themselves, as
 * the previous inline blocks did). Behavior is identical across all callers:
 * same URL, same body, same thrown code, same return value.
 */
async function postSchemaAction<T = void>(
  url: string,
  body: unknown,
): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  } catch {
    throw new SchemaChatError("genericError");
  }

  let parsed: { data?: T | null; error: string | null } | null = null;
  try {
    parsed = (await res.json()) as { data?: T | null; error: string | null };
  } catch {
    throw new SchemaChatError("genericError");
  }

  if (!res.ok || parsed?.error) {
    throw new SchemaChatError(parsed?.error ?? "genericError");
  }
  return parsed?.data as T;
}

export type EditorChatRequest = {
  slug: string;
  message: string;
  currentTableKey?: string | null;
  conversation?: ChatTurn[];
};

export async function postEditorChat(
  request: EditorChatRequest,
): Promise<EditorChatResult> {
  const data = await postSchemaAction<EditorChatResult | null>(
    "/api/schema/edit",
    {
      slug: request.slug,
      message: request.message,
      currentTableKey: request.currentTableKey ?? undefined,
      conversation: request.conversation,
    },
  );
  if (data == null) {
    throw new SchemaChatError("genericError");
  }
  return data;
}

/**
 * Undo an applied column-visibility change (Story 5.1 add-column, Story 5.5
 * hide-column) by flipping the EXISTING append-only column-visibility flag
 * through `POST /api/schema/columns` (Story 3.5). `hidden` is the direction the
 * Undo sets:
 *   - undo of an ADD-column hides it (`hidden: true`) — the field definition and
 *     any data are retained; the column simply disappears from view;
 *   - undo of a HIDE-column shows it again (`hidden: false`) — the column
 *     reappears with no data change.
 * Neither direction ever deletes anything. Throws `SchemaChatError` on a true
 * transport/auth failure so the panel can show a translated retry message — a raw
 * error, stack, or SQL never reaches the UI.
 */
export async function postSetColumnVisibility(
  slug: string,
  tableKey: string,
  fieldKey: string,
  hidden: boolean,
): Promise<void> {
  await postSchemaAction("/api/schema/columns", {
    slug,
    tableKey,
    fieldKey,
    hidden,
  });
}

/**
 * Hide a whole table by its key (Story 5.7) through the direct, non-LLM
 * `POST /api/schema/tables` (`action: "hide"`). Used by the chat hide-table confirm
 * button and the add-table chat-bubble Undo (hiding the just-added table). Only the
 * table-level append-only `hidden` flag is set — every row is retained, so the hide
 * is fully reversible from Settings or the chat show-again Undo. Throws
 * `SchemaChatError` on a true transport/auth failure so the caller can show a
 * translated retry message — a raw error, stack, or SQL never reaches the UI.
 */
export async function postHideTable(
  slug: string,
  tableKey: string,
): Promise<void> {
  await postSchemaAction("/api/schema/tables", {
    slug,
    action: "hide",
    tableKey,
  });
}

/**
 * Restore a previously-hidden table by its key (Story 5.7) through the direct,
 * non-LLM `POST /api/schema/tables` (`action: "restore"`). Used by the chat
 * show-again Undo and the Settings "Hidden tables" Restore control. Flips the
 * table-level `hidden` flag back to false — the table and every record reappear
 * unchanged. Throws `SchemaChatError` on a true transport/auth failure so the
 * caller can show a translated retry message — a raw error, stack, or SQL never
 * reaches the UI.
 */
export async function postRestoreTable(
  slug: string,
  tableKey: string,
): Promise<void> {
  await postSchemaAction("/api/schema/tables", {
    slug,
    action: "restore",
    tableKey,
  });
}

/**
 * Remove a saved view by its key (Story 5.6) through the direct, non-LLM
 * `POST /api/schema/views` (`action: "remove"`). Used by the view-tab "Remove
 * view" control and the add-view chat-bubble Undo (removing the just-added view).
 * Returns the REMOVED `ViewDefinition` so the caller can offer a restore/Undo that
 * re-adds it unchanged. A view holds no rows, so this removal is non-destructive.
 * Throws `SchemaChatError` on a true transport/auth failure so the caller can show
 * a translated retry message — a raw error, stack, or SQL never reaches the UI.
 */
export async function postRemoveView(
  slug: string,
  viewKey: string,
): Promise<ViewDefinition> {
  const data = await postSchemaAction<{
    action: "remove";
    view: ViewDefinition;
  } | null>("/api/schema/views", { slug, action: "remove", viewKey });
  if (data == null) {
    throw new SchemaChatError("genericError");
  }
  return data.view;
}

/**
 * Restore a previously-removed view (the Undo of a removal, Story 5.6) through the
 * direct, non-LLM `POST /api/schema/views` (`action: "restore"`). Re-adds the
 * view's `{label, sourceTableKey, filters, sort}` via the already-validated
 * `addView`; because the removed key's slot is free, the same view key re-derives.
 * Throws `SchemaChatError` on a true transport/auth failure so the caller can show
 * a translated retry message — a raw error, stack, or SQL never reaches the UI.
 */
export async function postRestoreView(
  slug: string,
  view: ViewDefinition,
): Promise<void> {
  await postSchemaAction("/api/schema/views", {
    slug,
    action: "restore",
    view: {
      label: view.label,
      sourceTableKey: view.sourceTableKey,
      filters: view.filters,
      sort: view.sort,
    },
  });
}
