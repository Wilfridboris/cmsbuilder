"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";

import { readIntent } from "@/lib/generation/intent";

/**
 * Minimal hand-off route (Story 1.3, OQ1 → Option A).
 *
 * Reads the captured `GenerationIntent` from the anonymous session and renders
 * a "Building…" skeleton stub — NO LLM, no generation, no database. Story 1.4
 * replaces this stub body with the real `/api/generate` pipeline; Story 1.3
 * owns only the navigable route + skeleton so the submit hand-off has a
 * destination. When no valid intent is present (direct navigation, corrupt
 * storage), it degrades to a gentle prompt to start over — never an error.
 *
 * sessionStorage is an external store, so it is read via `useSyncExternalStore`
 * — the server snapshot is `false` (no window), giving a stable SSR/first-paint
 * skeleton, then the client resolves the real presence on hydration.
 */

/** sessionStorage never changes under this stub, so there is nothing to subscribe to. */
const noopSubscribe = () => () => {};
const hasIntentClient = () => readIntent() !== null;
const hasIntentServer = () => false;

export default function GeneratePage() {
  const t = useTranslations("Generate");
  const hasIntent = useSyncExternalStore(
    noopSubscribe,
    hasIntentClient,
    hasIntentServer,
  );

  if (!hasIntent) {
    return (
      <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">
          {t("missingTitle")}
        </h1>
        <p className="text-base text-muted-foreground">{t("missingBody")}</p>
        <Link
          href="/"
          className="mx-auto inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
        >
          {t("restart")}
        </Link>
      </main>
    );
  }

  return (
    <main
      aria-busy="true"
      aria-label={t("loadingLabel")}
      className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-base text-muted-foreground">{t("subtitle")}</p>
      </header>

      {/* Skeleton "grow-into-dashboard" stub — CSS pulse only; Story 1.6 owns
          the Framer Motion reveal. */}
      <div className="flex flex-col gap-4">
        <div className="h-8 w-1/3 animate-pulse rounded-md bg-muted" />
        <div className="overflow-hidden rounded-lg border">
          <div className="h-11 w-full animate-pulse bg-muted/70" />
          <div className="flex flex-col gap-px bg-border">
            {[0, 1, 2, 3, 4].map((row) => (
              <div key={row} className="h-14 w-full animate-pulse bg-muted/40" />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
