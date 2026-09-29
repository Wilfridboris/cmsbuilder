import type { ApiResponse } from "@/types/api";
import type { InvoiceRow } from "@/types/db";
import type { DraftBody } from "@/app/api/invoices/schemas";
import type { CreatedInvoicePayload } from "@/app/api/invoices/route";
import type { InvoiceWithLineItems } from "@/lib/data/invoices";

/**
 * Client-side fetch helpers for the `/api/invoices` routes (Story 12.2). Mirrors
 * `business-profile-client.ts`: each parses the `{ data, error }` envelope and, on
 * failure, throws an `InvoiceApiError` carrying the server's translated error CODE
 * (a frozen `Invoice.error.*` key or a shared code). The UI resolves the code to a
 * translated message — a raw error, stack, or SQL never reaches here.
 */

/** Carries the server error code so the UI can resolve a translated message. */
export class InvoiceApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "InvoiceApiError";
    this.code = code;
  }
}

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

/** The editable draft fields the form submits (minus the org `slug`). */
export type InvoiceDraftInput = Omit<DraftBody, "slug">;

/** List the org's invoices (newest first). Throws `InvoiceApiError(code)`. */
export async function listInvoices(slug: string): Promise<InvoiceRow[]> {
  const res = await fetch(`/api/invoices?slug=${encodeURIComponent(slug)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return parseEnvelope<InvoiceRow[]>(res);
}

/** Load one invoice with its line items + resolved customer label. */
export async function getInvoice(
  slug: string,
  id: string,
): Promise<InvoiceWithLineItems> {
  const res = await fetch(
    `/api/invoices/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  return parseEnvelope<InvoiceWithLineItems>(res);
}

/** Create a new draft. Returns the created invoice's id + version. */
export async function createInvoice(
  slug: string,
  input: InvoiceDraftInput,
): Promise<CreatedInvoicePayload> {
  const res = await fetch("/api/invoices", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ slug, ...input }),
  });
  return parseEnvelope<CreatedInvoicePayload>(res);
}

/**
 * Update an existing draft (version-gated). `input.version` must be the version
 * last read; a stale or non-draft row throws `InvoiceApiError("versionConflict")`.
 */
export async function updateInvoice(
  slug: string,
  id: string,
  input: InvoiceDraftInput,
): Promise<CreatedInvoicePayload> {
  const res = await fetch(`/api/invoices/${encodeURIComponent(id)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ slug, ...input }),
  });
  return parseEnvelope<CreatedInvoicePayload>(res);
}

/** Discard (hard-delete) a draft. A non-draft throws `InvoiceApiError("notDraft")`. */
export async function discardInvoice(
  slug: string,
  id: string,
): Promise<{ id: string }> {
  const res = await fetch(
    `/api/invoices/${encodeURIComponent(id)}?slug=${encodeURIComponent(slug)}`,
    { method: "DELETE", headers: { Accept: "application/json" } },
  );
  return parseEnvelope<{ id: string }>(res);
}

export type { InvoiceRow, InvoiceWithLineItems };
