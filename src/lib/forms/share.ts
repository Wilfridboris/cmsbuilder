/**
 * Build the public multi-form URL from an origin + org slug + form slug (Epic 14,
 * Story 14.3). One pure helper so the share surface's Copy Link / QR / Preview / Send
 * all produce the exact same absolute link, and so the
 * "{origin}/forms/{orgSlug}/{formSlug}" contract is unit-testable without a DOM.
 *
 * Each path segment is percent-encoded independently so a slug with reserved
 * characters never corrupts the path shape — mirrors the per-segment `encodeURIComponent`
 * the public keyed page uses when it builds its submit path. Mirrors
 * `src/lib/invoicing/share.ts` `invoiceShareUrl`.
 */
export function publicFormUrl(
  origin: string,
  orgSlug: string,
  formSlug: string,
): string {
  const path = `/forms/${encodeURIComponent(orgSlug)}/${encodeURIComponent(
    formSlug,
  )}`;
  return new URL(path, origin).toString();
}
