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
import { issueCreditNote } from "@/lib/data/credit-note-mutate";
import { issueCreditNoteBodySchema } from "../../../../schemas";

/**
 * `POST /api/invoices/[id]/credit-notes/[cnId]/issue` — issue a validated credit-note
 * draft (Story 12.8, Admin-only). `[id]` is the source invoice; `[cnId]` is the credit note.
 *
 * Reuses the EXACT auth chain of the other invoice routes (401/403 before any DB access).
 * The body carries the org `slug` and the REQUIRED `version` (optimistic concurrency). No
 * `issue_date` is accepted — it is server-authoritative (TODAY). `issueCreditNote` runs the
 * `assertIssuableCreditNote` compliance gate (which throws a 422 `Invoice.error.*` on any
 * failure), then mints the gap-free credit-note number in its own namespace, freezes the
 * snapshots + original invoice number + share token, and flips status to `issued` in one
 * transaction. A stale/non-draft row -> 409. The original invoice is never written (FR88).
 */

export const dynamic = "force-dynamic";

/** The POST response: the issued credit note's identity + its minted number. */
export type IssuedCreditNotePayload = {
  id: string;
  version: number;
  credit_note_number: number;
};

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; cnId: string }> },
): Promise<NextResponse<ApiResponse<IssuedCreditNotePayload>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }

    const { id, cnId } = await params;
    if (!id || !cnId) {
      throw new AppError(400, "genericError");
    }

    // Auth + authorize BEFORE consuming the body.
    const user = await requireUser();
    const parsed = issueCreditNoteBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const identity = await resolveWritableAdminIdentity(parsed.data.slug, user);

    const result = await issueCreditNote(identity, {
      creditNoteId: cnId,
      version: parsed.data.version,
      invoiceId: id,
    });
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    return json<IssuedCreditNotePayload>(
      {
        data: {
          id: result.data.id,
          version: result.data.version,
          credit_note_number: result.data.credit_note_number,
        },
        error: null,
      },
      200,
    );
  } catch (err) {
    return handleError<IssuedCreditNotePayload>(
      err,
      "/api/invoices/[id]/credit-notes/[cnId]/issue",
    );
  }
}
