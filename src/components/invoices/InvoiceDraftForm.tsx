"use client";

import { useEffect, useId, useState } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  FileCheck2,
  Link2,
  Loader2,
  Plus,
  Save,
  Trash2,
  X,
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
import type { InvoiceLanguage } from "@/types/db";
import {
  InvoiceApiError,
  createInvoice,
  getInvoice,
  updateInvoice,
  discardInvoice,
  issueInvoice,
  type InvoiceDraftInput,
} from "@/lib/data/invoices-client";
import { LinkedRecordPicker } from "@/components/invoices/LinkedRecordPicker";

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
 * Drafting only: no snapshot, no number, no PDF, no issue — those are Stories
 * 12.4-12.8. Totals are stored on the draft row only.
 */

type OrgTable = { key: string; label: string };

/** One editable line-item row (all strings for controlled inputs). */
type LineRow = {
  key: string;
  description: string;
  quantity: string;
  unitPrice: string;
};

/** The known Invoices.error codes this form maps to a translated inline message. */
const ERROR_KEYS = new Set([
  "descriptionRequired",
  "amountInvalid",
  "lineItemsRequired",
  "customerRecordInvalid",
  "legalIdentityMissing",
  "taxWithoutRegistration",
  "taxSplit",
  "totalsMismatch",
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
  return { key: `row-${rowSeq}`, description: "", quantity: "1", unitPrice: "0" };
}

/** Parse a controlled numeric string; NaN/empty degrades to 0 for display math. */
function toNumber(value: string): number {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

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

  const [loading, setLoading] = useState(isEdit);
  const [status, setStatus] = useState<"idle" | "saving" | "saved">("idle");
  const [error, setError] = useState<string | null>(null);

  const [version, setVersion] = useState<number | null>(null);
  const [customer, setCustomer] = useState<{ id: string; label: string } | null>(
    null,
  );
  const [customerMissing, setCustomerMissing] = useState(false);
  const [province, setProvince] = useState(defaultProvince);
  const [language, setLanguage] = useState<InvoiceLanguage>(defaultLanguage);
  const [rows, setRows] = useState<LineRow[]>([newRow()]);

  const [pickerOpen, setPickerOpen] = useState(false);
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
    if (!isEdit || !invoiceId) {
      return;
    }
    let active = true;
    (async () => {
      try {
        const payload = await getInvoice(slug, invoiceId);
        if (!active) return;
        setVersion(payload.invoice.version);
        setProvince(payload.invoice.place_of_supply_province ?? defaultProvince);
        setLanguage(payload.invoice.language);
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
        const loaded = payload.lineItems.map((item) => {
          rowSeq += 1;
          return {
            key: `row-${rowSeq}`,
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
  }, [isEdit, invoiceId, slug]);

  const clearFeedback = () => {
    if (error) setError(null);
    if (status === "saved") setStatus("idle");
  };

  const updateRow = (key: string, patch: Partial<LineRow>) => {
    setRows((prev) =>
      prev.map((r) => (r.key === key ? { ...r, ...patch } : r)),
    );
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

  // Live totals from the SAME canonical function the server stores from (I2/I3).
  // The HST line appears only when the business is tax-registered AND the province
  // has an active rate; otherwise it degrades to subtotal-only.
  const totals = computeInvoiceTotals({
    lineItems: rows.map((r) => ({
      quantity: toNumber(r.quantity),
      unitPrice: toNumber(r.unitPrice),
    })),
    province,
    taxApplies: taxRegistered,
  });

  const buildInput = (): InvoiceDraftInput => ({
    customerRecordId: customer?.id,
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
      if (isEdit && invoiceId) {
        const result = await updateInvoice(slug, invoiceId, input);
        setVersion(result.version);
        setStatus("saved");
      } else {
        const result = await createInvoice(slug, input);
        // Land on the new draft's edit page so a follow-up save is version-gated.
        router.push(`/${slug}/invoices/${result.id}`);
        return;
      }
    } catch (err) {
      const code = err instanceof InvoiceApiError ? err.code : null;
      setError(resolveError(code));
      setStatus("idle");
    }
  };

  const handleDiscard = async () => {
    if (!invoiceId) return;
    setDiscarding(true);
    setError(null);
    try {
      await discardInvoice(slug, invoiceId);
      router.push(`/${slug}/invoices`);
    } catch (err) {
      const code = err instanceof InvoiceApiError ? err.code : null;
      setError(resolveError(code));
      setDiscarding(false);
      setDiscardOpen(false);
    }
  };

  // Issue the invoice (Story 12.4). The version must be the one last read; the server
  // runs assertIssuable first and maps a block to a specific translated code. On success
  // the row is now non-draft, so we push to the invoice view (the read-only issued view).
  const handleIssue = async () => {
    if (!invoiceId || version === null) return;
    setIssuing(true);
    setError(null);
    try {
      await issueInvoice(slug, invoiceId, version);
      router.push(`/${slug}/invoices/${invoiceId}`);
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
                clearFeedback();
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
                clearFeedback();
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
                clearFeedback();
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
          {/* Column headers (visible on wider screens). */}
          <div className="hidden gap-3 px-1 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_6rem_8rem_6rem_2.5rem]">
            <span>{t("colDescription")}</span>
            <span>{t("colQuantity")}</span>
            <span>{t("colUnitPrice")}</span>
            <span className="text-right">{t("colAmount")}</span>
            <span className="sr-only">{t("colRemove")}</span>
          </div>

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
                  <Label className="sm:sr-only">{t("colDescription")}</Label>
                  <Input
                    value={row.description}
                    placeholder={t("descriptionPlaceholder")}
                    onChange={(e) =>
                      updateRow(row.key, { description: e.target.value })
                    }
                    className="min-h-12"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="sm:sr-only">{t("colQuantity")}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={row.quantity}
                    onChange={(e) =>
                      updateRow(row.key, { quantity: e.target.value })
                    }
                    className="min-h-12"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label className="sm:sr-only">{t("colUnitPrice")}</Label>
                  <Input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    value={row.unitPrice}
                    onChange={(e) =>
                      updateRow(row.key, { unitPrice: e.target.value })
                    }
                    className="min-h-12"
                  />
                </div>
                <div className="flex items-center justify-between gap-2 sm:justify-end">
                  <span className="text-xs text-muted-foreground sm:sr-only">
                    {t("colAmount")}
                  </span>
                  <span className="text-sm font-medium tabular-nums text-foreground">
                    {amount.toFixed(2)}
                  </span>
                </div>
                <div className="flex justify-end">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={t("removeLine")}
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
            {t("addLine")}
          </Button>

          <div className="flex flex-col items-end gap-2">
            <dl className="flex flex-col gap-1.5 text-right">
              <div className="flex items-center justify-end gap-6">
                <dt className="text-sm font-medium text-muted-foreground">
                  {t("subtotalLabel")}
                </dt>
                <dd className="min-w-24 text-sm font-medium tabular-nums text-foreground">
                  {totals.subtotal.toFixed(2)}
                </dd>
              </div>

              {totals.taxLines.map((line) => (
                <div
                  key={line.label}
                  className="flex items-center justify-end gap-6"
                >
                  <dt className="text-sm font-medium text-muted-foreground">
                    {t("taxLineLabel", {
                      tax: t("taxHst"),
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
                  {t("totalLabel")}
                </dt>
                <dd className="min-w-24 text-base font-semibold tabular-nums text-foreground">
                  {totals.total.toFixed(2)}
                </dd>
              </div>
            </dl>
            <p className="max-w-xs text-right text-xs text-muted-foreground text-pretty">
              {totals.taxLines.length > 0
                ? t("totalsHint")
                : t("subtotalHint")}
            </p>
          </div>
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
              <FileCheck2 aria-hidden="true" className="size-4" />
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

      <LinkedRecordPicker
        slug={slug}
        tables={tables}
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={(record) => {
          setCustomer(record);
          setCustomerMissing(false);
          clearFeedback();
        }}
      />

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
                <FileCheck2 aria-hidden="true" className="size-4" />
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
