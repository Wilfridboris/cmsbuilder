"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { AlertCircle, Check, CheckCircle2, Loader2, Mail } from "lucide-react";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { readIntent } from "@/lib/generation/intent";
import { deriveSlugFromName, guardReservedSlug } from "@/lib/claim/slug-derive";
import type { ApiResponse } from "@/types/api";
import type { SchemaDefinition } from "@/types/db";

/**
 * ClaimModal (Story 2.1, extended 15.1) — the "Make it Real" claim surface.
 *
 * Reads the captured business name from the stored intent and shows the owner
 * their dashboard slug (`scheza.com/{slug}`) with an inline, editable segment and
 * a best-effort availability check (via the service-role `/api/claim/slug-check`
 * route). On submit it POSTs the email + consent + the confirmed slug +
 * businessName to `/api/claim`. The availability check is a UX affordance only;
 * finalize resolves the authoritative slug, and the owner is always shown their
 * final dashboard URL after login. A network error on the check is treated as
 * "unconfirmed" and the claim still proceeds. All copy resolves through the
 * `Claim` next-intl namespace.
 */

type ClaimModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The current, overridden schema from the demo dashboard state. */
  schema: SchemaDefinition;
};

/** Map a server error code (or network failure) to a translated message key. */
const ERROR_KEYS = new Set([
  "consentRequired",
  "invalidEmail",
  "noSession",
  "sendFailed",
  "genericError",
  "invalidBody",
  "businessNameRequired",
]);

type SlugCheck = {
  available: boolean;
  normalized: string;
  suggestion?: string;
};

export function ClaimModal({ open, onOpenChange, schema }: ClaimModalProps) {
  const t = useTranslations("Claim");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const [businessName, setBusinessName] = useState("");
  const [slug, setSlug] = useState("");
  const [checkState, setCheckState] = useState<
    "idle" | "checking" | "available" | "taken"
  >("idle");
  const [suggestion, setSuggestion] = useState<string | null>(null);

  const emailId = useId();
  const consentId = useId();
  const errorId = useId();
  const slugId = useId();
  const slugStatusId = useId();

  // Seed the business name + slug preview from the stored intent whenever the
  // modal opens. This is a necessary sync-from-external-store: `sessionStorage`
  // (where the landing prompt wrote the intent) is client-only and unreadable
  // during render/SSR, so it can only be read after mount/open.
  useEffect(() => {
    if (!open) return;
    const intent = readIntent();
    const name = intent?.businessName ?? "";
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setBusinessName(name);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSlug(name ? guardReservedSlug(deriveSlugFromName(name)) : "");
  }, [open]);

  // Debounced best-effort availability check (~400ms) whenever the slug changes.
  // A fault leaves the status "idle" (unconfirmed) and the claim stays
  // submittable — finalize is authoritative.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open || !slug.trim()) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCheckState("idle");
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSuggestion(null);
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCheckState("checking");
    if (debounceRef.current) clearTimeout(debounceRef.current);
    let cancelled = false;
    debounceRef.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/claim/slug-check", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ slug: slug.trim() }),
        });
        const body: ApiResponse<SlugCheck> = await res.json();
        if (cancelled) return;
        if (!res.ok || !body.data) {
          // Unconfirmed — allow submit; finalize owns authority.
          setCheckState("idle");
          setSuggestion(null);
          return;
        }
        if (body.data.available) {
          setCheckState("available");
          setSuggestion(null);
        } else {
          setCheckState("taken");
          setSuggestion(body.data.suggestion ?? null);
        }
      } catch {
        if (!cancelled) {
          setCheckState("idle");
          setSuggestion(null);
        }
      }
    }, 400);
    return () => {
      cancelled = true;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [slug, open]);

  const resolveError = (code: string | null): string => {
    if (code && ERROR_KEYS.has(code)) {
      return t(`error.${code}`);
    }
    return t("error.genericError");
  };

  // Reset the form when the modal closes. The "sent" success state is component
  // state and the modal stays mounted, so without this a user who mistyped their
  // email would be trapped on "check your email" and unable to retry with a
  // corrected address without a full page reload.
  const handleOpenChange = (next: boolean) => {
    if (!next) {
      setEmail("");
      setConsent(false);
      setStatus("idle");
      setError(null);
      setCheckState("idle");
      setSuggestion(null);
    }
    onOpenChange(next);
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    // Client half of the hard gate: never submit without consent.
    if (!consent) {
      setError(t("error.consentRequired"));
      return;
    }
    setStatus("submitting");
    setError(null);

    const intent = readIntent();

    try {
      const res = await fetch("/api/claim", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          consent: true,
          schema,
          intent: {
            // Business name is the authoritative display name; prefer the live
            // field (seeded from the intent, editable is out of scope here) and
            // fall back to the stored intent.
            businessName: businessName.trim() || intent?.businessName || "",
            tradeType: intent?.tradeType,
            city: intent?.city,
            slug: slug.trim() || undefined,
          },
        }),
      });
      const body: ApiResponse<{ sent: true }> = await res.json();
      if (!res.ok || !body.data) {
        setError(resolveError(body.error));
        setStatus("idle");
        return;
      }
      setStatus("sent");
    } catch {
      setError(resolveError(null));
      setStatus("idle");
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent closeLabel={t("close")}>
        {status === "sent" ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <CheckCircle2
              aria-hidden="true"
              className="size-10 text-primary"
            />
            <DialogHeader className="items-center">
              <DialogTitle>{t("sentTitle")}</DialogTitle>
              <DialogDescription>
                {t("sentBody", { email: email.trim() })}
              </DialogDescription>
            </DialogHeader>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="flex flex-col gap-5">
            <DialogHeader>
              <DialogTitle>{t("title")}</DialogTitle>
              <DialogDescription>{t("subtitle")}</DialogDescription>
            </DialogHeader>

            <div className="flex flex-col gap-2">
              <Label htmlFor={emailId}>{t("emailLabel")}</Label>
              <Input
                id={emailId}
                type="email"
                inputMode="email"
                autoComplete="email"
                required
                value={email}
                placeholder={t("emailPlaceholder")}
                aria-invalid={error !== null}
                aria-describedby={error ? errorId : undefined}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                className="min-h-12"
              />
            </div>

            {/* Slug preview + inline edit (Story 15.1). */}
            <div className="flex flex-col gap-2">
              <Label htmlFor={slugId}>{t("slugLabel")}</Label>
              <div className="flex items-center gap-1 rounded-md border border-input bg-background px-3 focus-within:ring-2 focus-within:ring-ring">
                <span className="font-mono text-sm text-muted-foreground">
                  {t("slugPrefix")}
                </span>
                <input
                  id={slugId}
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  aria-describedby={slugStatusId}
                  className="min-h-10 flex-1 bg-transparent font-mono text-sm outline-none"
                />
                <span aria-hidden="true" className="flex items-center">
                  {checkState === "checking" ? (
                    <Loader2 className="size-4 animate-spin text-muted-foreground" />
                  ) : checkState === "available" ? (
                    <Check className="size-4 text-emerald-600" />
                  ) : checkState === "taken" ? (
                    <AlertCircle className="size-4 text-amber-600" />
                  ) : null}
                </span>
              </div>
              <p
                id={slugStatusId}
                aria-live="polite"
                className="min-h-5 text-sm text-muted-foreground"
              >
                {checkState === "checking" ? (
                  <span className="sr-only">{t("slugChecking")}</span>
                ) : checkState === "available" ? (
                  <span className="text-emerald-600">{t("slugAvailable")}</span>
                ) : checkState === "taken" ? (
                  <span className="text-amber-600">
                    {t("slugTaken")}
                    {suggestion ? (
                      <>
                        {" "}
                        <button
                          type="button"
                          onClick={() => setSlug(suggestion)}
                          className="font-medium text-primary underline underline-offset-4"
                        >
                          {t("slugUseSuggestion", { suggestion })}
                        </button>
                      </>
                    ) : null}
                  </span>
                ) : (
                  t("slugHint")
                )}
              </p>
            </div>

            <div className="flex items-start gap-3">
              <Checkbox
                id={consentId}
                checked={consent}
                onCheckedChange={(value) => {
                  setConsent(value === true);
                  if (error) setError(null);
                }}
                className="mt-0.5"
              />
              <Label
                htmlFor={consentId}
                className="text-sm font-normal leading-relaxed text-muted-foreground text-pretty"
              >
                {t.rich("consentLabel", {
                  privacy: (chunks) => (
                    <Link
                      href="/privacy"
                      target="_blank"
                      className="font-medium text-primary underline underline-offset-4"
                    >
                      {chunks}
                    </Link>
                  ),
                  terms: (chunks) => (
                    <Link
                      href="/terms"
                      target="_blank"
                      className="font-medium text-primary underline underline-offset-4"
                    >
                      {chunks}
                    </Link>
                  ),
                })}
              </Label>
            </div>

            {error ? (
              <p id={errorId} role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <Button
              type="submit"
              disabled={!consent || status === "submitting"}
              className="min-h-12 gap-2"
            >
              {status === "submitting" ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Mail aria-hidden="true" className="size-4" />
              )}
              <span>{t("submit")}</span>
            </Button>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
