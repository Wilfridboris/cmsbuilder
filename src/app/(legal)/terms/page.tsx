import { getTranslations } from "next-intl/server";

import { LocaleToggle } from "@/components/i18n/LocaleToggle";

/**
 * Terms of Service placeholder (Story 2.1). The claim consent checkbox links
 * here; the real legal copy is deferred (frozen constraint). Translated
 * placeholder only. Story 15.1 surfaces the EN/FR toggle (a client component
 * rendered directly from this server page).
 */
export default async function TermsPage() {
  const t = await getTranslations("Legal");
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-16">
      <div className="flex justify-end">
        <LocaleToggle />
      </div>
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("termsTitle")}
      </h1>
      <p className="text-base text-muted-foreground">{t("placeholder")}</p>
    </main>
  );
}
