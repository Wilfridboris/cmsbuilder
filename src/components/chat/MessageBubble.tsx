"use client";

import { Check } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * MessageBubble (Story 5.1) — one iMessage-style chat bubble in the AI Assistant
 * panel. Pure presentation: a user turn is right-aligned on the primary color; an
 * assistant turn is left-aligned on a neutral surface. An `applied` success bubble
 * carries a subtle check accent and renders its inline one-tap Undo as `children`.
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
