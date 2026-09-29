/**
 * Canonical invoice money math (Epic 12, Invariant I2).
 *
 * This module is the SINGLE source of every invoice amount computation. Story
 * 12.2 seeds it with only `computeLineAmount` (line `amount = round(quantity ×
 * unit_price, 2)`); Story 12.3 EXTENDS this same file with the subtotal, tax
 * total, and total helpers (and the shared HST/registration predicate). Nothing
 * anywhere re-implements a line amount — the DB stores what this returns, and the
 * 12.4 issuance gate calls the same function to verify equality.
 *
 * Pure and dependency-free so it unit-tests in the node env and can be imported
 * from both server (the mutation layer) and client (a draft's running subtotal).
 */

/**
 * Round a monetary value to 2 decimal places using half-away-from-zero rounding
 * (standard commercial rounding), guarding against binary floating-point drift
 * (e.g. `1.005` must round to `1.01`, not `1.00`). Scales to cents, nudges by a
 * tiny epsilon in the value's direction to counter the representational error,
 * rounds, then scales back.
 */
function roundMoney(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  const scaled = value * 100;
  // Epsilon nudge (relative to magnitude) so a value that is mathematically at a
  // .5 cent boundary but stored just below it (e.g. 100.49999999) still rounds up.
  const nudged = scaled + (scaled >= 0 ? 1 : -1) * Number.EPSILON * Math.abs(scaled);
  return Math.round(nudged) / 100;
}

/**
 * The ONE canonical line-amount computation (Invariant I2): `round(quantity ×
 * unit_price, 2)`. This is the only place a line amount is ever computed — the DB
 * stores the result, and Story 12.3's subtotal/total build on it rather than a
 * second implementation.
 *
 * Inputs are expected to be finite non-negative numbers (the Zod schema rejects
 * non-numeric / negative values upstream before this is ever called on a write).
 * A non-finite input degrades to `0` rather than propagating `NaN`.
 */
export function computeLineAmount(quantity: number, unitPrice: number): number {
  if (!Number.isFinite(quantity) || !Number.isFinite(unitPrice)) {
    return 0;
  }
  return roundMoney(quantity * unitPrice);
}

// --- Story 12.3: subtotal / tax / total (Ontario HST, place of supply) --------

/** A single line item as consumed by the totals computation. */
export type TotalsLineItem = {
  quantity: number;
  unitPrice: number;
};

/**
 * One stored tax line (Invariant I3, FR84). For the MVP Ontario path there is
 * ALWAYS exactly one of these when tax applies — HST computed once on the subtotal,
 * never per line, never split into federal/provincial. `label` is the canonical
 * stored name (`HST`); the form/PDF translate it for display.
 */
export type TaxLine = {
  /** Canonical stored tax label (e.g. `HST`). */
  label: string;
  /** The tax rate applied to `base` (e.g. `0.13`). */
  rate: number;
  /** The base the tax is computed on — the invoice subtotal. */
  base: number;
  /** `round(base × rate, 2)`. */
  tax_amount: number;
};

/** The full computed money picture for an invoice (Invariant I2). */
export type InvoiceTotals = {
  /** `Σ computeLineAmount` over the line items. */
  subtotal: number;
  /** Zero or one tax line (MVP Ontario). Empty when no tax applies. */
  taxLines: TaxLine[];
  /** `Σ taxLines[].tax_amount` (a single value for the Ontario path). */
  taxTotal: number;
  /** `subtotal + taxTotal`. */
  total: number;
};

/**
 * The active place-of-supply tax rates. Ontario/HST is the only active path in the
 * MVP; every other province (including `QC`) is deliberately ABSENT so no active tax
 * line is emitted for it — the province/language seam is stored so Quebec (GST +
 * QST) can be enabled later with no re-architecture (FR95). Keyed by the normalized
 * (trimmed, uppercased) province code.
 */
export const PROVINCE_TAX: Record<string, { label: string; rate: number }> = {
  ON: { label: "HST", rate: 0.13 },
};

/** Trim + uppercase a province code so lookups are stable (`" on " -> "ON"`). */
export function normalizeProvince(province: string | null | undefined): string {
  return (province ?? "").trim().toUpperCase();
}

/**
 * The SINGLE shared registration-effectiveness predicate (Invariant I3, FR84):
 * a GST/HST registration is effective when its effective date is on or before the
 * reference date. Story 12.3's totals and Story 12.4's issuance gate (`validate.ts`)
 * both import THIS helper — there is no second implementation anywhere.
 *
 * Pure and date-injected: the caller supplies both dates as `YYYY-MM-DD` strings
 * (this module never calls `Date`). A null/absent `effectiveDate` means "not
 * effective" (false) — a business with no recorded effective date charges no tax.
 * Comparison is lexicographic, which is correct for zero-padded ISO `YYYY-MM-DD`.
 */
export function isRegistrationEffective(
  effectiveDate: string | null | undefined,
  referenceDate: string,
): boolean {
  if (!effectiveDate) {
    return false;
  }
  return effectiveDate <= referenceDate;
}

/**
 * Sum every line's canonical amount into the invoice subtotal (Invariant I2):
 * `subtotal = Σ computeLineAmount(quantity, unitPrice)`. Reuses the sole line-amount
 * helper — no second implementation. The sum is re-rounded to guard against any
 * float drift accumulating across many already-rounded 2-decimal amounts.
 */
export function computeSubtotal(lineItems: TotalsLineItem[]): number {
  const sum = lineItems.reduce(
    (acc, item) => acc + computeLineAmount(item.quantity, item.unitPrice),
    0,
  );
  return roundMoney(sum);
}

/**
 * The canonical invoice totals computation (Invariant I2, I3, FR84) — the ONLY
 * place invoice-level money is computed. The DB stores exactly what this returns
 * (on every draft save), and Story 12.4's issuance gate calls this same function to
 * verify equality against the frozen figures.
 *
 * A tax line is emitted only when BOTH `taxApplies` is true (the caller has already
 * evaluated `gst_hst_number present && isRegistrationEffective(...)` against the
 * reference date) AND the normalized province has an active rate in `PROVINCE_TAX`.
 * When emitted it is exactly ONE line: HST computed once on the subtotal
 * (`round(subtotal × rate, 2)`), never per line, never split. Otherwise there is no
 * tax line, `taxTotal = 0`, and `total = subtotal`.
 *
 * Pure: `taxApplies` is passed as a boolean (not a raw date) so the client preview
 * can reuse this with a server-evaluated flag while the date predicate stays the
 * single shared helper.
 */
export function computeInvoiceTotals({
  lineItems,
  province,
  taxApplies,
}: {
  lineItems: TotalsLineItem[];
  province: string | null | undefined;
  taxApplies: boolean;
}): InvoiceTotals {
  const subtotal = computeSubtotal(lineItems);

  const provinceTax = PROVINCE_TAX[normalizeProvince(province)];
  const taxLines: TaxLine[] = [];

  if (taxApplies && provinceTax) {
    taxLines.push({
      label: provinceTax.label,
      rate: provinceTax.rate,
      base: subtotal,
      tax_amount: roundMoney(subtotal * provinceTax.rate),
    });
  }

  const taxTotal = roundMoney(
    taxLines.reduce((acc, line) => acc + line.tax_amount, 0),
  );
  const total = roundMoney(subtotal + taxTotal);

  return { subtotal, taxLines, taxTotal, total };
}

// --- Story 12.4: invoice-number display format (Invariant I1) ----------------

/**
 * The one documented display format for a per-org invoice number (Invariant I1):
 * 6-digit zero-padded, no prefix (e.g. `1` -> `000001`). The stored integer is
 * authoritative; this width is display-only. Kept here with the numbering concern
 * (rather than in the `server-only` validate.ts) so the list + issued view — both
 * client components — can render it. A number wider than 6 digits is shown in full
 * (never truncated); a null/non-finite number degrades to an empty string so a
 * still-draft row renders a dash at the call site.
 */
export function formatInvoiceNumber(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) {
    return "";
  }
  return String(Math.trunc(n)).padStart(6, "0");
}

// --- Story 12.5: CAD money formatting for the rendered PDF --------------------

/**
 * Format a CAD monetary amount for display on the invoice PDF (Story 12.5).
 * Client-safe (pure `Intl.NumberFormat`, no server-only dependency) so the one
 * shared render path — and any future preview — can reuse it.
 *
 * The invoice's `language` selects the Canadian locale: `en` -> `en-CA`
 * (`$1,234.56`) and `fr` -> `fr-CA` (`1 234,56 $`, with the currency symbol
 * trailing and a non-breaking space group separator, per Canadian French
 * convention). Every amount renders with exactly two fraction digits.
 *
 * A non-finite amount degrades to `0` (formatted) rather than propagating `NaN`
 * onto a legal document.
 */
export function formatMoney(
  amount: number,
  language: InvoiceLanguageCode,
): string {
  const value = Number.isFinite(amount) ? amount : 0;
  const locale = language === "fr" ? "fr-CA" : "en-CA";
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/** The two invoice languages (mirrors `InvoiceLanguage` without a server import). */
export type InvoiceLanguageCode = "en" | "fr";
