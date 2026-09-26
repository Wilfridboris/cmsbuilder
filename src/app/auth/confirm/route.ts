import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUserPrimaryOrgSlug } from "@/lib/auth/org";
import { reportError } from "@/lib/observability/report";

/**
 * `GET /auth/confirm` (Story 2.3) — cross-device invite acceptance.
 *
 * An invite is opened on the invitee's OWN device, which has no PKCE
 * `code_verifier` cookie, so the same-browser `exchangeCodeForSession` flow that
 * claim/login (`/auth/callback`) rely on cannot work here. Supabase's cross-
 * device flow is `verifyOtp({ token_hash, type })` with a `token_hash` link, so
 * invite acceptance gets its OWN route and leaves the hardened claim/login
 * callback untouched.
 *
 * Flow: read `token_hash` + `type` from the query → `verifyOtp` on the RLS-scoped
 * SERVER client (so the session cookies are written onto THIS redirect response)
 * → resolve the user's primary org slug (reusing the 2.2 resolver) → redirect
 * `/{slug}`, where membership-based RLS (`auth_org_ids()`) grants immediate
 * read/write.
 *
 * A failed/expired verify redirects to a translated re-request status on the
 * existing login surface (`/login?login=link-expired`) — never a raw error
 * screen, never a crash.
 */

export const dynamic = "force-dynamic";

/**
 * Email OTP types the cross-device confirm link is honored for. Kept as a local
 * literal set (not imported from `@supabase/auth-js`, a transitive dep) — it is
 * passed straight to `verifyOtp`, whose `type` accepts these strings.
 */
const CONFIRM_TYPES = ["invite", "signup", "magiclink", "email"] as const;
type ConfirmType = (typeof CONFIRM_TYPES)[number];

/** Redirect to the translated re-request status on the login surface. */
function statusRedirect(req: NextRequest): NextResponse {
  const url = new URL("/login", req.nextUrl.origin);
  url.searchParams.set("login", "link-expired");
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const typeParam = req.nextUrl.searchParams.get("type");

  // Missing token or an unrecognized type → re-request path (never a raw screen).
  if (
    !tokenHash ||
    !typeParam ||
    !CONFIRM_TYPES.includes(typeParam as ConfirmType)
  ) {
    return statusRedirect(req);
  }
  const type = typeParam as ConfirmType;

  // The whole session-establishment region is guarded: a THROWN exception from
  // `cookies()`, client creation (missing env), `verifyOtp` (provider/network
  // fault), or the org resolve must land on the translated re-request path, never
  // a raw error screen (frozen matrix "never a raw screen / never a crash").
  try {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);

    // Establish the session cross-device (no PKCE verifier). The SSR client writes
    // the session cookies onto the redirect response via its cookie bridge.
    const { data: verifyData, error: verifyError } = await supabase.auth.verifyOtp(
      {
        token_hash: tokenHash,
        type,
      },
    );

    if (verifyError || !verifyData.user) {
      reportError(new Error(verifyError?.message ?? "no user after verifyOtp"), {
        route: "/auth/confirm",
        stage: "verifyOtp",
      });
      return statusRedirect(req);
    }

    // Resolve the org the invitee just joined and land them on it. Membership was
    // provisioned at invite-send time, so RLS already resolves their org.
    const resolved = await resolveUserPrimaryOrgSlug(
      verifyData.user.id,
      createAdminClient(),
    );
    if (!resolved) {
      // Verified but no membership (should not happen via the invite path) —
      // route to the same translated status rather than crash.
      return statusRedirect(req);
    }
    return NextResponse.redirect(new URL(`/${resolved.slug}`, req.nextUrl.origin));
  } catch (err) {
    reportError(err, { route: "/auth/confirm", stage: "establishSession" });
    return statusRedirect(req);
  }
}
