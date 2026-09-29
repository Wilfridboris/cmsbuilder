import type { ApiResponse } from "@/types/api";
import type { BusinessProfileRow } from "@/types/db";
import type { PutBody } from "@/app/api/business-profile/schemas";
import type { BusinessProfilePayload } from "@/app/api/business-profile/route";
import type { LogoUploadPayload } from "@/app/api/business-profile/logo/route";

/**
 * Client-side fetch helpers for the Business Profile routes (Story 12.1). Mirrors
 * `import-client.ts` / `records-client.ts`: each parses the `{ data, error }`
 * envelope and, on failure, throws a `BusinessProfileApiError` carrying the
 * server's translated error CODE (a frozen `BusinessProfile.error.*` key or a
 * shared code). The UI resolves the code to a translated message — a raw error,
 * stack, or SQL never reaches here.
 */

/** Carries the server error code so the UI can resolve a translated message. */
export class BusinessProfileApiError extends Error {
  readonly code: string;
  constructor(code: string) {
    super(code);
    this.name = "BusinessProfileApiError";
    this.code = code;
  }
}

async function parseEnvelope<T>(res: Response): Promise<T> {
  let body: ApiResponse<T>;
  try {
    body = (await res.json()) as ApiResponse<T>;
  } catch {
    throw new BusinessProfileApiError("genericError");
  }
  if (!res.ok || body.error !== null) {
    throw new BusinessProfileApiError(body.error ?? "genericError");
  }
  return body.data as T;
}

/**
 * Load the org's Business Profile. Returns `null` when none is saved yet (the
 * empty-form case), or the profile + a private signed logo URL. Throws
 * `BusinessProfileApiError(code)` on any failure.
 */
export async function getBusinessProfile(
  slug: string,
): Promise<BusinessProfilePayload | null> {
  const res = await fetch(
    `/api/business-profile?slug=${encodeURIComponent(slug)}`,
    { method: "GET", headers: { Accept: "application/json" } },
  );
  return parseEnvelope<BusinessProfilePayload | null>(res);
}

/** The editable Business Profile fields the form submits (minus `slug`). */
export type BusinessProfileInput = Omit<PutBody, "slug">;

/**
 * Save (upsert) the org's Business Profile. Returns the persisted profile + a fresh
 * signed logo URL. Throws `BusinessProfileApiError(code)` on any failure —
 * including `legalNameRequired` / `registrationPairRequired`.
 */
export async function saveBusinessProfile(
  slug: string,
  input: BusinessProfileInput,
): Promise<BusinessProfilePayload> {
  const res = await fetch("/api/business-profile", {
    method: "PUT",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ slug, ...input }),
  });
  return parseEnvelope<BusinessProfilePayload>(res);
}

/**
 * Upload a logo image for the org. Validated + stored privately server-side; a bad
 * type/size throws `BusinessProfileApiError("BusinessProfile.error.logoInvalid")`.
 * Returns the persisted `logoPath` + a fresh signed URL for preview.
 */
export async function uploadBusinessProfileLogo(
  slug: string,
  file: File,
): Promise<LogoUploadPayload> {
  const form = new FormData();
  form.set("slug", slug);
  form.set("file", file);
  const res = await fetch("/api/business-profile/logo", {
    method: "POST",
    headers: { Accept: "application/json" },
    body: form,
  });
  return parseEnvelope<LogoUploadPayload>(res);
}

export type { BusinessProfileRow };
