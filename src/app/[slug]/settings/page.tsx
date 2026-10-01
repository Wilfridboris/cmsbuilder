import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";

import { AppError } from "@/types/api";
import type { ResolvedMembership } from "@/lib/auth/org";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { requireAdmin } from "@/lib/auth/rbac";
import type { SubscriptionStatus, SubscriptionTier } from "@/types/db";
import { priceIdToTier, nextTierUp } from "@/lib/billing/tiers";
import { shouldPromptUpgrade } from "@/lib/billing/tier-prompt";
import { countIssuedInvoicesInPeriod } from "@/lib/data/invoices";
import { reportError } from "@/lib/observability/report";
import { InviteForm } from "@/components/settings/InviteForm";
import { BusinessProfileForm } from "@/components/settings/BusinessProfileForm";
import { BillingStart } from "@/components/settings/BillingStart";
import { BillingManage } from "@/components/settings/BillingManage";
import { TierView } from "@/components/settings/TierView";

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

/** The read-only tier-view props the page computes for a subscribed org (Story 7.5). */
type TierViewData = {
  tier: SubscriptionTier;
  nextBillingDate: string | null;
  showUpgradePrompt: boolean;
  suggestedTier: SubscriptionTier | null;
};

/**
 * Build the tier-view data for a subscribed org (Story 7.5). Does a LIVE Stripe fetch
 * of the subscription: the next billing date and the authoritative current tier come
 * from the subscription ITEM (`items.data[0].current_period_end` / `.price.id` on the
 * pinned API version), and the last fully-completed billing cycle's issued-invoice
 * count drives the advisory upgrade prompt.
 *
 * Graceful degradation (Boundaries / matrix): if the Stripe fetch (or anything after
 * it) throws, we log via `reportError` and fall back to the CACHED tier with no
 * next-billing-date and no prompt — the page must never be blocked by Stripe downtime.
 */
async function resolveTierView(
  orgId: string,
  subscriptionId: string,
  cachedTier: SubscriptionTier,
): Promise<TierViewData> {
  try {
    // Lazy-load the Stripe client so the heavy SDK stays OUT of this page module's
    // eager import graph: unauthenticated / trial / read-only settings loads (the
    // common path) never pay to evaluate it, and only a subscribed org actually
    // resolving its tier view pulls it in.
    const { getStripeClient } = await import("@/lib/stripe/client");
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(subscriptionId);

    // On the pinned API version the billing-period boundaries + price live on the
    // subscription ITEM, not top-level.
    const item = subscription.items?.data?.[0];
    const periodEndSec = item?.current_period_end ?? null;
    const periodStartSec = item?.current_period_start ?? null;

    // Authoritative tier from the item's price id; fall back to the cached tier when
    // the price id does not reverse-map (misconfiguration — surfaced by the reconcile
    // cron, never blocking the view).
    const authoritativeTier =
      priceIdToTier(item?.price?.id ?? null) ?? cachedTier;

    const nextBillingDate =
      periodEndSec !== null
        ? new Date(periodEndSec * 1000).toISOString()
        : null;

    // Count issued invoices over the LAST FULLY COMPLETED cycle:
    // [current_period_start - cycleLength, current_period_start). Only when both
    // boundaries are known AND there is a prior cycle to measure.
    let issuedLastCycle = 0;
    if (periodStartSec !== null && periodEndSec !== null) {
      const cycleLengthSec = periodEndSec - periodStartSec;
      const lastCycleStartSec = periodStartSec - cycleLengthSec;
      if (cycleLengthSec > 0) {
        const cookieStore = await cookies();
        const rlsClient = createServerSupabaseClient(cookieStore);
        const startDate = new Date(lastCycleStartSec * 1000)
          .toISOString()
          .slice(0, 10);
        const endDate = new Date(periodStartSec * 1000)
          .toISOString()
          .slice(0, 10);
        issuedLastCycle = await countIssuedInvoicesInPeriod(
          rlsClient,
          orgId,
          startDate,
          endDate,
        );
      }
    }

    const showUpgradePrompt = shouldPromptUpgrade(
      authoritativeTier,
      issuedLastCycle,
    );

    return {
      tier: authoritativeTier,
      nextBillingDate,
      showUpgradePrompt,
      suggestedTier: showUpgradePrompt ? nextTierUp(authoritativeTier) : null,
    };
  } catch (err) {
    // Degrade gracefully: cached tier + inclusions only, no date, no prompt.
    reportError(err, {
      route: "/[slug]/settings",
      orgId,
      subscriptionId,
    });
    return {
      tier: cachedTier,
      nextBillingDate: null,
      showUpgradePrompt: false,
      suggestedTier: null,
    };
  }
}

export default async function SettingsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const t = await getTranslations("Settings");
  const tBilling = await getTranslations("Billing");

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
  const adminClient = createAdminClient();
  let membership: ResolvedMembership;
  try {
    membership = await requireAdmin(user, adminClient);
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

  // Branch the Billing surface on the org's cached subscription status (Story
  // 7.3). Read via the in-scope service-role admin client (the caller is a proven
  // Admin of this org). Handle the read `error` EXPLICITLY: an errored read must
  // NOT silently default to `trial` and hide "Manage billing" from an active
  // admin — treat an errored/absent read as its own state so the fallback is the
  // safe "Add billing" only when the status is genuinely trial/read_only. Here we
  // surface a read error by throwing so the page fails visibly rather than
  // mis-rendering the billing surface.
  const { data: billingRow, error: billingReadError } = await adminClient
    .from("organizations")
    .select("subscription_status, subscription_tier, stripe_subscription_id")
    .eq("id", membership.orgId)
    .maybeSingle();
  if (billingReadError) {
    throw new AppError(
      500,
      "genericError",
      `Failed to read subscription_status for org ${membership.orgId}: ${billingReadError.message}`,
    );
  }
  const subscriptionStatus =
    (billingRow?.subscription_status as SubscriptionStatus | undefined) ??
    "trial";
  // active/past_due have a Stripe customer → the portal ("Manage billing").
  // trial/read_only re-subscribe via a fresh checkout ("Add billing"): a
  // read_only (canceled) org's subscription no longer exists, so the portal
  // cannot restart it.
  const showManageBilling =
    subscriptionStatus === "active" || subscriptionStatus === "past_due";

  // Story 7.5: for a SUBSCRIBED org with a Stripe subscription, build the read-only
  // tier-view data (authoritative tier + next billing date from a live Stripe fetch,
  // last-completed-cycle issued-invoice count for the advisory upgrade prompt). The
  // fetch degrades gracefully — on any error we render the card from the cached tier
  // with no next-billing-date and no prompt, never blocking the page. Trial/read_only
  // orgs keep the existing add-billing surface (no tier card).
  const cachedTier =
    (billingRow?.subscription_tier as SubscriptionTier | null | undefined) ??
    null;
  const subscriptionId =
    (billingRow?.stripe_subscription_id as string | null | undefined) ?? null;
  const tierView =
    showManageBilling && subscriptionId && cachedTier
      ? await resolveTierView(
          membership.orgId,
          subscriptionId,
          cachedTier,
        )
      : null;
  // Match the section subtitle to the surface: manage-oriented for active/past_due
  // (portal), a "subscription ended" prompt for read_only (re-subscribe), and the
  // trial add-a-card copy otherwise.
  const billingSubtitleKey = showManageBilling
    ? "manageSubtitle"
    : subscriptionStatus === "read_only"
      ? "endedSubtitle"
      : "subtitle";

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-12 px-6 py-16">
      <section className="flex flex-col gap-8">
        <header className="flex flex-col gap-2">
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {t("title")}
          </h1>
          <p className="text-sm text-muted-foreground text-pretty">
            {t("subtitle")}
          </p>
        </header>
        <InviteForm />
      </section>

      <hr className="border-border" />

      <section id="billing" className="flex flex-col gap-8 scroll-mt-16">
        <header className="flex flex-col gap-2">
          <h2 className="text-2xl font-semibold tracking-tight text-balance">
            {tBilling("title")}
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">
            {tBilling(billingSubtitleKey)}
          </p>
        </header>
        {showManageBilling ? (
          <>
            {tierView ? (
              <TierView
                slug={slug}
                tier={tierView.tier}
                nextBillingDate={tierView.nextBillingDate}
                showUpgradePrompt={tierView.showUpgradePrompt}
                suggestedTier={tierView.suggestedTier}
              />
            ) : null}
            <BillingManage slug={slug} />
          </>
        ) : (
          <BillingStart slug={slug} />
        )}
      </section>

      <hr className="border-border" />

      <BusinessProfileForm slug={slug} />
    </main>
  );
}
