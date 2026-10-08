import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import type { ApiResponse } from "@/types/api";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  deriveSlugFromName,
  guardReservedSlug,
  ensureUniqueSlug,
} from "@/lib/claim/slug";
import { reportError } from "@/lib/observability/report";

/**
 * `POST /api/claim/slug-check` (Story 15.1) — best-effort slug availability.
 *
 * The claim modal shows + lets the owner edit their dashboard slug before
 * claiming. Anonymous callers cannot read `organizations.slug` (deny-all RLS),
 * so this service-role route normalizes the candidate, applies the reserved-word
 * guard, and checks `organizations.slug` existence. It returns
 * `{ available, normalized, suggestion? }`:
 *   - a reserved / empty base is re-derived by the guard and reported with its
 *     guarded `normalized` + a `suggestion`;
 *   - a taken base reports `available:false` + the first free `base-N` suggestion;
 *   - a free base reports `available:true`.
 *
 * This is a UX affordance ONLY — the authoritative slug is resolved at finalize
 * by `ensureUniqueSlug`. A network/DB fault here is treated by the client as
 * "unconfirmed" and the claim still proceeds. The route never leaks SQL/stacks.
 */

export const dynamic = "force-dynamic";

export type SlugCheckResponse = {
  available: boolean;
  normalized: string;
  suggestion?: string;
};

const bodySchema = z.object({
  // Either an explicit slug candidate the owner typed, or the business name to
  // derive one from. `slug` wins when present.
  slug: z.string().trim().optional(),
  name: z.string().trim().optional(),
});

function json(
  body: ApiResponse<SlugCheckResponse>,
  status: number,
): NextResponse<ApiResponse<SlugCheckResponse>> {
  return NextResponse.json(body, { status });
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<SlugCheckResponse>>> {
  try {
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return json({ data: null, error: "invalidBody" }, 400);
    }
    const parsed = bodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ data: null, error: "invalidBody" }, 400);
    }

    const source = parsed.data.slug?.trim()
      ? parsed.data.slug.trim()
      : deriveSlugFromName(parsed.data.name ?? "");
    // Guard first: a reserved or empty candidate becomes a safe, non-shadowing
    // base. `normalized` is what the owner's slug would actually be.
    const normalized = guardReservedSlug(source);

    const admin = createAdminClient();
    const { data: existing, error } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", normalized)
      .limit(1)
      .maybeSingle();

    if (error) {
      // Never leak the DB message; the client treats a failure as "unconfirmed".
      reportError(new Error(error.message), {
        route: "/api/claim/slug-check",
        stage: "lookup",
      });
      return json({ data: null, error: "genericError" }, 500);
    }

    if (!existing) {
      // Free. Report it back with the guarded form; if the guard changed the
      // input (reserved/empty), surface it as a suggestion so the UI can show it.
      const suggestion = normalized !== source ? normalized : undefined;
      return json(
        { data: { available: true, normalized, suggestion }, error: null },
        200,
      );
    }

    // Taken: offer the first free `base-N` as the suggestion the owner can adopt.
    const suggestion = await ensureUniqueSlug(admin, normalized);
    return json(
      { data: { available: false, normalized, suggestion }, error: null },
      200,
    );
  } catch (err) {
    reportError(err, { route: "/api/claim/slug-check" });
    return json({ data: null, error: "genericError" }, 500);
  }
}
