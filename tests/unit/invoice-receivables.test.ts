import { describe, expect, it } from "vitest";

import {
  filterInvoicesByView,
  isInvoiceOverdue,
} from "@/lib/invoicing/receivables";
import type { InvoiceStatus } from "@/types/db";

/**
 * Unit coverage for the read-time receivables derivation (Story 12.7, FR92) — the three
 * Invoices-list matrix rows that live in pure logic rather than the DB path:
 *   - Receivables default: the `unpaid` view shows only issued invoices; `all` shows every
 *     invoice regardless of status.
 *   - Overdue label: an issued invoice past its due date is derived Overdue (its stored
 *     status stays `issued`); the `overdue` view returns only those.
 *   - No due date: an issued invoice with a null due date is Unpaid but never Overdue.
 * `today` is injected so the derivation is deterministic and clock-free.
 */

const TODAY = "2026-09-29";

function inv(status: InvoiceStatus, dueDate: string | null) {
  return { status, due_date: dueDate };
}

describe("isInvoiceOverdue", () => {
  it("is true only for an issued invoice with a due date strictly before today", () => {
    expect(isInvoiceOverdue(inv("issued", "2026-09-28"), TODAY)).toBe(true);
  });

  it("is false when the due date is today or in the future", () => {
    expect(isInvoiceOverdue(inv("issued", TODAY), TODAY)).toBe(false);
    expect(isInvoiceOverdue(inv("issued", "2026-09-30"), TODAY)).toBe(false);
  });

  it("is false for an issued invoice with no due date (Unpaid, never Overdue)", () => {
    expect(isInvoiceOverdue(inv("issued", null), TODAY)).toBe(false);
  });

  it("is false for paid/void/draft invoices even when past a due date", () => {
    expect(isInvoiceOverdue(inv("paid", "2026-01-01"), TODAY)).toBe(false);
    expect(isInvoiceOverdue(inv("void", "2026-01-01"), TODAY)).toBe(false);
    expect(isInvoiceOverdue(inv("draft", "2026-01-01"), TODAY)).toBe(false);
  });
});

describe("filterInvoicesByView", () => {
  const list = [
    inv("draft", null),
    inv("issued", null), // unpaid, no due date
    inv("issued", "2026-09-28"), // unpaid, overdue
    inv("issued", "2026-12-01"), // unpaid, not yet due
    inv("paid", "2026-09-01"),
    inv("void", null),
  ];

  it("unpaid (default) returns every issued invoice and nothing else", () => {
    const result = filterInvoicesByView(list, "unpaid", TODAY);
    expect(result.length).toBe(3);
    expect(result.every((i) => i.status === "issued")).toBe(true);
  });

  it("overdue returns only issued invoices past their due date", () => {
    const result = filterInvoicesByView(list, "overdue", TODAY);
    expect(result).toEqual([inv("issued", "2026-09-28")]);
  });

  it("all returns every invoice regardless of status", () => {
    expect(filterInvoicesByView(list, "all", TODAY).length).toBe(list.length);
  });

  it("an issued invoice with no due date is Unpaid but absent from Overdue", () => {
    const noDue = inv("issued", null);
    expect(filterInvoicesByView([noDue], "unpaid", TODAY)).toEqual([noDue]);
    expect(filterInvoicesByView([noDue], "overdue", TODAY)).toEqual([]);
  });
});
