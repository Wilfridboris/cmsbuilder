import { getTranslations } from "next-intl/server";
import { FileMinus2 } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { PaymentInstructionsBlock } from "@/components/invoices/PaymentInstructionsBlock";
import { CreditNoteDeliveryActions } from "@/components/invoices/CreditNoteDeliveryActions";
import { formatInvoiceNumber } from "@/lib/invoicing/tax";
import type {
  CreditNoteLineItemRow,
  CreditNoteRow,
  CreditNoteStatus,
  CreditNoteTaxLineRow,
  InvoiceLanguage,
} from "@/types/db";

/**
 * IssuedCreditNoteView (Story 12.8) — the read-only summary of an ISSUED credit note,
 * rendered server-side from the FROZEN snapshots (I6). Mirrors `IssuedInvoiceView`: status
 * badge, the 6-digit `formatInvoiceNumber`, the issue date, the frozen supplier and
 * customer identity, the line items, the HST line, and the total — plus a "Corrects
 * invoice N" line naming the original invoice. There is NO edit/discard/issue action: an
 * issued credit note is immutable, and the original invoice is never changed. When a
 * `share_token` exists, the in-app Download PDF + Copy Link delivery bar is mounted.
 */

const STATUS_LABEL_KEY: Record<CreditNoteStatus, string> = {
  draft: "statusDraft",
  issued: "statusIssued",
  void: "statusVoid",
};

const STATUS_VARIANT: Record<
  CreditNoteStatus,
  "default" | "secondary" | "outline" | "destructive"
> = {
  draft: "secondary",
  issued: "default",
  void: "outline",
};

/** Coerce a PostgREST numeric-boundary value to a 2-decimal display string. */
function money(value: number | string): string {
  const n = typeof value === "number" ? value : Number(value);
  return (Number.isFinite(n) ? n : 0).toFixed(2);
}

function formatIssueDate(iso: string | null, locale: string): string {
  if (!iso) return "";
  const date = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(locale, {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export async function IssuedCreditNoteView({
  creditNote,
  lineItems,
  taxLines,
  locale,
}: {
  creditNote: CreditNoteRow;
  lineItems: CreditNoteLineItemRow[];
  taxLines: CreditNoteTaxLineRow[];
  locale: string;
}) {
  const t = await getTranslations("CreditNotes");
  const tInvoices = await getTranslations("Invoices");

  const supplier = creditNote.supplier_snapshot;
  const customer = creditNote.customer_snapshot;
  const numberDisplay = formatInvoiceNumber(
    typeof creditNote.credit_note_number === "string"
      ? Number(creditNote.credit_note_number)
      : creditNote.credit_note_number,
  );
  const originalNumberDisplay = formatInvoiceNumber(
    typeof creditNote.original_invoice_number === "string"
      ? Number(creditNote.original_invoice_number)
      : creditNote.original_invoice_number,
  );
  const language: InvoiceLanguage = creditNote.language === "fr" ? "fr" : "en";

  return (
    <section className="flex flex-col gap-10">
      <header className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary"
          >
            <FileMinus2 className="size-5" />
          </span>
          <h1 className="text-2xl font-semibold tracking-tight text-balance">
            {t("issuedTitle", { number: numberDisplay })}
          </h1>
          <Badge variant={STATUS_VARIANT[creditNote.status]}>
            {t(STATUS_LABEL_KEY[creditNote.status])}
          </Badge>
        </div>
        <p className="max-w-prose text-sm text-muted-foreground text-pretty">
          {t("issuedSubtitle")}
        </p>
      </header>

      <dl className="grid gap-6 sm:grid-cols-2">
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("issuedNumberLabel")}
          </dt>
          <dd className="text-sm font-medium tabular-nums text-foreground">
            {numberDisplay}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("issuedDateLabel")}
          </dt>
          <dd className="text-sm font-medium text-foreground">
            {formatIssueDate(creditNote.issue_date, locale)}
          </dd>
        </div>

        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("correctsInvoiceLabel")}
          </dt>
          <dd className="text-sm font-medium tabular-nums text-foreground">
            {originalNumberDisplay || "-"}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("supplierHeading")}
          </dt>
          <dd className="flex flex-col gap-0.5 text-sm text-foreground">
            <span className="font-medium">{supplier?.legal_name}</span>
            {supplier?.operating_name ? (
              <span className="text-muted-foreground">
                {supplier.operating_name}
              </span>
            ) : null}
            {supplier?.gst_hst_number ? (
              <span className="text-muted-foreground tabular-nums">
                {supplier.gst_hst_number}
              </span>
            ) : null}
            {supplier?.business_address ? (
              <span className="whitespace-pre-line text-muted-foreground">
                {supplier.business_address}
              </span>
            ) : null}
          </dd>
        </div>
        <div className="flex flex-col gap-1">
          <dt className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            {t("billedToHeading")}
          </dt>
          <dd className="text-sm text-foreground">
            {customer?.display_label ? (
              <span className="font-medium">{customer.display_label}</span>
            ) : (
              <span className="text-muted-foreground italic">
                {t("standaloneCustomer")}
              </span>
            )}
          </dd>
        </div>
      </dl>

      {/* Line items. */}
      <div className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold tracking-tight text-foreground">
          {t("lineItemsHeading")}
        </h2>
        <div className="rounded-xl border border-border">
          <div className="hidden gap-3 border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_6rem_8rem_6rem]">
            <span>{tInvoices("colDescription")}</span>
            <span className="text-right">{tInvoices("colQuantity")}</span>
            <span className="text-right">{tInvoices("colUnitPrice")}</span>
            <span className="text-right">{tInvoices("colAmount")}</span>
          </div>
          <ul className="divide-y divide-border">
            {lineItems.map((item) => (
              <li
                key={item.id}
                className="grid gap-1 px-4 py-3 sm:grid-cols-[1fr_6rem_8rem_6rem] sm:items-center sm:gap-3"
              >
                <span className="text-sm text-foreground">
                  {item.description}
                </span>
                <span className="text-sm tabular-nums text-muted-foreground sm:text-right">
                  {String(item.quantity)}
                </span>
                <span className="text-sm tabular-nums text-muted-foreground sm:text-right">
                  {money(item.unit_price)}
                </span>
                <span className="text-sm font-medium tabular-nums text-foreground sm:text-right">
                  {money(item.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Totals. */}
      <div className="flex justify-end">
        <dl className="flex w-full max-w-xs flex-col gap-1.5 text-right">
          <div className="flex items-center justify-between gap-6">
            <dt className="text-sm font-medium text-muted-foreground">
              {tInvoices("subtotalLabel")}
            </dt>
            <dd className="tabular-nums text-foreground">
              {money(creditNote.subtotal)}
            </dd>
          </div>
          {taxLines.map((line) => (
            <div key={line.id} className="flex items-center justify-between gap-6">
              <dt className="text-sm font-medium text-muted-foreground">
                {tInvoices("taxLineLabel", {
                  tax: tInvoices("taxHst"),
                  rate: Math.round(
                    (typeof line.rate === "number"
                      ? line.rate
                      : Number(line.rate)) * 100,
                  ),
                })}
              </dt>
              <dd className="tabular-nums text-foreground">
                {money(line.tax_amount)}
              </dd>
            </div>
          ))}
          <div className="mt-1 flex items-center justify-between gap-6 border-t border-border pt-2">
            <dt className="text-sm font-semibold text-foreground">
              {tInvoices("totalLabel")}
            </dt>
            <dd className="text-base font-semibold tabular-nums text-foreground">
              {money(creditNote.total)}
            </dd>
          </div>
        </dl>
      </div>

      {/* Payment instructions from the frozen supplier snapshot (I6). */}
      <PaymentInstructionsBlock supplier={supplier} />

      {/* In-app delivery: Download PDF + Copy Link (only once a share token exists). */}
      {creditNote.status !== "void" && creditNote.share_token ? (
        <CreditNoteDeliveryActions
          shareToken={creditNote.share_token}
          creditNoteNumber={numberDisplay}
          language={language}
        />
      ) : null}
    </section>
  );
}
