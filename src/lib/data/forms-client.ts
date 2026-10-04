import type { ApiResponse } from "@/types/api";
import type { FormRow } from "@/types/db";
import type { CreatedFormPayload } from "@/app/api/forms/route";
import type { FormMutateResult } from "@/lib/data/form-mutate";

/**
 * Client-side fetch helpers for the `/api/forms` routes (Epic 14, Story 14.1). Mirrors
 * `invoices-client.ts`: each parses the `{ data, error }` envelope and, on failure,
 * throws a `FormApiError` carrying the server's translated error CODE (a frozen
 * `Forms.error.*` key or a shared code). The UI resolves the code to a translated
 * message — a raw error, stack, or SQL never reaches here.
 */

/** Carries the server error code so the UI can resolve a translated message. */
export class FormApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "FormApiError";
    this.code = code;
  }
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new FormApiError("genericError");
  }
  if (!res.ok || body.error !== null) {
    throw new FormApiError(body.error ?? "genericError");
  }
  return body.data as T;
}

/** List the org's forms (newest first). Throws `FormApiError(code)`. */
export async function listForms(slug: string): Promise<FormRow[]> {
  const res = await fetch(`/api/forms?slug=${encodeURIComponent(slug)}`, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
  return parseEnvelope<FormRow[]>(res);
}

/** Create a new form from a title. Returns the created form's id + slug. */
export async function createForm(
  slug: string,
  title: string,
): Promise<CreatedFormPayload> {
  const res = await fetch("/api/forms", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ slug, title }),
  });
  return parseEnvelope<CreatedFormPayload>(res);
}

/** Rename a form (title only; slug unchanged). Returns the form's id + slug. */
export async function renameForm(
  slug: string,
  formId: string,
  title: string,
): Promise<FormMutateResult> {
  const res = await fetch(`/api/forms/${encodeURIComponent(formId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ slug, title }),
  });
  return parseEnvelope<FormMutateResult>(res);
}

/**
 * Edit a form's slug. The server normalizes it to kebab-case; a value that normalizes to
 * empty throws `FormApiError("Forms.error.slugInvalid")` and a collision throws
 * `FormApiError("Forms.error.slugTaken")`. Returns the form's id + resulting slug.
 */
export async function updateFormSlug(
  slug: string,
  formId: string,
  newSlug: string,
): Promise<FormMutateResult> {
  const res = await fetch(`/api/forms/${encodeURIComponent(formId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ slug, newSlug }),
  });
  return parseEnvelope<FormMutateResult>(res);
}

/**
 * Publish or unpublish a form (Story 14.3). Publishing a form with no valid target table
 * throws `FormApiError("Forms.error.publishBlocked")`; everything else maps as usual.
 * Returns the form's id + slug.
 */
export async function setFormPublished(
  slug: string,
  formId: string,
  published: boolean,
): Promise<FormMutateResult> {
  const res = await fetch(`/api/forms/${encodeURIComponent(formId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ slug, published }),
  });
  return parseEnvelope<FormMutateResult>(res);
}

/** Delete a form. Throws `FormApiError(code)` on failure. */
export async function deleteForm(
  slug: string,
  formId: string,
): Promise<{ id: string }> {
  const res = await fetch(
    `/api/forms/${encodeURIComponent(formId)}?slug=${encodeURIComponent(slug)}`,
    { method: "DELETE", headers: { Accept: "application/json" } },
  );
  return parseEnvelope<{ id: string }>(res);
}

export type { FormRow };
