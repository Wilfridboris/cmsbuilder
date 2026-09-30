"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, Download, Link2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { invoiceShareUrl } from "@/lib/invoicing/share";
import type { InvoiceLanguage } from "@/types/db";

/**
 * CreditNoteDeliveryActions (Story 12.8) — the client-island delivery bar on the issued
 * credit-note view. In-app only this story (no email / Web Share): it offers Download PDF
 * and Copy Link, both reading the frozen `shareToken` via the public `/i/[token]` proxy
 * (never re-minting the token). WCAG AA: labelled controls, `aria-live` feedback, motion
 * gated by `useReducedMotion`. Mirrors the invoice delivery bar's Copy/Download pattern.
 */

/** No-op subscribe: mount state never changes after hydration. */
const noopSubscribe = () => () => {};

/** `true` on the client (after hydration) so the token URL lights up without SSR mismatch. */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function CreditNoteDeliveryActions({
  shareToken,
  creditNoteNumber,
  language,
}: {
  shareToken: string;
  creditNoteNumber: string;
  /** The frozen document language (labels the section for assistive tech). */
  language: InvoiceLanguage;
}) {
  const t = useTranslations("CreditNotes");
  const prefersReducedMotion = useReducedMotion();

  const isClient = useIsClient();
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const feedbackId = useId();

  const shareLink =
    isClient && typeof window !== "undefined"
      ? invoiceShareUrl(window.location.origin, shareToken)
      : "";

  async function handleCopy() {
    if (!shareLink) return;
    setCopied(false);
    setCopyError(false);
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2500);
    } catch {
      setCopyError(true);
    }
  }

  const feedback = copied ? t("copied") : copyError ? t("copyFailed") : null;

  return (
    <section
      aria-label={t("deliverHeading")}
      data-credit-note-language={language}
      className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t("deliverHeading")}
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("deliverSubtitle")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {shareLink ? (
          <Button asChild variant="outline" className="min-h-11 gap-2">
            <a
              href={shareLink}
              download={`credit-note-${creditNoteNumber}.pdf`}
              aria-label={t("downloadAria")}
            >
              <Download aria-hidden="true" className="size-4" />
              {t("download")}
            </a>
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="min-h-11 gap-2"
          aria-label={t("copyLinkAria")}
          onClick={handleCopy}
        >
          {copied ? (
            <Check aria-hidden="true" className="size-4 text-green-600" />
          ) : (
            <Link2 aria-hidden="true" className="size-4" />
          )}
          {t("copyLink")}
        </Button>
      </div>

      <p
        id={feedbackId}
        aria-live="polite"
        className="min-h-5 text-sm text-muted-foreground"
      >
        <AnimatePresence mode="wait">
          {feedback ? (
            <motion.span
              key={feedback}
              initial={prefersReducedMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
              className={copyError ? "text-destructive" : undefined}
            >
              {feedback}
            </motion.span>
          ) : null}
        </AnimatePresence>
      </p>
    </section>
  );
}
