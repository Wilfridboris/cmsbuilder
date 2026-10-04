import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { resolvePublicFormTarget } from "@/lib/data/forms-public";
import { submitToTarget } from "@/lib/intake/submit";
import { json, handleError } from "@/lib/api/route-helpers";

/**
 * `POST /api/intake/[slug]` — the PUBLIC, no-auth LEGACY bare-org intake write
 * (Story 6.2, FR26; migrated onto the `forms` entity in Story 14.2).
 *
 * The product's narrow public write path (NFR-FC1): an unauthenticated visitor submits
 * the form at `/forms/{slug}` and this handler persists exactly ONE record. It is the
 * authority, never the client:
 *   - it re-resolves the ORG's PRIMARY PUBLISHED form (oldest `published` by
 *     `created_at`) server-side via `resolvePublicFormTarget` (the SAME resolver the
 *     page uses), treating the form's stored `target_table_key` as authoritative — the
 *     client payload never chooses the table or the columns. Resolution is STRICT: with
 *     no published form (the default state until 14.3) this collapses to a generic 400,
 *     with NO fallback to the Epic-6 intake heuristic;
 *   - the shared `submitToTarget` writes ONLY allowlisted non-relation fields, re-coerces
 *     every value, rejects an empty/invalid submission with a generic 400, writes through
 *     the guarded `mutate.ts` under the anonymous `INTAKE_ACTOR_ID` scoped to the resolved
 *     org, and best-effort emails the admins.
 *
 * It never leaks DB/provider internals — an unknown slug / no published form collapses to
 * a generic error envelope, indistinguishable from any other unavailable cause.
 *
 * Public via `PUBLIC_TOP_LEVEL` (`"forms"`) and matcher-excluded (`/api/*`) in
 * `src/middleware.ts`, so no session is required and no middleware change is needed.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse<ApiResponse<{ ok: true }>>> {
  try {
    const { slug } = await params;

    // Re-resolve the target server-side: the org's primary published form, strict (no
    // heuristic fallback). An unknown slug / no published form / invalid target is
    // indistinguishable from any other unavailable case — a generic 400, no internals.
    const target = await resolvePublicFormTarget({ orgSlug: slug });
    if (!target) {
      throw new AppError(400, "genericError");
    }

    const data = await submitToTarget(req, target, "/api/intake/[slug]");
    return json({ data, error: null }, 200);
  } catch (err) {
    return handleError<{ ok: true }>(err, "/api/intake/[slug]");
  }
}
