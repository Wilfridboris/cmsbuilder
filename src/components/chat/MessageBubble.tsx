"use client";

import {
  Check,
  EyeOff,
  FilterX,
  ListFilter,
  ShieldAlert,
  Table2,
} from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * MessageBubble (Story 5.1, 5.2, 5.3, 5.5) — one iMessage-style chat bubble in the
 * AI Assistant panel. Pure presentation: a user turn is right-aligned on the primary
 * color; an assistant turn is left-aligned on a neutral surface. An `applied`
 * (add-column) success bubble carries a subtle emerald check accent and renders its
 * inline one-tap Undo as `children`. An `appliedTable` (add-table, Story 5.2) success
 * bubble reuses the exact same glass shell but swaps the check for a table glyph —
 * the copy points the Admin to the new table in the switcher, and there is NO Undo
 * (table visibility is deferred), so it is passed no `children`. An `appliedView`
 * (add-view, Story 5.3) success bubble is identical but swaps in a filter glyph and
 * likewise has no Undo. A `removedView` (remove-view via chat, Story 5.6) success
 * bubble swaps in a muted filter-off glyph — a view holds no rows, so its removal is
 * safe — and has no Undo (the removal was the request). A `hidden` (hide-column,
 * Story 5.5 — the SAFE answer to
 * "delete this column") bubble swaps in a reassuring amber eye-off glyph and DOES
 * carry a one-tap "show again" Undo as `children` (the data is never deleted).
 *
 * Story 5.7 adds two table-grain variants. An `offerHideTable` bubble is the OFFER
 * shown when the owner asks to delete a whole table: a caution-toned amber shield
 * glyph with the reassuring "I'll hide it instead" copy, and it renders its
 * "Hide the table" / "Keep it" confirm buttons as `children` (no mutation has run
 * yet). A `tableHidden` bubble is the post-confirm (or post-undo-of-add) state: the
 * same amber eye-off reassurance as `hidden`, at the table grain, carrying a one-tap
 * "show again" Undo as `children` (every record is retained, so it is reversible).
 *
 * Never renders raw JSON, SQL, or errors — the `text` it receives is always a
 * translated, human string produced server-side. All microstates are CSS
 * (`transition-*`); no Framer Motion here (that is reserved for the panel
 * open/close in `ChatPanel`).
 */

export type BubbleVariant =
  | "user"
  | "assistant"
  | "applied"
  | "appliedTable"
  | "appliedView"
  | "removedView"
  | "hidden"
  | "offerHideTable"
  | "tableHidden"
  | "declined"
  | "degraded";

export function MessageBubble({
  variant,
  text,
  children,
}: {
  variant: BubbleVariant;
  text: string;
  children?: React.ReactNode;
}) {
  const isUser = variant === "user";
  const isApplied = variant === "applied";
  const isAppliedTable = variant === "appliedTable";
  const isAppliedView = variant === "appliedView";
  const isRemovedView = variant === "removedView";
  const isHidden = variant === "hidden";
  const isOfferHideTable = variant === "offerHideTable";
  const isTableHidden = variant === "tableHidden";

  return (
    <div
      className={cn(
        "flex w-full",
        isUser ? "justify-end" : "justify-start",
      )}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-3.5 py-2 text-sm text-pretty",
          isUser
            ? "rounded-br-sm bg-primary text-primary-foreground"
            : "rounded-bl-sm bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100",
        )}
      >
        <div className="flex items-start gap-2">
          {isApplied ? (
            <Check
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
          ) : null}
          {isAppliedTable ? (
            <Table2
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
          ) : null}
          {isAppliedView ? (
            <ListFilter
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400"
            />
          ) : null}
          {isRemovedView ? (
            // A view removal is not a creation and not a hide — a muted filter-off
            // glyph marks "view cleared away" distinctly from the emerald "created"
            // states and the amber hide. Safe: a view holds no rows.
            <FilterX
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-zinc-500 dark:text-zinc-400"
            />
          ) : null}
          {isHidden || isTableHidden ? (
            // A hide is reassurance, not a creation — an amber eye-off glyph marks
            // "safely tucked away" distinctly from the emerald "created" states.
            // Reused at the table grain (Story 5.7) for a hidden whole table.
            <EyeOff
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
            />
          ) : null}
          {isOfferHideTable ? (
            // A hide-table OFFER (Story 5.7): a caution-toned amber shield marks a
            // consequential, confirm-gated action (removing a whole dashboard tab),
            // distinct from the immediate emerald "created" and the done amber hide.
            <ShieldAlert
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400"
            />
          ) : null}
          <p className="min-w-0 whitespace-pre-wrap">{text}</p>
        </div>
        {children ? <div className="mt-2">{children}</div> : null}
      </div>
    </div>
  );
}

/**
 * The assistant-side "thinking" bubble (Story 5.1): three dots with a staggered
 * CSS bounce (no Framer Motion). Shown while a request is in flight.
 */
export function ThinkingBubble({ label }: { label: string }) {
  return (
    <div className="flex w-full justify-start">
      <div
        role="status"
        aria-label={label}
        className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-zinc-100 px-3.5 py-3 dark:bg-zinc-800"
      >
        <span className="sr-only">{label}</span>
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className="size-2 animate-bounce rounded-full bg-zinc-400 dark:bg-zinc-500"
            style={{ animationDelay: `${i * 150}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
