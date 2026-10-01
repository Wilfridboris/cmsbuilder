"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowUpCircle, Check, CreditCard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ApiResponse } from "@/types/api";
import type { SubscriptionTier } from "@/types/db";

/**
 * TierView (Story 7.5, FR54/FR55) — the Admin-only, read-only tier card shown in the
 * Settings billing section for a SUBSCRIBED org (`active` / `past_due`). It renders
 * three things and nothing more:
 *   1. the current tier label,
 *   2. the flat-tier inclusions (unlimited team / customers / records / import — no
 *      per-seat or per-record charge),
 *   3. the next billing date (omitted entirely when the live Stripe fetch failed).
 *
 * There is DELIBERATELY no usage meter, quota countdown, remaining-invoice count, or
 * spend cap anywhere (flat-tier predictability — FR54). When `showUpgradePrompt`, a
 * NON-BLOCKING `role="status"` callout suggests moving up a plan; its CTA reuses the
 * Customer Portal path (the same `POST /api/stripe/portal` handoff as `BillingManage`)
 * — never a bespoke in-app plan-switcher and never an auto-charge (FR55). The prompt
 * is advisory: it never gates reads or writes.
 *
 * Mirrors `BillingManage`'s client shape: a subtle `useReducedMotion`-gated reveal,
 * Lucide icons, `useTranslations("Billing")`, and the portal fetch + `useState` status
 * machine (disabled "Redirecting..." + inline `<p role="alert">` mapping server error
 * codes to translated copy). The server independently re-enforces the Admin gate and
 * the has-a-customer check — this card being visible is a UX affordance, never the
 * sole enforcement.
 */

/** Server error codes the upgrade-prompt CTA maps to a translated inline message. */
const ERROR_KEYS = new Set([
  "billingUnavailable",
  "noSubscription",
  "forbidden",
  "unauthorized",
  "genericError",
]);

/** The i18n label key for each tier (kept explicit so copy stays reviewable). */
const TIER_LABEL_KEY: Record<SubscriptionTier, string> = {
  solo: "tierSolo",
  crew: "tierCrew",
  shop: "tierShop",
};

export type TierViewProps = {
  slug: string;
  tier: SubscriptionTier;
  /** ISO timestamp of the next billing date, or null when the Stripe fetch failed. */
  nextBillingDate: string | null;
  /** Whether the non-blocking "move up a plan" prompt should render. */
  showUpgradePrompt: boolean;
  /** The tier the prompt suggests moving up to (null when none / prompt hidden). */
  suggestedTier: SubscriptionTier | null;
};

export function TierView({
  slug,
  tier,
  nextBillingDate,
  showUpgradePrompt,
  suggestedTier,
}: TierViewProps) {
  const t = useTranslations("Billing");
  const [status, setStatus] = useState<"idle" | "redirecting">("idle");
  const [error, setError] = useState<string | null>(null);

  const prefersReducedMotion = useReducedMotion();

  const resolveError = (code: string | null): string => {
    if (code && ERROR_KEYS.has(code)) {
      return t(`error.${code}`);
    }
    return t("error.genericError");
  };

  const handleUpgrade = async () => {
    setStatus("redirecting");
    setError(null);

    try {
      const res = await fetch("/api/stripe/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      const body: ApiResponse<{ url: string }> = await res.json();
      if (!res.ok || !body.data) {
        setError(resolveError(body.error));
        setStatus("idle");
        return;
      }
      // Hand off to Stripe's hosted Customer Portal, where the plan change happens.
      // Keep the button disabled during the redirect (state stays "redirecting").
      window.location.href = body.data.url;
    } catch {
      setError(resolveError(null));
      setStatus("idle");
    }
  };

  const tierLabel = t("tierLabel", { tier: t(TIER_LABEL_KEY[tier]) });

  const inclusions = [
    t("inclusionTeam"),
    t("inclusionCustomers"),
    t("inclusionRecords"),
    t("inclusionImport"),
  ];

  const reveal = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <motion.div
      {...reveal}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-6"
    >
      {/* Read-only plan card: label + inclusions + next billing date. No meter. */}
      <div className="flex flex-col gap-5 rounded-xl border border-border bg-card p-6 shadow-xs">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary"
          >
            <CreditCard className="size-5" />
          </span>
          <div className="flex flex-col">
            <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("tierHeading")}
            </span>
            <span className="text-lg font-semibold tracking-tight text-balance">
              {tierLabel}
            </span>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium text-foreground">
            {t("inclusionsHeading")}
          </p>
          <ul className="flex flex-col gap-1.5">
            {inclusions.map((inclusion) => (
              <li
                key={inclusion}
                className="flex items-center gap-2 text-sm text-muted-foreground"
              >
                <Check
                  aria-hidden="true"
                  className="size-4 shrink-0 text-primary"
                />
                <span className="text-pretty">{inclusion}</span>
              </li>
            ))}
          </ul>
        </div>

        {nextBillingDate ? (
          <p className="text-sm text-muted-foreground text-pretty">
            {t("nextBillingDate", { date: new Date(nextBillingDate) })}
          </p>
        ) : null}
      </div>

      {/* Non-blocking upgrade suggestion. role="status" = announced politely, never
          a gate. CTA routes to the Stripe Customer Portal (no in-app switcher). */}
      {showUpgradePrompt && suggestedTier ? (
        <div
          role="status"
          className="flex flex-col gap-4 rounded-xl border border-primary/30 bg-primary/5 p-6"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"
            >
              <ArrowUpCircle className="size-5" />
            </span>
            <div className="flex flex-col gap-1">
              <p className="text-sm font-semibold text-foreground text-balance">
                {t("upgradePromptTitle")}
              </p>
              <p className="text-sm text-muted-foreground text-pretty">
                {t("upgradePromptBody", {
                  currentTier: t(TIER_LABEL_KEY[tier]),
                  suggestedTier: t(TIER_LABEL_KEY[suggestedTier]),
                })}
              </p>
            </div>
          </div>

          <AnimatePresence>
            {error ? (
              <motion.p
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                role="alert"
                className="text-sm text-destructive"
              >
                {error}
              </motion.p>
            ) : null}
          </AnimatePresence>

          <Button
            type="button"
            onClick={handleUpgrade}
            disabled={status === "redirecting"}
            aria-busy={status === "redirecting"}
            className="min-h-11 gap-2 self-start"
          >
            {status === "redirecting" ? (
              <Loader2 aria-hidden="true" className="size-4 animate-spin" />
            ) : (
              <ArrowUpCircle aria-hidden="true" className="size-4" />
            )}
            <span>
              {status === "redirecting"
                ? t("upgradePromptRedirecting")
                : t("upgradePromptCta")}
            </span>
          </Button>
        </div>
      ) : null}
    </motion.div>
  );
}
