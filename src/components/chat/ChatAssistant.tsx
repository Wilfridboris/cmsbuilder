"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";

import { cn } from "@/lib/utils";
import { useActiveTable } from "@/components/dashboard/ActiveTableProvider";
import { ChatPanel } from "@/components/chat/ChatPanel";

/**
 * ChatAssistant (Story 5.1) — the Admin-only floating "AI Assistant" entry point.
 *
 * Renders a glass pill fixed bottom-right. Tapping it expands the iMessage-style
 * `ChatPanel` with a Framer Motion open/close transition (the justified FM use is
 * the exit animation). It is mounted by `[slug]/layout.tsx` ONLY when the caller's
 * role is admin — a Member never receives it (the server endpoint's `requireAdmin`
 * is the real gate). It reads the currently-viewed table key from
 * `ActiveTableProvider` so an unnamed add-column request can be inferred, and runs
 * `router.refresh()` after an applied add / undo so the server re-reads the schema
 * and the column appears/disappears without a full reload.
 */

export function ChatAssistant({ slug }: { slug: string }) {
  const t = useTranslations("ChatAssistant");
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();
  const { activeTableKey } = useActiveTable();
  const [open, setOpen] = useState(false);
  const pillRef = useRef<HTMLButtonElement>(null);
  const wasOpenRef = useRef(false);

  // Return focus to the pill when the modeless panel closes (WCAG). The pill
  // unmounts while open, so Radix cannot restore focus to it — do it here once it
  // remounts. Skip the initial mount (never focus the pill unprompted).
  useEffect(() => {
    if (!open && wasOpenRef.current) {
      pillRef.current?.focus();
    }
    wasOpenRef.current = open;
  }, [open]);

  return (
    <>
      {!open ? (
        <button
          ref={pillRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label={t("pillLabel")}
          className={cn(
            "fixed bottom-6 right-6 z-50 flex size-14 items-center justify-center rounded-full border border-white/40 bg-white/70 text-primary shadow-xl shadow-black/5 backdrop-blur-xl transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring dark:border-white/10 dark:bg-zinc-900/70",
          )}
        >
          <Sparkles aria-hidden="true" className="size-6" />
          <span className="sr-only">{t("pillLabel")}</span>
        </button>
      ) : null}

      <AnimatePresence>
        {open ? (
          <motion.div
            key="chat-panel"
            initial={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.95, y: 8 }
            }
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={
              prefersReducedMotion
                ? { opacity: 0 }
                : { opacity: 0, scale: 0.95, y: 8 }
            }
            transition={{ type: "spring", bounce: 0.2, duration: 0.5 }}
          >
            <ChatPanel
              slug={slug}
              activeTableKey={activeTableKey}
              onClose={() => setOpen(false)}
              onSchemaChanged={() => router.refresh()}
            />
          </motion.div>
        ) : null}
      </AnimatePresence>
    </>
  );
}
