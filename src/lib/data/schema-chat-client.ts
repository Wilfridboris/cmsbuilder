import type { ApiResponse } from "@/types/api";
import type { EditorChatResult } from "@/app/api/schema/edit/route";
import type { ChatTurn } from "@/lib/gemini/prompts";

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

export type EditorChatRequest = {
  slug: string;
  message: string;
  currentTableKey?: string | null;
  conversation?: ChatTurn[];
};

export async function postEditorChat(
  request: EditorChatRequest,
): Promise<EditorChatResult> {
  let res: Response;
  try {
    res = await fetch("/api/schema/edit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        slug: request.slug,
        message: request.message,
        currentTableKey: request.currentTableKey ?? undefined,
        conversation: request.conversation,
      }),
    });
  } catch {
    throw new SchemaChatError("genericError");
  }

  let body: ApiResponse<EditorChatResult>;
  try {
    body = (await res.json()) as ApiResponse<EditorChatResult>;
  } catch {
    throw new SchemaChatError("genericError");
  }

  if (!res.ok || body.error !== null || body.data === null) {
    throw new SchemaChatError(body.error ?? "genericError");
  }
  return body.data;
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
  let res: Response;
  try {
    res = await fetch("/api/schema/columns", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ slug, tableKey, fieldKey, hidden }),
    });
  } catch {
    throw new SchemaChatError("genericError");
  }

  let body: { error: string | null } | null = null;
  try {
    body = (await res.json()) as { error: string | null };
  } catch {
    throw new SchemaChatError("genericError");
  }

  if (!res.ok || body?.error) {
    throw new SchemaChatError(body?.error ?? "genericError");
  }
}
