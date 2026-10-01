"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { CreditCard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { SubscriptionTier } from "@/types/db";
import {
  useBillingRedirect,
  BillingErrorAlert,
} from "@/components/settings/billing-redirect";

/**
 * BillingStart (Story 7.2) — the Admin-only "Add Billing" surface.
 *
 * Scheza renders NO card form and NO price (FR53): this is a single button that
 * POSTs `{ slug, tier: "solo" }` (the default tier) to `POST /api/stripe/checkout`
 * and hands off to the Stripe-hosted Checkout page via `window.location.href`.
 * The full plan selector is deferred to the tier-change surface (7.5); the copy
 * notes the plan can be changed later in the billing portal (7.3).
 *
 * Mirrors `InviteForm`'s fetch + `useState` status machine: the button shows a
 * disabled "Redirecting..." state during the handoff and an inline
 * `<p role="alert">` maps server error codes to translated copy (never a raw
 * error). Motion is a subtle reveal gated by `useReducedMotion` (WCAG AA).
 *
 * The server independently re-enforces the Admin gate — this button being visible
 * is a UX affordance, never the sole enforcement.
 */

/** Server error codes this component maps to a translated inline message. */
const ERROR_KEYS = new Set([
  "invalidTier",
  "billingUnavailable",
  "forbidden",
  "unauthorized",
  "genericError",
]);

/** The default tier 7.2 posts. Kept explicit so 7.5 can widen this to a selector. */
const DEFAULT_TIER: SubscriptionTier = "solo";

export function BillingStart({ slug }: { slug: string }) {
  const t = useTranslations("Billing");
  const { status, error, reveal, redirect } = useBillingRedirect(ERROR_KEYS);

  const handleClick = () =>
    redirect("/api/stripe/checkout", { slug, tier: DEFAULT_TIER });

  return (
    <motion.div
      {...reveal}
      transition={{ duration: 0.25 }}
      className="flex flex-col gap-5"
    >
      <BillingErrorAlert error={error} />

      <Button
        type="button"
        onClick={handleClick}
        disabled={status === "redirecting"}
        aria-busy={status === "redirecting"}
        className="min-h-12 gap-2 self-start"
      >
        {status === "redirecting" ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <CreditCard aria-hidden="true" className="size-4" />
        )}
        <span>{status === "redirecting" ? t("redirecting") : t("addButton")}</span>
      </Button>

      <p className="text-sm text-muted-foreground text-pretty">
        {t("portalNote")}
      </p>
    </motion.div>
  );
}
