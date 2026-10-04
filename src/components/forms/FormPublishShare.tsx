"use client";

import { useId, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Check, ExternalLink, Link2, Loader2, Share2 } from "lucide-react";
import QRCode from "react-qr-code";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { setFormPublished, FormApiError } from "@/lib/data/forms-client";
import { publicFormUrl } from "@/lib/forms/share";
import { useIsClient } from "@/components/invoices/use-is-client";
import type { PublishabilityReason } from "@/lib/forms/publishability";

/**
 * FormPublishShare (Epic 14, Story 14.3) — the Admin publish toggle + share surface,
 * rendered between the Target and Delete cards of {@link FormEditor}. Mirrors
 * `InvoiceDeliveryActions`: the `useIsClient` SSR-safe origin guard, the `aria-live`
 * copy confirmation, `navigator.share` feature-detected after mount with a copy
 * fallback, and `useReducedMotion`-gated feedback.
 *
 * Two cards:
 *   - Publish : a `Switch` (off by default) gated server-side. When the form has no
 *               valid target table the switch is DISABLED with a non-technical reason;
 *               the mutation re-runs the same gate, so a disabled switch is never the
 *               only authority. Flipping it calls `setFormPublished`; a blocked publish
 *               (`publishBlocked`) surfaces inline in a `role="alert"` region.
 *   - Share   : shown ONLY when the form is published AND the client has mounted (so the
 *               live `{origin}/forms/{orgSlug}/{formSlug}` URL exists). Copy link, a
 *               pure-SVG QR of the same URL, preview-in-new-tab, and Web Share with a
 *               prefilled message (falling back to copy). While unpublished it shows a
 *               short "publish this form to get a shareable link" hint instead.
 *
 * WCAG AA: labelled controls, `min-h-11`/`min-h-12` touch targets, visible focus rings
 * (from the primitives), `aria-hidden` decorative icons, motion gated by
 * `useReducedMotion`. All copy resolves through the `Forms` namespace.
 */

/** Server error codes the publish action maps to a translated message. */
const PUBLISH_ERROR_KEYS = new Set([
  "publishBlocked",
  "slugLocked",
  "notFound",
  "forbidden",
  "unauthorized",
  "readOnly",
  "writeFailed",
  "genericError",
]);

function resolvePublishError(
  t: (key: string) => string,
  code: string,
): string {
  const short = code.replace(/^Forms\.error\./, "");
  return PUBLISH_ERROR_KEYS.has(short)
    ? t(`error.${short}`)
    : t("error.genericError");
}

/** Map the server-computed publishability reason to the disabled-switch hint. */
function reasonText(
  t: (key: string) => string,
  reason: PublishabilityReason,
): string {
  switch (reason) {
    case "no-target":
      return t("publishReasonNoTarget");
    case "invalid-target":
      return t("publishReasonInvalidTarget");
    default:
      return "";
  }
}

export function FormPublishShare({
  slug,
  formId,
  orgSlug,
  formSlug,
  initialPublished,
  publishable,
  publishReason,
  onPublishedChange,
}: {
  slug: string;
  formId: string;
  /** The org slug segment of the public URL (the route `[slug]`). */
  orgSlug: string;
  /** The current form slug segment of the public URL. */
  formSlug: string;
  initialPublished: boolean;
  /** Server-computed publish gate — the switch is disabled when false. */
  publishable: boolean;
  publishReason: PublishabilityReason;
  /** Lets the parent editor reflect publish state (e.g. to lock the slug control). */
  onPublishedChange?: (published: boolean) => void;
}) {
  const t = useTranslations("Forms");
  const prefersReducedMotion = useReducedMotion();
  const isClient = useIsClient();

  const [published, setPublished] = useState(initialPublished);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [toggling, startToggle] = useTransition();

  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);

  const publishHintId = useId();
  const feedbackId = useId();

  // Browser-only derived values, computed during render (never setState-in-effect): the
  // SSR / first render has no origin, then the real absolute URL lights up once mounted.
  const shareLink =
    isClient && typeof window !== "undefined"
      ? publicFormUrl(window.location.origin, orgSlug, formSlug)
      : "";
  const canShare =
    isClient && typeof navigator !== "undefined" && "share" in navigator;

  function handleToggle(next: boolean) {
    setPublishError(null);
    startToggle(async () => {
      try {
        await setFormPublished(slug, formId, next);
        setPublished(next);
        onPublishedChange?.(next);
      } catch (err) {
        const code = err instanceof FormApiError ? err.code : "genericError";
        setPublishError(resolvePublishError(t, code));
      }
    });
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

  async function handleShare() {
    if (!shareLink) return;
    const shareText = t("shareText");
    try {
      await navigator.share({ url: shareLink, title: shareText, text: shareText });
    } catch {
      // The visitor cancelled or the platform rejected the share — nothing to surface.
    }
  }

  const feedback = copied
    ? t("copied")
    : copyError
      ? t("copyFailed")
      : null;

  const disabledReason = reasonText(t, publishReason);

  return (
    <>
      {/* Publish */}
      <Card>
        <CardHeader>
          <CardTitle>{t("publishTitle")}</CardTitle>
          <CardDescription>{t("publishHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <div className="flex items-center gap-3">
            <Switch
              id="form-publish"
              checked={published}
              disabled={toggling || (!published && !publishable)}
              aria-describedby={
                !publishable && !published ? publishHintId : undefined
              }
              onCheckedChange={handleToggle}
            />
            <Label htmlFor="form-publish" className="cursor-pointer">
              {published ? t("publishOn") : t("publishOff")}
            </Label>
            {toggling ? (
              <Loader2
                aria-hidden="true"
                className="size-4 animate-spin text-muted-foreground"
              />
            ) : null}
          </div>

          {!publishable && !published ? (
            <p
              id={publishHintId}
              className="text-sm text-muted-foreground text-pretty"
            >
              {disabledReason}
            </p>
          ) : null}

          {publishError ? (
            <p role="alert" className="text-sm text-destructive">
              {publishError}
            </p>
          ) : null}
        </CardContent>
      </Card>

      {/* Share */}
      <Card>
        <CardHeader>
          <CardTitle>{t("shareTitle")}</CardTitle>
          <CardDescription>{t("shareHelp")}</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {published && shareLink ? (
            <>
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

                <Button asChild variant="outline" className="min-h-11 gap-2">
                  <a
                    href={shareLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={t("previewAria")}
                  >
                    <ExternalLink aria-hidden="true" className="size-4" />
                    {t("preview")}
                  </a>
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

              <div className="flex flex-col gap-2">
                <p className="text-sm font-medium text-foreground">
                  {t("qrTitle")}
                </p>
                <div
                  role="img"
                  aria-label={t("qrAria")}
                  className="w-fit rounded-lg bg-white p-4"
                >
                  <QRCode value={shareLink} size={160} />
                </div>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground text-pretty">
              {t("shareUnavailable")}
            </p>
          )}
        </CardContent>
      </Card>
    </>
  );
}
