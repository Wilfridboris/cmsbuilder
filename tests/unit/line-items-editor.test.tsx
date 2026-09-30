import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

/**
 * Structural coverage for the extracted `LineItemsEditor` (retro A3). The repo test
 * env is `node` (no jsdom), so the component is exercised through React's server
 * renderer (`renderToStaticMarkup`) and assertions are on the rendered HTML string —
 * consistent with the credit-note-draft-form test's precedent. Interactive add/remove
 * paths stay manual-review only.
 *
 * This pins the rendered structure the two form shells depend on: N rows render N
 * description inputs, the subtotal/total render, and the visible column headers are
 * present (the accepted additive markup shared by both forms).
 */

import { LineItemsEditor } from "@/components/invoices/LineItemsEditor";
import type { LineItemsEditorLabels } from "@/components/invoices/LineItemsEditor";
import type { LineRow } from "@/components/invoices/use-draft-form";
import { computeInvoiceTotals } from "@/lib/invoicing/tax";

const labels: LineItemsEditorLabels = {
  colDescription: "Description",
  colQuantity: "Quantity",
  colUnitPrice: "Unit price",
  colAmount: "Amount",
  colRemove: "Remove",
  descriptionPlaceholder: "Describe the line",
  removeLine: "Remove line",
  addLine: "Add line",
  subtotalLabel: "Subtotal",
  totalLabel: "Total",
  taxLineLabel: ({ tax, rate }) => `${tax} (${rate}%)`,
  taxName: "HST",
  totalsHint: "Totals hint",
  subtotalHint: "Subtotal hint",
};

function makeRows(n: number): LineRow[] {
  return Array.from({ length: n }, (_, i) => ({
    key: `row-${i}`,
    description: `Line ${i}`,
    quantity: "1",
    unitPrice: "10",
  }));
}

function render(rows: LineRow[]): string {
  const totals = computeInvoiceTotals({
    lineItems: rows.map((r) => ({
      quantity: Number(r.quantity),
      unitPrice: Number(r.unitPrice),
    })),
    province: "ON",
    taxApplies: true,
  });
  return renderToStaticMarkup(
    <LineItemsEditor
      rows={rows}
      totals={totals}
      onAddRow={() => {}}
      onRemoveRow={() => {}}
      onUpdateRow={() => {}}
      labels={labels}
    />,
  );
}

describe("LineItemsEditor", () => {
  it("renders N description inputs for N rows", () => {
    const html = render(makeRows(3));
    // Each row's description renders as a controlled input value.
    expect(html).toContain('value="Line 0"');
    expect(html).toContain('value="Line 1"');
    expect(html).toContain('value="Line 2"');
  });

  it("renders the subtotal and total labels", () => {
    const html = render(makeRows(2));
    expect(html).toContain("Subtotal");
    expect(html).toContain("Total");
  });

  it("renders the visible column headers", () => {
    const html = render(makeRows(1));
    expect(html).toContain("Description");
    expect(html).toContain("Quantity");
    expect(html).toContain("Unit price");
    expect(html).toContain("Amount");
  });

  it("disables the remove control at the last row (min-1 guard), enables it beyond", () => {
    // The min-1-row guard is enforced on the remove button's `disabled` attribute,
    // which renders as the boolean HTML attribute `disabled=""` (not the Tailwind
    // `disabled:` class variants present in the className strings).
    const one = render(makeRows(1));
    // Exactly one remove button, and it is disabled.
    expect((one.match(/disabled=""/g) ?? []).length).toBe(1);

    const two = render(makeRows(2));
    // Two rows -> two remove buttons, neither disabled.
    expect(two).not.toContain('disabled=""');
  });
});
