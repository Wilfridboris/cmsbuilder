import "server-only";

import { AppError } from "@/types/api";
import {
  computeInvoiceTotals,
  computeLineAmount,
  isRegistrationEffective,
} from "@/lib/invoicing/tax";
import { reportRejection } from "@/lib/observability/report";

/**
 * assertIssuable (Story 12.4, FR87) — the synchronous pre-issue compliance gate.
 *
 * Mirrors the Schema Validator pattern (`src/lib/schema/validator.ts`): a total,
 * synchronous allowlist gate that runs BEFORE any write and reports every rejection
 * through the same observability seam (`reportRejection`). On any failure it throws
 * an `AppError` carrying a specific translated `Invoice.error.*` code (a
 * plain-language reason) and NOTHING is written.
 *
 * It reuses the CANONICAL `computeInvoiceTotals` / `computeLineAmount` /
 * `isRegistrationEffective` from `tax.ts` (Invariants I2/I3) — there is no second
 * money-math or registration implementation. It NEVER rewrites the stored figures:
 * it recomputes against the real `issue_date` and BLOCKS on any mismatch (fix:
 * re-save the draft), rather than silently changing money at issue.
 *
 * It blocks when:
 *   (a) no Business Profile, or a blank `legal_name`               -> legalIdentityMissing
 *   (b) a tax line is present but the business lacks a `gst_hst_number`
 *       OR the registration is not effective as of the issue date   -> taxWithoutRegistration
 *   (c) more than one tax line (the MVP Ontario path is one HST line)  -> taxSplit
 *   (d) the STORED subtotal/tax_total/total or any line amount does not
 *       equal a fresh recomputation against the real issue_date      -> totalsMismatch
 *   (e) zero line items                                              -> lineItemsRequired
 */

/** The Business Profile identity fields the gate reads (subset of the row). */
export type IssuableProfile = {
  legal_name: string | null;
  gst_hst_number: string | null;
  gst_hst_effective_date: string | null;
} | null;

/** A stored line item as read for the gate (numeric columns may be strings from PostgREST). */
export type IssuableLineItem = {
  description: string;
  quantity: number | string;
  unit_price: number | string;
  amount: number | string;
};

/** A stored tax line as read for the gate. */
export type IssuableTaxLine = {
  label: string;
  rate: number | string;
  base: number | string;
  tax_amount: number | string;
};

/** The stored invoice figures the gate verifies. */
export type IssuableInvoice = {
  place_of_supply_province: string | null;
  subtotal: number | string;
  tax_total: number | string;
  total: number | string;
};

export type AssertIssuableInput = {
  invoice: IssuableInvoice;
  lineItems: IssuableLineItem[];
  taxLines: IssuableTaxLine[];
  profile: IssuableProfile;
  /** The server-authoritative issue date (`YYYY-MM-DD`); never client-supplied. */
  issueDate: string;
};

/** Coerce a PostgREST numeric-boundary value (number | string) to a finite number. */
function num(value: number | string): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Verify the draft is compliant and ready to become a finalized, immutable invoice.
 * Throws an `AppError(422, "Invoice.error.<code>")` on the first failure (and reports
 * it via the observability seam); returns void on success. Verifies-and-blocks — it
 * never rewrites the stored figures (I2).
 */
export function assertIssuable(input: AssertIssuableInput): void {
  const { invoice, lineItems, taxLines, profile, issueDate } = input;

  const reject = (code: string, detail: string): never => {
    reportRejection(`assertIssuable: ${detail}`);
    // 422 Unprocessable Entity: the request is well-formed but the invoice's state
    // fails the compliance gate. The code is a frozen Invoice.error.* key the route
    // envelope surfaces and the UI translates to a plain-language reason.
    throw new AppError(422, `Invoice.error.${code}`, detail);
  };

  // (e) Zero line items — a draft with no lines cannot be issued.
  if (!lineItems || lineItems.length === 0) {
    reject("lineItemsRequired", "no line items");
  }

  // (a) Legal identity — a Business Profile with a non-blank legal name is mandatory
  // (FR87: every taxed invoice must show the supplier's legal name; we require it for
  // every issued invoice).
  const legalName = profile?.legal_name?.trim() ?? "";
  if (!profile || legalName === "") {
    reject("legalIdentityMissing", "no business profile or blank legal_name");
  }

  // (c) Split tax — the MVP Ontario path emits exactly ONE HST line, never split into
  // federal/provincial components (I3). More than one stored tax line is non-compliant.
  if (taxLines.length > 1) {
    reject("taxSplit", `expected at most one tax line, found ${taxLines.length}`);
  }

  // (b) Tax without a valid registration — if a tax line is present, the business must
  // have a GST/HST number AND its registration must be effective as of the issue date
  // (the SHARED predicate against the real issue date, I3).
  const hasTaxLine = taxLines.length === 1;
  const hasNumber =
    typeof profile?.gst_hst_number === "string" &&
    profile.gst_hst_number.trim() !== "";
  const taxApplies =
    hasNumber &&
    isRegistrationEffective(profile?.gst_hst_effective_date ?? null, issueDate);
  if (hasTaxLine && !taxApplies) {
    reject(
      "taxWithoutRegistration",
      "a tax line is present but the business is not effectively GST/HST-registered as of the issue date",
    );
  }

  // (d) Totals must reconcile — recompute from the canonical function against the real
  // issue date and verify the STORED figures equal it exactly. This never rewrites the
  // stored figures; it BLOCKS on a mismatch (fix: re-save the draft).
  const fresh = computeInvoiceTotals({
    lineItems: lineItems.map((item) => ({
      quantity: num(item.quantity),
      unitPrice: num(item.unit_price),
    })),
    province: invoice.place_of_supply_province,
    taxApplies,
  });

  // Each stored line amount must equal a fresh computeLineAmount.
  for (const item of lineItems) {
    const freshAmount = computeLineAmount(num(item.quantity), num(item.unit_price));
    if (num(item.amount) !== freshAmount) {
      reject(
        "totalsMismatch",
        `stored line amount ${String(item.amount)} != recomputed ${freshAmount}`,
      );
    }
  }

  if (num(invoice.subtotal) !== fresh.subtotal) {
    reject(
      "totalsMismatch",
      `stored subtotal ${String(invoice.subtotal)} != recomputed ${fresh.subtotal}`,
    );
  }
  if (num(invoice.tax_total) !== fresh.taxTotal) {
    reject(
      "totalsMismatch",
      `stored tax_total ${String(invoice.tax_total)} != recomputed ${fresh.taxTotal}`,
    );
  }
  if (num(invoice.total) !== fresh.total) {
    reject(
      "totalsMismatch",
      `stored total ${String(invoice.total)} != recomputed ${fresh.total}`,
    );
  }

  // The stored tax line's own figures must also equal the fresh computation (the base
  // and tax_amount computed once on the subtotal).
  if (hasTaxLine) {
    const stored = taxLines[0];
    const expected = fresh.taxLines[0];
    if (
      !expected ||
      num(stored.base) !== expected.base ||
      num(stored.tax_amount) !== expected.tax_amount
    ) {
      reject(
        "totalsMismatch",
        "stored tax line does not equal the recomputed tax line",
      );
    }
  }
}

/**
 * The source-invoice ceiling a credit note must respect (Story 12.8 / retro [X1]).
 *
 * A credit note reduces an issued invoice, so the cumulative credited amount can never
 * exceed the invoice total. `invoiceTotal` is the source invoice's frozen total, and
 * `alreadyCredited` is the sum of the totals of credit notes ALREADY issued against the
 * same invoice (excluding the one being issued). Void credit notes are cancelled and are
 * excluded from `alreadyCredited` upstream.
 */
export type CreditNoteCeiling = {
  invoiceTotal: number;
  alreadyCredited: number;
};

/** Half a cent — the tolerance for the cent-rounded money comparison (matches roundMoney). */
const MONEY_EPSILON = 0.005;

/**
 * assertIssuableCreditNote (Story 12.8) — the pre-issue compliance gate for a credit
 * note. A credit note mirrors an invoice's issuance compliance exactly: >= 1 line item,
 * a legal identity present, tax not split, tax only with a valid registration as of the
 * credit note's issue date, and the stored totals reconciling against a fresh canonical
 * recomputation (I2/I3). Every predicate and every `Invoice.error.*` code is REUSED from
 * `assertIssuable` — there is no second money-math or registration implementation. A
 * credit note's line amounts are POSITIVE (like an invoice); the "Credit Note" title and
 * its reference to the original invoice carry the reduction meaning.
 *
 * On top of the shared invoice gate it enforces the credit-specific CEILING (retro [X1]):
 * the cumulative credited amount against the source invoice may not exceed the invoice
 * total, so a credit note cannot over-credit or double-credit an invoice. The ceiling is
 * skipped only when the source invoice total is unavailable (`ceiling` null) — the issue
 * path blocks a missing / non-creditable source separately. Like `assertIssuable`, this
 * synchronous TS gate carries a benign TOCTOU window (two concurrent issues against one
 * invoice) that is acceptable for the single-owner MVP and matches the invoice gate.
 */
export function assertIssuableCreditNote(
  input: AssertIssuableInput & { ceiling: CreditNoteCeiling | null },
): void {
  // Reuse every invoice compliance predicate verbatim (I2/I3) — no second money-math.
  assertIssuable(input);

  if (input.ceiling) {
    const thisTotal = num(input.invoice.total);
    const cumulative = input.ceiling.alreadyCredited + thisTotal;
    if (cumulative > input.ceiling.invoiceTotal + MONEY_EPSILON) {
      const detail = `cumulative credit ${cumulative} exceeds invoice total ${input.ceiling.invoiceTotal}`;
      reportRejection(`assertIssuableCreditNote: ${detail}`);
      throw new AppError(422, "Invoice.error.creditExceedsInvoice", detail);
    }
  }
}
