"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, FileMinus2, Loader2, Save, Trash2 } from "lucide-react";

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
import { INVOICE_LANGUAGES } from "@/app/api/invoices/schemas";
import {
  createCreditNote,
  getCreditNote,
  updateCreditNote,
  discardCreditNote,
  issueCreditNote,
  type CreditNoteDraftInput,
} from "@/lib/data/credit-notes-client";
import type { InvoiceLanguage } from "@/types/db";
import { LineItemsEditor } from "@/components/invoices/LineItemsEditor";
import { ConfirmActionDialog } from "@/components/invoices/ConfirmActionDialog";
import {
  makeRow,
  newRow,
  toNumber,
  useDraftForm,
} from "@/components/invoices/use-draft-form";

/**
 * CreditNoteDraftForm (Story 12.8) — the Admin-only create + edit surface for a credit-note
 * DRAFT. Built for correcting an issued invoice (FR88): it PREFILLS from the source
 * invoice's frozen line items on create (passed as `prefillLines`) so the common
 * "re-state the invoice with one figure fixed" correction is one edit away; the owner then
 * trims/edits before issuing. Mirrors `InvoiceDraftForm` (inline line-items table, live
 * totals from the SAME canonical `computeInvoiceTotals`, issue/discard dialogs, error-code
 * mapping) minus the customer picker and due-date field, and links to the source invoice via
 * `invoiceId`.
 *
 * On create it POSTs a new draft (server copies its own children from these lines); on
 * edit it loads via GET then PUTs, version-gated. Issuing is deliberate and irreversible;
 * it never mutates the original invoice.
 *
 * Retro A3: the line-items table, the two confirm dialogs, and the shared load/save/issue/
 * discard lifecycle now live in `LineItemsEditor`, `ConfirmActionDialog`, and the
 * `useDraftForm` hook; this shell keeps only the credit-note-specific parts (prefill, the
 * "corrects invoice N" header, `customerRecordId`-only handling, and the extra
 * `creditExceedsInvoice` / `notIssued` error keys).
 */

/** A prefill line copied from the source invoice's frozen line items (create mode). */
export type CreditNotePrefillLine = {
  description: string;
  quantity: number;
  unitPrice: number;
};

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

  // Credit-note-only state: province, language, and the id-only customer link
  // (no picker). Shared state (rows/version/status/…) lives in the hook below.
  const [customerRecordId, setCustomerRecordId] = useState<string | null>(null);
  const [province, setProvince] = useState(defaultProvince);
  const [language, setLanguage] = useState<InvoiceLanguage>(defaultLanguage);

  const provinceId = useId();
  const languageId = useId();
  const errorId = useId();

  // Create mode: prefill from the source invoice's frozen line items. Edit mode
  // loads via GET in the hook (a single placeholder row until it lands).
  const initialRows =
    isEdit || prefillLines.length === 0
      ? [newRow("cn-row-")]
      : prefillLines.map((line) =>
          makeRow("cn-row-", {
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
          }),
        );

  const buildInput = (): CreditNoteDraftInput => ({
    customerRecordId: customerRecordId ?? undefined,
    province: province.trim() === "" ? undefined : province.trim(),
    language,
    version: form.version ?? undefined,
    lineItems: form.rows.map((r) => ({
      description: r.description.trim(),
      quantity: toNumber(r.quantity),
      unitPrice: toNumber(r.unitPrice),
    })),
  });

  const form = useDraftForm({
    isEdit,
    keyPrefix: "cn-row-",
    initialRows,
    province,
    taxRegistered,
    extraErrorKeys: ["creditExceedsInvoice", "notIssued"],
    translateError: (key) => t(`error.${key}`),
    load: async () => {
      const payload = await getCreditNote(slug, invoiceId, creditNoteId!);
      setProvince(payload.creditNote.place_of_supply_province ?? defaultProvince);
      setLanguage(payload.creditNote.language);
      setCustomerRecordId(payload.creditNote.customer_record_id);
      return {
        version: payload.creditNote.version,
        rows: payload.lineItems.map((item) =>
          makeRow("cn-row-", {
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unit_price,
          }),
        ),
      };
    },
    buildInput,
    create: async (input) => {
      const result = await createCreditNote(
        slug,
        invoiceId,
        input as CreditNoteDraftInput,
      );
      router.push(`/${slug}/invoices/${invoiceId}/credit-notes/${result.id}`);
    },
    update: async (input) => {
      const result = await updateCreditNote(
        slug,
        invoiceId,
        creditNoteId!,
        input as CreditNoteDraftInput,
      );
      return { version: result.version };
    },
    discard: async () => {
      await discardCreditNote(slug, invoiceId, creditNoteId!);
      router.push(`/${slug}/invoices/${invoiceId}`);
    },
    issue: async (version) => {
      await issueCreditNote(slug, invoiceId, creditNoteId!, version);
      router.push(`/${slug}/invoices/${invoiceId}/credit-notes/${creditNoteId}`);
      router.refresh();
    },
  });

  const reveal = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : { initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } };

  if (form.loading) {
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
      onSubmit={form.runSave}
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
                form.clearFeedback();
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
                form.clearFeedback();
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

        <LineItemsEditor
          rows={form.rows}
          totals={form.totals}
          onAddRow={form.addRow}
          onRemoveRow={form.removeRow}
          onUpdateRow={form.updateRow}
          labels={{
            colDescription: tInvoices("colDescription"),
            colQuantity: tInvoices("colQuantity"),
            colUnitPrice: tInvoices("colUnitPrice"),
            colAmount: tInvoices("colAmount"),
            colRemove: tInvoices("colRemove"),
            descriptionPlaceholder: tInvoices("descriptionPlaceholder"),
            removeLine: tInvoices("removeLine"),
            addLine: tInvoices("addLine"),
            subtotalLabel: tInvoices("subtotalLabel"),
            totalLabel: tInvoices("totalLabel"),
            taxLineLabel: (values) => tInvoices("taxLineLabel", values),
            taxName: tInvoices("taxHst"),
            totalsHint: tInvoices("totalsHint"),
            subtotalHint: tInvoices("subtotalHint"),
          }}
        />
      </fieldset>

      <AnimatePresence>
        {form.error ? (
          <motion.p
            key="error"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            id={errorId}
            role="alert"
            className="text-sm text-destructive"
          >
            {form.error}
          </motion.p>
        ) : null}
      </AnimatePresence>

      <div className="flex flex-wrap items-center gap-4">
        <Button
          type="submit"
          disabled={form.status === "saving"}
          aria-describedby={form.error ? errorId : undefined}
          className="min-h-12 gap-2"
        >
          {form.status === "saving" ? (
            <Loader2 aria-hidden="true" className="size-4 animate-spin" />
          ) : (
            <Save aria-hidden="true" className="size-4" />
          )}
          <span>{form.status === "saving" ? t("saving") : t("save")}</span>
        </Button>

        {isEdit ? (
          <>
            <Button
              type="button"
              variant="secondary"
              className="min-h-12 gap-2"
              disabled={form.version === null || form.issuing}
              onClick={() => form.setIssueOpen(true)}
            >
              <FileMinus2 aria-hidden="true" className="size-4" />
              {t("issue")}
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-12 gap-2"
              onClick={() => form.setDiscardOpen(true)}
            >
              <Trash2 aria-hidden="true" className="size-4" />
              {t("discard")}
            </Button>
          </>
        ) : null}

        <AnimatePresence>
          {form.status === "saved" ? (
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

      <ConfirmActionDialog
        open={form.issueOpen}
        onOpenChange={form.setIssueOpen}
        onConfirm={form.runIssue}
        pending={form.issuing}
        title={t("issueConfirmTitle")}
        body={t("issueConfirmBody")}
        confirmLabel={t("issueConfirm")}
        pendingLabel={t("issuing")}
        cancelLabel={t("issueCancel")}
        icon={FileMinus2}
      />

      <ConfirmActionDialog
        open={form.discardOpen}
        onOpenChange={form.setDiscardOpen}
        onConfirm={form.runDiscard}
        pending={form.discarding}
        title={t("discardConfirmTitle")}
        body={t("discardConfirmBody")}
        confirmLabel={t("discardConfirm")}
        pendingLabel={t("discarding")}
        cancelLabel={t("discardCancel")}
        icon={Trash2}
        destructive
      />
    </motion.form>
  );
}
