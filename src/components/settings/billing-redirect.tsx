"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";

import type { ApiResponse } from "@/types/api";

/**
 * Shared billing-redirect machinery (retro [A3b]).
 *
 * The three billing client components — `BillingStart` (checkout), `BillingManage`
 * and `TierView`'s upgrade CTA (both the Customer Portal) — each POST a `{ slug, ... }`
 * body to a Stripe-handoff route, read the `{ data: { url } }` envelope, map an error
 * code to translated copy, and `window.location.href` to the returned URL. That
 * state machine, the error-code resolver, and the reduced-motion reveal lived three
 * times; they live here once. Each component still supplies its own endpoint, body,
 * accepted error codes, and button copy.
 */

/** The subtle reveal used by all three billing surfaces, gated by reduced-motion. */
export type Reveal = {
  initial: { opacity: number; y?: number };
  animate: { opacity: number; y?: number };
};

export type BillingRedirect = {
  status: "idle" | "redirecting";
  error: string | null;
  reveal: Reveal;
  /** POST `body` to `endpoint`, then hand off to the returned Stripe URL. */
  redirect: (endpoint: string, body: Record<string, unknown>) => Promise<void>;
};

/**
 * The fetch + status + error-mapping machine shared by the billing surfaces.
 * `errorKeys` is the set of server error codes this surface maps to translated
 * `Billing.error.*` copy (anything else falls back to `genericError`).
 */
export function useBillingRedirect(errorKeys: Set<string>): BillingRedirect {
  const t = useTranslations("Billing");
  const [status, setStatus] = useState<"idle" | "redirecting">("idle");
  const [error, setError] = useState<string | null>(null);
  const prefersReducedMotion = useReducedMotion();

  const resolveError = (code: string | null): string =>
    code && errorKeys.has(code) ? t(`error.${code}`) : t("error.genericError");

  const redirect = async (
    endpoint: string,
    body: Record<string, unknown>,
  ): Promise<void> => {
    setStatus("redirecting");
    setError(null);

    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload: ApiResponse<{ url: string }> = await res.json();
      if (!res.ok || !payload.data) {
        setError(resolveError(payload.error));
        setStatus("idle");
        return;
      }
      // Hand off to Stripe's hosted page. Keep the button disabled during the
      // redirect (state stays "redirecting").
      window.location.href = payload.data.url;
    } catch {
      setError(resolveError(null));
      setStatus("idle");
    }
  };

  const reveal: Reveal = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  return { status, error, reveal, redirect };
}

/** The inline `role="alert"` error paragraph shared by the billing surfaces. */
export function BillingErrorAlert({ error }: { error: string | null }) {
  return (
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
  );
}
