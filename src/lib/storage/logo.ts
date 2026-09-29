import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";

/**
 * Server-side logo storage helpers (Story 12.1) — validate an uploaded image and
 * persist it PRIVATELY under the owning org's prefix, plus mint a short-lived
 * signed URL to read it back for display.
 *
 * Storage is introduced by this story (reused by 12.5). The bucket is private:
 * an object is never served from a public URL. Every call runs under the caller's
 * RLS-scoped client (never the service-role key) so the `business-logos`
 * storage.objects policies enforce org isolation as a DB backstop.
 *
 * Object keys are `<organization_id>/logo.<ext>` so the bucket path's first
 * segment is the org id (see the bucket migration's path_tokens[1] policies) and
 * a re-upload replaces the single logo per org (upsert) rather than accumulating.
 */

/** The private bucket introduced by this story (and reused by 12.5). */
export const LOGO_BUCKET = "business-logos";

/** Max logo size: 2 MB, enforced server-side before any store. */
export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

/** Accepted image content types (PNG/JPEG only — no SVG). */
export const ACCEPTED_LOGO_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
};

/**
 * Signed-URL lifetime for a private logo read. Short-lived: the URL is minted per
 * request when the profile is loaded, so it never lingers as a durable public link.
 */
export const LOGO_SIGNED_URL_TTL_SECONDS = 60 * 5; // 5 minutes

/**
 * Validate an uploaded logo `File` strictly server-side (client-declared type is
 * never trusted alone — we key off the File's own MIME type, which the platform
 * derives from the multipart part). Rejects a wrong content type (including SVG)
 * or an over-size file with the frozen `BusinessProfile.error.logoInvalid` KEY.
 * Returns the resolved file extension for the storage key.
 */
export function validateLogo(file: File): { extension: string } {
  const extension = ACCEPTED_LOGO_TYPES[file.type];
  if (!extension) {
    // Wrong type (incl. SVG) → 400 logoInvalid, before any store.
    throw new AppError(400, "BusinessProfile.error.logoInvalid");
  }
  if (file.size <= 0) {
    throw new AppError(400, "BusinessProfile.error.logoInvalid");
  }
  if (file.size > MAX_LOGO_BYTES) {
    // Over the size bound → 413 logoInvalid.
    throw new AppError(413, "BusinessProfile.error.logoInvalid");
  }
  return { extension };
}

/** The bucket-relative object key for an org's single logo. */
export function logoObjectKey(orgId: string, extension: string): string {
  return `${orgId}/logo.${extension}`;
}

/**
 * Validate and upload a logo under the org's prefix, returning the persisted
 * `logo_path` (the bucket-relative object key). Upserts so a re-upload replaces
 * the existing logo. RLS-scoped client only. A storage failure is masked as a
 * generic write failure — raw storage output never leaks.
 */
export async function uploadLogo(
  client: SupabaseClient,
  orgId: string,
  file: File,
): Promise<{ logoPath: string }> {
  const { extension } = validateLogo(file);
  const key = logoObjectKey(orgId, extension);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const { error } = await client.storage
    .from(LOGO_BUCKET)
    .upload(key, bytes, {
      contentType: file.type,
      upsert: true,
    });

  if (error) {
    throw new AppError(500, "writeFailed", error.message);
  }

  return { logoPath: key };
}

/**
 * Download a private logo and return it as a self-contained base64 data URL
 * (`data:image/png;base64,...`) for embedding in a server-rendered PDF (Story
 * 12.5). The MIME is derived from the object-key extension we control
 * (`{org}/logo.{png|jpg}`) and restricted to the PNG/JPEG that `@react-pdf/renderer`
 * can decode. RLS-scoped client only. Best-effort: returns `null` on a missing
 * key, a download error, an unsupported extension, or an empty/oversize object —
 * so a logo problem degrades to a logoless PDF rather than failing the freeze.
 */
export async function downloadLogoDataUrl(
  client: SupabaseClient,
  logoPath: string | null,
): Promise<string | null> {
  if (!logoPath) {
    return null;
  }
  const ext = logoPath.split(".").pop()?.toLowerCase();
  const mime =
    ext === "png"
      ? "image/png"
      : ext === "jpg" || ext === "jpeg"
        ? "image/jpeg"
        : null;
  if (!mime) {
    return null;
  }
  try {
    const { data, error } = await client.storage
      .from(LOGO_BUCKET)
      .download(logoPath);
    if (error || !data) {
      return null;
    }
    const bytes = Buffer.from(await data.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_LOGO_BYTES) {
      return null;
    }
    return `data:${mime};base64,${bytes.toString("base64")}`;
  } catch {
    return null;
  }
}

/**
 * Mint a short-lived signed URL to read a private logo back for display. Returns
 * `null` when there is no key or the sign fails (a missing preview is non-fatal —
 * the form still renders). Never a public URL; the URL expires after
 * {@link LOGO_SIGNED_URL_TTL_SECONDS}.
 */
export async function signLogoUrl(
  client: SupabaseClient,
  logoPath: string | null,
): Promise<string | null> {
  if (!logoPath) {
    return null;
  }
  const { data, error } = await client.storage
    .from(LOGO_BUCKET)
    .createSignedUrl(logoPath, LOGO_SIGNED_URL_TTL_SECONDS);
  if (error || !data?.signedUrl) {
    return null;
  }
  return data.signedUrl;
}
