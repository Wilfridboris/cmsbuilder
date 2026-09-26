import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppError } from "@/types/api";
import type { ResolvedMembership } from "@/lib/auth/org";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { InviteForm } from "@/components/settings/InviteForm";

/**
 * Admin-only Settings surface at `/{slug}/settings` (Story 2.3).
 *
 * Server component mirroring the `/{slug}` protected-page pattern plus an admin
 * gate. It resolves the caller's membership (org + role) via
 * `resolveUserOrgMembership` and redirects away to `/{slug}` unless they are an
 * Admin whose org matches the requested slug. This is a UX gate — the invite
 * ACTION is independently re-authorized server-side in `POST /api/invite`
 * (frontend hiding is never the sole enforcement).
 *
 * Scope (frozen): the invite form ONLY — no member list, role change, or revoke
 * UI (deferred to 2.4+).
 */

export const dynamic = "force-dynamic";

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("Settings");

  // Middleware already bounced unauthenticated visits to /login; re-check for
  // defense in depth (and to have the user id for the membership resolve).
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?auth=required");
  }

  // Reuse the single RBAC guard for the admin resolution (Story 2.4). This is a
  // UX GATE: the page keeps its redirect-to-`/{slug}` behavior rather than
  // surfacing a raw 403, so a non-member / Member / cross-org admin bounces to
  // the tenant dashboard. The invite ACTION is independently re-enforced by the
  // same guard in `POST /api/invite` (frontend hiding is never the sole gate).
  let membership: ResolvedMembership;
  try {
    membership = await requireAdmin(user, createAdminClient());
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/${slug}`);
    }
    throw err;
  }
  // A slug mismatch (an admin of a DIFFERENT org) is likewise bounced to their
  // own dashboard rather than shown another org's Settings.
  if (membership.slug !== slug) {
    redirect(`/${slug}`);
  }

  return (
    <main className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center gap-8 px-6 py-16">
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {t("title")}
        </h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("subtitle")}
        </p>
      </header>
      <InviteForm />
    </main>
  );
}
