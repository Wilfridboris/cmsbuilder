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
import { setBusinessProfileLogoPath } from "@/lib/data/business-profile-mutate";
import { uploadLogo, signLogoUrl } from "@/lib/storage/logo";

/**
 * `POST /api/business-profile/logo` — Story 12.1 Admin-only logo upload.
 *
 * Multipart body: a `slug` field + a `file` (the logo). Same auth gate as the
 * profile route — `getCurrentUser` → 401, `resolveOrgIdentity` (non-member → 403),
 * `requireAdmin` (Member → 403), slug-match (cross-org Admin → 403) — all before
 * any validation or store.
 *
 * The image is validated server-side (PNG/JPEG only, no SVG; ≤ 2 MB) and stored
 * PRIVATELY under the org's prefix via `src/lib/storage/logo.ts`; the resulting
 * `logo_path` is persisted onto the singleton profile. A bad type/size maps to
 * `BusinessProfile.error.logoInvalid` (400/413) with NO write. The response
 * carries a fresh short-lived private signed URL so the form can preview it.
 */

export const dynamic = "force-dynamic";

export type LogoUploadPayload = { logoPath: string; logoUrl: string | null };

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<LogoUploadPayload>>> {
  try {
    // 1. Identify the caller (before reading the body).
    const user = await requireUser();

    // 2. Read the multipart body: a slug field + the file.
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new AppError(400, "genericError");
    }
    const slugRaw = form.get("slug");
    if (typeof slugRaw !== "string" || slugRaw.trim() === "") {
      throw new AppError(400, "genericError");
    }
    const slug = slugRaw.trim();

    // 3. Admin gate + writable assert — the shared resolver runs the RLS org resolve,
    //    authoritative role check, and slug match (non-admin → forbidden) BEFORE the
    //    writable assertion (read_only / expired-trial → readOnly, admin gate wins),
    //    all before any validation or store [retro A1].
    const identity = await resolveWritableAdminIdentity(slug, user);

    // 4. Require an actual file part. A missing / non-File part → logoInvalid.
    const file = form.get("file");
    if (!(file instanceof File) || file.name === "") {
      throw new AppError(400, "BusinessProfile.error.logoInvalid");
    }

    // 5. Validate + store privately (uploadLogo throws logoInvalid on bad
    //    type/size BEFORE any write), then persist the key onto the profile.
    const { logoPath } = await uploadLogo(identity.client, identity.orgId, file);
    const result = await setBusinessProfileLogoPath(
      { client: identity.client, actorId: identity.actorId, orgId: identity.orgId },
      logoPath,
    );
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    const logoUrl = await signLogoUrl(identity.client, logoPath);

    return json<LogoUploadPayload>(
      { data: { logoPath, logoUrl }, error: null },
      200,
    );
  } catch (err) {
    return handleError<LogoUploadPayload>(err, "/api/business-profile/logo");
  }
}
