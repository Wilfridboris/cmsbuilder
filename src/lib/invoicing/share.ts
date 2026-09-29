/**
 * Build the public `/i/[token]` invoice-share URL from an origin + share token
 * (Story 12.6). One pure helper so the delivery bar's Copy Link / Download / Web
 * Share and the email body all produce the exact same link, and so the "clipboard =
 * {origin}/i/{token}" contract is unit-testable without a DOM.
 */
export function invoiceShareUrl(origin: string, token: string): string {
  return new URL(`/i/${token}`, origin).toString();
}
