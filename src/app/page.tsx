"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";

import { PromptBuilder } from "@/components/generation/PromptBuilder";

/**
 * Landing "conversation" screen (Story 1.3, extended in 2.1).
 *
 * A hyper-minimalist single-focus hero: a short headline + subhead (from the
 * `Home` namespace) above the guided "Mad Libs" prompt and its one primary CTA.
 *
 * Story 2.1 adds the claim re-request surface: when the magic-link callback
 * fails (expired/invalid link, used claim, cross-device open) it redirects here
 * with `?claim=expired|error`, and when middleware bounces an unauthenticated
 * tenant-route visit it redirects with `?auth=required`. Both render a
 * translated, non-alarming notice with the natural re-request path (describe
 * your business → generate → claim again). Never a raw error screen.
 */
export default function Home() {
  const t = useTranslations("Home");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <Suspense fallback={null}>
        <ClaimNotice />
      </Suspense>
      <header className="flex flex-col gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">{t("tagline")}</h1>
        <p className="text-base text-muted-foreground">{t("description")}</p>
      </header>
      <PromptBuilder />
    </main>
  );
}

/** Translated claim/auth notice driven by the callback / middleware redirect. */
function ClaimNotice() {
  const tClaim = useTranslations("Claim");
  const params = useSearchParams();
  const claim = params.get("claim");
  const auth = params.get("auth");

  let message: string | null = null;
  if (claim === "expired") message = tClaim("linkExpired");
  else if (claim === "error") message = tClaim("linkError");
  else if (auth === "required") message = tClaim("authRequired");

  if (!message) return null;

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-lg border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground/80"
    >
      <Info aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
      <p className="text-pretty">{message}</p>
    </div>
  );
}
