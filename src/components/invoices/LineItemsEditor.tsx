"use client";

import { useId } from "react";
import { Plus, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { computeLineAmount, type InvoiceTotals } from "@/lib/invoicing/tax";
import { toNumber, type LineRow } from "@/components/invoices/use-draft-form";

/**
 * LineItemsEditor (retro A3) — the shared, controlled line-items table + totals
 * block extracted from `InvoiceDraftForm` and `CreditNoteDraftForm`, which owned
 * two near-identical copies of it.
 *
 * It renders one editable row per line (description / quantity / unit price, a live
 * per-row amount via the canonical `computeLineAmount`, and a remove button gated by
 * the min-1-row guard), an "add line" button, and the totals footer (subtotal, the
 * zero-or-one HST line, and the total) fed by the caller's live `totals`.
 *
 * Per the spec's Open Question decision it uses ONE markup for both forms — the
 * richer invoice layout with visible column headers on `sm+`, per-cell `sr-only`
 * `<Label>`s, and mobile amount hints. The credit-note draft therefore gains those
 * headers/hints (a strictly-additive accessibility improvement). All labels are
 * passed in as strings so the shared component stays free of any i18n namespace.
 */

export type LineItemsEditorLabels = {
  colDescription: string;
  colQuantity: string;
  colUnitPrice: string;
  colAmount: string;
  colRemove: string;
  descriptionPlaceholder: string;
  removeLine: string;
  addLine: string;
  subtotalLabel: string;
  totalLabel: string;
  /** `taxLineLabel({ tax, rate })` — resolves the per-line tax name (e.g. HST (13%)). */
  taxLineLabel: (values: { tax: string; rate: number }) => string;
  /** The translated tax name (e.g. HST) fed into `taxLineLabel`. */
  taxName: string;
  /** Hint shown under the totals when a tax line is present. */
  totalsHint: string;
  /** Hint shown under the totals when there is no tax line. */
  subtotalHint: string;
};

export function LineItemsEditor({
  rows,
  totals,
  onAddRow,
  onRemoveRow,
  onUpdateRow,
  labels,
}: {
  rows: LineRow[];
  totals: InvoiceTotals;
  onAddRow: () => void;
  onRemoveRow: (key: string) => void;
  onUpdateRow: (key: string, patch: Partial<LineRow>) => void;
  labels: LineItemsEditorLabels;
}) {
  // Component-scoped prefix so each cell's <Label htmlFor> associates with its <Input id>
  // (giving every input an accessible name) without colliding across editor instances.
  const fieldPrefix = useId();
  return (
    <>
      <div className="flex flex-col gap-3">
        {/* Column headers (visible on wider screens). */}
        <div className="hidden gap-3 px-1 text-xs font-medium text-muted-foreground sm:grid sm:grid-cols-[1fr_6rem_8rem_6rem_2.5rem]">
          <span>{labels.colDescription}</span>
          <span>{labels.colQuantity}</span>
          <span>{labels.colUnitPrice}</span>
          <span className="text-right">{labels.colAmount}</span>
          <span className="sr-only">{labels.colRemove}</span>
        </div>

        {rows.map((row) => {
          const amount = computeLineAmount(
            toNumber(row.quantity),
            toNumber(row.unitPrice),
          );
          const descriptionId = `${fieldPrefix}-${row.key}-description`;
          const quantityId = `${fieldPrefix}-${row.key}-quantity`;
          const unitPriceId = `${fieldPrefix}-${row.key}-unit-price`;
          return (
            <div
              key={row.key}
              className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[1fr_6rem_8rem_6rem_2.5rem] sm:items-center sm:border-0 sm:p-1"
            >
              <div className="flex flex-col gap-1">
                <Label htmlFor={descriptionId} className="sm:sr-only">
                  {labels.colDescription}
                </Label>
                <Input
                  id={descriptionId}
                  value={row.description}
                  placeholder={labels.descriptionPlaceholder}
                  onChange={(e) =>
                    onUpdateRow(row.key, { description: e.target.value })
                  }
                  className="min-h-12"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={quantityId} className="sm:sr-only">
                  {labels.colQuantity}
                </Label>
                <Input
                  id={quantityId}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={row.quantity}
                  onChange={(e) =>
                    onUpdateRow(row.key, { quantity: e.target.value })
                  }
                  className="min-h-12"
                />
              </div>
              <div className="flex flex-col gap-1">
                <Label htmlFor={unitPriceId} className="sm:sr-only">
                  {labels.colUnitPrice}
                </Label>
                <Input
                  id={unitPriceId}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="any"
                  value={row.unitPrice}
                  onChange={(e) =>
                    onUpdateRow(row.key, { unitPrice: e.target.value })
                  }
                  className="min-h-12"
                />
              </div>
              <div className="flex items-center justify-between gap-2 sm:justify-end">
                <span className="text-xs text-muted-foreground sm:sr-only">
                  {labels.colAmount}
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
                  aria-label={labels.removeLine}
                  disabled={rows.length <= 1}
                  onClick={() => onRemoveRow(row.key)}
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
          onClick={onAddRow}
        >
          <Plus aria-hidden="true" className="size-4" />
          {labels.addLine}
        </Button>

        <div className="flex flex-col items-end gap-2">
          <dl className="flex flex-col gap-1.5 text-right">
            <div className="flex items-center justify-end gap-6">
              <dt className="text-sm font-medium text-muted-foreground">
                {labels.subtotalLabel}
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
                  {labels.taxLineLabel({
                    tax: labels.taxName,
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
                {labels.totalLabel}
              </dt>
              <dd className="min-w-24 text-base font-semibold tabular-nums text-foreground">
                {totals.total.toFixed(2)}
              </dd>
            </div>
          </dl>
          <p className="max-w-xs text-right text-xs text-muted-foreground text-pretty">
            {totals.taxLines.length > 0 ? labels.totalsHint : labels.subtotalHint}
          </p>
        </div>
      </div>
    </>
  );
}
