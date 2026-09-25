import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { finalizeClaim, ClaimError } from "@/lib/claim/claim";
import { CURRENT_POLICY_VERSION } from "@/app/api/claim/route";
import { reportError } from "@/lib/observability/report";

/**
 * `GET /auth/callback` (Story 2.1) — the magic-link landing.
 *
 * Same-browser PKCE: `exchangeCodeForSession` reads the verifier cookie set by
 * the claim POST in this browser, establishes the `@supabase/ssr` cookie session
 * (written onto the redirect response), then finalizes the claim by the
 * `claim_token` embedded in the link:
 *   - insert the `org_members` admin row, provision a unique slug, clear the
 *     synthetic records (`finalizeClaim`, service-role bootstrap);
 *   - store the consent timestamp + `role:'admin'` on the user's metadata
 *     (`auth.updateUser`), under the just-established session;
 *   - redirect → `/{slug}`.
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

  // Without a claim token there is nothing to finalize (e.g. a returning-user
  // login, Story 2.2). This story only handles the claim; treat a missing token
  // as an error re-request rather than a raw screen.
  if (!claimToken) {
    return statusRedirect(req, "error");
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

  // Store the consent timestamp + confirm the admin role on the user metadata.
  // A metadata write failure must not strand a successfully-bootstrapped org —
  // log it and still land the user (the membership/slug are already live).
  const { error: metaError } = await supabase.auth.updateUser({
    data: {
      role: "admin",
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
