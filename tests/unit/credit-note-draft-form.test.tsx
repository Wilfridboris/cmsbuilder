import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

/**
 * Coverage for the Story 12.8 credit-note draft form's PREFILL behaviour, closing the
 * frozen I/O-matrix "Draft prefill" row.
 *
 * The repo test env is `node` (no jsdom), so the client island is exercised through
 * React's server renderer (`renderToStaticMarkup`) — which models the SSR + first client
 * render. In create mode (`creditNoteId === null`) the form initialises its line rows
 * from `prefillLines` in a `useState` initialiser, so those descriptions/quantities are
 * present in the very first render (before any effect). This pins the resolved decision
 * that a credit note opens pre-filled from the source invoice's frozen line items, and
 * that an empty prefill falls back to a single blank row.
 *
 * `next-intl` is mocked to echo keys, `next/navigation` + `framer-motion` + the client
 * data layer are stubbed so the server render stays deterministic.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: new Proxy(
    {},
    {
      get:
        () =>
        ({ children }: { children?: ReactNode }) =>
          children ?? null,
    },
  ),
  useReducedMotion: () => true,
}));
vi.mock("@/lib/data/credit-notes-client", () => ({
  createCreditNote: vi.fn(),
  getCreditNote: vi.fn(),
  updateCreditNote: vi.fn(),
  discardCreditNote: vi.fn(),
  issueCreditNote: vi.fn(),
}));
vi.mock("@/lib/data/invoices-client", () => ({
  InvoiceApiError: class extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

import {
  CreditNoteDraftForm,
  type CreditNotePrefillLine,
} from "@/components/invoices/CreditNoteDraftForm";

function render(prefillLines: CreditNotePrefillLine[]): string {
  return renderToStaticMarkup(
    <CreditNoteDraftForm
      slug="acme"
      invoiceId="inv-1"
      creditNoteId={null}
      originalInvoiceNumber="000042"
      prefillLines={prefillLines}
      defaultProvince="ON"
      defaultLanguage="en"
      taxRegistered={true}
    />,
  );
}

describe("CreditNoteDraftForm (create-mode prefill)", () => {
  it("prefills line rows from the source invoice's frozen line items", () => {
    const html = render([
      { description: "Overcharged call-out", quantity: 2, unitPrice: 100 },
      { description: "Duplicate part", quantity: 1, unitPrice: 45.5 },
    ]);
    // Both prefilled descriptions render as controlled-input values in the first render.
    expect(html).toContain("Overcharged call-out");
    expect(html).toContain("Duplicate part");
    // A prefilled numeric value is present too (the quantity/unit-price inputs).
    expect(html).toContain('value="45.5"');
  });

  it("falls back to a single blank row when there is nothing to prefill", () => {
    const html = render([]);
    expect(html).not.toContain("Overcharged call-out");
    // A blank description input (empty value) is present for manual entry.
    expect(html).toContain('value=""');
  });
});
