"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  FileMinus2,
  Loader2,
  Plus,
  Save,
  Trash2,
} from "lucide-react";

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
import { computeInvoiceTotals, computeLineAmount } from "@/lib/invoicing/tax";
import { INVOICE_LANGUAGES } from "@/app/api/invoices/schemas";
import { InvoiceApiError } from "@/lib/data/invoices-client";
import {
  createCreditNote,
  getCreditNote,
  updateCreditNote,
  discardCreditNote,
  issueCreditNote,
  type CreditNoteDraftInput,
} from "@/lib/data/credit-notes-client";
import type { InvoiceLanguage } from "@/types/db";

/**
 * CreditNoteDraftForm (Story 12.8) — the Admin-only create + edit surface for a credit-note
 * DRAFT. Built for correcting an issued invoice (FR88): it PREFILLS from the source
 * invoice's frozen line items on create (passed as `prefillLines`) so the common
 * "re-state the invoice with one figure fixed" correction is one edit away; the owner then
 * trims/edits before issuing. Mirrors `InvoiceDraftForm` (inline line-items table, live
 * totals from the SAME canonical `computeInvoiceTotals`, issue/discard dialogs, error-code
 * mapping) minus the due-date field, and links to the source invoice via `invoiceId`.
 *
 * On create it POSTs a new draft (server copies its own children from these lines); on
 * edit it loads via GET then PUTs, version-gated. Issuing is deliberate and irreversible;
 * it never mutates the original invoice.
 */

/** One editable line-item row (all strings for controlled inputs). */
type LineRow = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

/** A prefill line copied from the source invoice's frozen line items (create mode). */
export type CreditNotePrefillLine = {
  description: string;
  quantity: number;
  unitPrice: number;
};

/** The known error codes this form maps to a translated inline message. */
const ERROR_KEYS = new Set([
  "descriptionRequired",
  "amountInvalid",
  "lineItemsRequired",
  "customerRecordInvalid",
  "legalIdentityMissing",
  "taxWithoutRegistration",
  "taxSplit",
  "totalsMismatch",
  "creditExceedsInvoice",
  "notIssued",
  "versionConflict",
  "notDraft",
  "notFound",
  "forbidden",
  "unauthorized",
  "loadFailed",
  "writeFailed",
  "genericError",
]);

let rowSeq = 0;
function newRow(): LineRow {
  rowSeq += 1;
  return { key: `cn-row-${rowSeq}`, description: "", quantity: "1", unitPrice: "0" };
}

function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function CreditNoteDraftForm({
  slug,
  invoiceId,
  creditNoteId,
  originalInvoiceNumber,
  prefillLines,
  defaultProvince,
  defaultLanguage,
  taxRegistered,
}: {
  slug: string;
  /** The source invoice this credit note corrects. */
  invoiceId: string;
  /** null = create; a uuid = edit an existing draft. */
  creditNoteId: string | null;
  /** The source invoice's display number, for the "corrects invoice N" header. */
  originalInvoiceNumber: string;
  /** Lines copied from the source invoice's frozen line items (create-mode prefill). */
  prefillLines: CreditNotePrefillLine[];
  defaultProvince: string;
  defaultLanguage: InvoiceLanguage;
  taxRegistered: boolean;
}) {
  const t = useTranslations("CreditNotes");
  const tInvoices = useTranslations("Invoices");
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();

  const isEdit = creditNoteId !== null;

  const [loading, setLoading] = useState(isEdit);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState<number | null>(null);
  const [customerRecordId, setCustomerRecordId] = useState<string | null>(null);
  const [province, setProvince] = useState(defaultProvince);
  const [language, setLanguage] = useState<InvoiceLanguage>(defaultLanguage);
  const [rows, setRows] = useState<LineRow[]>(() => {
    // Create mode: prefill from the source invoice's frozen line items. Edit mode loads
    // via GET below (a single placeholder row until it lands).
    if (isEdit || prefillLines.length === 0) {
      return [newRow()];
    }
    return prefillLines.map((line) => {
      rowSeq += 1;
      return {
        key: `cn-row-${rowSeq}`,
        description: line.description,
        quantity: String(line.quantity),
        unitPrice: String(line.unitPrice),
      };
    });
  });

  const [discardOpen, setDiscardOpen] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [issueOpen, setIssueOpen] = useState(false);
  const [issuing, setIssuing] = useState(false);

  const provinceId = useId();
  const languageId = useId();
  const errorId = useId();

  const resolveError = (code: string | null): string => {
    const short = code ? code.replace(/^Invoice\.error\./, "") : null;
    return short && ERROR_KEYS.has(short)
      ? t(`error.${short}`)
      : t("error.genericError");
  };

  // Load an existing draft when editing.
  useEffect(() => {
    if (!isEdit || !creditNoteId) {
      return;
    }
    let active = true;
    (async () => {
      try {
        const payload = await getCreditNote(slug, invoiceId, creditNoteId);
        if (!active) return;
        setVersion(payload.creditNote.version);
        setProvince(
          payload.creditNote.place_of_supply_province ?? defaultProvince,
        );
        setLanguage(payload.creditNote.language);
        setCustomerRecordId(payload.creditNote.customer_record_id);
        const loaded = payload.lineItems.map((item) => {
          rowSeq += 1;
          return {
            key: `cn-row-${rowSeq}`,
            description: item.description,
            quantity: String(item.quantity),
            unitPrice: String(item.unit_price),
          };
        });
        setRows(loaded.length > 0 ? loaded : [newRow()]);
      } catch (err) {
        if (!active) return;
        const code = err instanceof InvoiceApiError ? err.code : "loadFailed";
        setError(resolveError(code));
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, creditNoteId, slug, invoiceId]);

  const clearFeedback = () => {
    if (error) setError(null);
    if (status === "saved") setStatus("idle");
  };

  const updateRow = (key: string, patch: Partial<LineRow>) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, ...patch } : r)));
    clearFeedback();
  };

  const addRow = () => {
    setRows((prev) => [...prev, newRow()]);
    clearFeedback();
  };

  const removeRow = (key: string) => {
    setRows((prev) => (prev.length > 1 ? prev.filter((r) => r.key !== key) : prev));
    clearFeedback();
  };

  const totals = computeInvoiceTotals({
    lineItems: rows.map((r) => ({
      quantity: toNumber(r.quantity),
      unitPrice: toNumber(r.unitPrice),
    })),
    province,
    taxApplies: taxRegistered,
  });

  const buildInput = (): CreditNoteDraftInput => ({
    customerRecordId: customerRecordId ?? undefined,
    province: province.trim() === "" ? undefined : province.trim(),
    language,
    version: version ?? undefined,
    lineItems: rows.map((r) => ({
      description: r.description.trim(),
      quantity: toNumber(r.quantity),
      unitPrice: toNumber(r.unitPrice),
    })),
  });

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setStatus("saving");
    setError(null);
    try {
      const input = buildInput();
      if (isEdit && creditNoteId) {
        const result = await updateCreditNote(slug, invoiceId, creditNoteId, input);
        setVersion(result.version);
        setStatus("saved");
      } else {
        const result = await createCreditNote(slug, invoiceId, input);
        router.push(`/${slug}/invoices/${invoiceId}/credit-notes/${result.id}`);
        return;
      }
    } catch (err) {
      const code = err instanceof InvoiceApiError ? err.code : null;
      setError(resolveError(code));
      setStatus("idle");
    }
  };

  const handleDiscard = async () => {
    if (!creditNoteId) return;
    setDiscarding(true);
    setError(null);
    try {
      await discardCreditNote(slug, invoiceId, creditNoteId);
      router.push(`/${slug}/invoices/${invoiceId}`);
    } catch (err) {
      const code = err instanceof InvoiceApiError ? err.code : null;
      setError(resolveError(code));
      setDiscarding(false);
      setDiscardOpen(false);
    }
  };

  const handleIssue = async () => {
    if (!creditNoteId || version === null) return;
    setIssuing(true);
    setError(null);
    try {
      await issueCreditNote(slug, invoiceId, creditNoteId, version);
      router.push(`/${slug}/invoices/${invoiceId}/credit-notes/${creditNoteId}`);
      router.refresh();
    } catch (err) {
      const code = err instanceof InvoiceApiError ? err.code : null;
      setError(resolveError(code));
      setIssuing(false);
      setIssueOpen(false);
    }
  };

  const reveal = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  if (loading) {
    return (
      <section aria-busy="true" className="flex flex-col gap-6">
        <div className="h-7 w-56 animate-pulse rounded-md bg-muted" />
        <div className="h-4 w-full max-w-prose animate-pulse rounded-md bg-muted" />
        <div className="flex flex-col gap-4">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-12 w-full animate-pulse rounded-md bg-muted" />
          ))}
        </div>
        <span className="sr-only">{t("draftLoading")}</span>
      </section>
    );
  }

  return (
    <motion.form
      {...reveal}
      transition={{ duration: 0.25 }}
      onSubmit={handleSubmit}
      className="flex flex-col gap-10"
    >
      <header className="flex flex-col gap-2">
        <h1 className="text-2xl font-semibold tracking-tight text-balance">
          {isEdit ? t("draftTitleEdit") : t("draftTitleNew")}
        </h1>
        <p className="text-sm font-medium text-muted-foreground">
          {t("correctsInvoice", { number: originalInvoiceNumber })}
        </p>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">
          {t("draftSubtitle")}
        </p>
      </header>

      {/* Credit note details */}
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-1 text-sm font-semibold tracking-tight text-foreground">
          {t("detailsHeading")}
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={provinceId}>{tInvoices("provinceLabel")}</Label>
            <Input
              id={provinceId}
              value={province}
              placeholder={tInvoices("provincePlaceholder")}
              onChange={(e) => {
                setProvince(e.target.value);
                clearFeedback();
              }}
              className="min-h-12"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={languageId}>{tInvoices("languageLabel")}</Label>
            <Select
              value={language}
              onValueChange={(v) => {
                setLanguage(v as InvoiceLanguage);
                clearFeedback();
              }}
            >
              <SelectTrigger id={languageId} className="min-h-12 w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INVOICE_LANGUAGES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === "en"
                      ? tInvoices("languageEn")
                      : tInvoices("languageFr")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </fieldset>

      {/* Line items */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 flex flex-col gap-1">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            {t("lineItemsHeading")}
          </span>
          <span className="text-sm font-normal text-muted-foreground text-pretty">
            {t("lineItemsSubtitle")}
          </span>
        </legend>

        <div className="flex flex-col gap-3">
          {rows.map((row) => {
            const amount = computeLineAmount(
              toNumber(row.quantity),
              toNumber(row.unitPrice),
            );
            return (
              <div
                key={row.key}
                className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_6rem_8rem_6rem_2.5rem] sm:items-center sm:border-0 sm:p-1"
              >
                <div className="flex flex-col gap-1">
                  <Label className="sm:sr-only">
                    {tInvoices("colDescription")}
                  </Label>
                  <Input
                    value={row.description}
                    placeholder={tInvoices("descriptionPlaceholder")}
                    onChange={(e) =>
                      updateRow(row.key, { description: e.target.value })
                    }
                    className="min-h-12"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={row.quantity}
                    aria-label={tInvoices("colQuantity")}
                    onChange={(e) =>
                      updateRow(row.key, { quantity: e.target.value })
                    }
                    className="min-h-12"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={row.unitPrice}
                    aria-label={tInvoices("colUnitPrice")}
                    onChange={(e) =>
                      updateRow(row.key, { unitPrice: e.target.value })
                    }
                    className="min-h-12"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <span className="text-sm font-medium tabular-nums text-foreground">
                    {amount.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={tInvoices("removeLine")}
                    disabled={rows.length <= 1}
                    onClick={() => removeRow(row.key)}
                    className="size-12 sm:size-9"
                  >
                    <Trash2 aria-hidden="true" className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4">
          <Button
            type="button"
            variant="outline"
            className="min-h-12 gap-2"
            onClick={addRow}
          >
            <Plus aria-hidden="true" className="size-4" />
            {tInvoices("addLine")}
          </Button>

          <dl className="flex flex-col gap-1.5 text-right">
            <div className="flex items-center justify-end gap-6">
              <dt className="text-sm font-medium text-muted-foreground">
                {tInvoices("subtotalLabel")}
              </dt>
              <dd className="min-w-24 text-sm font-medium tabular-nums text-foreground">
                {totals.subtotal.toFixed(2)}
              </dd>
            </div>
            {totals.taxLines.map((line) => (
              <div key={line.label} className="flex items-center justify-end gap-6">
                <dt className="text-sm font-medium text-muted-foreground">
                  {tInvoices("taxLineLabel", {
                    tax: tInvoices("taxHst"),
                    rate: Math.round(line.rate * 100),
                  })}
                </dt>
                <dd className="min-w-24 text-sm font-medium tabular-nums text-foreground">
                  {line.tax_amount.toFixed(2)}
                </dd>
              </div>
            ))}
            <div className="mt-1 flex items-center justify-end gap-6 border-t border-border pt-2">
              <dt className="text-sm font-semibold text-foreground">
                {tInvoices("totalLabel")}
              </dt>
              <dd className="min-w-24 text-base font-semibold tabular-nums text-foreground">
                {totals.total.toFixed(2)}
              </dd>
            </div>
          </dl>
        </div>
      </fieldset>

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

      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          disabled={status === "saving"}
          aria-describedby={error ? errorId : undefined}
          className="min-h-12 gap-2"
        >
          {status === "saving" ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Save aria-hidden="true" className="size-4" />
          )}
          <span>{status === "saving" ? t("saving") : t("save")}</span>
        </Button>

        {isEdit ? (
          <>
            <Button
              type="button"
              variant="secondary"
              className="min-h-12 gap-2"
              disabled={version === null || issuing}
              onClick={() => setIssueOpen(true)}
            >
              <FileMinus2 aria-hidden="true" className="size-4" />
              {t("issue")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-12 gap-2"
              onClick={() => setDiscardOpen(true)}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {t("discard")}
            </Button>
          </>
        ) : null}

        <AnimatePresence>
          {status === "saved" ? (
            <motion.div
              key="saved"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              role="status"
              className="flex items-center gap-2 text-sm"
            >
              <CheckCircle2
                aria-hidden="true"
                className="size-4 shrink-0 text-primary"
              />
              <span className="flex flex-col">
                <span className="font-medium text-foreground">
                  {t("savedTitle")}
                </span>
                <span className="text-muted-foreground text-pretty">
                  {t("savedBody")}
                </span>
              </span>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <Dialog open={issueOpen} onOpenChange={setIssueOpen}>
        <DialogContent closeLabel={t("issueCancel")}>
          <DialogHeader>
            <DialogTitle>{t("issueConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("issueConfirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-12"
              onClick={() => setIssueOpen(false)}
            >
              {t("issueCancel")}
            </Button>
            <Button
              type="button"
              className="min-h-12 gap-2"
              disabled={issuing}
              onClick={handleIssue}
            >
              {issuing ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <FileMinus2 aria-hidden="true" className="size-4" />
              )}
              {issuing ? t("issuing") : t("issueConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={discardOpen} onOpenChange={setDiscardOpen}>
        <DialogContent closeLabel={t("discardCancel")}>
          <DialogHeader>
            <DialogTitle>{t("discardConfirmTitle")}</DialogTitle>
            <DialogDescription>{t("discardConfirmBody")}</DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              className="min-h-12"
              onClick={() => setDiscardOpen(false)}
            >
              {t("discardCancel")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-12 gap-2"
              disabled={discarding}
              onClick={handleDiscard}
            >
              {discarding ? (
                <Loader2 aria-hidden="true" className="size-4 animate-spin" />
              ) : (
                <Trash2 aria-hidden="true" className="size-4" />
              )}
              {discarding ? t("discarding") : t("discardConfirm")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </motion.form>
  );
}
