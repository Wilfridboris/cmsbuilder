"use client";

import { useTranslations } from "next-intl";

import { PromptBuilder } from "@/components/generation/PromptBuilder";

/**
 * Landing "conversation" screen (Story 1.3).
 *
 * A hyper-minimalist single-focus hero: a short headline + subhead (from the
 * `Home` namespace) above the guided "Mad Libs" prompt and its one primary CTA.
 * No pricing tiers, feature lists, testimonials, or demo links above the fold —
 * the only action is describing your business. Generation, account, and
 * dashboard are owned by later stories.
 */
export default function Home() {
  const t = useTranslations("Home");

  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-3 text-center">
        <h1 className="text-4xl font-semibold tracking-tight">{t("tagline")}</h1>
        <p className="text-base text-muted-foreground">{t("description")}</p>
      </header>
      <PromptBuilder />
    </main>
  );
}
