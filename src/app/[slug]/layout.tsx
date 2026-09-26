import type { ReactNode } from "react";

import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUserOrgMembership } from "@/lib/auth/org";
import { DashboardNav } from "@/components/layout/DashboardNav";

/**
 * Tenant shell layout for `/{slug}` and its subpages (Story 2.4).
 *
 * Server layout that resolves the caller's membership ONCE and renders the
 * role-aware `DashboardNav` above the page. Resolving here keeps role off the
 * client (there is no client role provider) and avoids a `GET /api/membership`
 * round-trip — a Member simply never receives the Admin links in their HTML.
 *
 * Unauthenticated access continues to defer to `middleware.ts` (which bounces a
 * signed-out visitor to `/login?auth=required`); this layout adds no role
 * enforcement of its own — the page itself (RLS-scoped) and the API routes (via
 * `requireAdmin`) are the hard gates. When membership can't be resolved (a valid
 * session with no `org_members` row, or a viewer of a slug they don't belong to)
 * the nav is omitted and the page handles the redirect — never a crash.
 */

export const dynamic = "force-dynamic";

export default async function SlugLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;

  const user = await getCurrentUser();
  // No session → middleware already redirected; render children so the page's
  // own auth check runs. No nav (no role to show).
  const membership = user
    ? await resolveUserOrgMembership(user.id, createAdminClient())
    : null;

  // Only show the nav for a caller who actually belongs to THIS org. A
  // cross-org / no-membership viewer gets no nav; the page bounces them.
  const showNav = membership !== null && membership.slug === slug;

  return (
    <>
      {showNav ? <DashboardNav slug={slug} role={membership.role} /> : null}
      {children}
    </>
  );
}
