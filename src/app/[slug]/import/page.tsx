import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppError } from "@/types/api";
import type { ResolvedMembership } from "@/lib/auth/org";
import type { FieldCatalog } from "@/types/import";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { resolveOrgIdentity } from "@/lib/api/route-helpers";
import { getSchema } from "@/lib/data/records";
import { ImportView } from "@/components/import/ImportView";

/**
 * Admin-only Import surface at `/{slug}/import` (Story 4.1 — analyze phase).
 *
 * Server component mirroring the `/{slug}/settings` admin-gate pattern: resolve
 * the caller's membership via `requireAdmin` and redirect a non-member / Member /
 * cross-org admin to `/{slug}`. This is the UX gate; the analyze ACTION is
 * independently re-authorized in `POST /api/import/analyze` (frontend hiding is
 * never the sole enforcement).
 *
 * Scope (4.3): after the admin gate, resolve the caller's RLS-scoped client + orgId
 * (`resolveOrgIdentity`) and READ the org schema (`getSchema`) to build a client-safe
 * `FieldCatalog` (non-hidden tables/fields only — safe `{key, label, type}` metadata)
 * that the editable mapping surface uses for its target picker and label rendering.
 * A schema read failure or empty schema degrades to an empty catalog (the picker
 * offers only "skip"; no crash). Still writes NOTHING — the commit is 4.4.
 */

export const dynamic = "force-dynamic";

export default async function ImportPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("Import");

  // Middleware already bounced unauthenticated visits to /login; re-check for
  // defense in depth (and to have the user id for the membership resolve).
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?auth=required");
  }

  // Reuse the single RBAC guard for the admin resolution. A non-member / Member /
  // cross-org admin bounces to the tenant dashboard rather than seeing a raw 403.
  let membership: ResolvedMembership;
  try {
    membership = await requireAdmin(user, createAdminClient());
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/${slug}`);
    }
    throw err;
  }
  if (membership.slug !== slug) {
    redirect(`/${slug}`);
  }

  // READ the org schema under the caller's RLS-scoped client (never the
  // service-role client, never a write) and project it to a client-safe catalog:
  // non-hidden tables, each with its non-hidden fields as `{key, label, type}`.
  // A read failure or empty schema degrades to an empty catalog so the picker
  // still works (skip-only) and the page never crashes.
  let fieldCatalog: FieldCatalog = [];
  try {
    const { client, orgId } = await resolveOrgIdentity(slug, user.id);
    const schemaResult = await getSchema(client, orgId);
    if (schemaResult.data) {
      fieldCatalog = schemaResult.data.tables
        .filter((table) => !table.hidden)
        .map((table) => ({
          tableKey: table.key,
          tableLabel: table.label,
          fields: table.fields
            .filter((field) => !field.hidden)
            .map((field) => ({
              key: field.key,
              label: field.label,
              type: field.type,
            })),
        }));
    }
  } catch {
    // Degrade silently to an empty catalog — no error screen (matrix row:
    // empty / unreadable schema). The picker will offer only "skip".
    fieldCatalog = [];
  }

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("subtitle")}
        </p>
      </header>
      <ImportView slug={slug} fieldCatalog={fieldCatalog} />
    </main>
  );
}
