"use client";

import Link from "next/link";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { CalendarClock } from "lucide-react";

import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import type { MemberRole } from "@/types/db";

/**
 * GracePeriodBanner (Story 8.5, FR38) — the inline offboarding grace notice shown
 * throughout the 30-day read-only grace period after a voluntary cancellation.
 *
 * Mirrors `TrialBanner` exactly in structure, tokens, and motion: an inline
 * full-width `border-b` block (NOT portalled/fixed, so the DashboardNav backdrop-blur
 * fixed-overlay gotcha does not apply), a subtle framer-motion reveal gated by
 * `useReducedMotion` (WCAG AA), and a server-independent CTA. The server pre-formats
 * the localized deletion-date label and the whole-days countdown and passes them in,
 * so this component stays pure and never computes dates or fetches.
 *
 * Urgent-but-calm (amber, not failure-red). An admin sees the "Download my data" and
 * "Keep my account" actions; a member sees the notice only (billing is Admin-only
 * RBAC, enforced server-side regardless).
 */

export function GracePeriodBanner({
  slug,
  role,
  daysRemaining,
  deletionDateLabel,
}: {
  slug: string;
  role: MemberRole;
  /** Whole days left until deletion (clamped to >= 0 by the server). */
  daysRemaining: number;
  /** The localized, pre-formatted deletion date (e.g. "November 5, 2026"). */
  deletionDateLabel: string;
}) {
  const t = useTranslations("Offboarding");
  const prefersReducedMotion = useReducedMotion();

  const isAdmin = role === "admin";

  const reveal = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: -4 }, animate: { opacity: 1, y: 0 } };

  return (
    <motion.div
      {...reveal}
      transition={{ duration: 0.25 }}
      role="alert"
      className={cn(
        "w-full border-b border-amber-300/60 bg-amber-50 text-amber-900",
        "dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200",
      )}
    >
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <CalendarClock
            aria-hidden="true"
            className="mt-0.5 size-5 shrink-0"
          />
          <div className="flex flex-col gap-1">
            <p className="text-sm font-semibold">{t("banner.title")}</p>
            <p className="text-sm text-pretty">
              {isAdmin
                ? t("banner.message", { date: deletionDateLabel })
                : t("banner.messageMember", { date: deletionDateLabel })}
            </p>
            <span className="mt-0.5 w-fit rounded-full bg-destructive/10 px-2 py-0.5 text-xs font-semibold text-destructive">
              {t("banner.countdown", { days: daysRemaining })}
            </span>
          </div>
        </div>

        {isAdmin ? (
          <div className="flex shrink-0 flex-wrap gap-2 self-start sm:self-auto">
            <Link
              href={`/${slug}/settings#offboarding`}
              className={cn(buttonVariants({ variant: "default", size: "sm" }))}
            >
              {t("banner.downloadCta")}
            </Link>
            <Link
              href={`/${slug}/settings#billing`}
              className={cn(buttonVariants({ variant: "outline", size: "sm" }))}
            >
              {t("banner.keepCta")}
            </Link>
          </div>
        ) : null}
      </div>
    </motion.div>
  );
}
