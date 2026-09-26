import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  finalizeClaimByEmail,
  ClaimError,
} from "@/lib/claim/claim";
import { resolveUserPrimaryOrgSlug } from "@/lib/auth/org";
import { CURRENT_POLICY_VERSION } from "@/app/api/claim/route";
import { reportError } from "@/lib/observability/report";

/**
 * `GET /auth/confirm` — THE single cross-device landing for login, claim, AND
 * invite, driven by a SiteURL `token_hash`/`verifyOtp` link (no supabase.co hop,
 * no PKCE `code_verifier` cookie, so it works on any device).
 *
 * Every auth email (Magic Link for returning login, Confirm-signup for a new
 * claim, Invite for a teammate) now points here as
 * `${SITE_URL}/auth/confirm?token_hash=...&type=...&next=<per-flow marker>`.
 *
 * Post-verify decision (single, by verified identity — NOT by `type`, since a
 * claim-by-existing-email arrives as `magiclink`):
 *
 *   verifyOtp → user
 *   if resolveUserPrimaryOrgSlug(user) → /{slug}          // login / invite / claim re-entry
 *   else if finalizeClaimByEmail(user.email) → /{slug}    // first claim: bootstrap + consent write
 *   else → /login?login=no-org
 *
 * Claim finalization (membership + unique slug + synthetic-record clear) and the
 * consent-timestamp / policy-version metadata write are ported here from the
 * now-deleted PKCE `/auth/callback` route. Role authority stays exclusively in
 * `org_members` (written by `finalizeClaim`); NO role is ever written to user
 * metadata, and a metadata-write failure must not strand a live org.
 *
 * Every failure/expired/bad-param path redirects to a translated re-request
 * surface — never a raw error screen, never a crash. The surface is chosen from
 * the per-flow `next` marker on the link so an expired verify (where we have no
 * user/email to disambiguate) still routes claim → `/?claim=...` vs login/invite
 * → `/login?login=link-expired`.
 */

export const dynamic = "force-dynamic";

/**
 * Email OTP types the cross-device confirm link is honored for. Kept as a local
 * literal set (not imported from `@supabase/auth-js`, a transitive dep) — it is
 * passed straight to `verifyOtp`, whose `type` accepts these strings.
 */
const CONFIRM_TYPES = ["invite", "signup", "magiclink", "email"] as const;
type ConfirmType = (typeof CONFIRM_TYPES)[number];

/**
 * The per-flow re-request marker templates set on the link's `next` param. Only
 * the claim flow's failures route to the claim surface (`/?claim=...`); every
 * other value (or a missing marker) routes to the login surface. Matching the
 * claim marker conservatively means a corrupted/absent marker fails SAFE to the
 * login surface rather than mis-routing a login user to the claim page.
 */
const CLAIM_NEXT_MARKER = "claim";

/** Is this link (by its `next` marker) part of the claim flow? */
function isClaimFlow(nextMarker: string | null): boolean {
  return nextMarker === CLAIM_NEXT_MARKER;
}

/**
 * Redirect to the translated re-request surface for the flow.
 *   - claim  → `/?claim=<expired|error>` (the landing-page ClaimNotice)
 *   - login/invite → `/login?login=link-expired`
 */
function statusRedirect(
  req: NextRequest,
  nextMarker: string | null,
  claimReason: "expired" | "error",
): NextResponse {
  if (isClaimFlow(nextMarker)) {
    const url = new URL("/", req.nextUrl.origin);
    url.searchParams.set("claim", claimReason);
    return NextResponse.redirect(url);
  }
  const url = new URL("/login", req.nextUrl.origin);
  url.searchParams.set("login", "link-expired");
  return NextResponse.redirect(url);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const tokenHash = req.nextUrl.searchParams.get("token_hash");
  const typeParam = req.nextUrl.searchParams.get("type");
  const nextMarker = req.nextUrl.searchParams.get("next");

  // Missing token or an unrecognized type → re-request path (never a raw screen),
  // verifyOtp NOT called.
  if (
    !tokenHash ||
    !typeParam ||
    !CONFIRM_TYPES.includes(typeParam as ConfirmType)
  ) {
    return statusRedirect(req, nextMarker, "expired");
  }
  const type = typeParam as ConfirmType;

  // The whole session-establishment region is guarded: a THROWN exception from
  // `cookies()`, client creation (missing env), `verifyOtp` (provider/network
  // fault), the org resolve, or the claim finalize must land on the translated
  // re-request path, never a raw error screen (frozen matrix "never a raw screen
  // / never a crash").
  try {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);

    // Establish the session cross-device (no PKCE verifier). The SSR client writes
    // the session cookies onto the redirect response via its cookie bridge.
    const { data: verifyData, error: verifyError } =
      await supabase.auth.verifyOtp({
        token_hash: tokenHash,
        type,
      });

    if (verifyError || !verifyData.user) {
      reportError(new Error(verifyError?.message ?? "no user after verifyOtp"), {
        route: "/auth/confirm",
        stage: "verifyOtp",
      });
      return statusRedirect(req, nextMarker, "expired");
    }

    const user = verifyData.user;
    const adminClient = createAdminClient();

    // Membership-first: a user who already belongs to an org is a login, an
    // invite acceptance, or a claim re-entry (membership was created by the first
    // finalize). Resolve their primary org and land them — no finalize, no
    // metadata write.
    const resolved = await resolveUserPrimaryOrgSlug(user.id, adminClient);
    if (resolved) {
      return NextResponse.redirect(
        new URL(`/${resolved.slug}`, req.nextUrl.origin),
      );
    }

    // No membership yet: this is a first-time claim. Resolve the most-recent
    // unconsumed + unexpired pending claim for the verified email and finalize it
    // (membership + unique slug + synthetic-record clear). finalizeClaim is
    // idempotent by construction, so a race that already created the membership
    // resolves above on re-entry.
    let slug: string;
    let consentAcceptedAt: string;
    try {
      const result = await finalizeClaimByEmail(
        user.email ?? "",
        user.id,
        adminClient,
      );
      slug = result.slug;
      consentAcceptedAt = result.consentAcceptedAt;
    } catch (err) {
      if (err instanceof ClaimError) {
        // `not-found` here means the user verified but has neither a membership
        // nor a pending claim — a login link for an account with no org. Route to
        // the translated no-org status rather than the generic claim-error page.
        if (err.kind === "not-found") {
          const url = new URL("/login", req.nextUrl.origin);
          url.searchParams.set("login", "no-org");
          return NextResponse.redirect(url);
        }
        reportError(err, {
          route: "/auth/confirm",
          stage: "finalizeClaimByEmail",
          kind: err.kind,
        });
        return statusRedirect(
          req,
          nextMarker,
          err.kind === "expired" ? "expired" : "error",
        );
      }
      reportError(err, {
        route: "/auth/confirm",
        stage: "finalizeClaimByEmail",
      });
      return statusRedirect(req, nextMarker, "error");
    }

    // Store the consent timestamp (PIPEDA audit) + policy version on the user
    // metadata. The role is deliberately NOT written: finalizeClaim already
    // recorded it in `org_members` (the sole authority RBAC reads), and a global
    // metadata `role` scalar could wrongly assert admin on an account that is a
    // Member of another org. A metadata write failure must not strand a
    // successfully-bootstrapped org — log it and still land the user (the
    // membership/slug are already live).
    const { error: metaError } = await supabase.auth.updateUser({
      data: {
        // The true consent moment (claim-submit time), carried from the pending
        // claim — not the confirm time — so the audit record is accurate.
        consent_accepted_at: consentAcceptedAt,
        policy_version: CURRENT_POLICY_VERSION,
      },
    });
    if (metaError) {
      reportError(new Error(metaError.message), {
        route: "/auth/confirm",
        stage: "updateUser",
      });
    }

    return NextResponse.redirect(new URL(`/${slug}`, req.nextUrl.origin));
  } catch (err) {
    reportError(err, { route: "/auth/confirm", stage: "establishSession" });
    return statusRedirect(req, nextMarker, "error");
  }
}
