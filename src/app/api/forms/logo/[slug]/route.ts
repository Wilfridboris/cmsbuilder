import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { getPrimaryPublishedForm } from "@/lib/data/forms";
import { downloadLogoBytes } from "@/lib/storage/logo";
import { reportError } from "@/lib/observability/report";

/**
 * `GET /api/forms/logo/[slug]` — the PUBLIC, published-gated logo proxy (Epic 14,
 * Story 14.6).
 *
 * The public form must not fork the private-bucket posture (12.1/12.5 keep logos
 * private; admins get 5-minute signed URLs). So the public surface references a
 * stable org-keyed route that RE-CHECKS the published gate per request and STREAMS
 * the bytes with the service-role admin client — no public bucket, no signed URL,
 * the storage object key never exposed.
 *
 * Per request: resolve the org by slug (admin client) → 404 if none; gate on
 * `getPrimaryPublishedForm` (the org has at least one published form) → 404 if
 * null, so an org's logo is publicly fetchable exactly when it has published
 * something; load `business_profiles.logo_path` → 404 if null; download the bytes
 * → 404 if absent/unsupported/oversize; else stream with the correct
 * `Content-Type` + a short `Cache-Control` (the URL is org-stable, so caching
 * helps, but the window is kept small so a re-uploaded logo — or a logo served
 * from a shared cache after the org UNPUBLISHES — goes stale within minutes
 * rather than an hour, keeping the cache roughly in step with the published
 * gate). ANY error collapses to a 404 — no bytes, no internals leaked.
 *
 * Public via `/api/*` being excluded from `middleware.ts`'s matcher.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** A bare 404 with no body — never leaks whether the org/form/logo exists or why. */
function notFound(): NextResponse {
  return new NextResponse(null, { status: 404 });
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
): Promise<NextResponse> {
  try {
    const { slug } = await params;
    if (!slug) {
      return notFound();
    }

    const admin = createAdminClient();

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id")
      .eq("slug", slug)
      .maybeSingle();
    if (orgError || !org) {
      return notFound();
    }
    const orgId = org.id as string;

    // Published gate: the logo becomes publicly fetchable exactly when the org has
    // published at least one form. No published form -> 404.
    const published = await getPrimaryPublishedForm(admin, orgId);
    if (!published) {
      return notFound();
    }

    const { data: profile, error: profileError } = await admin
      .from("business_profiles")
      .select("logo_path")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (profileError || !profile?.logo_path) {
      return notFound();
    }

    const logo = await downloadLogoBytes(admin, profile.logo_path as string);
    if (!logo) {
      return notFound();
    }

    return new NextResponse(new Uint8Array(logo.bytes), {
      status: 200,
      headers: {
        "Content-Type": logo.contentType,
        "Cache-Control": "public, max-age=300",
      },
    });
  } catch (err) {
    // Never leak provider/DB internals to the public surface — report and 404.
    reportError(err, { route: "/api/forms/logo/[slug]" });
    return notFound();
  }
}
