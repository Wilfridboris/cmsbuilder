"use client";

import { useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { CheckCircle2, FileCheck2, Link2, Loader2, Save, Trash2, X } from "lucide-react";

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
import type { InvoiceLanguage } from "@/types/db";
import {
  createInvoice,
  getInvoice,
  updateInvoice,
  discardInvoice,
  issueInvoice,
  type InvoiceDraftInput,
} from "@/lib/data/invoices-client";
import { LinkedRecordPicker } from "@/components/invoices/LinkedRecordPicker";
import { LineItemsEditor } from "@/components/invoices/LineItemsEditor";
import { ConfirmActionDialog } from "@/components/invoices/ConfirmActionDialog";
import {
  makeRow,
  newRow,
  toNumber,
  useDraftForm,
} from "@/components/invoices/use-draft-form";

/**
 * InvoiceDraftForm (Story 12.2 + 12.3) — the Admin-only create + edit surface for
 * an invoice DRAFT. It edits an inline line-items table (description / quantity /
 * unit price, add + remove rows, a per-row amount), links a customer via the
 * schema-agnostic `LinkedRecordPicker` (FR82), and edits the place-of-supply
 * province + language.
 *
 * Totals (Story 12.3): the footer shows the subtotal, a single HST line (translated
 * name + rate, e.g. `HST (13%)`), and the total, all recomputed LIVE from the SAME
 * canonical `computeInvoiceTotals` the server stores from (I2/I3). It degrades to
 * subtotal-only when no tax applies — driven by the server-evaluated `taxRegistered`
 * flag (present && effective as of today) and the active-province rate map. This is
 * a preview; the server recomputes and stores authoritatively on save.
 *
 * On create it POSTs a new draft; on edit it loads via GET then PUTs, version-
 * gated. Mirrors `BusinessProfileForm`'s proven patterns: `useId()` ARIA wiring,
 * inline `<p role="alert">` errors, motion gated by `useReducedMotion`, and server
 * error codes mapped to translated inline messages (a raw error never shows).
 *
 * Retro A3: the line-items table, the two confirm dialogs, and the shared load/save/
 * issue/discard lifecycle now live in `LineItemsEditor`, `ConfirmActionDialog`, and
 * the `useDraftForm` hook; this shell keeps only the invoice-specific parts (customer
 * picker + label resolution, due-date, and the `dateInvalid` error key).
 */

type OrgTable = { key: string; label: string };

export function InvoiceDraftForm({
  slug,
  invoiceId,
  tables,
  defaultProvince,
  defaultLanguage,
  taxRegistered,
}: {
  slug: string;
  /** null = create; a uuid = edit an existing draft. */
  invoiceId: string | null;
  tables: OrgTable[];
  /** Province default from the Business Profile jurisdiction, falling back to ON. */
  defaultProvince: string;
  /** Language default from the Business Profile, falling back to en. */
  defaultLanguage: InvoiceLanguage;
  /**
   * Whether the business's GST/HST registration is effective as of today (Story
   * 12.3). Drives the live tax preview: passed as `taxApplies` into
   * `computeInvoiceTotals`, so the HST line shows only when the business is
   * registered AND the province has an active rate. Matches the server's provisional
   * reference date for a draft.
   */
  taxRegistered: boolean;
}) {
  const t = useTranslations("Invoices");
  const router = useRouter();
  const prefersReducedMotion = useReducedMotion();

  const isEdit = invoiceId !== null;

  // Invoice-only state: the linked customer object (via the picker) and its
  // resolution status, plus the due-date. Shared state (rows/version/status/…)
  // lives in the hook below.
  const [customer, setCustomer] = useState<{ id: string; label: string } | null>(
    null,
  );
  const [customerMissing, setCustomerMissing] = useState(false);
  const [province, setProvince] = useState(defaultProvince);
  const [language, setLanguage] = useState<InvoiceLanguage>(defaultLanguage);
  const [dueDate, setDueDate] = useState("");
  const [pickerOpen, setPickerOpen] = useState(false);

  const provinceId = useId();
  const languageId = useId();
  const dueDateId = useId();
  const errorId = useId();

  const buildInput = (): InvoiceDraftInput => ({
    customerRecordId: customer?.id,
    province: province.trim() === "" ? undefined : province.trim(),
    language,
    version: form.version ?? undefined,
    dueDate: dueDate.trim() === "" ? undefined : dueDate.trim(),
    lineItems: form.rows.map((r) => ({
      description: r.description.trim(),
      quantity: toNumber(r.quantity),
      unitPrice: toNumber(r.unitPrice),
    })),
  });

  const form = useDraftForm({
    isEdit,
    keyPrefix: "row-",
    initialRows: [newRow("row-")],
    province,
    taxRegistered,
    extraErrorKeys: ["dateInvalid"],
    translateError: (key) => t(`error.${key}`),
    load: async () => {
      const payload = await getInvoice(slug, invoiceId!);
      setProvince(payload.invoice.place_of_supply_province ?? defaultProvince);
      setLanguage(payload.invoice.language);
      setDueDate(payload.invoice.due_date ?? "");
      if (payload.invoice.customer_record_id) {
        if (payload.customerLabel) {
          setCustomer({
            id: payload.invoice.customer_record_id,
            label: payload.customerLabel,
          });
        } else {
          // The record is linked but its label no longer resolves (soft-deleted
          // or missing) — show the translated "unavailable" note, no crash.
          setCustomer({
            id: payload.invoice.customer_record_id,
            label: t("customerUnavailable"),
          });
          setCustomerMissing(true);
        }
      }
      return {
        version: payload.invoice.version,
        rows: payload.lineItems.map((item) =>
          makeRow("row-", {
            description: item.description,
            quantity: item.quantity,
            unitPrice: item.unit_price,
          }),
        ),
      };
    },
    buildInput,
    create: async (input) => {
      const result = await createInvoice(slug, input as InvoiceDraftInput);
      // Land on the new draft's edit page so a follow-up save is version-gated.
      router.push(`/${slug}/invoices/${result.id}`);
    },
    update: async (input) => {
      const result = await updateInvoice(slug, invoiceId!, input as InvoiceDraftInput);
      return { version: result.version };
    },
    discard: async () => {
      await discardInvoice(slug, invoiceId!);
      router.push(`/${slug}/invoices`);
    },
    // Issue the invoice (Story 12.4). On success the row is now non-draft, so we push
    // to the invoice view (the read-only issued view).
    issue: async (version) => {
      await issueInvoice(slug, invoiceId!, version);
      router.push(`/${slug}/invoices/${invoiceId}`);
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
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">
          {t("draftSubtitle")}
        </p>
      </header>

      {/* Customer */}
      <fieldset className="flex flex-col gap-4">
        <legend className="mb-1 flex flex-col gap-1">
          <span className="text-sm font-semibold tracking-tight text-foreground">
            {t("customerHeading")}
          </span>
          <span className="text-sm font-normal text-muted-foreground text-pretty">
            {t("customerSubtitle")}
          </span>
        </legend>

        {customer ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm font-medium text-foreground">
              {t("linkedCustomerLabel")}:
            </span>
            <span
              className={
                customerMissing
                  ? "text-sm text-muted-foreground italic"
                  : "text-sm text-foreground"
              }
            >
              {customer.label}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="min-h-9 gap-2"
              onClick={() => setPickerOpen(true)}
            >
              <Link2 aria-hidden="true" className="size-4" />
              {t("changeCustomer")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="min-h-9 gap-2"
              onClick={() => {
                setCustomer(null);
                setCustomerMissing(false);
                form.clearFeedback();
              }}
            >
              <X aria-hidden="true" className="size-4" />
              {t("clearCustomer")}
            </Button>
          </div>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="min-h-12 w-fit gap-2"
            onClick={() => setPickerOpen(true)}
          >
            <Link2 aria-hidden="true" className="size-4" />
            {t("linkCustomer")}
          </Button>
        )}
      </fieldset>

      {/* Invoice details */}
      <fieldset className="flex flex-col gap-5">
        <legend className="mb-1 text-sm font-semibold tracking-tight text-foreground">
          {t("detailsHeading")}
        </legend>
        <div className="grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-2">
            <Label htmlFor={provinceId}>{t("provinceLabel")}</Label>
            <Input
              id={provinceId}
              value={province}
              placeholder={t("provincePlaceholder")}
              onChange={(e) => {
                setProvince(e.target.value);
                form.clearFeedback();
              }}
              className="min-h-12"
            />
            <p className="text-sm text-muted-foreground text-pretty">
              {t("provinceHint")}
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={languageId}>{t("languageLabel")}</Label>
            <Select
              value={language}
              onValueChange={(v) => {
                setLanguage(v as InvoiceLanguage);
                form.clearFeedback();
              }}
            >
              <SelectTrigger id={languageId} className="min-h-12 w-full">
                <SelectValue placeholder={t("languagePlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {INVOICE_LANGUAGES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {value === "en" ? t("languageEn") : t("languageFr")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor={dueDateId}>{t("dueDateLabel")}</Label>
            <Input
              id={dueDateId}
              type="date"
              value={dueDate}
              className="min-h-12"
              onChange={(e) => {
                setDueDate(e.target.value);
                form.clearFeedback();
              }}
            />
            <p className="text-sm text-muted-foreground text-pretty">
              {t("dueDateHint")}
            </p>
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
            colDescription: t("colDescription"),
            colQuantity: t("colQuantity"),
            colUnitPrice: t("colUnitPrice"),
            colAmount: t("colAmount"),
            colRemove: t("colRemove"),
            descriptionPlaceholder: t("descriptionPlaceholder"),
            removeLine: t("removeLine"),
            addLine: t("addLine"),
            subtotalLabel: t("subtotalLabel"),
            totalLabel: t("totalLabel"),
            taxLineLabel: (values) => t("taxLineLabel", values),
            taxName: t("taxHst"),
            totalsHint: t("totalsHint"),
            subtotalHint: t("subtotalHint"),
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
              <FileCheck2 aria-hidden="true" className="size-4" />
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

      <LinkedRecordPicker
        slug={slug}
        tables={tables}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(record) => {
          setCustomer(record);
          setCustomerMissing(false);
          form.clearFeedback();
        }}
      />

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
        icon={FileCheck2}
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
