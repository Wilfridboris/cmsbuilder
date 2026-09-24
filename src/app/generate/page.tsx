"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";

import { readIntent } from "@/lib/generation/intent";
import type { ApiResponse } from "@/types/api";
import type { GenerateResponse } from "@/app/api/generate/route";
import {
  DemoDashboard,
  DashboardSkeleton,
} from "@/components/dashboard/DemoDashboard";

/**
 * Generation surface — the visible "aha moment".
 *
 * On mount it reads the captured `GenerationIntent` from the anonymous session
 * and POSTs it to `/api/generate`, showing the skeleton while awaiting, then
 * revealing the interactive `<DemoDashboard>` (Story 1.6): a Framer-Motion
 * skeleton→content "grow", tab browse across the generated tables, an
 * accessible open-a-record detail view, and a basic in-place optimistic edit of
 * the demo data — all with no account. This page keeps the `POST /api/generate`
 * call, the StrictMode single-POST guard, the `isFallback` banner (Story 1.5),
 * and the `failed`/`missing` graceful degradation phases; the reveal body lives
 * in the extracted `<DemoDashboard>` client component.
 *
 * It NEVER shows a raw error screen. A double-failure at the endpoint lands on a
 * populated fallback dashboard (Story 1.5): the response carries
 * `isFallback: true` and a subtle "starter template" banner renders above the
 * dashboard. The "start over" (`failed`) path fires only when there is no valid
 * intent, or on the endpoint's last-resort 502 (the fallback provisioning itself
 * failing). Accessibility: `aria-busy`/`aria-live` on the loading region.
 */

type Phase = "initializing" | "generating" | "ready" | "missing" | "failed";

export default function GeneratePage() {
  const t = useTranslations("Generate");
  const [phase, setPhase] = useState<Phase>("initializing");
  const [result, setResult] = useState<GenerateResponse | null>(null);
  // Guard against duplicate POSTs (React 18/19 StrictMode double-invokes effects).
  const startedRef = useRef(false);

  useEffect(() => {
    // StrictMode double-invokes this effect on the same instance; the ref makes
    // exactly one POST run. We deliberately do NOT abort on cleanup: aborting the
    // sole request and then short-circuiting the re-invocation on the ref would
    // leave the page stuck on the skeleton in dev, and a cookie-less POST aborted
    // mid-flight can still mint a session org server-side. Letting the one request
    // finish keeps a single org + a single reveal; a stray setState after a real
    // unmount is a no-op in React 18+.
    if (startedRef.current) {
      return;
    }
    startedRef.current = true;

    (async () => {
      const intent = readIntent();
      if (!intent) {
        setPhase("missing");
        return;
      }

      setPhase("generating");
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(intent),
        });
        const body: ApiResponse<GenerateResponse> = await res.json();
        if (!res.ok || !body.data) {
          setPhase("failed");
          return;
        }
        setResult(body.data);
        setPhase("ready");
      } catch {
        setPhase("failed");
      }
    })();
  }, []);

  if (phase === "missing") {
    return (
      <StartOver
        title={t("missingTitle")}
        body={t("missingBody")}
        cta={t("restart")}
      />
    );
  }

  if (phase === "failed") {
    return (
      <StartOver
        title={t("failedTitle")}
        body={t("failedBody")}
        cta={t("restart")}
      />
    );
  }

  if (phase === "ready" && result) {
    return (
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight text-balance">
            {t("readyTitle")}
          </h1>
          <p className="text-base text-muted-foreground text-pretty">
            {t("readySubtitle")}
          </p>
        </header>

        {/* Fallback banner (Story 1.5): a subtle, non-alarming, dismiss-free
            note shown only when the hardcoded starter template was provisioned.
            `role="status"` announces it to assistive tech without stealing
            focus; it is informational only (customization is Epic 5's chat). */}
        {result.isFallback ? (
          <div
            role="status"
            className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground/80"
          >
            <Sparkles
              aria-hidden="true"
              className="mt-0.5 size-4 shrink-0 text-primary"
            />
            <p className="text-pretty">{t("fallbackBanner")}</p>
          </div>
        ) : null}

        {/* Story 1.6: the interactive demo dashboard consumes the response in
            hand — no second generation call. It owns the skeleton→content grow,
            tab browse, responsive table/card, open-a-record, and the optimistic
            client-side-only edit. */}
        <DemoDashboard response={result} />
      </main>
    );
  }

  // initializing | generating → skeleton that "grows" into the dashboard.
  return (
    <main
      aria-busy="true"
      aria-live="polite"
      aria-label={t("loadingLabel")}
      className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-16"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight text-balance">
          {t("title")}
        </h1>
        <p className="text-base text-muted-foreground text-pretty">
          {t("subtitle")}
        </p>
      </header>

      <DashboardSkeleton />
    </main>
  );
}

/** Shared graceful degradation screen — never an error screen. */
function StartOver({
  title,
  body,
  cta,
}: {
  title: string;
  body: string;
  cta: string;
}) {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="text-base text-muted-foreground">{body}</p>
      <Link
        href="/"
        className="mx-auto inline-flex min-h-12 items-center justify-center rounded-md bg-primary px-6 text-base font-medium text-primary-foreground transition-colors hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        {cta}
      </Link>
    </main>
  );
}
