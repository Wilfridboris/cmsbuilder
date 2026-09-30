"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BadgeCheck, CheckCircle2, Loader2 } from "lucide-react";

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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { PAYMENT_METHODS } from "@/app/api/invoices/schemas";
import { InvoiceApiError, recordPayment } from "@/lib/data/invoices-client";
import { todayIso } from "@/lib/invoicing/format";
import type { InvoiceLanguage, PaymentMethod } from "@/types/db";

/**
 * InvoicePaymentActions (Story 12.7) — the client-island "Mark paid" bar on the issued
 * invoice view. Shown for `status = 'issued'` ONLY (hidden for draft/paid/void). Scheza
 * never processes money: this records a SINGLE out-of-band payment (method, date, amount,
 * optional reference) and flips the invoice to `paid` via the Admin-gated pay route.
 *
 * WCAG AA: labelled controls, a method select, `role="alert"` inline errors, `aria-live`
 * success feedback, and motion gated by `useReducedMotion`. Reuses the shared
 * `Button`/`Dialog`/`Input`/`Label`/`Select` primitives + Lucide icons.
 */

/** Server error codes this island maps to a translated `Invoices.error.*` message. */
const PAYMENT_ERROR_KEYS = new Set([
  "alreadyPaid",
  "notIssued",
  "versionConflict",
  "methodInvalid",
  "amountInvalid",
  "dateInvalid",
  "forbidden",
  "unauthorized",
  "writeFailed",
  "genericError",
]);

export function InvoicePaymentActions({
  slug,
  invoiceId,
  version,
  invoiceTotal,
  language,
}: {
  slug: string;
  invoiceId: string;
  /** The version last read — the optimistic-concurrency gate for the pay route. */
  version: number;
  /** The invoice total, formatted "1234.56", used as the editable amount default. */
  invoiceTotal: string;
  /** The frozen document language (labels the section for assistive tech). */
  language: InvoiceLanguage;
}) {
  const t = useTranslations("Invoices");
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();

  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState<PaymentMethod>("etransfer");
  const [paidDate, setPaidDate] = useState(todayIso());
  const [amount, setAmount] = useState(invoiceTotal);
  const [reference, setReference] = useState("");

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const methodId = useId();
  const paidDateId = useId();
  const amountId = useId();
  const referenceId = useId();

  const resolveError = (code: string | null): string => {
    const short = code ? code.replace(/^Invoice\.error\./, "") : null;
    return short && PAYMENT_ERROR_KEYS.has(short)
      ? t(`error.${short}`)
      : t("error.genericError");
  };

  const amountValue = Number(amount);
  const amountValid = Number.isFinite(amountValue) && amountValue > 0;
  const dateValid = /^\d{4}-\d{2}-\d{2}$/.test(paidDate);
  const canSubmit = amountValid && dateValid && !saving;

  async function handleSubmit() {
    if (!canSubmit) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await recordPayment(slug, invoiceId, {
        version,
        method,
        paidDate,
        amount: amountValue,
        reference: reference.trim() === "" ? undefined : reference.trim(),
      });
      setSaved(true);
      // The row is now `paid` — refresh so the read-only view re-renders without this
      // control (it only shows for `issued`).
      window.setTimeout(() => {
        setOpen(false);
        setSaved(false);
        router.refresh();
      }, 900);
    } catch (err) {
      const code = err instanceof InvoiceApiError ? err.code : null;
      setError(resolveError(code));
    } finally {
      setSaving(false);
    }
  }

  return (
    <section
      aria-label={t("markPaidHeading")}
      data-invoice-language={language}
      className="flex flex-col gap-3 rounded-xl border border-border bg-muted/30 p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t("markPaidHeading")}
        </h2>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("markPaidSubtitle")}
        </p>
      </div>

      <Button
        type="button"
        variant="default"
        className="min-h-11 w-fit gap-2"
        onClick={() => setOpen(true)}
      >
        <BadgeCheck aria-hidden="true" className="size-4" />
        {t("markPaid")}
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent closeLabel={t("markPaidCancel")}>
          <DialogHeader>
            <DialogTitle>{t("markPaidDialogTitle")}</DialogTitle>
            <DialogDescription>{t("markPaidDialogBody")}</DialogDescription>
          </DialogHeader>

          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <Label htmlFor={methodId}>{t("paymentMethodLabel")}</Label>
              <Select
                value={method}
                onValueChange={(v) => {
                  setMethod(v as PaymentMethod);
                  setError(null);
                }}
              >
                <SelectTrigger id={methodId} className="min-h-12 w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(`paymentMethod_${value}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-2">
                <Label htmlFor={paidDateId}>{t("paidDateLabel")}</Label>
                <Input
                  id={paidDateId}
                  type="date"
                  value={paidDate}
                  disabled={saving}
                  className="min-h-12"
                  onChange={(e) => {
                    setPaidDate(e.target.value);
                    setError(null);
                  }}
                />
              </div>
              <div className="flex flex-col gap-2">
                <Label htmlFor={amountId}>{t("paymentAmountLabel")}</Label>
                <Input
                  id={amountId}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.01"
                  value={amount}
                  disabled={saving}
                  aria-invalid={amount !== "" && !amountValid ? true : undefined}
                  className="min-h-12"
                  onChange={(e) => {
                    setAmount(e.target.value);
                    setError(null);
                  }}
                />
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor={referenceId}>{t("paymentReferenceLabel")}</Label>
              <Input
                id={referenceId}
                value={reference}
                placeholder={t("paymentReferencePlaceholder")}
                disabled={saving}
                className="min-h-12"
                onChange={(e) => {
                  setReference(e.target.value);
                  setError(null);
                }}
              />
              <p className="text-sm text-muted-foreground text-pretty">
                {t("paymentReferenceHint")}
              </p>
            </div>

            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}

            <p aria-live="polite" className="min-h-5 text-sm text-primary">
              <AnimatePresence mode="wait">
                {saved ? (
                  <motion.span
                    key="saved"
                    initial={prefersReducedMotion ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={prefersReducedMotion ? { opacity: 1 } : { opacity: 0 }}
                    className="inline-flex items-center gap-2"
                  >
                    <CheckCircle2 aria-hidden="true" className="size-4" />
                    {t("markPaidSaved")}
                  </motion.span>
                ) : null}
              </AnimatePresence>
            </p>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-12"
              disabled={saving}
              onClick={() => setOpen(false)}
            >
              {t("markPaidCancel")}
            </Button>
            <Button
              type="button"
              className="min-h-12 gap-2"
              disabled={!canSubmit}
              onClick={handleSubmit}
            >
              {saving ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <BadgeCheck aria-hidden="true" className="size-4" />
              )}
              {saving ? t("markPaidSaving") : t("markPaidConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
