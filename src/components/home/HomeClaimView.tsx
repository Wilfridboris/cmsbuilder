"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useTranslations } from "next-intl";
import { Info } from "lucide-react";

import { PromptBuilder } from "@/components/generation/PromptBuilder";

/**
 * HomeClaimView (Story 15.1) — the signed-out / first-time landing claim UI.
 *
 * Extracted from the old `page.tsx` so the landing route can be an auth-aware
 * SERVER component: a signed-out (or org-less) visitor sees this client UI, a
 * signed-in owner sees the "go to my dashboard" card instead. Unchanged behavior
 * from before: the hero + guided prompt, the claim/auth re-request notice driven
 * by `?claim=`/`?auth=`, and the strengthened returning-user log-in entry.
 */
export function HomeClaimView() {
  const t = useTranslations("Home");
  const tLogin = useTranslations("Login");

  return (
    <>
      <Suspense fallback={null}>
        <ClaimNotice />
      </Suspense>
      <header className="flex flex-col gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">{t("tagline")}</h1>
        <p className="text-base text-muted-foreground">{t("description")}</p>
      </header>
      <PromptBuilder />
      {/* Returning-user login path (Story 2.2, strengthened 15.1): a clear,
          always-visible entry so a visitor who did not memorize their slug can
          sign back in. */}
      <p className="text-center text-sm text-muted-foreground">
        {tLogin("linkPrompt")}{" "}
        <Link
          href="/login"
          className="font-medium text-primary underline underline-offset-4"
        >
          {tLogin("linkCta")}
        </Link>
      </p>
    </>
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
