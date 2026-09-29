import type { InvoiceRow } from "@/types/db";

/**
 * Read-time receivables derivation (Story 12.7, FR92). The Invoices tab defaults to an
 * Unpaid / Overdue view derived AT READ TIME from `status` + `due_date`, uniform across
 * every tenant regardless of generated schema. `overdue` is a DERIVED label only — it is
 * never written to `invoices.status`. Kept as pure functions (no React, no clock) so the
 * matrix rows are unit-testable with an injected `today`.
 */

/** The three receivables views (button-group toggle). Default is `unpaid`. */
export type ReceivablesView = "unpaid" | "overdue" | "all";

/** Only the fields the derivation reads — so tests need not build a full `InvoiceRow`. */
type ReceivableInvoice = Pick<InvoiceRow, "status" | "due_date">;

/**
 * An issued invoice is Overdue when it carries a due date strictly before `today`. A
 * paid/void/draft invoice is never Overdue, and an issued invoice with no due date is
 * Unpaid but never Overdue. `today` and `due_date` are both `YYYY-MM-DD`, compared
 * lexicographically (correct for zero-padded ISO dates).
 */
export function isInvoiceOverdue(
  invoice: ReceivableInvoice,
  today: string,
): boolean {
  return (
    invoice.status === "issued" &&
    invoice.due_date !== null &&
    invoice.due_date < today
  );
}

/**
 * Partition the invoice list for the selected view:
 *   - `unpaid` (default) — every issued invoice (each rendered Unpaid or, when past its
 *     due date, the derived Overdue label);
 *   - `overdue` — only issued invoices past their due date;
 *   - `all` — every invoice regardless of status.
 */
export function filterInvoicesByView<T extends ReceivableInvoice>(
  invoices: T[],
  view: ReceivablesView,
  today: string,
): T[] {
  switch (view) {
    case "all":
      return invoices;
    case "overdue":
      return invoices.filter((inv) => isInvoiceOverdue(inv, today));
    case "unpaid":
    default:
      return invoices.filter((inv) => inv.status === "issued");
  }
}
