import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { BusinessProfileRow } from "@/types/db";
import {
  json,
  requireUser,
  resolveAdminIdentity,
  resolveWritableAdminIdentity,
  handleError,
} from "@/lib/api/route-helpers";
import { upsertBusinessProfile } from "@/lib/data/business-profile-mutate";
import { signLogoUrl } from "@/lib/storage/logo";
import { getQuerySchema, putBodySchema, toWritableProfile } from "./schemas";

/**
 * `GET /api/business-profile?slug=` (load) and `PUT /api/business-profile` (save) —
 * Story 12.1 Business Profile capture, Admin-only.
 *
 * Both mirror the records/import auth chain: `getCurrentUser()` (JWT-validated) →
 * 401 if none → resolve the org by `slug` UNDER the caller's RLS-scoped client
 * (a non-member sees no row → 403) → `requireAdmin` re-checks the role
 * authoritatively from `org_members` (a Member → 403) and a `membership.slug ===
 * slug` check rejects a cross-org Admin (403). ALL before any profile read/write.
 *
 * GET returns the org's singleton profile or `{ data: null }` (empty form), plus a
 * short-lived private signed logo URL when `logo_path` is set (never a public URL).
 * PUT upserts the singleton (last-write-wins) through the guarded mutation layer
 * with `{ client: rlsClient, actorId: user.id, orgId }` — never the admin client
 * for tenant data, never `records`/`org_schemas`.
 *
 * Every failure resolves to a translated `BusinessProfile.error.*` KEY (or a shared
 * code) via the `{ data, error }` envelope; raw SQL/stacks never leak.
 */

export const dynamic = "force-dynamic";

/** The GET/PUT payload: the profile row plus an optional private signed logo URL. */
export type BusinessProfilePayload = {
  profile: BusinessProfileRow;
  logoUrl: string | null;
};

export async function GET(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<BusinessProfilePayload | null>>> {
  try {
    const parsed = getQuerySchema.safeParse({
      slug: req.nextUrl.searchParams.get("slug"),
    });
    if (!parsed.success) {
      throw new AppError(400, "genericError");
    }
    const { slug } = parsed.data;

    const user = await requireUser();
    const identity = await resolveAdminIdentity(slug, user);

    const { data, error } = await identity.client
      .from("business_profiles")
      .select("*")
      .eq("organization_id", identity.orgId)
      .maybeSingle();

    if (error) {
      throw new AppError(500, "loadFailed", error.message);
    }
    if (!data) {
      // No profile saved yet — the empty form renders from a null payload.
      return json<BusinessProfilePayload | null>({ data: null, error: null }, 200);
    }

    const profile = data as BusinessProfileRow;
    const logoUrl = await signLogoUrl(identity.client, profile.logo_path);

    return json<BusinessProfilePayload | null>(
      { data: { profile, logoUrl }, error: null },
      200,
    );
  } catch (err) {
    return handleError<BusinessProfilePayload | null>(err, "/api/business-profile");
  }
}

export async function PUT(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<BusinessProfilePayload>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "genericError");
    }

    // Authenticate + authorize BEFORE validating the full body, so an
    // unauthenticated / non-admin / cross-org caller is rejected (401/403) before
    // we do any input work — matching the logo route and the records exemplar. Only
    // the org slug is read from the body to run the gate.
    const user = await requireUser();
    const slugParsed = getQuerySchema.safeParse(raw);
    if (!slugParsed.success) {
      throw new AppError(400, "genericError");
    }
    // Story 7.4 / retro [A1][A2]: the shared writable admin resolver runs the admin
    // gate (non-admin → forbidden) THEN asserts the org is writable (read_only /
    // expired-trial → readOnly), before the profile write. The GET above stays on
    // the plain admin resolver — reads are never gated.
    const identity = await resolveWritableAdminIdentity(
      slugParsed.data.slug,
      user,
    );

    const parsed = putBodySchema.safeParse(raw);
    if (!parsed.success) {
      // The first refinement message is a frozen matrix KEY (legalNameRequired /
      // registrationPairRequired). A field-shape error (e.g. a bad enum) carries a
      // Zod default message, not one of our KEYs — surface it as genericError so a
      // raw validation string never reaches the client. All are 400.
      const message = parsed.error.issues[0]?.message ?? "";
      const key = message.startsWith("BusinessProfile.error.")
        ? message
        : "genericError";
      throw new AppError(400, key);
    }

    const result = await upsertBusinessProfile(
      identity,
      toWritableProfile(parsed.data),
    );
    if (result.error || !result.data) {
      throw new AppError(500, "writeFailed");
    }

    const logoUrl = await signLogoUrl(identity.client, result.data.logo_path);

    return json<BusinessProfilePayload>(
      { data: { profile: result.data, logoUrl }, error: null },
      200,
    );
  } catch (err) {
    return handleError<BusinessProfilePayload>(err, "/api/business-profile");
  }
}
