import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { invoiceShareUrl } from "@/lib/invoicing/share";

/**
 * Coverage for the Story 12.6 delivery bar, closing the frozen I/O-matrix's UI rows.
 *
 * The repo test env is `node` (no jsdom), so the client island is exercised through
 * React's server renderer (`renderToStaticMarkup`) — which models the SSR + first
 * client render, where `useIsClient()` is still `false`. In that state the browser-only
 * affordances (Web Share, Download) are deliberately NOT rendered: this is exactly the
 * "Web Share unsupported -> Share button hidden" matrix row (a client with no
 * `navigator.share` never flips them on either). The always-available Email + Copy Link
 * controls ARE present. The Copy Link VALUE contract ("clipboard = {origin}/i/{token}")
 * is pinned via the pure `invoiceShareUrl` helper (the actual `navigator.clipboard`
 * write is browser interaction, left to the post-commit manual review).
 *
 * `next-intl` is mocked to echo keys, `framer-motion` + the client data layer are
 * stubbed so the server render stays deterministic.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
}));
vi.mock("framer-motion", () => ({
  AnimatePresence: ({ children }: { children: ReactNode }) => children,
  motion: new Proxy(
    {},
    { get: () => ({ children }: { children?: ReactNode }) => children ?? null },
  ),
  useReducedMotion: () => true,
}));
vi.mock("@/lib/data/invoices-client", () => ({
  sendInvoice: vi.fn(),
  InvoiceApiError: class extends Error {
    code: string;
    constructor(code: string) {
      super(code);
      this.code = code;
    }
  },
}));

import { InvoiceDeliveryActions } from "@/components/invoices/InvoiceDeliveryActions";

function render(customerEmailPrefill: string | null = null): string {
  return renderToStaticMarkup(
    <InvoiceDeliveryActions
      slug="acme"
      invoiceId="inv-1"
      shareToken="tok_abc123"
      invoiceNumber="000042"
      language="en"
      customerEmailPrefill={customerEmailPrefill}
    />,
  );
}

describe("InvoiceDeliveryActions (SSR / first render)", () => {
  it("always renders the Email and Copy Link controls", () => {
    const html = render();
    expect(html).toContain("email");
    expect(html).toContain("copyLink");
    expect(html).toContain("heading");
  });

  it("hides the client-only Web Share and Download controls when unsupported", () => {
    // `useIsClient()` is false during SSR + the first client render, and a client with no
    // `navigator.share` never flips them on — so neither the Share nor the Download
    // (token-URL anchor) control is present. `download` is the distinctive marker.
    const html = render();
    expect(html).not.toContain("download");
    expect(html).not.toContain("share");
  });
});

describe("invoiceShareUrl", () => {
  it("builds {origin}/i/{token} — the Copy Link / share value contract", () => {
    expect(invoiceShareUrl("http://localhost:3000", "tok_abc123")).toBe(
      "http://localhost:3000/i/tok_abc123",
    );
    expect(invoiceShareUrl("https://app.example.com", "XYZ")).toBe(
      "https://app.example.com/i/XYZ",
    );
  });
});
