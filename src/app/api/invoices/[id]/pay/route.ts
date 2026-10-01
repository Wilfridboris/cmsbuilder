import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import {
  json,
  requireUser,
  resolveWritableAdminIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { recordPayment } from "@/lib/data/invoice-mutate";
import { recordPaymentSchema, firstInvoiceErrorKey } from "../../schemas";

/**
 * `POST /api/invoices/[id]/pay` — record a single out-of-band payment against an issued
 * invoice and flip it to `paid` (Story 12.7, Admin-only). Scheza never processes, holds,
 * or moves money — this only RECORDS what the owner received out of band.
 *
 * Reuses the EXACT auth chain of the other invoice routes: `getCurrentUser()` -> 401 ->
 * resolve the org by `slug` UNDER the caller's RLS client (non-member -> 403) ->
 * `requireAdmin` (Member -> 403) -> slug match (cross-org Admin -> 403), ALL before any
 * DB access.
 *
 * The zod-validated body carries the org `slug`, the REQUIRED `version` (optimistic
 * concurrency), the `method` enum, the `paidDate` (`YYYY-MM-DD`), the `amount` (finite
 * positive), and an optional `reference`. `recordPayment` runs under the acting user's RLS
 * client (never service-role, NFR-FC1): it inserts one `invoice_payments` row and updates
 * `status -> paid` in one transaction, mapping already-paid / not-issued / stale-version to
 * specific 409 codes and bad input to 400 — never leaking provider/DB detail.
 */

export const dynamic = "force-dynamic";

/** The POST response: the invoice's id + its new version after the payment. */
export type PaidInvoicePayload = { id: string; version: number };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<PaidInvoicePayload>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }

    const { id } = await params;
    if (!id) {
      throw new AppError(400, "genericError");
    }

    // Auth + authorize BEFORE consuming the body — an unauthenticated / non-admin /
    // cross-org caller is rejected (401/403) before any input work.
    const user = await requireUser();
    const parsed = recordPaymentSchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, firstInvoiceErrorKey(parsed.error));
    }
    const identity = await resolveWritableAdminIdentity(parsed.data.slug, user);

    const result = await recordPayment(identity, {
      invoiceId: id,
      version: parsed.data.version,
      method: parsed.data.method,
      paidDate: parsed.data.paidDate,
      amount: parsed.data.amount,
      reference: parsed.data.reference ?? null,
    });
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    return json<PaidInvoicePayload>(
      { data: { id: result.data.id, version: result.data.version }, error: null },
      200,
    );
  } catch (err) {
    return handleError<PaidInvoicePayload>(err, "/api/invoices/[id]/pay");
  }
}
