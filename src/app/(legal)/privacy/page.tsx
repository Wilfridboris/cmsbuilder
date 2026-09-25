import { getTranslations } from "next-intl/server";

/**
 * Privacy Policy placeholder (Story 2.1). The claim consent checkbox links here,
 * so the link must resolve — but the real legal copy is deferred (frozen: "Do
 * not author the actual Privacy Policy / Terms legal copy here"). This renders a
 * translated placeholder only.
 */
export default async function PrivacyPage() {
  const t = await getTranslations("Legal");
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 px-6 py-16">
      <h1 className="text-3xl font-semibold tracking-tight">
        {t("privacyTitle")}
      </h1>
      <p className="text-base text-muted-foreground">{t("placeholder")}</p>
    </main>
  );
}
