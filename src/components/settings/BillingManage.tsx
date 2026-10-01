"use client";

import { useTranslations } from "next-intl";
import { motion } from "framer-motion";
import { CreditCard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  useBillingRedirect,
  BillingErrorAlert,
} from "@/components/settings/billing-redirect";

/**
 * BillingManage (Story 7.3) — the Admin-only "Manage billing" surface, shown when
 * the org has a subscription (`subscription_status` is `active` or `past_due`).
 *
 * A faithful mirror of `BillingStart`: Scheza renders NO card form, price, or
 * invoice in-app (FR53). This is a single button that POSTs `{ slug }` to
 * `POST /api/stripe/portal` and hands off to the Stripe-hosted Customer Portal
 * via `window.location.href`, where the Admin can update their card, view invoice
 * history, or cancel anytime — all on Stripe.
 *
 * Mirrors `BillingStart`'s fetch + `useState` status machine: the button shows a
 * disabled "Redirecting..." state during the handoff and an inline
 * `<p role="alert">` maps server error codes to translated copy (never a raw
 * error). Motion is a subtle reveal gated by `useReducedMotion` (WCAG AA).
 *
 * The server independently re-enforces the Admin gate and the
 * has-a-customer check (409 `noSubscription`) — this button being visible is a UX
 * affordance, never the sole enforcement.
 */

/** Server error codes this component maps to a translated inline message. */
const ERROR_KEYS = new Set([
  "billingUnavailable",
  "noSubscription",
  "forbidden",
  "unauthorized",
  "genericError",
]);

export function BillingManage({ slug }: { slug: string }) {
  const t = useTranslations("Billing");
  const { status, error, reveal, redirect } = useBillingRedirect(ERROR_KEYS);

  const handleClick = () => redirect("/api/stripe/portal", { slug });

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
        <span>
          {status === "redirecting"
            ? t("manageRedirecting")
            : t("manageButton")}
        </span>
      </Button>

      <p className="text-sm text-muted-foreground text-pretty">
        {t("manageNote")}
      </p>
    </motion.div>
  );
}
