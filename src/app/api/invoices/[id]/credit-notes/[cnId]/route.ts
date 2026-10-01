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
import { customerRecordBelongsToOrg } from "@/lib/data/invoices";
import {
  getCreditNoteWithLineItems,
  type CreditNoteWithLineItems,
} from "@/lib/data/credit-notes";
import {
  saveCreditNoteDraft,
  discardCreditNoteDraft,
} from "@/lib/data/credit-note-mutate";
import {
  creditNoteDraftBodySchema,
  getQuerySchema,
  firstInvoiceErrorKey,
  toWritableCreditNoteDraft,
} from "../../../schemas";

/**
 * `GET /api/invoices/[id]/credit-notes/[cnId]?slug=` (load a draft + children + customer
 * label), `PUT /api/invoices/[id]/credit-notes/[cnId]` (update the draft, version-gated),
 * and `DELETE /api/invoices/[id]/credit-notes/[cnId]?slug=` (discard the draft) — Story
 * 12.8, Admin-only. `[id]` is the source invoice; `[cnId]` is the credit note.
 *
 * All three reuse the same Admin gate as the other invoice routes (401/403 before any DB
 * access). PUT updates through the guarded mutation layer, gated on `version`; a stale or
 * non-`draft` row -> 409 `versionConflict`. DELETE hard-deletes only a `draft` (else 409
 * `notDraft`). Every failure resolves to a translated KEY via the envelope; raw SQL never
 * leaks. The source invoice id (`[id]`) is preserved through the update (the RPC does not
 * change it).
 */

export const dynamic = "force-dynamic";

export type DiscardCreditNotePayload = { id: string };

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cnId: string }> },
): Promise<NextResponse<ApiResponse<CreditNoteWithLineItems | null>>> {
  try {
    const parsed = getQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug } = parsed.data;

    const { cnId } = await params;
    if (!cnId) {
      throw new AppError(400, "genericError");
    }

    const user = await requireUser();
    const identity = await resolveAdminIdentity(slug, user);

    const result = await getCreditNoteWithLineItems(
      identity.client,
      identity.orgId,
      cnId,
    );
    if (result.error) {
      throw new AppError(500, "loadFailed");
    }
    if (!result.data) {
      throw new AppError(404, "notFound");
    }

    return json<CreditNoteWithLineItems | null>(
      { data: result.data, error: null },
      200,
    );
  } catch (err) {
    return handleError<CreditNoteWithLineItems | null>(
      err,
      "/api/invoices/[id]/credit-notes/[cnId]",
    );
  }
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cnId: string }> },
): Promise<NextResponse<ApiResponse<{ id: string; version: number }>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }

    const { id: invoiceId, cnId } = await params;
    if (!invoiceId || !cnId) {
      throw new AppError(400, "genericError");
    }

    const user = await requireUser();
    const slugParsed = getQuerySchema.safeParse(raw);
    if (!slugParsed.success) {
      throw new AppError(400, "genericError");
    }
    const identity = await resolveWritableAdminIdentity(slugParsed.data.slug, user);

    const parsed = creditNoteDraftBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, firstInvoiceErrorKey(parsed.error));
    }
    const writable = toWritableCreditNoteDraft(parsed.data);

    if (writable.version === null) {
      throw new AppError(409, "versionConflict");
    }

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
      invoiceId,
      creditNoteId: cnId,
      referenceDate,
    });
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    return json<{ id: string; version: number }>(
      { data: { id: result.data.id, version: result.data.version }, error: null },
      200,
    );
  } catch (err) {
    return handleError<{ id: string; version: number }>(
      err,
      "/api/invoices/[id]/credit-notes/[cnId]",
    );
  }
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cnId: string }> },
): Promise<NextResponse<ApiResponse<DiscardCreditNotePayload>>> {
  try {
    const parsed = getQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug } = parsed.data;

    const { cnId } = await params;
    if (!cnId) {
      throw new AppError(400, "genericError");
    }

    const user = await requireUser();
    const identity = await resolveWritableAdminIdentity(slug, user);

    const result = await discardCreditNoteDraft(identity, cnId);
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    return json<DiscardCreditNotePayload>(
      { data: { id: result.data.id }, error: null },
      200,
    );
  } catch (err) {
    return handleError<DiscardCreditNotePayload>(
      err,
      "/api/invoices/[id]/credit-notes/[cnId]",
    );
  }
}
