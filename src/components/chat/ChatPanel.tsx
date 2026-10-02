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
  postRemoveView,
  postSetColumnVisibility,
  SchemaChatError,
} from "@/lib/data/schema-chat-client";
import type { EditorChatResult } from "@/app/api/schema/edit/route";
import type { ChatTurn } from "@/lib/gemini/prompts";
import { MessageBubble, ThinkingBubble } from "@/components/chat/MessageBubble";

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
 * applied ADD-TABLE (Story 5.2) result has no `undo`, so it shows a glyph-only success
 * bubble pointing to the switcher.
 * Any applied result calls `onSchemaChanged` so the dashboard re-reads the schema
 * and the column/table/view appears (or disappears). Never renders raw JSON, SQL,
 * or errors.
 */

type ChatMessage =
  | { id: string; role: "user"; text: string }
  | {
      id: string;
      role: "assistant";
      kind: EditorChatResult["kind"];
      text: string;
      /**
       * Present on an applied ADD-COLUMN or HIDE-COLUMN message: drives the
       * one-tap column Undo. `direction` is the visibility the Undo SETS (`"hide"`
       * for an add, `"show"` for a hide).
       */
      applied?: {
        tableKey: string;
        fieldKey: string;
        direction: "hide" | "show";
      };
      /**
       * Present on an applied ADD-VIEW message: drives the one-tap view Undo, which
       * removes the just-added view via the `remove_view` path (Story 5.6). A view
       * holds no rows, so this is non-destructive. Carries the view key + its label
       * (for the undone copy).
       */
      appliedView?: {
        viewKey: string;
        label: string;
      };
      /** True on an `applied` HIDE-COLUMN message (a shield-glyph reassurance bubble). */
      isHide?: boolean;
      /** True on an `applied` ADD-VIEW message (a filter-glyph bubble; carries an Undo). */
      isView?: boolean;
      /**
       * True on an `applied` chat-driven REMOVE-VIEW message (Story 5.6): carries a
       * `viewKey` but no `undo` (the removal is the action; there is no Undo on a
       * chat removal). Gets its own removal glyph, distinct from the add-table and
       * add-view "created" glyphs.
       */
      isViewRemoved?: boolean;
      /** Local flag once Undo has reversed this change (column visibility or view removal). */
      undone?: boolean;
    };

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
      const assistantMessage: ChatMessage = {
        id: nextId(),
        role: "assistant",
        kind: result.kind,
        text: result.assistantText,
        applied:
          result.kind === "applied" &&
          result.tableKey &&
          result.fieldKey &&
          (result.undo === "hide" || result.undo === "show")
            ? {
                tableKey: result.tableKey,
                fieldKey: result.fieldKey,
                direction: result.undo,
              }
            : undefined,
        appliedView:
          result.kind === "applied" &&
          result.undo === "remove" &&
          result.viewKey
            ? { viewKey: result.viewKey, label: result.label ?? result.viewKey }
            : undefined,
        isHide: result.kind === "applied" && result.undo === "show",
        isView:
          result.kind === "applied" &&
          Boolean(result.viewKey) &&
          result.undo === "remove",
        // A chat-driven removal: applied + a viewKey, but no "remove" undo (that
        // marks an add-view). Distinct glyph, no Undo.
        isViewRemoved:
          result.kind === "applied" &&
          Boolean(result.viewKey) &&
          result.undo !== "remove",
      };
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
        { id: nextId(), role: "assistant", kind: "degraded", text },
      ]);
    } finally {
      setPending(false);
    }
  };

  const undo = async (messageId: string) => {
    const message = messages.find((m) => m.id === messageId);
    if (
      !message ||
      message.role !== "assistant" ||
      (!message.applied && !message.appliedView) ||
      undoingId
    ) {
      return;
    }
    setUndoingId(messageId);
    try {
      let undoneText: string;
      if (message.appliedView) {
        // Undo of an ADD-VIEW removes the just-added view via the remove_view path
        // (Story 5.6). A view holds no rows, so this is non-destructive.
        await postRemoveView(slug, message.appliedView.viewKey);
        undoneText = t("viewUndone", { view: message.appliedView.label });
      } else {
        // Flip the column's append-only visibility. Undo of an ADD hides it
        // (direction "hide"); Undo of a HIDE shows it again (direction "show").
        const direction = message.applied!.direction;
        await postSetColumnVisibility(
          slug,
          message.applied!.tableKey,
          message.applied!.fieldKey,
          direction === "hide",
        );
        undoneText = direction === "hide" ? t("undone") : t("restored");
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === messageId && m.role === "assistant"
            ? { ...m, undone: true, text: undoneText }
            : m,
        ),
      );
      onSchemaChanged();
    } catch {
      setMessages((prev) => [
        ...prev,
        { id: nextId(), role: "assistant", kind: "degraded", text: t("undoFailed") },
      ]);
    } finally {
      setUndoingId(null);
    }
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
                  variant={
                    message.kind === "applied" && !message.undone
                      ? // An applied result is an add-column (check glyph), a
                        // hide-column (eye-off glyph, Story 5.5), an add-view (filter
                        // glyph + Undo, Story 5.6), or an add-table (table glyph, no
                        // Undo). Each gets its own glyph; the ones with an Undo render
                        // it as children below.
                        message.isHide
                        ? "hidden"
                        : message.applied
                          ? "applied"
                          : message.isView
                            ? "appliedView"
                            : message.isViewRemoved
                              ? "removedView"
                              : "appliedTable"
                      : message.kind === "declined"
                        ? "declined"
                        : message.kind === "degraded"
                          ? "degraded"
                          : "assistant"
                  }
                  text={message.text}
                >
                  {(message.applied || message.appliedView) && !message.undone ? (
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
