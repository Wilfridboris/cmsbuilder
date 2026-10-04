import { FormsList } from "@/components/forms/FormsList";
import { loadFormsPageContext } from "./_shared";

/**
 * Admin-only Forms list at `/{slug}/forms` (Epic 14, Story 14.1). Server component:
 * gates via `loadFormsPageContext` (non-Admin bounces to `/{slug}`), then renders the
 * client `FormsList` which fetches the org's forms and hosts the create dialog. The
 * list/create endpoints re-enforce Admin server-side (frontend gating is never the sole
 * enforcement). No public effect — this story adds management only.
 */

export const dynamic = "force-dynamic";

export default async function FormsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  await loadFormsPageContext(slug);

  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16">
      <FormsList slug={slug} />
    </main>
  );
}
