import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppError } from "@/types/api";
import type { ResolvedMembership } from "@/lib/auth/org";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
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
 * Scope (4.1): upload + parse + read-only preview only. No column mapping (4.2),
 * edit/resolve (4.3), or commit (4.4) — those layer on later and add their own UI.
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
      <ImportView slug={slug} />
    </main>
  );
}
