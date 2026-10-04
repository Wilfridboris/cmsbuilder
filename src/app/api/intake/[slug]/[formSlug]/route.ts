import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { resolvePublicFormTarget } from "@/lib/data/forms-public";
import { submitToTarget } from "@/lib/intake/submit";
import { json, handleError } from "@/lib/api/route-helpers";

/**
 * `POST /api/intake/[slug]/[formSlug]` — the PUBLIC, no-auth FORM-KEYED intake write
 * (Epic 14, Story 14.2).
 *
 * The multi-form public write surface: an unauthenticated visitor submits a SPECIFIC
 * named form at `/forms/{orgSlug}/{formSlug}` and this handler persists exactly ONE
 * record into THAT form's stored `target_table_key`. It is the authority, never the
 * client:
 *   - it re-resolves the form from `(orgSlug, formSlug)` server-side via
 *     `resolvePublicFormTarget` (the SAME resolver the page uses), published-gated and
 *     STRICT — an unknown/unpublished form or a null/stale target table collapses to a
 *     generic 400 with NO heuristic fallback;
 *   - the shared `submitToTarget` writes ONLY allowlisted non-relation fields, re-coerces
 *     every value, rejects an empty/invalid submission with a generic 400, writes through
 *     the guarded `mutate.ts` under the anonymous `INTAKE_ACTOR_ID` scoped to the resolved
 *     org, and best-effort emails the admins.
 *
 * It never leaks DB/provider internals — every unavailable case collapses to the same
 * generic error envelope, not distinguishing the cause.
 *
 * Public via `PUBLIC_TOP_LEVEL` (`"forms"`) and matcher-excluded (`/api/*`) in
 * `src/middleware.ts`, so no session is required and no middleware change is needed.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string; formSlug: string }> },
): Promise<NextResponse<ApiResponse<{ ok: true }>>> {
  try {
    const { slug, formSlug } = await params;

    // Re-resolve the keyed target server-side, published-gated and strict. Any
    // unavailable case is indistinguishable — a generic 400, no internals leaked.
    const target = await resolvePublicFormTarget({ orgSlug: slug, formSlug });
    if (!target) {
      throw new AppError(400, "genericError");
    }

    const data = await submitToTarget(
      req,
      target,
      "/api/intake/[slug]/[formSlug]",
    );
    return json({ data, error: null }, 200);
  } catch (err) {
    return handleError<{ ok: true }>(err, "/api/intake/[slug]/[formSlug]");
  }
}
