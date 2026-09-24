"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";

import { readIntent } from "@/lib/generation/intent";
import type { FieldDefinition } from "@/types/db";
import type { ApiResponse } from "@/types/api";
import type { GenerateResponse } from "@/app/api/generate/route";

/**
 * Generation surface (Story 1.4) — the visible "aha moment".
 *
 * On mount it reads the captured `GenerationIntent` from the anonymous session
 * and POSTs it to `/api/generate`, showing the skeleton while awaiting, then
 * revealing a minimal read-only table of the generated, Ontario-localized data
 * (reusing the `/demo` `formatCell` render pattern). Interactivity, in-place
 * edit, explainability UI, and the grow-into-dashboard Framer Motion transition
 * are deferred to Stories 1.6/1.7.
 *
 * It NEVER shows a raw error screen. A double-failure at the endpoint now lands
 * on a populated fallback dashboard (Story 1.5): the response carries
 * `isFallback: true` and a subtle "starter template" banner renders above the
 * tables. The "start over" (`failed`) path fires only when there is no valid
 * intent, or on the endpoint's last-resort 502 (the fallback provisioning itself
 * failing). Accessibility: `aria-busy`/`aria-live` on the live region, a semantic
 * `<table>` with a caption and column scopes; the only motion is a CSS pulse on
 * the loading skeleton (respects `prefers-reduced-motion` at the app level).
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
      <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold tracking-tight">
            {t("readyTitle")}
          </h1>
          <p className="text-base text-muted-foreground">{t("readySubtitle")}</p>
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

        <div aria-live="polite" className="flex flex-col gap-10">
          {result.schema.tables.map((table) => {
            const fields = table.fields.filter((field) => !field.hidden);
            const rows = result.records[table.key] ?? [];
            return (
              <section key={table.key} className="flex flex-col gap-3">
                <h2 className="text-xl font-medium tracking-tight">
                  {table.label}
                </h2>
                {fields.length > 0 && rows.length > 0 ? (
                  <div className="overflow-x-auto rounded-lg border border-foreground/10">
                    <table className="w-full border-collapse text-left text-sm">
                      <caption className="sr-only">
                        {t("tableCaption", { table: table.label })}
                      </caption>
                      <thead>
                        <tr className="border-b border-foreground/10 bg-foreground/5">
                          {fields.map((field) => (
                            <th
                              key={field.key}
                              scope="col"
                              className="px-4 py-3 font-medium text-foreground/80"
                            >
                              {field.label}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map((row) => (
                          <tr
                            key={row.id}
                            className="border-b border-foreground/5 last:border-b-0"
                          >
                            {fields.map((field) => (
                              <td
                                key={field.key}
                                className="px-4 py-3 text-foreground/90"
                              >
                                {formatCell(row.data[field.key], field.type, t)}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-base text-muted-foreground">
                    {t("emptyTable")}
                  </p>
                )}
              </section>
            );
          })}
        </div>
      </main>
    );
  }

  // initializing | generating → skeleton.
  return (
    <main
      aria-busy="true"
      aria-live="polite"
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

/** Render a JSONB cell value per its field type. Non-load-bearing formatting. */
function formatCell(
  value: unknown,
  type: FieldDefinition["type"],
  t: ReturnType<typeof useTranslations>,
): string {
  if (value === null || value === undefined) {
    return t("cellEmpty");
  }
  if (type === "currency" && typeof value === "number") {
    return new Intl.NumberFormat("en-CA", {
      style: "currency",
      currency: "CAD",
    }).format(value);
  }
  if (type === "boolean") {
    return value ? t("cellYes") : t("cellNo");
  }
  return String(value);
}
