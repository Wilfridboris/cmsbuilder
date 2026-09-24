"use client";

import { useTranslations } from "next-intl";

/**
 * Story 1.1 home page — the smallest end-to-end proof of the i18n seam.
 *
 * Every user-facing string resolves through next-intl's useTranslations().
 * There is intentionally no product UI here; the Mad Libs prompt intake
 * (Story 1.3) and generation arc (Story 1.4) are owned by later stories.
 */
export default function Home() {
  const t = useTranslations("Home");

  return (
    <main className="mx-auto flex max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-6 py-16 text-center">
      <h1 className="text-4xl font-semibold tracking-tight">{t("title")}</h1>
      <p className="text-xl text-foreground/80">{t("tagline")}</p>
      <p className="text-base text-foreground/60">{t("description")}</p>
      <button
        type="button"
        className="min-h-12 rounded-md bg-foreground px-6 py-3 text-base font-medium text-background"
      >
        {t("cta")}
      </button>
    </main>
  );
}
