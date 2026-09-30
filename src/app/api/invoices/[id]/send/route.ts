import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import {
  json,
  requireUser,
  resolveAdminIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { getInvoiceWithLineItems } from "@/lib/data/invoices";
import { ensureInvoicePdf } from "@/lib/data/invoice-mutate";
import { downloadInvoicePdf } from "@/lib/invoicing/storage";
import { formatInvoiceNumber } from "@/lib/invoicing/tax";
import { invoiceShareUrl } from "@/lib/invoicing/share";
import { sendInvoiceEmail } from "@/lib/resend/send";
import { sendBodySchema } from "../../schemas";

/**
 * `POST /api/invoices/[id]/send` — email an issued invoice with the frozen PDF attached
 * (Story 12.6, Admin-only, CASL transactional).
 *
 * Reuses the EXACT auth chain of the other invoice routes: `getCurrentUser()` -> 401 ->
 * resolve the org by `slug` UNDER the caller's RLS client (non-member -> 403) ->
 * `requireAdmin` (Member -> 403) -> slug match (cross-org Admin -> 403), ALL before any
 * DB access.
 *
 * The body carries the org `slug` and the confirmed `to` recipient (validated as an
 * email). The invoice is loaded under the acting user's RLS client (never service-role,
 * NFR-FC1); a non-issued invoice is rejected; a missing freeze is repaired via
 * `ensureInvoicePdf` before the PDF is downloaded and attached. The email is sent with
 * `reply-to` = the acting admin's own login email, in the invoice's FROZEN language. A
 * provider failure surfaces as a non-leaking `502 sendFailed`.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** The POST response: the id of the invoice that was emailed (no delivery record is kept). */
export type SentInvoicePayload = { id: string };

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
): Promise<NextResponse<ApiResponse<SentInvoicePayload>>> {
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
    const parsed = sendBodySchema.safeParse(raw);
    if (!parsed.success) {
      // The recipient email is the only meaningful failure surface here.
      const message = parsed.error.issues[0]?.message ?? "";
      throw new AppError(
        400,
        message.startsWith("Invoice.error.") ? message : "genericError",
      );
    }
    const identity = await resolveAdminIdentity(parsed.data.slug, user);

    // Reply-to = the acting admin's OWN login email (the only correct "owner's address";
    // `business_profiles` has no separate contact-email field). Without one we cannot set
    // the transactional reply-to, so fail loudly rather than send an unreplyable email.
    const replyTo = user.email;
    if (!replyTo) {
      throw new AppError(500, "genericError");
    }

    // Load the invoice under the acting user's RLS client (NEVER service-role).
    const loaded = await getInvoiceWithLineItems(
      identity.client,
      identity.orgId,
      id,
    );
    if (loaded.error) {
      throw new AppError(500, "loadFailed");
    }
    if (!loaded.data) {
      throw new AppError(404, "notFound");
    }
    const { invoice } = loaded.data;

    // Only an issued/paid/overdue invoice can be delivered; a draft/void is rejected.
    if (
      invoice.status !== "issued" &&
      invoice.status !== "paid" &&
      invoice.status !== "overdue"
    ) {
      throw new AppError(409, "notDraft");
    }

    // Repair a missing freeze before send (`ensureInvoicePdf` is idempotent + never
    // throws). Re-read to pick up the freshly-written `pdf_path`.
    let pdfPath = invoice.pdf_path;
    if (!pdfPath) {
      await ensureInvoicePdf(identity, id);
      const reloaded = await getInvoiceWithLineItems(
        identity.client,
        identity.orgId,
        id,
      );
      pdfPath = reloaded.data?.invoice.pdf_path ?? null;
      if (!pdfPath) {
        // The freeze could not be repaired — nothing to attach.
        throw new AppError(500, "writeFailed");
      }
    }

    // Download the frozen bytes under the acting user's RLS client (NFR-FC1).
    const pdfBytes = await downloadInvoicePdf(identity.client, pdfPath);
    if (!pdfBytes) {
      throw new AppError(500, "writeFailed");
    }

    const number = formatInvoiceNumber(
      invoice.invoice_number === null
        ? null
        : Number(invoice.invoice_number),
    );
    const link = invoiceShareUrl(req.nextUrl.origin, invoice.share_token ?? "");

    await sendInvoiceEmail({
      to: parsed.data.to,
      replyTo,
      language: invoice.language === "fr" ? "fr" : "en",
      invoiceNumber: number,
      pdfBytes,
      link,
    });

    return json<SentInvoicePayload>({ data: { id }, error: null }, 200);
  } catch (err) {
    return handleError<SentInvoicePayload>(err, "/api/invoices/[id]/send");
  }
}
