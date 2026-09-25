"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

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
import type { ApiResponse } from "@/types/api";
import type { SchemaDefinition } from "@/types/db";

/**
 * ClaimModal (Story 2.1) — the "Make it Real" claim entry surface.
 *
 * Email input + a mandatory, initially-UNCHECKED privacy-consent checkbox
 * linking `/privacy` & `/terms`. Submit is disabled until consent is checked
 * (the client half of the hard gate; the server re-enforces it). On submit it
 * POSTs the CURRENT overridden `schema` (+ the captured intent, for the
 * auto-derived slug) to `/api/claim`, then shows a "check your email" success
 * state. Server error codes map to translated inline messages — never a raw
 * error. All copy resolves through the `Claim` next-intl namespace.
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
]);

export function ClaimModal({ open, onOpenChange, schema }: ClaimModalProps) {
  const t = useTranslations("Claim");
  const [email, setEmail] = useState("");
  const [consent, setConsent] = useState(false);
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const emailId = useId();
  const consentId = useId();
  const errorId = useId();

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
          intent: intent
            ? { tradeType: intent.tradeType, city: intent.city }
            : undefined,
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
