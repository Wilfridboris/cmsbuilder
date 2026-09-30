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
 * The bucket-relative object key for an org's frozen credit-note PDF (Story 12.8, I8):
 * `{orgId}/credit-notes/{creditNoteId}.pdf`. Reuses the SAME private `invoice-pdfs`
 * bucket under a `credit-notes/` sub-prefix — the bucket RLS keys off `path_tokens[1]`
 * (the org id), which the sub-prefix leaves unchanged, so org isolation holds without a
 * second bucket or duplicate policies.
 */
export function creditNotePdfObjectKey(
  orgId: string,
  creditNoteId: string,
): string {
  return `${orgId}/credit-notes/${creditNoteId}.pdf`;
}

/**
 * Upload a rendered credit-note PDF under the org's `credit-notes/` prefix, returning the
 * persisted `pdf_path`. Mirrors {@link uploadInvoicePdf}: RLS-scoped client only, `upsert`
 * true so the freeze is idempotent (retro [X2]), and a storage failure masked as a generic
 * write failure — raw storage output never leaks.
 */
export async function uploadCreditNotePdf(
  client: SupabaseClient,
  orgId: string,
  creditNoteId: string,
  bytes: Uint8Array,
): Promise<{ pdfPath: string }> {
  const key = creditNotePdfObjectKey(orgId, creditNoteId);

  const { error } = await client.storage
    .from(INVOICE_PDF_BUCKET)
    .upload(key, bytes, {
      contentType: "application/pdf",
      // Idempotent (retro [X2]): the caller (`ensureCreditNotePdf`) only reaches here
      // when `pdf_path` is still null, and the bytes are deterministic from the frozen
      // snapshot, so overwriting the same key with identical content is safe. `upsert:
      // false` would wedge the retry when a prior attempt uploaded the object but failed
      // the `pdf_path` DB write, leaving an issued credit note permanently PDF-less.
      upsert: true,
    });

  if (error) {
    throw new AppError(500, "writeFailed", error.message);
  }

  return { pdfPath: key };
}

/**
 * Upload a rendered invoice PDF under the org's prefix, returning the persisted
 * `pdf_path` (the bucket-relative object key). RLS-scoped client only. `upsert` is
 * true so the freeze is IDEMPOTENT (retro [X2]): the caller — `ensureInvoicePdf` — is
 * itself idempotent and only reaches here when `pdf_path` is still null, and the bytes
 * are deterministic from the frozen snapshot, so overwriting the same key with identical
 * content is safe. `upsert: false` would permanently wedge the retry path when a prior
 * attempt uploaded the object but failed the subsequent `pdf_path` DB write (the object
 * would exist, so every retry died on "already exists" and the invoice stayed PDF-less).
 * A storage failure is masked as a generic write failure — raw storage output never leaks.
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
      upsert: true,
    });

  if (error) {
    throw new AppError(500, "writeFailed", error.message);
  }

  return { pdfPath: key };
}

/**
 * Download a frozen invoice PDF object's bytes from the private `invoice-pdfs`
 * bucket (Story 12.6). The caller supplies the client:
 *   - the SERVICE-ROLE admin client for the public `/i/[token]` proxy (no session);
 *   - the ACTING user's RLS client for the owner's authed email send (NFR-FC1).
 *
 * Returns the raw bytes as a `Uint8Array`, or `null` when there is no key, the
 * object is missing, or the download fails (a caller renders its own 404 / repairs
 * the freeze). Never leaks raw storage output. Mirrors `downloadLogoDataUrl` in
 * `src/lib/storage/logo.ts`.
 */
export async function downloadInvoicePdf(
  client: SupabaseClient,
  pdfPath: string | null,
): Promise<Uint8Array | null> {
  if (!pdfPath) {
    return null;
  }
  try {
    const { data, error } = await client.storage
      .from(INVOICE_PDF_BUCKET)
      .download(pdfPath);
    if (error || !data) {
      return null;
    }
    const bytes = new Uint8Array(await data.arrayBuffer());
    return bytes.byteLength > 0 ? bytes : null;
  } catch {
    return null;
  }
}
