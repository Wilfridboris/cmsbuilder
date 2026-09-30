import type { ApiResponse } from "@/types/api";
import type { CreditNoteDraftBody } from "@/app/api/invoices/schemas";
import type { CreatedCreditNotePayload } from "@/app/api/invoices/[id]/credit-notes/route";
import type { IssuedCreditNotePayload } from "@/app/api/invoices/[id]/credit-notes/[cnId]/issue/route";
import type {
  CreditNoteSummary,
  CreditNoteWithLineItems,
} from "@/lib/data/credit-notes";
import { InvoiceApiError } from "@/lib/data/invoices-client";

/**
 * Client-side fetch helpers for the `/api/invoices/[id]/credit-notes` routes (Story 12.8).
 * Mirrors `invoices-client.ts`: each parses the `{ data, error }` envelope and, on failure,
 * throws an `InvoiceApiError` carrying the server's translated error CODE (reused from the
 * invoice client so the UI's `resolveError` prefix-strip pattern works unchanged). A raw
 * error, stack, or SQL never reaches here.
 */

async function parseEnvelope<T>(res: Response): Promise<T> {
  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new InvoiceApiError("genericError");
  }
  if (!res.ok || body.error !== null) {
    throw new InvoiceApiError(body.error ?? "genericError");
  }
  return body.data as T;
}

/** The editable credit-note draft fields the form submits (minus the org `slug`). */
export type CreditNoteDraftInput = Omit<CreditNoteDraftBody, "slug">;

/** List a source invoice's linked credit notes (newest first). */
export async function listCreditNotesForInvoice(
  slug: string,
  invoiceId: string,
): Promise<CreditNoteSummary[]> {
  const res = await fetch(
    `/api/invoices/${encodeURIComponent(invoiceId)}/credit-notes?slug=${encodeURIComponent(slug)}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  return parseEnvelope<CreditNoteSummary[]>(res);
}

/** Load one credit note with its line items + resolved customer label. */
export async function getCreditNote(
  slug: string,
  invoiceId: string,
  cnId: string,
): Promise<CreditNoteWithLineItems> {
  const res = await fetch(
    `/api/invoices/${encodeURIComponent(invoiceId)}/credit-notes/${encodeURIComponent(cnId)}?slug=${encodeURIComponent(slug)}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  return parseEnvelope<CreditNoteWithLineItems>(res);
}

/** Create a new credit-note draft linked to the source invoice. */
export async function createCreditNote(
  slug: string,
  invoiceId: string,
  input: CreditNoteDraftInput,
): Promise<CreatedCreditNotePayload> {
  const res = await fetch(
    `/api/invoices/${encodeURIComponent(invoiceId)}/credit-notes`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ slug, ...input }),
    },
  );
  return parseEnvelope<CreatedCreditNotePayload>(res);
}

/** Update an existing credit-note draft (version-gated). */
export async function updateCreditNote(
  slug: string,
  invoiceId: string,
  cnId: string,
  input: CreditNoteDraftInput,
): Promise<CreatedCreditNotePayload> {
  const res = await fetch(
    `/api/invoices/${encodeURIComponent(invoiceId)}/credit-notes/${encodeURIComponent(cnId)}`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ slug, ...input }),
    },
  );
  return parseEnvelope<CreatedCreditNotePayload>(res);
}

/**
 * Issue a validated credit-note draft (Story 12.8). `version` must be the version last read;
 * the server runs `assertIssuableCreditNote` first and throws an `InvoiceApiError` carrying
 * the specific `Invoice.error.*` code on any block, or `versionConflict` / `notDraft`.
 */
export async function issueCreditNote(
  slug: string,
  invoiceId: string,
  cnId: string,
  version: number,
): Promise<IssuedCreditNotePayload> {
  const res = await fetch(
    `/api/invoices/${encodeURIComponent(invoiceId)}/credit-notes/${encodeURIComponent(cnId)}/issue`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ slug, version }),
    },
  );
  return parseEnvelope<IssuedCreditNotePayload>(res);
}

/** Discard (hard-delete) a credit-note draft. A non-draft throws `InvoiceApiError("notDraft")`. */
export async function discardCreditNote(
  slug: string,
  invoiceId: string,
  cnId: string,
): Promise<{ id: string }> {
  const res = await fetch(
    `/api/invoices/${encodeURIComponent(invoiceId)}/credit-notes/${encodeURIComponent(cnId)}?slug=${encodeURIComponent(slug)}`,
    { method: "DELETE", headers: { Accept: "application/json" } },
  );
  return parseEnvelope<{ id: string }>(res);
}

export type { CreditNoteSummary, CreditNoteWithLineItems };
