"use client";

import { useId, useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  Check,
  Download,
  Link2,
  Loader2,
  Mail,
  Share2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InvoiceApiError, sendInvoice } from "@/lib/data/invoices-client";
import { invoiceShareUrl } from "@/lib/invoicing/share";
import type { InvoiceLanguage } from "@/types/db";

/**
 * InvoiceDeliveryActions (Story 12.6) — the client-island delivery bar on the issued
 * invoice view, shown for `issued`/`paid`/`overdue` only. It offers the owner four ways
 * to get the frozen PDF to the customer from their OWN channels:
 *   - Web Share: shares the actual PDF `File` via `navigator.canShare({ files })`,
 *     falling back to `navigator.share({ url })` with the token link when file-share is
 *     unsupported; the button is hidden entirely when `navigator.share` is absent
 *     (desktop). Feature-detected AFTER mount to avoid an SSR/hydration mismatch.
 *   - Copy Link: copies `{origin}/i/{token}` to the clipboard.
 *   - Download PDF: an anchor with the `download` attribute pointing at the same token
 *     URL (which the public `/i/[token]` proxy serves inline; the attribute forces a save).
 *   - Email invoice: opens a dialog to confirm/edit the recipient, then POSTs to the
 *     admin-gated send route.
 *
 * All four read only the frozen `shareToken` + `invoiceNumber` (never re-minting the
 * token). WCAG AA: labelled controls, a required recipient field, `aria-live` feedback,
 * and motion gated by `useReducedMotion`. Reuses the shared `Button`/`Dialog`/`Input`
 * primitives + Lucide icons.
 */

/** Resolve a server error CODE to a translated `InvoiceDelivery.error.*` message. */
const DELIVERY_ERROR_KEYS = new Set([
  "recipientInvalid",
  "sendFailed",
  "genericError",
]);

/** No-op subscribe: mount state never changes after hydration. */
const noopSubscribe = () => () => {};

/**
 * `true` on the client (after hydration), `false` during SSR + the first client render —
 * so the SSR markup and first client render agree, then browser-only affordances (Web
 * Share, the token URL) light up. Uses `useSyncExternalStore` rather than a
 * setState-in-effect (which the hooks lint forbids).
 */
function useIsClient(): boolean {
  return useSyncExternalStore(
    noopSubscribe,
    () => true,
    () => false,
  );
}

export function InvoiceDeliveryActions({
  slug,
  invoiceId,
  shareToken,
  invoiceNumber,
  language,
  customerEmailPrefill,
}: {
  slug: string;
  invoiceId: string;
  shareToken: string;
  invoiceNumber: string;
  /** The frozen document language (labels the section for assistive tech). */
  language: InvoiceLanguage;
  /** A prefilled recipient from the customer snapshot, only when email-looking. */
  customerEmailPrefill: string | null;
}) {
  const t = useTranslations("InvoiceDelivery");
  const prefersReducedMotion = useReducedMotion();

  const isClient = useIsClient();

  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const [emailOpen, setEmailOpen] = useState(false);
  const [recipient, setRecipient] = useState(customerEmailPrefill ?? "");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const recipientId = useId();
  const feedbackId = useId();

  // Browser-only derived values. Computed during render (not via setState-in-effect); the
  // SSR/first-render values are empty/hidden, then light up once `isClient` is true.
  const shareLink =
    isClient && typeof window !== "undefined"
      ? invoiceShareUrl(window.location.origin, shareToken)
      : "";
  const canShare =
    isClient && typeof navigator !== "undefined" && "share" in navigator;

  const resolveSendError = (code: string | null): string => {
    const short = code ? code.replace(/^Invoice\.error\./, "") : null;
    return short && DELIVERY_ERROR_KEYS.has(short)
      ? t(`error.${short}`)
      : t("error.genericError");
  };

  async function handleShare() {
    if (!shareLink) return;
    const shareText = t("shareText", { number: invoiceNumber });
    // Prefer sharing the actual PDF File; fall back to the link when file-share is
    // unsupported. Both are best-effort — an aborted/failed share is not an error.
    try {
      const canShareFiles =
        typeof navigator !== "undefined" &&
        typeof navigator.canShare === "function";
      if (canShareFiles) {
        const res = await fetch(shareLink);
        if (res.ok) {
          const blob = await res.blob();
          const file = new File([blob], `invoice-${invoiceNumber}.pdf`, {
            type: "application/pdf",
          });
          if (navigator.canShare({ files: [file] })) {
            await navigator.share({ files: [file], title: shareText });
            return;
          }
        }
      }
      await navigator.share({ url: shareLink, title: shareText, text: shareText });
    } catch {
      // User cancelled or the platform rejected the share — nothing to surface.
    }
  }

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

  async function handleSend() {
    setSending(true);
    setSendError(null);
    setSent(false);
    try {
      await sendInvoice(slug, invoiceId, { to: recipient.trim() });
      setSent(true);
      window.setTimeout(() => {
        setEmailOpen(false);
        setSent(false);
      }, 1500);
    } catch (err) {
      const code = err instanceof InvoiceApiError ? err.code : null;
      setSendError(resolveSendError(code));
    } finally {
      setSending(false);
    }
  }

  const feedback = copied
    ? t("copied")
    : copyError
      ? t("copyFailed")
      : null;

  return (
    <section
      aria-label={t("heading")}
      data-invoice-language={language}
      className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t("heading")}
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("subtitle")}
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {canShare ? (
          <Button
            type="button"
            variant="default"
            className="min-h-11 gap-2"
            onClick={handleShare}
          >
            <Share2 aria-hidden="true" className="size-4" />
            {t("share")}
          </Button>
        ) : null}

        <Button
          type="button"
          variant="outline"
          className="min-h-11 gap-2"
          onClick={() => setEmailOpen(true)}
        >
          <Mail aria-hidden="true" className="size-4" />
          {t("email")}
        </Button>

        {shareLink ? (
          <Button
            asChild
            variant="outline"
            className="min-h-11 gap-2"
          >
            <a
              href={shareLink}
              download={`invoice-${invoiceNumber}.pdf`}
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

      <Dialog open={emailOpen} onOpenChange={setEmailOpen}>
        <DialogContent closeLabel={t("closeDialog")}>
          <DialogHeader>
            <DialogTitle>{t("emailDialogTitle")}</DialogTitle>
            <DialogDescription>{t("emailDialogBody")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-2">
            <Label htmlFor={recipientId}>{t("recipientLabel")}</Label>
            <Input
              id={recipientId}
              type="email"
              inputMode="email"
              autoComplete="email"
              required
              placeholder={t("recipientPlaceholder")}
              value={recipient}
              disabled={sending}
              aria-describedby={sendError ? `${recipientId}-error` : undefined}
              aria-invalid={sendError ? true : undefined}
              onChange={(e) => {
                setRecipient(e.target.value);
                setSendError(null);
              }}
            />
            {sendError ? (
              <p
                id={`${recipientId}-error`}
                role="alert"
                className="text-sm text-destructive"
              >
                {sendError}
              </p>
            ) : null}
            <p aria-live="polite" className="min-h-5 text-sm text-green-600">
              {sent ? t("sent") : null}
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-12"
              disabled={sending}
              onClick={() => setEmailOpen(false)}
            >
              {t("cancel")}
            </Button>
            <Button
              type="button"
              className="min-h-12 gap-2"
              disabled={sending || recipient.trim() === ""}
              onClick={handleSend}
            >
              {sending ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Mail aria-hidden="true" className="size-4" />
              )}
              {sending ? t("sending") : t("sendEmail")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
