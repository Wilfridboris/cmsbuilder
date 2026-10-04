import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FormEditor } from "@/components/forms/FormEditor";
import { loadFormForPage } from "../_shared";

/**
 * Admin-only Forms editor at `/{slug}/forms/[formId]` (Epic 14, Story 14.1). Server
 * component: `loadFormForPage` runs the Admin gate and reads the form under RLS (the
 * `/api/forms/[formId]` routes re-enforce Admin independently). A form not in the
 * caller's org renders a not-found note. Otherwise the client `FormEditor` hosts the
 * title rename, slug edit, read-only target-table display, and delete. The target table
 * is read-only here — owner reassignment is Story 14.4.
 */

export const dynamic = "force-dynamic";

export default async function FormEditorPage({
  params,
}: {
  params: Promise<{ slug: string; formId: string }>;
}) {
  const { slug, formId } = await params;
  const t = await getTranslations("Forms");

  const form = await loadFormForPage(slug, formId);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-16">
      <Link
        href={`/${slug}/forms`}
        className={cn(
          buttonVariants({ variant: "ghost", size: "sm" }),
          "w-fit gap-2",
        )}
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t("backToList")}
      </Link>

      {!form ? (
        <p role="alert" className="text-sm text-destructive">
          {t("error.notFound")}
        </p>
      ) : (
        <FormEditor
          slug={slug}
          formId={form.id}
          initialTitle={form.title}
          initialSlug={form.slug}
          targetTableKey={form.target_table_key}
        />
      )}
    </main>
  );
}
