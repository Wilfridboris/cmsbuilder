"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, Loader2, Send } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ApiResponse } from "@/types/api";
import type { MemberRole } from "@/types/db";

/**
 * InviteForm (Story 2.3) — the Admin-only team-invite surface.
 *
 * Mirrors the proven `LoginForm`/`ClaimModal` patterns (`useId()` ARIA wiring, an
 * inline `<p role="alert">` for errors, a "sent" success state, form reset) and
 * adds a role `select` with **Member preselected** (FR20/FR21). On submit it
 * POSTs `{ email, role }` to `POST /api/invite`; the server independently
 * re-enforces Admin authorization (frontend gating is never the sole gate).
 *
 * Server error codes (invalidEmail, invalidRole, forbidden, accountExists,
 * sendFailed) map to translated inline messages — never a raw error. All copy
 * resolves through the `Settings` next-intl namespace (EN + FR). Motion is a
 * subtle reveal gated by `useReducedMotion` (WCAG AA).
 */

/** Server error codes this form maps to a translated inline message. */
const ERROR_KEYS = new Set([
  "invalidEmail",
  "invalidRole",
  "forbidden",
  "accountExists",
  "sendFailed",
  "unauthorized",
  "genericError",
]);

export function InviteForm() {
  const t = useTranslations("Settings");
  const [email, setEmail] = useState("");
  // Member preselected by default at invite time (FR20/FR21).
  const [role, setRole] = useState<MemberRole>("member");
  const [status, setStatus] = useState<"idle" | "submitting" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);
  const [sentEmail, setSentEmail] = useState("");

  const prefersReducedMotion = useReducedMotion();
  const emailId = useId();
  const roleId = useId();
  const roleHintId = useId();
  const errorId = useId();

  const resolveError = (code: string | null): string => {
    if (code && ERROR_KEYS.has(code)) {
      return t(`error.${code}`);
    }
    return t("error.genericError");
  };

  const reset = () => {
    setEmail("");
    setRole("member");
    setStatus("idle");
    setError(null);
    setSentEmail("");
  };

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("submitting");
    setError(null);

    try {
      const res = await fetch("/api/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), role }),
      });
      const body: ApiResponse<{ sent: true }> = await res.json();
      if (!res.ok || !body.data) {
        setError(resolveError(body.error));
        setStatus("idle");
        return;
      }
      setSentEmail(email.trim());
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
        className="flex flex-col items-center gap-4 py-4 text-center"
      >
        <CheckCircle2 aria-hidden="true" className="size-10 text-primary" />
        <div className="flex flex-col gap-1">
          <h2 className="text-lg font-semibold tracking-tight">
            {t("sentTitle")}
          </h2>
          <p className="text-sm text-muted-foreground text-pretty">
            {t("sentBody", { email: sentEmail })}
          </p>
        </div>
        <Button type="button" variant="outline" onClick={reset} className="gap-2">
          {t("sendAnother")}
        </Button>
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
      <div className="flex flex-col gap-2">
        <Label htmlFor={emailId}>{t("emailLabel")}</Label>
        <Input
          id={emailId}
          type="email"
          inputMode="email"
          autoComplete="off"
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

      <div className="flex flex-col gap-2">
        <Label htmlFor={roleId}>{t("roleLabel")}</Label>
        <Select
          value={role}
          onValueChange={(value) => {
            setRole(value as MemberRole);
            if (error) setError(null);
          }}
        >
          <SelectTrigger
            id={roleId}
            aria-describedby={roleHintId}
            className="min-h-12 w-full"
          >
            <SelectValue placeholder={t("rolePlaceholder")} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="member">{t("roleMember")}</SelectItem>
            <SelectItem value="admin">{t("roleAdmin")}</SelectItem>
          </SelectContent>
        </Select>
        <p id={roleHintId} className="text-sm text-muted-foreground text-pretty">
          {role === "admin" ? t("roleAdminHint") : t("roleMemberHint")}
        </p>
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
          <Send aria-hidden="true" className="size-4" />
        )}
        <span>{t("submit")}</span>
      </Button>
    </motion.form>
  );
}
