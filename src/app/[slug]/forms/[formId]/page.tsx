import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { FormEditor } from "@/components/forms/FormEditor";
import { loadFormForEditor } from "../_shared";

/**
 * Admin-only Forms editor at `/{slug}/forms/[formId]` (Epic 14, Stories 14.1 + 14.3).
 * Server component: `loadFormForEditor` runs the Admin gate, reads the form under RLS,
 * and evaluates the server-side publish gate (the `/api/forms/[formId]` routes re-enforce
 * both Admin and the publish predicate independently). A form not in the caller's org
 * renders a not-found note. Otherwise the client `FormEditor` hosts the title rename, slug
 * edit (locked once published), the target-table picker (Story 14.4; visible tables,
 * locked once published), the publish toggle + share surface, and delete.
 */

export const dynamic = "force-dynamic";

export default async function FormEditorPage({
  params,
}: {
  params: Promise<{ slug: string; formId: string }>;
}) {
  const { slug, formId } = await params;
  const t = await getTranslations("Forms");

  const loaded = await loadFormForEditor(slug, formId);
  const form = loaded?.form ?? null;

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
          tables={loaded?.tables ?? []}
          editorFields={loaded?.editorFields ?? []}
          initialFieldConfig={form.field_config}
          initialIntroText={form.intro_text}
          initialPublished={form.published}
          publishable={loaded?.publishable ?? false}
          publishReason={loaded?.reason ?? "no-target"}
        />
      )}
    </main>
  );
}
