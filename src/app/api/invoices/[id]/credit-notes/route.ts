import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import {
  json,
  requireUser,
  resolveAdminIdentity,
  resolveWritableAdminIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import {
  getInvoiceWithLineItems,
  customerRecordBelongsToOrg,
} from "@/lib/data/invoices";
import {
  listCreditNotesForInvoice,
  type CreditNoteSummary,
} from "@/lib/data/credit-notes";
import { saveCreditNoteDraft } from "@/lib/data/credit-note-mutate";
import {
  creditNoteDraftBodySchema,
  listQuerySchema,
  getQuerySchema,
  firstInvoiceErrorKey,
  toWritableCreditNoteDraft,
} from "../../schemas";

/**
 * `GET /api/invoices/[id]/credit-notes?slug=` (list a source invoice's credit notes) and
 * `POST /api/invoices/[id]/credit-notes` (create a credit-note draft) — Story 12.8,
 * Admin-only. `[id]` is the SOURCE invoice id.
 *
 * Both reuse the EXACT auth chain of the other invoice routes: `getCurrentUser()` -> 401 ->
 * resolve the org by `slug` UNDER the caller's RLS client (non-member -> 403) ->
 * `requireAdmin` (Member -> 403) -> slug match (cross-org Admin -> 403), ALL before any DB
 * access.
 *
 * POST creates a `status='draft'` credit note linked to the source invoice. The draft is
 * PREFILLED from the source invoice's frozen line items when the client sends none (the
 * common "re-state the invoice with one figure fixed" correction); the owner then trims/
 * edits before issuing. The source invoice must be creditable (issued/paid/overdue) — a
 * draft or void source is rejected `notIssued` (409). Any linked customer record is verified
 * to belong to the org before the write. Every failure resolves to a translated KEY via the
 * `{ data, error }` envelope; raw SQL never leaks.
 */

export const dynamic = "force-dynamic";

/** The POST response: the created credit-note draft's identity (id + version). */
export type CreatedCreditNotePayload = { id: string; version: number };

/** Source invoice statuses that may be credited (a correction is valid regardless of payment). */
const CREDITABLE_STATUSES = new Set(["issued", "paid", "overdue"]);

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<CreditNoteSummary[]>>> {
  try {
    const parsed = listQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug } = parsed.data;

    const { id } = await params;
    if (!id) {
      throw new AppError(400, "genericError");
    }

    const user = await requireUser();
    const identity = await resolveAdminIdentity(slug, user);

    const result = await listCreditNotesForInvoice(
      identity.client,
      identity.orgId,
      id,
    );
    if (result.error) {
      throw new AppError(500, "loadFailed");
    }

    return json<CreditNoteSummary[]>(
      { data: result.data ?? [], error: null },
      200,
    );
  } catch (err) {
    return handleError<CreditNoteSummary[]>(
      err,
      "/api/invoices/[id]/credit-notes",
    );
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<CreatedCreditNotePayload>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }

    const { id: invoiceId } = await params;
    if (!invoiceId) {
      throw new AppError(400, "genericError");
    }

    // Auth + authorize BEFORE validating the full body (slug from the body).
    const user = await requireUser();
    const slugParsed = getQuerySchema.safeParse(raw);
    if (!slugParsed.success) {
      throw new AppError(400, "genericError");
    }
    const identity = await resolveWritableAdminIdentity(slugParsed.data.slug, user);

    // Load the source invoice under RLS. It must exist and be creditable (a correction is
    // valid regardless of payment; a draft/void source cannot be credited).
    const source = await getInvoiceWithLineItems(
      identity.client,
      identity.orgId,
      invoiceId,
    );
    if (source.error) {
      throw new AppError(500, "loadFailed");
    }
    if (!source.data) {
      throw new AppError(404, "notFound");
    }
    if (!CREDITABLE_STATUSES.has(source.data.invoice.status)) {
      throw new AppError(409, "notIssued");
    }

    const parsed = creditNoteDraftBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, firstInvoiceErrorKey(parsed.error));
    }
    const writable = toWritableCreditNoteDraft(parsed.data);

    if (writable.customerRecordId) {
      const ok = await customerRecordBelongsToOrg(
        identity.client,
        identity.orgId,
        writable.customerRecordId,
      );
      if (!ok) {
        throw new AppError(400, "Invoice.error.customerRecordInvalid");
      }
    }

    const referenceDate = new Date().toISOString().slice(0, 10);

    const result = await saveCreditNoteDraft(identity, {
      ...writable,
      // Inherit the source invoice's linked customer when the body supplies none, so a
      // credit note correcting a customer invoice carries that customer into its frozen
      // snapshot + PDF (the "re-state the invoice" intent). The source is RLS-loaded above,
      // so its customer record already belongs to this org.
      customerRecordId:
        writable.customerRecordId ?? source.data.invoice.customer_record_id,
      invoiceId,
      creditNoteId: null,
      referenceDate,
    });
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    return json<CreatedCreditNotePayload>(
      { data: { id: result.data.id, version: result.data.version }, error: null },
      200,
    );
  } catch (err) {
    return handleError<CreatedCreditNotePayload>(
      err,
      "/api/invoices/[id]/credit-notes",
    );
  }
}
