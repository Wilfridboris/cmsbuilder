"use client";

import { useLocale, useTranslations } from "next-intl";
import { Languages } from "lucide-react";

import { cn } from "@/lib/utils";
import { locales, type Locale } from "@/lib/i18n/config";
import { useLocaleSwitcher } from "@/components/i18n/LocaleProvider";

/**
 * Compact segmented EN/FR control (Story 8.1) — the user-facing toggle.
 *
 * Reads the active locale from next-intl's `useLocale()` (driven by the client
 * `LocaleProvider`'s state) and calls the context `setLocale`, so activating a
 * segment flips all client UI in place instantly with no page reload and no
 * backend call. The stored column labels/values of generated data are never
 * re-translated — this switches i18n catalog chrome only.
 *
 * Built to the web-uiux-architect standard: `role="group"` with a real
 * `aria-label`, two `aria-pressed` buttons, a decorative `Languages` icon
 * (`aria-hidden`), an `sr-only` "switch to" label on each INACTIVE segment only
 * (the active segment already reads as pressed, so an invitation to switch to the
 * current language would contradict it), visible `focus-visible` rings, and a CSS
 * transition on the active state. All copy
 * resolves through the `LocaleToggle` next-intl namespace (EN + FR) — no
 * hardcoded strings. Zinc theme tokens keep contrast at WCAG AA.
 */
export function LocaleToggle() {
  const t = useTranslations("LocaleToggle");
  const active = useLocale() as Locale;
  const { setLocale } = useLocaleSwitcher();

  return (
    <div
      role="group"
      aria-label={t("label")}
      className="ml-auto inline-flex items-center gap-0.5 rounded-full border bg-muted/50 p-0.5"
    >
      <Languages aria-hidden="true" className="ml-1.5 size-4 text-muted-foreground" />
      {locales.map((loc) => (
        <button
          key={loc}
          type="button"
          aria-pressed={loc === active}
          onClick={() => setLocale(loc)}
          className={cn(
            "rounded-full px-3 py-1.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
            loc === active
              ? "bg-background text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {t(`locale.${loc}`)}
          {loc !== active ? (
            <span className="sr-only">{t(`switchTo.${loc}`)}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
}
