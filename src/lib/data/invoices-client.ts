import type { ApiResponse } from "@/types/api";
import type { InvoiceRow } from "@/types/db";
import type { DraftBody } from "@/app/api/invoices/schemas";
import type { CreatedInvoicePayload } from "@/app/api/invoices/route";
import type { IssuedInvoicePayload } from "@/app/api/invoices/[id]/issue/route";
import type { SentInvoicePayload } from "@/app/api/invoices/[id]/send/route";
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

/**
 * Issue a validated draft (Story 12.4). `version` must be the version last read; the
 * server runs the `assertIssuable` compliance gate first and throws an
 * `InvoiceApiError` carrying the specific `Invoice.error.*` code (legalIdentityMissing,
 * taxWithoutRegistration, taxSplit, totalsMismatch, lineItemsRequired) on any block, or
 * `versionConflict` / `notDraft` on a stale / non-draft row. Returns the issued
 * invoice's id, new version, and minted number.
 */
export async function issueInvoice(
  slug: string,
  id: string,
  version: number,
): Promise<IssuedInvoicePayload> {
  const res = await fetch(`/api/invoices/${encodeURIComponent(id)}/issue`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ slug, version }),
  });
  return parseEnvelope<IssuedInvoicePayload>(res);
}

/**
 * Email an issued invoice with the frozen PDF attached (Story 12.6). `to` is the
 * confirmed recipient address; the server validates it, repairs a missing freeze,
 * attaches the PDF, and sends transactionally with reply-to the acting admin. Throws
 * `InvoiceApiError` carrying `recipientInvalid` / `sendFailed` / a shared code on failure.
 */
export async function sendInvoice(
  slug: string,
  id: string,
  input: { to: string },
): Promise<SentInvoicePayload> {
  const res = await fetch(`/api/invoices/${encodeURIComponent(id)}/send`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ slug, to: input.to }),
  });
  return parseEnvelope<SentInvoicePayload>(res);
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
