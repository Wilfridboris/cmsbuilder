"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { AlertTriangle, Clock } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { MemberRole, SubscriptionStatus } from "@/types/db";

/**
 * TrialBanner (Story 7.4) — the persistent dashboard conversion / read-only notice.
 *
 * A client component mirroring `BillingStart`'s conventions: `useTranslations`
 * ("Trial"), a subtle framer-motion reveal gated by `useReducedMotion` (WCAG AA),
 * and a server-independent CTA (the server re-enforces the Admin gate and the
 * write gate). It renders in exactly two states, otherwise nothing:
 *
 *   - converting: the org is a `trial` with 0..2 days left — a `role="status"`
 *     prompt "Your trial ends in N days..."; an admin additionally sees an
 *     "Add billing" link to `/{slug}/settings#billing`, a member sees the prompt
 *     only (billing is Admin-only RBAC).
 *   - read-only: the org is `read_only` (or an expired trial the cron has not yet
 *     flipped) — a `role="alert"` paused-account notice; admin gets the CTA, member
 *     the notice only.
 *
 * The server layout computes `daysRemaining` + passes `subscriptionStatus` + `role`
 * so this component never fetches. No layout shift: the banner is a block that is
 * either present (both states) or absent (hidden), never a reflowing placeholder.
 */

/** The states the banner can show; `hidden` means render nothing. */
type BannerState = "converting" | "readOnly" | "hidden";

/** Pure state resolver — mirrors the server-side gate so UI and enforcement agree. */
export function resolveBannerState(
  subscriptionStatus: SubscriptionStatus,
  daysRemaining: number | null,
): BannerState {
  if (subscriptionStatus === "read_only") {
    return "readOnly";
  }
  if (subscriptionStatus === "trial" && daysRemaining !== null) {
    if (daysRemaining <= 0) {
      // An expired trial the cron has not yet flipped: enforce read-only in the UI.
      return "readOnly";
    }
    if (daysRemaining <= 2) {
      return "converting";
    }
  }
  return "hidden";
}

export function TrialBanner({
  slug,
  subscriptionStatus,
  daysRemaining,
  role,
}: {
  slug: string;
  subscriptionStatus: SubscriptionStatus;
  /** Whole days left in the trial, or null when not on a trial clock. */
  daysRemaining: number | null;
  role: MemberRole;
}) {
  const t = useTranslations("Trial");
  const prefersReducedMotion = useReducedMotion();

  const state = resolveBannerState(subscriptionStatus, daysRemaining);
  if (state === "hidden") {
    return null;
  }

  const isAdmin = role === "admin";
  const isReadOnly = state === "readOnly";

  const title = isReadOnly ? t("readOnlyTitle") : t("convertingTitle");
  const message = isReadOnly
    ? isAdmin
      ? t("readOnlyMessage")
      : t("readOnlyMessageMember")
    : daysRemaining !== null && daysRemaining >= 1
      ? t("convertingMessage", { days: daysRemaining })
      : t("convertingMessageToday");

  const reveal = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 } };

  const Icon = isReadOnly ? AlertTriangle : Clock;

  return (
    <motion.div
      {...reveal}
      transition={{ duration: 0.25 }}
      role={isReadOnly ? "alert" : "status"}
      className={cn(
        "w-full border-b",
        isReadOnly
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
      )}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Icon aria-hidden="true" className="mt-0.5 size-5 shrink-0" />
          <div className="flex flex-col gap-0.5">
            <p className="text-sm font-semibold">{title}</p>
            <p className="text-sm text-pretty">{message}</p>
          </div>
        </div>

        {isAdmin ? (
          <Link
            href={`/${slug}/settings#billing`}
            className={cn(
              buttonVariants({ variant: isReadOnly ? "default" : "outline", size: "sm" }),
              "shrink-0 self-start sm:self-auto",
            )}
          >
            {t("addBillingCta")}
          </Link>
        ) : null}
      </div>
    </motion.div>
  );
}
