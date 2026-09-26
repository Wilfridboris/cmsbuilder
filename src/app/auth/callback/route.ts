import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeClaim, ClaimError } from "@/lib/claim/claim";
import { resolveUserPrimaryOrgSlug } from "@/lib/auth/org";
import { CURRENT_POLICY_VERSION } from "@/app/api/claim/route";
import { reportError } from "@/lib/observability/report";

/**
 * `GET /auth/callback` (Story 2.1 + 2.2) — the magic-link landing for BOTH the
 * claim flow and returning-user login.
 *
 * Same-browser PKCE: `exchangeCodeForSession` reads the verifier cookie set by
 * the claim/login POST in this browser and establishes the `@supabase/ssr`
 * cookie session (written onto the redirect response). The link then branches on
 * the presence of a `claim_token`:
 *
 *   - WITH a `claim_token` (Story 2.1 claim) — finalize the claim: insert the
 *     `org_members` admin row, provision a unique slug, clear the synthetic
 *     records (`finalizeClaim`, service-role bootstrap); store the consent
 *     timestamp + `role:'admin'` on the user's metadata; redirect → `/{slug}`.
 *
 *   - WITHOUT a `claim_token` (Story 2.2 login) — resolve the authenticated
 *     user's primary org slug and redirect → `/{slug}`. No org is created, no
 *     role changed, no claim finalized. A user with no membership lands on the
 *     translated no-org status (`/login?login=no-org`), never a crash.
 *
 * Any exchange/finalize failure redirects to a translated status state with a
 * re-request path (`/?claim=<reason>`) — never a raw error screen, never a
 * partial bootstrap. Cross-device opens (no verifier cookie) fail the exchange
 * and land on the same "request a fresh link" path.
 */

export const dynamic = "force-dynamic";

/** Redirect to the translated claim-status surface with a re-request path. */
function statusRedirect(req: NextRequest, reason: "expired" | "error"): NextResponse {
  const url = new URL("/", req.nextUrl.origin);
  url.searchParams.set("claim", reason);
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const code = req.nextUrl.searchParams.get("code");
  const claimToken = req.nextUrl.searchParams.get("claim_token");

  // No code (or a link opened without the PKCE handshake) → re-request path.
  if (!code) {
    return statusRedirect(req, "expired");
  }

  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);

  // The redirect response carries the session cookies the SSR client sets during
  // the exchange (via the cookie `setAll` bridge in createServerSupabaseClient).
  const { data: exchangeData, error: exchangeError } =
    await supabase.auth.exchangeCodeForSession(code);

  if (exchangeError || !exchangeData.user) {
    // Expired/invalid link, or a cross-device open with no local verifier.
    reportError(new Error(exchangeError?.message ?? "no user after exchange"), {
      route: "/auth/callback",
      stage: "exchangeCodeForSession",
    });
    return statusRedirect(req, "expired");
  }

  const user = exchangeData.user;

  // Returning-user login (Story 2.2): a link with NO claim_token is a login, not
  // a claim. Resolve the authenticated user's primary org slug and land them on
  // their dashboard. Nothing is created, no role is changed, no claim finalized.
  if (!claimToken) {
    try {
      const resolved = await resolveUserPrimaryOrgSlug(
        user.id,
        createAdminClient(),
      );
      if (!resolved) {
        // A valid session with no membership → translated no-org status, never
        // a crash or a raw screen. (Not reachable via the normal login flow,
        // where a claim always created a membership first.)
        const url = new URL("/login", req.nextUrl.origin);
        url.searchParams.set("login", "no-org");
        return NextResponse.redirect(url);
      }
      return NextResponse.redirect(
        new URL(`/${resolved.slug}`, req.nextUrl.origin),
      );
    } catch (err) {
      reportError(err, { route: "/auth/callback", stage: "resolveLoginOrg" });
      return statusRedirect(req, "error");
    }
  }

  let slug: string;
  let consentAcceptedAt: string;
  try {
    const result = await finalizeClaim({
      token: claimToken,
      userId: user.id,
      adminClient: createAdminClient(),
    });
    slug = result.slug;
    consentAcceptedAt = result.consentAcceptedAt;
  } catch (err) {
    if (err instanceof ClaimError) {
      reportError(err, { route: "/auth/callback", stage: "finalizeClaim", kind: err.kind });
      return statusRedirect(req, err.kind === "expired" ? "expired" : "error");
    }
    reportError(err, { route: "/auth/callback", stage: "finalizeClaim" });
    return statusRedirect(req, "error");
  }

  // Store the consent timestamp (PIPEDA audit) on the user metadata. The role is
  // deliberately NOT written here: finalizeClaim already recorded it in
  // `org_members` (the sole authority RBAC reads), and a global metadata `role`
  // scalar could wrongly assert admin on an account that is a Member of another
  // org. A metadata write failure must not strand a successfully-bootstrapped org
  // — log it and still land the user (the membership/slug are already live).
  const { error: metaError } = await supabase.auth.updateUser({
    data: {
      // The true consent moment (claim-submit time), carried from the pending
      // claim — not the callback time — so the audit record is accurate.
      consent_accepted_at: consentAcceptedAt,
      policy_version: CURRENT_POLICY_VERSION,
    },
  });
  if (metaError) {
    reportError(new Error(metaError.message), {
      route: "/auth/callback",
      stage: "updateUser",
    });
  }

  return NextResponse.redirect(new URL(`/${slug}`, req.nextUrl.origin));
}
