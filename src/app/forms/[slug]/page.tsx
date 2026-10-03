import { getPublicIntakeForm } from "@/lib/data/intake";
import { IntakeForm, Unavailable } from "@/components/intake/IntakeForm";

/**
 * `GET /forms/[slug]` — the PUBLIC, no-auth intake form (Story 6.1, FR25).
 *
 * A claimed org's public lead-capture surface. An unauthenticated visitor (arriving
 * from a Google Business bio or a shared link) opens `/forms/{slug}` with NO session;
 * `getPublicIntakeForm` resolves the slug to an org and derives the form from the org's
 * existing schema via the SERVICE-ROLE admin client (no RLS), mirroring the `/i/[token]`
 * public pattern (`force-dynamic`, data-free failure). The page inherits the neutral
 * root layout — no dashboard nav/chrome.
 *
 * This story delivers the public PAGE only: the rendered, labelled, type-matched inputs
 * plus a present-but-unwired submit button. The submission write, confirmation, and
 * inline validation are Story 6.2; real-time (6.3) and email (6.4) are later still.
 *
 * Public via `PUBLIC_TOP_LEVEL` in `src/middleware.ts` (`"forms"`): without that entry
 * `/forms` would be treated as a protected tenant slug and bounced to `/login`.
 *
 * `force-dynamic`: the slug->org resolution reads live per request and must never be
 * cached across orgs. An unknown slug or an org with nothing to collect degrades to the
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
  const form = await getPublicIntakeForm(slug);

  if (!form) {
    return <Unavailable />;
  }

  return <IntakeForm slug={slug} orgName={form.orgName} fields={form.fields} />;
}
