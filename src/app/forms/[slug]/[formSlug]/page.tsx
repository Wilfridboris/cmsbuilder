import { resolvePublicFormTarget } from "@/lib/data/forms-public";
import { IntakeForm, Unavailable } from "@/components/intake/IntakeForm";

/**
 * `GET /forms/[slug]/[formSlug]` — the PUBLIC, no-auth FORM-KEYED intake form (Epic 14,
 * Story 14.2).
 *
 * The multi-form public surface: each `forms` row is independently reachable at
 * `/forms/{orgSlug}/{formSlug}`. An unauthenticated visitor opens the page with NO
 * session; `resolvePublicFormTarget` resolves `(orgSlug, formSlug)` to a PUBLISHED form
 * via the SERVICE-ROLE admin client (no RLS), treating the form's stored
 * `target_table_key` as authoritative. Resolution is STRICT and published-gated — an
 * unknown/unpublished form or a null/stale target table degrades to the friendly
 * `Unavailable` state, with NO heuristic fallback and no distinction between causes. The
 * page inherits the neutral root layout — no dashboard nav/chrome.
 *
 * Public via `PUBLIC_TOP_LEVEL` in `src/middleware.ts` (`"forms"`).
 *
 * `force-dynamic`: the resolution reads live per request and must never be cached across
 * orgs/forms. No DB/provider internals leak.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function KeyedIntakeFormPage({
  params,
}: {
  params: Promise<{ slug: string; formSlug: string }>;
}) {
  const { slug, formSlug } = await params;
  const target = await resolvePublicFormTarget({ orgSlug: slug, formSlug });

  if (!target) {
    return <Unavailable />;
  }

  return (
    <IntakeForm
      submitPath={`/api/intake/${encodeURIComponent(slug)}/${encodeURIComponent(
        formSlug,
      )}`}
      orgName={target.orgName}
      fields={target.fields}
    />
  );
}
