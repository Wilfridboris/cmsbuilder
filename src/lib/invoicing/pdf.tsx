import "server-only";

import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  renderToBuffer,
} from "@react-pdf/renderer";

import en from "@/lib/i18n/en.json";
import fr from "@/lib/i18n/fr.json";
import { formatMoney, type InvoiceLanguageCode } from "@/lib/invoicing/tax";

/**
 * The single, shared invoice-PDF render path (Story 12.5, Invariant I8).
 *
 * `renderInvoicePdf(model)` produces a branded PDF `Buffer` from a neutral
 * {@link InvoiceDocumentModel} using `@react-pdf/renderer`'s `renderToBuffer`.
 * It is `server-only` (the reconciler runs in the Node runtime) and renders
 * EXCLUSIVELY from the model's frozen values — supplier/customer snapshots plus
 * the stored line items, tax line, totals, number, issue date, and language
 * (Invariant I6). It NEVER reads live `records` / `business_profiles`; the caller
 * (`ensureInvoicePdf`) builds the model from the issued invoice's snapshots.
 *
 * The model is deliberately document-shaped (not invoice-specific) so credit notes
 * (Story 12.8) reuse this exact path. Copy resolves from the `InvoicePdf.*` block
 * of the catalog matching the model's OWN `language` (a fr invoice always renders
 * French regardless of the viewer's cookie locale). Money renders in CAD via the
 * shared client-safe `formatMoney` (en-CA `$1,234.56` / fr-CA `1 234,56 $`).
 */

/** The supplier legal identity + payment instructions frozen onto the document. */
export type InvoiceDocumentSupplier = {
  legalName: string;
  operatingName: string | null;
  gstHstNumber: string | null;
  businessAddress: string | null;
  paymentTerms: string | null;
  paymentEtransferEmail: string | null;
  paymentChequePayableTo: string | null;
  paymentChequeAddress: string | null;
  paymentCardLink: string | null;
};

/** The billed-to identity, or null for a standalone document (no linked customer). */
export type InvoiceDocumentCustomer = {
  displayLabel: string | null;
} | null;

/** One rendered line item. */
export type InvoiceDocumentLineItem = {
  description: string;
  quantity: number;
  unitPrice: number;
  amount: number;
};

/** The single tax line (Ontario HST), or null when no tax applies. */
export type InvoiceDocumentTaxLine = {
  /** Canonical stored label (e.g. `HST`); translated for display via `taxHst`. */
  label: string;
  /** The rate as a fraction (e.g. `0.13`), rendered as a whole-number percent. */
  rate: number;
  amount: number;
} | null;

/**
 * The neutral, document-shaped model the shared render path consumes (I8). Built by
 * the caller from an issued invoice's frozen snapshots + stored rows; reused as-is
 * for credit notes.
 */
export type InvoiceDocumentModel = {
  /** The localized document title key selector: an invoice today; a credit note later. */
  documentType: "invoice";
  /** Display invoice number (already zero-padded via `formatInvoiceNumber`). */
  number: string;
  /** The frozen issue date (`YYYY-MM-DD`). */
  issueDate: string;
  /** The document language — drives copy AND CAD formatting. */
  language: InvoiceLanguageCode;
  supplier: InvoiceDocumentSupplier;
  customer: InvoiceDocumentCustomer;
  lineItems: InvoiceDocumentLineItem[];
  taxLine: InvoiceDocumentTaxLine;
  subtotal: number;
  total: number;
};

/** The `InvoicePdf.*` label block for one language (structurally identical en/fr). */
type PdfLabels = (typeof en)["InvoicePdf"];

const CATALOGS: Record<InvoiceLanguageCode, PdfLabels> = {
  en: en.InvoicePdf,
  fr: fr.InvoicePdf,
};

/**
 * Format the frozen `YYYY-MM-DD` issue date for display in the document's language.
 * Parsed as a LOCAL date (no `Z`) and formatted in the same local zone so the
 * calendar day is preserved (no UTC off-by-one), matching the issued-view helper.
 */
function formatIssueDate(iso: string, language: InvoiceLanguageCode): string {
  const parsed = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) {
    return iso;
  }
  return parsed.toLocaleDateString(language === "fr" ? "fr-CA" : "en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

/** Render the tax rate fraction as a whole-number percent string (0.13 -> "13"). */
function formatRatePercent(rate: number): string {
  if (!Number.isFinite(rate)) {
    return "0";
  }
  return String(Math.round(rate * 100));
}

/**
 * Format a line-item quantity in the document's language so a fractional quantity
 * (e.g. 2.5 hours) uses the locale's decimal separator — a comma in fr-CA
 * (`2,5`) — consistent with the CAD money in the same row. A non-finite value
 * degrades to `0`.
 */
function formatQuantity(quantity: number, language: InvoiceLanguageCode): string {
  const value = Number.isFinite(quantity) ? quantity : 0;
  return new Intl.NumberFormat(language === "fr" ? "fr-CA" : "en-CA", {
    maximumFractionDigits: 4,
  }).format(value);
}

/** The language- and content-dependent display strings resolved from the model. */
export type InvoicePdfStrings = {
  documentTitle: string;
  supplierName: string;
  customerLabel: string;
  taxLabelText: string;
};

/**
 * Resolve the branch-dependent display strings from the model: the localized
 * document title (language branch), the supplier heading, the billed-to label
 * (which falls back to the localized standalone line when no customer is present),
 * and the tax-line label (empty when no tax applies). Extracted from the render
 * tree and exported so the language / standalone-customer / tax-presence branches
 * — which the AC pins but the rendered PDF binary would otherwise hide — can be
 * unit-tested deterministically.
 */
export function resolveInvoicePdfStrings(
  model: InvoiceDocumentModel,
): InvoicePdfStrings {
  const t = CATALOGS[model.language];

  const supplierName =
    model.supplier.operatingName &&
    model.supplier.operatingName.trim() !== "" &&
    model.supplier.operatingName !== model.supplier.legalName
      ? `${model.supplier.legalName} (${model.supplier.operatingName})`
      : model.supplier.legalName;

  const customerLabel =
    model.customer?.displayLabel && model.customer.displayLabel.trim() !== ""
      ? model.customer.displayLabel
      : t.standaloneCustomer;

  const taxLabelText = model.taxLine
    ? t.taxLineLabel
        .replace("{tax}", t.taxHst)
        .replace("{rate}", formatRatePercent(model.taxLine.rate))
    : "";

  return { documentTitle: t.documentTitle, supplierName, customerLabel, taxLabelText };
}

// Neutral, print-oriented styles. No external fonts (Helvetica is built in) so the
// render is self-contained and deterministic in the Node runtime.
const styles = StyleSheet.create({
  page: {
    paddingVertical: 48,
    paddingHorizontal: 48,
    fontSize: 10,
    fontFamily: "Helvetica",
    color: "#1a1a1a",
    lineHeight: 1.4,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  title: {
    fontSize: 22,
    fontFamily: "Helvetica-Bold",
  },
  metaRight: {
    textAlign: "right",
  },
  metaLabel: {
    color: "#666666",
    fontSize: 9,
  },
  metaValue: {
    fontFamily: "Helvetica-Bold",
    marginBottom: 6,
  },
  parties: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginBottom: 24,
  },
  party: {
    width: "48%",
  },
  sectionHeading: {
    fontSize: 9,
    color: "#666666",
    marginBottom: 4,
    textTransform: "uppercase",
  },
  strong: {
    fontFamily: "Helvetica-Bold",
  },
  addressLine: {
    color: "#333333",
  },
  table: {
    marginBottom: 16,
  },
  tableHead: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#1a1a1a",
    paddingBottom: 4,
    marginBottom: 4,
  },
  tableRow: {
    flexDirection: "row",
    borderBottomWidth: 1,
    borderBottomColor: "#e5e5e5",
    paddingVertical: 4,
  },
  colDescription: { width: "46%" },
  colQuantity: { width: "14%", textAlign: "right" },
  colUnitPrice: { width: "20%", textAlign: "right" },
  colAmount: { width: "20%", textAlign: "right" },
  headCell: {
    fontFamily: "Helvetica-Bold",
    fontSize: 9,
    color: "#666666",
  },
  totals: {
    marginLeft: "auto",
    width: "45%",
  },
  totalsRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 2,
  },
  totalsGrand: {
    flexDirection: "row",
    justifyContent: "space-between",
    borderTopWidth: 1,
    borderTopColor: "#1a1a1a",
    marginTop: 4,
    paddingTop: 4,
  },
  payment: {
    marginTop: 28,
    borderTopWidth: 1,
    borderTopColor: "#e5e5e5",
    paddingTop: 12,
  },
  paymentRow: {
    flexDirection: "row",
    marginBottom: 2,
  },
  paymentLabel: {
    width: "35%",
    color: "#666666",
  },
  paymentValue: {
    width: "65%",
  },
});

/** A payment-instructions row, rendered only when its value is present. */
function PaymentRow({ label, value }: { label: string; value: string | null }) {
  if (!value || value.trim() === "") {
    return null;
  }
  return (
    <View style={styles.paymentRow}>
      <Text style={styles.paymentLabel}>{label}</Text>
      <Text style={styles.paymentValue}>{value}</Text>
    </View>
  );
}

/** Build the react-pdf document tree from the neutral model. */
function InvoiceDocument({ model }: { model: InvoiceDocumentModel }) {
  const t = CATALOGS[model.language];
  const lang = model.language;

  const { supplierName, customerLabel, taxLabelText } =
    resolveInvoicePdfStrings(model);

  const hasAnyPayment =
    Boolean(model.supplier.paymentTerms) ||
    Boolean(model.supplier.paymentEtransferEmail) ||
    Boolean(model.supplier.paymentChequePayableTo) ||
    Boolean(model.supplier.paymentChequeAddress) ||
    Boolean(model.supplier.paymentCardLink);

  return (
    <Document title={`${t.documentTitle} ${model.number}`}>
      <Page size="A4" style={styles.page}>
        {/* Header: title + number/date meta */}
        <View style={styles.header}>
          <Text style={styles.title}>{t.documentTitle}</Text>
          <View style={styles.metaRight}>
            <Text style={styles.metaLabel}>{t.invoiceNumberLabel}</Text>
            <Text style={styles.metaValue}>{model.number}</Text>
            <Text style={styles.metaLabel}>{t.issueDateLabel}</Text>
            <Text style={styles.metaValue}>
              {formatIssueDate(model.issueDate, lang)}
            </Text>
          </View>
        </View>

        {/* Parties: supplier (From) + customer (Billed to) */}
        <View style={styles.parties}>
          <View style={styles.party}>
            <Text style={styles.sectionHeading}>{t.fromHeading}</Text>
            <Text style={styles.strong}>{supplierName}</Text>
            {model.supplier.businessAddress ? (
              <Text style={styles.addressLine}>
                {model.supplier.businessAddress}
              </Text>
            ) : null}
            {model.supplier.gstHstNumber ? (
              <Text style={styles.addressLine}>
                {t.gstHstLabel}: {model.supplier.gstHstNumber}
              </Text>
            ) : null}
          </View>
          <View style={styles.party}>
            <Text style={styles.sectionHeading}>{t.billedToHeading}</Text>
            <Text style={styles.strong}>{customerLabel}</Text>
          </View>
        </View>

        {/* Line items table */}
        <View style={styles.table}>
          <View style={styles.tableHead}>
            <Text style={[styles.colDescription, styles.headCell]}>
              {t.colDescription}
            </Text>
            <Text style={[styles.colQuantity, styles.headCell]}>
              {t.colQuantity}
            </Text>
            <Text style={[styles.colUnitPrice, styles.headCell]}>
              {t.colUnitPrice}
            </Text>
            <Text style={[styles.colAmount, styles.headCell]}>
              {t.colAmount}
            </Text>
          </View>
          {model.lineItems.map((item, index) => (
            <View style={styles.tableRow} key={index}>
              <Text style={styles.colDescription}>{item.description}</Text>
              <Text style={styles.colQuantity}>
                {formatQuantity(item.quantity, lang)}
              </Text>
              <Text style={styles.colUnitPrice}>
                {formatMoney(item.unitPrice, lang)}
              </Text>
              <Text style={styles.colAmount}>
                {formatMoney(item.amount, lang)}
              </Text>
            </View>
          ))}
        </View>

        {/* Totals */}
        <View style={styles.totals}>
          <View style={styles.totalsRow}>
            <Text>{t.subtotalLabel}</Text>
            <Text>{formatMoney(model.subtotal, lang)}</Text>
          </View>
          {model.taxLine ? (
            <View style={styles.totalsRow}>
              <Text>{taxLabelText}</Text>
              <Text>{formatMoney(model.taxLine.amount, lang)}</Text>
            </View>
          ) : null}
          <View style={styles.totalsGrand}>
            <Text style={styles.strong}>{t.totalLabel}</Text>
            <Text style={styles.strong}>{formatMoney(model.total, lang)}</Text>
          </View>
        </View>

        {/* Payment instructions */}
        {hasAnyPayment ? (
          <View style={styles.payment}>
            <Text style={styles.sectionHeading}>{t.paymentHeading}</Text>
            <PaymentRow
              label={t.paymentTerms}
              value={model.supplier.paymentTerms}
            />
            <PaymentRow
              label={t.paymentEtransfer}
              value={model.supplier.paymentEtransferEmail}
            />
            <PaymentRow
              label={t.paymentCheque}
              value={model.supplier.paymentChequePayableTo}
            />
            <PaymentRow
              label={t.paymentChequeAddress}
              value={model.supplier.paymentChequeAddress}
            />
            <PaymentRow
              label={t.paymentCard}
              value={model.supplier.paymentCardLink}
            />
          </View>
        ) : null}
      </Page>
    </Document>
  );
}

/**
 * Render a branded invoice PDF from the neutral model, returning the raw bytes as a
 * `Buffer` (a valid `%PDF` document). The one shared render path (I8) — reused by
 * credit notes. Renders exclusively from the frozen model (I6).
 */
export async function renderInvoicePdf(
  model: InvoiceDocumentModel,
): Promise<Buffer> {
  return renderToBuffer(<InvoiceDocument model={model} />);
}
