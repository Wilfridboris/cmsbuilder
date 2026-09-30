import "server-only";

import type { NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getInvoiceByShareToken } from "@/lib/data/invoices";
import { getCreditNoteByShareToken } from "@/lib/data/credit-notes";
import { downloadInvoicePdf } from "@/lib/invoicing/storage";
import { formatInvoiceNumber } from "@/lib/invoicing/tax";
import { reportError } from "@/lib/observability/report";

/**
 * `GET /i/[token]` — the PUBLIC invoice-PDF proxy (Story 12.6, I4/I5).
 *
 * The product's second (and last) unauthenticated surface, deliberately narrow: it
 * matches an invoice by its exact 128-bit `share_token` via the SERVICE-ROLE client
 * (there is no session on a customer's device, so there is no `auth.uid()` for RLS),
 * reads the FROZEN PDF object at `pdf_path` from the private `invoice-pdfs` bucket,
 * and STREAMS the bytes as `application/pdf`. It NEVER redirects to a signed storage
 * URL (so revocation-on-void and non-enumerability are enforced at request time) and
 * exposes ONLY the PDF bytes — no other invoice field is ever returned.
 *
 * Status gating (I4):
 *   - unknown/empty token, or a matched invoice whose `pdf_path` is null -> 404;
 *   - a `void` invoice -> 410 Gone (the frozen PDF is no longer reachable);
 *   - only `issued`/`paid`/`overdue` stream the PDF.
 *
 * Public via `PUBLIC_TOP_LEVEL` (see `src/middleware.ts`): `/i/*` is not matcher-
 * excluded, so without that entry it would be treated as a protected tenant slug and
 * bounced to `/login`. The response is `Cache-Control: private, no-store` so a shared
 * proxy never caches a document that a later void must stop serving.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Statuses whose frozen PDF may still be served. A `draft` has no token; `void` is 410. */
const SERVABLE = new Set(["issued", "paid", "overdue"]);

/** A bare, data-free 404 (unknown token or not-yet-frozen document). */
function notFound(): Response {
  return new Response("Not found", {
    status: 404,
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      // Match the success path's cache policy so an intermediary never caches a
      // transient 404 (e.g. a not-yet-frozen document) past the freeze landing.
      "Cache-Control": "private, no-store",
    },
  });
}

/**
 * Stream a matched document's (invoice OR credit note) frozen PDF, applying the shared
 * status gating (I4/I5): a `void` document is 410 Gone; a non-servable status or a null
 * `pdf_path` (not yet frozen) is 404; only `issued`/`paid`/`overdue` stream the bytes. The
 * bytes are read server-side under the SERVICE-ROLE client (never a redirect to storage),
 * and only the PDF is exposed. `SERVABLE` covers both document types (a credit note is only
 * ever draft/issued/void, so `paid`/`overdue` never apply to it).
 */
async function streamDocument(
  admin: ReturnType<typeof createAdminClient>,
  status: string,
  pdfPath: string | null,
  filename: string,
): Promise<Response> {
  // A voided document's PDF is intentionally no longer reachable (I4).
  if (status === "void") {
    return new Response("Gone", {
      status: 410,
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "private, no-store",
      },
    });
  }

  // Not-yet-frozen (pdf_path null) or a non-servable status -> 404 (retryable once the
  // owner re-triggers the freeze).
  if (!SERVABLE.has(status) || !pdfPath) {
    return notFound();
  }

  // Read the frozen bytes server-side. A missing/failed object degrades to 404.
  const bytes = await downloadInvoicePdf(admin, pdfPath);
  if (!bytes) {
    return notFound();
  }

  // Copy into a fresh ArrayBuffer-backed view so the Blob part is well-typed (the storage
  // bytes may be typed as ArrayBufferLike). The copy is a single PDF, small.
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return new Response(new Blob([buffer], { type: "application/pdf" }), {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${filename}"`,
      "Content-Length": String(bytes.byteLength),
      "Cache-Control": "private, no-store",
    },
  });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> },
): Promise<Response> {
  try {
    const { token } = await params;
    if (!token) {
      return notFound();
    }

    const admin = createAdminClient();
    const invoice = await getInvoiceByShareToken(admin, token);

    if (invoice) {
      const number = formatInvoiceNumber(
        invoice.invoice_number === null ? null : Number(invoice.invoice_number),
      );
      return streamDocument(
        admin,
        invoice.status,
        invoice.pdf_path,
        `invoice-${number}.pdf`,
      );
    }

    // No invoice matched the token — try a credit note (Story 12.8). Credit notes share the
    // public proxy: the same non-enumerable token space, the same frozen-PDF stream.
    const creditNote = await getCreditNoteByShareToken(admin, token);
    if (creditNote) {
      const number = formatInvoiceNumber(
        creditNote.credit_note_number === null
          ? null
          : Number(creditNote.credit_note_number),
      );
      return streamDocument(
        admin,
        creditNote.status,
        creditNote.pdf_path,
        `credit-note-${number}.pdf`,
      );
    }

    // Unknown token (neither an invoice nor a credit note) -> a plain 404, no data.
    return notFound();
  } catch (err) {
    // Never leak provider/DB output to the public surface. Report and return a bare 404
    // (an unexpected failure is indistinguishable from an unknown token to the caller).
    reportError(err, { route: "/i/[token]" });
    return notFound();
  }
}
