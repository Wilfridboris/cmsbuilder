import type { ReactNode } from "react";

import { getLocale } from "next-intl/server";

import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUserOrgMembership } from "@/lib/auth/org";
import { reportError } from "@/lib/observability/report";
import { isOffboarding, isDeleted } from "@/lib/billing/access";
import { DashboardNav } from "@/components/layout/DashboardNav";
import { TrialBanner } from "@/components/layout/TrialBanner";
import { GracePeriodBanner } from "@/components/layout/GracePeriodBanner";
import { AccountClosedScreen } from "@/components/layout/AccountClosedScreen";
import { ActiveTableProvider } from "@/components/dashboard/ActiveTableProvider";
import { ChatAssistant } from "@/components/chat/ChatAssistant";
import type { SubscriptionStatus } from "@/types/db";

/** Grace length matched to the Day-30 cascade (Story 8.5). */
const GRACE_PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** Whole days from `now` until `trialExpiresAt` (negative past expiry); null when unset. */
function daysUntil(trialExpiresAt: string | null, now: Date): number | null {
  if (!trialExpiresAt) {
    return null;
  }
  const ms = new Date(trialExpiresAt).getTime() - now.getTime();
  return Math.ceil(ms / (24 * 60 * 60 * 1000));
}

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
  const adminClient = createAdminClient();
  // No session → middleware already redirected; render children so the page's
  // own auth check runs. No nav (no role to show).
  const membership = user
    ? await resolveUserOrgMembership(user.id, adminClient)
    : null;

  // Only show the nav for a caller who actually belongs to THIS org. A
  // cross-org / no-membership viewer gets no nav; the page bounces them.
  const showNav = membership !== null && membership.slug === slug;

  // Story 7.4 / 8.5: load the org's cached access state to drive the persistent
  // trial / read-only / grace banner (and the terminal account-closed screen). Only
  // for a confirmed member of THIS org (the gated surface).
  let banner: {
    subscriptionStatus: SubscriptionStatus;
    daysRemaining: number | null;
  } | null = null;
  // Story 8.5: grace-period UI state (null unless the org is mid-offboarding).
  let grace: { daysRemaining: number; deletionDateLabel: string } | null = null;
  // Story 8.5: terminal tombstone — render the account-closed screen instead of
  // the nav + banners + children.
  let accountDeleted = false;
  if (showNav && membership) {
    const { data: org, error } = await adminClient
      .from("organizations")
      .select(
        "subscription_status, trial_expires_at, offboarding_initiated_at, offboarding_purged_at",
      )
      .eq("id", membership.orgId)
      .maybeSingle();
    // Handle the read error explicitly: do NOT silently default an errored read to a
    // "hidden" banner. On error, surface the read-only notice (the safe side — an org
    // whose state we cannot confirm should be told access may be paused, never shown a
    // false "all clear"). A successful read drives the exact state.
    if (error) {
      // A transient read failure shows the safe-side read-only notice; log it so the
      // false-alarm branch (a paying org briefly told it is read-only) is observable.
      reportError(error, { route: "[slug]/layout" });
      banner = { subscriptionStatus: "read_only", daysRemaining: null };
    } else if (org) {
      const status = org.subscription_status as SubscriptionStatus;
      const initiatedAt =
        (org.offboarding_initiated_at as string | null) ?? null;
      const purgedAt = (org.offboarding_purged_at as string | null) ?? null;

      if (isDeleted(status)) {
        accountDeleted = true;
      } else if (
        isOffboarding({
          offboarding_initiated_at: initiatedAt,
          offboarding_purged_at: purgedAt,
        }) &&
        initiatedAt
      ) {
        // Mid-offboarding: compute the countdown + localized deletion date here so
        // the client banner stays pure. `daysRemaining` is whole days to deletion,
        // clamped to >= 0 (the sweep deletes at day 30).
        const deletionMs =
          new Date(initiatedAt).getTime() + GRACE_PERIOD_DAYS * DAY_MS;
        const daysRemaining = Math.max(
          0,
          Math.ceil((deletionMs - new Date().getTime()) / DAY_MS),
        );
        const locale = await getLocale();
        const deletionDateLabel = new Intl.DateTimeFormat(
          locale === "fr" ? "fr-CA" : "en-CA",
          { year: "numeric", month: "long", day: "numeric" },
        ).format(new Date(deletionMs));
        grace = { daysRemaining, deletionDateLabel };
      } else {
        banner = {
          subscriptionStatus: status,
          daysRemaining: daysUntil(
            (org.trial_expires_at as string | null) ?? null,
            new Date(),
          ),
        };
      }
    }
  }

  // Story 5.1: the floating AI Assistant chat is Admin-only (hidden for Members
  // per RBAC); the endpoint's `requireAdmin` is the real server-side gate. Only an
  // Admin of THIS org gets the pill.
  const isAdminHere =
    showNav && membership !== null && membership.role === "admin";

  // Story 8.5: a `deleted` org gets the terminal account-closed screen in place of
  // the whole tenant shell (no nav, no banner, no dashboard data).
  if (accountDeleted) {
    return <AccountClosedScreen />;
  }

  return (
    <ActiveTableProvider>
      {showNav ? <DashboardNav slug={slug} role={membership.role} /> : null}
      {/* Exactly ONE banner shows: the offboarding grace banner suppresses the
          TrialBanner's read-only state while the org is mid-offboarding. */}
      {showNav && membership && grace ? (
        <GracePeriodBanner
          slug={slug}
          role={membership.role}
          daysRemaining={grace.daysRemaining}
          deletionDateLabel={grace.deletionDateLabel}
        />
      ) : showNav && membership && banner ? (
        <TrialBanner
          slug={slug}
          role={membership.role}
          subscriptionStatus={banner.subscriptionStatus}
          daysRemaining={banner.daysRemaining}
        />
      ) : null}
      {children}
      {isAdminHere ? <ChatAssistant slug={slug} /> : null}
    </ActiveTableProvider>
  );
}
