"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CreditCard, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ApiResponse } from "@/types/api";
import type { SubscriptionTier } from "@/types/db";

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
  const [status, setStatus] = useState<"idle" | "redirecting">("idle");
  const [error, setError] = useState<string | null>(null);

  const prefersReducedMotion = useReducedMotion();

  const resolveError = (code: string | null): string => {
    if (code && ERROR_KEYS.has(code)) {
      return t(`error.${code}`);
    }
    return t("error.genericError");
  };

  const handleClick = async () => {
    setStatus("redirecting");
    setError(null);

    try {
      const res = await fetch("/api/stripe/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug, tier: DEFAULT_TIER }),
      });
      const body: ApiResponse<{ url: string }> = await res.json();
      if (!res.ok || !body.data) {
        setError(resolveError(body.error));
        setStatus("idle");
        return;
      }
      // Hand off to Stripe's hosted Checkout page. Keep the button disabled during
      // the redirect (state stays "redirecting").
      window.location.href = body.data.url;
    } catch {
      setError(resolveError(null));
      setStatus("idle");
    }
  };

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
      className="flex flex-col gap-5"
    >
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
