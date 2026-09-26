import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUserOrgMembership } from "@/lib/auth/org";
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

  // Resolve the caller's org + role. A non-member (null) or a Member is not an
  // admin of this surface → bounce to the tenant dashboard. A slug mismatch (an
  // admin of a DIFFERENT org) is likewise bounced to their own dashboard.
  const membership = await resolveUserOrgMembership(user.id, createAdminClient());
  if (!membership || membership.role !== "admin" || membership.slug !== slug) {
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
