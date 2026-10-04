import { resolvePublicFormTarget } from "@/lib/data/forms-public";
import { IntakeForm, Unavailable } from "@/components/intake/IntakeForm";

/**
 * `GET /forms/[slug]` — the PUBLIC, no-auth LEGACY bare-org intake form (Story 6.1,
 * FR25; migrated onto the `forms` entity in Story 14.2).
 *
 * A claimed org's public lead-capture surface. An unauthenticated visitor (arriving from
 * a Google Business bio or a shared link) opens `/forms/{slug}` with NO session;
 * `resolvePublicFormTarget` resolves the slug to an org and its PRIMARY PUBLISHED form
 * (oldest `published` by `created_at`) via the SERVICE-ROLE admin client (no RLS),
 * treating the form's stored `target_table_key` as authoritative. Resolution is STRICT:
 * with no published form (the default state until 14.3) the page degrades to the friendly
 * `Unavailable` state, with NO fallback to the Epic-6 intake heuristic. The page inherits
 * the neutral root layout — no dashboard nav/chrome.
 *
 * Public via `PUBLIC_TOP_LEVEL` in `src/middleware.ts` (`"forms"`): without that entry
 * `/forms` would be treated as a protected tenant slug and bounced to `/login`.
 *
 * `force-dynamic`: the slug->org->form resolution reads live per request and must never
 * be cached across orgs. An unknown slug or an org with nothing to collect degrades to the
 * friendly `Unavailable` state (never an error screen); no DB/provider internals leak.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export default async function IntakeFormPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const target = await resolvePublicFormTarget({ orgSlug: slug });

  if (!target) {
    return <Unavailable />;
  }

  return (
    <IntakeForm
      submitPath={`/api/intake/${encodeURIComponent(slug)}`}
      orgName={target.orgName}
      fields={target.fields}
      operatingName={target.operatingName}
      logoUrl={target.logoUrl}
      introText={target.introText}
    />
  );
}
