import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";

/**
 * Server-side invoice-PDF storage helpers (Story 12.5, I5) — freeze a rendered
 * invoice PDF to a PRIVATE Supabase Storage bucket under the owning org's prefix.
 *
 * Mirrors the `business-logos` pattern (`src/lib/storage/logo.ts`): the bucket is
 * private (never a public URL), and every call runs under the ACTING user's
 * RLS-scoped client (`identity.client`) — never the service-role key (NFR-FC1).
 * The `invoice-pdfs` storage.objects RLS policies (see the bucket migration)
 * enforce org isolation via the object folder's first path segment as a DB
 * backstop, so a cross-org read/write is impossible.
 *
 * Object keys are `<organization_id>/<invoice_id>.pdf` so the bucket path's first
 * segment is the org id (matching the bucket migration's `path_tokens[1]`
 * policies). One frozen PDF per issued invoice; the bucket has no lifecycle/expiry
 * rule so the immutable rows plus their PDFs satisfy the six-year retention (FR89).
 */

/** The private bucket introduced by this story for frozen invoice PDFs. */
export const INVOICE_PDF_BUCKET = "invoice-pdfs";

/** The bucket-relative object key for an org's frozen invoice PDF (I5). */
export function invoicePdfObjectKey(orgId: string, invoiceId: string): string {
  return `${orgId}/${invoiceId}.pdf`;
}

/**
 * Upload a rendered invoice PDF under the org's prefix, returning the persisted
 * `pdf_path` (the bucket-relative object key). RLS-scoped client only. `upsert` is
 * false: an invoice's PDF is frozen exactly once (the caller — `ensureInvoicePdf` —
 * is idempotent and only reaches here when `pdf_path` is still null), so a second
 * write to an existing object is a genuine error rather than a silent overwrite of
 * the immutable artifact. A storage failure is masked as a generic write failure —
 * raw storage output never leaks.
 */
export async function uploadInvoicePdf(
  client: SupabaseClient,
  orgId: string,
  invoiceId: string,
  bytes: Uint8Array,
): Promise<{ pdfPath: string }> {
  const key = invoicePdfObjectKey(orgId, invoiceId);

  const { error } = await client.storage
    .from(INVOICE_PDF_BUCKET)
    .upload(key, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });

  if (error) {
    throw new AppError(500, "writeFailed", error.message);
  }

  return { pdfPath: key };
}
