"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Loader2, Mail } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApiResponse } from "@/types/api";

/**
 * LoginForm (Story 2.2) — the returning-user, email-only login surface.
 *
 * Mirrors `ClaimModal`'s proven patterns (`useId()` ARIA wiring, an inline
 * `<p role="alert">` for errors, a "check your email" success state) but strips
 * everything claim-specific: NO consent checkbox, NO schema, NO intent. It POSTs
 * `{ email }` to `POST /api/login`, which dispatches a Supabase→Resend magic link
 * (no password ever requested).
 *
 * Anti-enumeration: the endpoint always returns the same success envelope, so an
 * unknown email lands on the SAME "check your email" state as a registered one —
 * the UI never reveals which emails have accounts. Only a malformed email (a 400
 * `invalidEmail`) surfaces an inline error.
 *
 * All copy resolves through the `Login` next-intl namespace (EN + FR). Motion is
 * a subtle opacity/rise reveal gated by `useReducedMotion` (WCAG AA).
 */

/** Server error codes this form maps to a translated inline message. */
const ERROR_KEYS = new Set(["invalidEmail", "sendFailed", "genericError"]);

export function LoginForm() {
  const t = useTranslations("Login");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const prefersReducedMotion = useReducedMotion();
  const emailId = useId();
  const errorId = useId();

  const resolveError = (code: string | null): string => {
    if (code && ERROR_KEYS.has(code)) {
      return t(`error.${code}`);
    }
    return t("error.genericError");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("submitting");
    setError(null);

    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const body: ApiResponse<{ sent: true }> = await res.json();
      if (!res.ok || !body.data) {
        setError(resolveError(body.error));
        setStatus("idle");
        return;
      }
      // Anti-enumeration: success even for an unknown email — the endpoint
      // swallows a no-user outcome into the same envelope.
      setStatus("sent");
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

  if (status === "sent") {
    return (
      <motion.div
        {...reveal}
        transition={{ duration: 0.25 }}
        className="flex flex-col items-center gap-3 py-4 text-center"
      >
        <CheckCircle2 aria-hidden="true" className="size-10 text-primary" />
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">
            {t("sentTitle")}
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">
            {t("sentBody", { email: email.trim() })}
          </p>
        </div>
      </motion.div>
    );
  }

  return (
    <motion.form
      {...reveal}
      transition={{ duration: 0.25 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-5"
    >
      <div className="flex flex-col gap-2 text-center">
        <h1 className="text-2xl font-semibold tracking-tight">{t("title")}</h1>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("subtitle")}
        </p>
      </div>

      <div className="flex flex-col gap-2 text-left">
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

      <AnimatePresence>
        {error ? (
          <motion.p
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            id={errorId}
            role="alert"
            className="text-sm text-destructive"
          >
            {error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <Button
        type="submit"
        disabled={status === "submitting"}
        className="min-h-12 gap-2"
      >
        {status === "submitting" ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Mail aria-hidden="true" className="size-4" />
        )}
        <span>{t("submit")}</span>
      </Button>
    </motion.form>
  );
}
