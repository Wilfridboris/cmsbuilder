"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Loader2, SendHorizontal, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import {
  postEditorChat,
  postHideTable,
  postRemoveView,
  postRestoreTable,
  postSetColumnVisibility,
  SchemaChatError,
} from "@/lib/data/schema-chat-client";
import type { ChatTurn } from "@/lib/gemini/prompts";
import { MessageBubble, ThinkingBubble } from "@/components/chat/MessageBubble";
import {
  buildAssistantMessage,
  bubbleVariantFor,
  hasUndo,
  resolveUndoAction,
  type AssistantMessage,
  type ChatMessage,
} from "@/components/chat/chat-message";

/**
 * ChatPanel (Story 5.1, 5.2) — the expanded iMessage-style body of the floating
 * AI Assistant. A MODELESS Radix dialog (`modal={false}`): it keeps dialog
 * semantics (role="dialog", Esc or the X to close) but does NOT block the page —
 * the dashboard stays fully interactive so the owner can keep working and watch a
 * new column/table appear live behind the panel. Clicking the dashboard never
 * dismisses it (`onInteractOutside` prevented); only Esc or the X close it. A soft
 * primary ring marks it as the active surface in place of a dimming scrim. On open,
 * focus lands on the composer; on close, it returns to the pill (handled in
 * ChatAssistant, since the pill unmounts while open). Scrollable message list + a
 * "Smart Input" composer.
 *
 * It holds the ephemeral conversation (never persisted — lost on close/refresh),
 * sends each turn to `postEditorChat` with the `activeTableKey` so an unnamed
 * add-column target can be inferred, and maps the typed `{ kind, assistantText, ... }`
 * result to a bubble. An applied result that carries an `undo` direction + a
 * `tableKey`/`fieldKey` drives the inline one-tap Undo, which flips the column's
 * append-only visibility via the existing `/api/schema/columns` path:
 *   - ADD-COLUMN (Story 5.1) → `undo: "hide"`: Undo hides the just-added column;
 *   - HIDE-COLUMN (Story 5.5 — the safe answer to "delete this column") →
 *     `undo: "show"`: Undo shows the column again.
 * An applied ADD-VIEW (Story 5.3/5.6) result carries `undo: "remove"` + a `viewKey`,
 * so its bubble offers a one-tap Undo that removes the just-added view via the direct
 * `/api/schema/views` path (a view holds no rows, so removal is non-destructive). An
 * applied ADD-TABLE (Story 5.2/5.7) result carries `undo: "hide-table"` + a `tableKey`,
 * so its bubble offers a one-tap Undo that HIDES the just-added table via the direct
 * `/api/schema/tables` path (non-destructive — every record is retained). A `confirm`
 * HIDE-TABLE offer (Story 5.7 — the safe answer to "delete the Jobs table") renders an
 * inline "Hide the table" / "Keep it" pair; confirming drives the same direct hide and
 * swaps the bubble to a reassurance state with a show-again Undo.
 * Any applied result calls `onSchemaChanged` so the dashboard re-reads the schema
 * and the column/table/view appears (or disappears). Never renders raw JSON, SQL,
 * or errors.
 */

let messageCounter = 0;
function nextId(): string {
  messageCounter += 1;
  return `chat-${messageCounter}`;
}

export function ChatPanel({
  slug,
  activeTableKey,
  onClose,
  onSchemaChanged,
}: {
  slug: string;
  activeTableKey: string | null;
  onClose: () => void;
  /** Runs after an applied add OR an undo so the dashboard re-reads the schema. */
  onSchemaChanged: () => void;
}) {
  const t = useTranslations("ChatAssistant");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [pending, setPending] = useState(false);
  const [undoingId, setUndoingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const listEndRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLInputElement>(null);

  // Auto-scroll to the newest message / the thinking bubble.
  useEffect(() => {
    listEndRef.current?.scrollIntoView({ block: "end" });
  }, [messages, pending]);

  const send = async () => {
    const text = draft.trim();
    if (!text || pending) return;

    const userMessage: ChatMessage = { id: nextId(), role: "user", text };
    // Build the ephemeral conversation from the prior turns (exclude the just-added
    // user turn's id metadata — send only role + content). Cap to the most recent 20
    // turns to stay within the endpoint's `conversation` limit: an unbounded history
    // on a long session would be rejected (400) and surface as a permanent "degraded"
    // bubble even though the assistant is fine.
    const conversation: ChatTurn[] = messages.slice(-20).map((m) => ({
      role: m.role,
      content: m.text,
    }));

    setMessages((prev) => [...prev, userMessage]);
    setDraft("");
    setPending(true);

    try {
      const result = await postEditorChat({
        slug,
        message: text,
        currentTableKey: activeTableKey,
        conversation,
      });
      // The result -> message dispatch (which bubble, which Undo) is the pure,
      // unit-tested `buildAssistantMessage` (retro [A6]).
      const assistantMessage = buildAssistantMessage(result, nextId());
      setMessages((prev) => [...prev, assistantMessage]);
      if (result.kind === "applied") {
        onSchemaChanged();
      }
    } catch (err) {
      // A true transport/auth failure (never a handled outcome) → degraded bubble.
      const code = err instanceof SchemaChatError ? err.code : "genericError";
      const text =
        code === "forbidden" || code === "unauthorized"
          ? t("forbidden")
          : t("degraded");
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "assistant", uiKind: "degraded", text },
      ]);
    } finally {
      setPending(false);
    }
  };

  const undo = async (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (message?.role !== "assistant" || undoingId) return;
    // `resolveUndoAction` is the pure, unit-tested map from a message to the
    // inverse-op client call it makes (retro [A6]); null means nothing to undo.
    const action = resolveUndoAction(message);
    if (!action) return;
    setUndoingId(messageId);
    try {
      let undoneText: string;
      // The Undo flips to this local message state so the bubble re-renders with the
      // correct glyph and (where reversible) a follow-up Undo.
      let patch: Partial<AssistantMessage> = { undone: true };
      switch (action.kind) {
        case "restore-table":
          // Show-again Undo of a just-hidden table (Story 5.7): restore it via the
          // direct tables path. Every record is retained, so the table returns
          // intact. Reads as a neutral confirmation (no amber eye-off, no Undo).
          await postRestoreTable(slug, action.tableKey);
          undoneText = t("tableRestored", { table: message.hiddenTable!.label });
          patch = { undone: true, hiddenTable: undefined, uiKind: "declined" };
          break;
        case "hide-table":
          // Undo of an ADD-TABLE (Story 5.7) hides the just-added table via the
          // direct tables path (an explicit Undo click is itself the confirmation).
          // Swap the bubble to the hidden-table state so it offers a show-again Undo.
          await postHideTable(slug, action.tableKey);
          undoneText = t("tableUndone", {
            table: message.appliedTableUndo!.label,
          });
          patch = {
            undone: false,
            appliedTableUndo: undefined,
            uiKind: "hidden-table",
            hiddenTable: {
              tableKey: message.appliedTableUndo!.tableKey,
              label: message.appliedTableUndo!.label,
            },
          };
          break;
        case "remove-view":
          // Undo of an ADD-VIEW removes the just-added view via the remove_view path
          // (Story 5.6). A view holds no rows, so this is non-destructive.
          await postRemoveView(slug, action.viewKey);
          undoneText = t("viewUndone", { view: message.appliedView!.label });
          break;
        case "set-column-visibility":
          // Flip the column's append-only visibility. Undo of an ADD hides it
          // (direction "hide"); Undo of a HIDE shows it again (direction "show").
          await postSetColumnVisibility(
            slug,
            action.tableKey,
            action.fieldKey,
            action.hidden,
          );
          undoneText = action.hidden ? t("undone") : t("restored");
          break;
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.role === "assistant"
            ? { ...m, ...patch, text: undoneText }
            : m,
        ),
      );
      onSchemaChanged();
    } catch (err) {
      // A concurrency race can make an add-table Undo's target the LAST visible
      // table (the mutator re-check throws `tableHideLast`); surface that specific,
      // actionable copy instead of the generic "try again" line retrying cannot fix
      // (retro [D3], matching confirmHideTable).
      const code = err instanceof SchemaChatError ? err.code : null;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          uiKind: "degraded",
          text: code === "tableHideLast" ? t("tableHideLast") : t("undoFailed"),
        },
      ]);
    } finally {
      setUndoingId(null);
    }
  };

  // Confirm a hide-table OFFER (Story 5.7): the explicit button click IS the
  // confirmation, so it drives the direct hide and swaps the bubble to a just-hidden
  // table state that carries its own show-again Undo.
  const confirmHideTable = async (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (
      !message ||
      message.role !== "assistant" ||
      !message.offerTable ||
      confirmingId
    ) {
      return;
    }
    const target = message.offerTable;
    setConfirmingId(messageId);
    try {
      await postHideTable(slug, target.tableKey);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.role === "assistant"
            ? {
                ...m,
                uiKind: "hidden-table",
                offerTable: undefined,
                hiddenTable: { tableKey: target.tableKey, label: target.label },
                text: t("tableHidden", { table: target.label }),
              }
            : m,
        ),
      );
      onSchemaChanged();
    } catch (err) {
      // The offer stays (the tab is untouched) so the owner can retry; show an
      // inline failure line without clearing the buttons. A concurrency race can
      // make the target the LAST visible table between offer and confirm (the
      // mutator re-check throws `tableHideLast`); surface that specific, actionable
      // copy instead of the generic "try again" line, which retrying cannot fix.
      const code = err instanceof SchemaChatError ? err.code : null;
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          role: "assistant",
          uiKind: "degraded",
          text:
            code === "tableHideLast"
              ? t("tableHideLast")
              : t("tableHideFailed"),
        },
      ]);
    } finally {
      setConfirmingId(null);
    }
  };

  // Dismiss a hide-table OFFER (Story 5.7): nothing is written; the bubble swaps to
  // a neutral "kept it" line and the buttons clear.
  const keepTable = (messageId: string) => {
    setMessages((prev) =>
      prev.map((m) =>
        m.id === messageId && m.role === "assistant" && m.offerTable
          ? {
              ...m,
              uiKind: "declined",
              offerTable: undefined,
              text: t("tableKept", { table: m.offerTable.label }),
            }
          : m,
      ),
    );
  };

  return (
    <DialogPrimitive.Root open modal={false} onOpenChange={(open) => !open && onClose()}>
      <DialogPrimitive.Portal>
        {/* Modeless: no overlay, no page-blocking (`modal={false}`). The dashboard
            stays interactive so schema changes appear live. Focus the composer on
            open; don't let Radix restore focus on close (the pill unmounts while
            open — ChatAssistant returns focus to it). */}
        <DialogPrimitive.Content
          aria-describedby={undefined}
          onInteractOutside={(e) => e.preventDefault()}
          onOpenAutoFocus={(e) => {
            e.preventDefault();
            composerRef.current?.focus();
          }}
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "fixed bottom-6 right-4 left-4 z-50 flex max-h-[70vh] w-auto flex-col overflow-hidden rounded-2xl border border-white/40 bg-white/80 shadow-xl shadow-black/5 ring-1 ring-primary/15 backdrop-blur-xl outline-none sm:left-auto sm:right-6 sm:w-[22rem] dark:border-white/10 dark:bg-zinc-900/80 dark:ring-primary/20",
            "data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95",
          )}
        >
          <header className="flex items-center justify-between gap-2 border-b border-border/60 px-4 py-3">
            <div className="flex items-center gap-2">
              <Sparkles aria-hidden="true" className="size-4 text-primary" />
              <DialogPrimitive.Title className="text-sm font-semibold">
                {t("title")}
              </DialogPrimitive.Title>
            </div>
            <DialogPrimitive.Close asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-9"
                aria-label={t("close")}
              >
                <X aria-hidden="true" className="size-4" />
              </Button>
            </DialogPrimitive.Close>
          </header>

          <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-4">
            {messages.length === 0 ? (
              <MessageBubble variant="assistant" text={t("greeting")} />
            ) : null}
            {messages.map((message) =>
              message.role === "user" ? (
                <MessageBubble key={message.id} variant="user" text={message.text} />
              ) : (
                <MessageBubble
                  key={message.id}
                  // The message -> bubble-variant map is the pure, unit-tested
                  // `bubbleVariantFor` (retro [A6]); `uiKind` is the single source
                  // of truth, so there is no nested boolean ternary here anymore.
                  variant={bubbleVariantFor(message)}
                  text={message.text}
                >
                  {message.offerTable ? (
                    // The hide-table OFFER (Story 5.7): an explicit confirm/keep pair.
                    // A confirm click IS the confirmation and drives the direct hide.
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        className="min-h-11"
                        aria-label={t("tableHideConfirmAria", {
                          table: message.offerTable.label,
                        })}
                        disabled={confirmingId !== null}
                        onClick={() => confirmHideTable(message.id)}
                      >
                        {confirmingId === message.id ? (
                          <Loader2
                            aria-hidden="true"
                            className="size-4 animate-spin"
                          />
                        ) : null}
                        {t("tableHideConfirm")}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="min-h-11"
                        aria-label={t("tableKeepButtonAria", {
                          table: message.offerTable.label,
                        })}
                        disabled={confirmingId !== null}
                        onClick={() => keepTable(message.id)}
                      >
                        {t("tableKeepButton")}
                      </Button>
                    </div>
                  ) : hasUndo(message) ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="min-h-11"
                      disabled={undoingId !== null}
                      onClick={() => undo(message.id)}
                    >
                      {undoingId === message.id ? (
                        <Loader2
                          aria-hidden="true"
                          className="size-4 animate-spin"
                        />
                      ) : null}
                      {t("undo")}
                    </Button>
                  ) : null}
                </MessageBubble>
              ),
            )}
            {pending ? <ThinkingBubble label={t("thinking")} /> : null}
            <div ref={listEndRef} />
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
            className="flex items-center gap-2 border-t border-border/60 p-3"
          >
            <Input
              ref={composerRef}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={pending}
              placeholder={t("placeholder")}
              aria-label={t("placeholder")}
              className="min-h-11 rounded-2xl"
            />
            <Button
              type="submit"
              size="icon"
              className="size-11 shrink-0 rounded-2xl"
              disabled={pending || draft.trim() === ""}
              aria-label={t("send")}
            >
              {pending ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <SendHorizontal aria-hidden="true" className="size-4" />
              )}
            </Button>
          </form>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
