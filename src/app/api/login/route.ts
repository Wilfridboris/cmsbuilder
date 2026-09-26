import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/report";

/**
 * `POST /api/login` (Story 2.2) — passwordless returning-user login dispatch.
 *
 * Login is the claim route's mirror, minus the bootstrap: a thin `signInWithOtp`
 * with NONE of claim's provisioning. It Zod-validates `{ email }`, then dispatches
 * a Supabase→Resend magic link via the RLS-scoped SERVER client. The actual auth
 * URL is a SiteURL `token_hash` link (set by the Magic Link email template) that
 * lands cross-device on `/auth/confirm` — no supabase.co hop, no PKCE verifier.
 *
 * Constraints (frozen intent):
 *   - `shouldCreateUser: false` — a login request never creates an account.
 *   - NO `data.role` — a returning user (incl. an invited Member) already
 *     carries their role in user metadata; login must never clobber it.
 *   - NO `claim_token` in `emailRedirectTo` — the link lands on the bare
 *     `/auth/confirm`, which resolves the user's org by membership (login lands
 *     with no finalize / no metadata write).
 *
 * Anti-enumeration: a no-user / "signups not allowed" provider outcome (the ONLY
 * signal that would reveal whether an email is registered, because
 * `shouldCreateUser:false` rejects an unknown email) is logged via `reportError`
 * and SWALLOWED into the same `{ data:{ sent:true } }` success envelope — a login
 * request must never reveal which emails have accounts.
 *
 * A genuine transport/send failure (SMTP down, provider rate-limit) carries NO
 * such signal, so surfacing it does not aid enumeration: it is returned as a
 * `502 sendFailed` so the user can retry rather than being told to check an inbox
 * that will never receive anything (frozen I/O matrix, row 1). A malformed email
 * is a `400 invalidEmail` (the client already gates on it).
 *
 * Never leaks stacks/SQL/provider output.
 */

// Request-time only: reads/sets cookies + hits the auth provider.
export const dynamic = "force-dynamic";

export type LoginResponse = { sent: true };

const loginBodySchema = z.object({
  email: z.string().trim().email(),
});

/**
 * Does this `signInWithOtp` error reveal whether the email is registered?
 *
 * With `shouldCreateUser:false` the provider rejects an UNKNOWN email with an
 * "otp_disabled" / "Signups not allowed" outcome — swallowing that (returning
 * success anyway) is what preserves anti-enumeration. A genuine transport/send
 * failure (SMTP unreachable, rate-limit, unexpected 5xx) carries none of these
 * markers and is safe to surface, since it happens identically for a known and
 * an unknown email. We match conservatively on the enumerating markers: anything
 * we don't positively recognize as "no-user" is treated as a real send failure.
 */
function isNoUserOutcome(error: { message?: string; code?: string }): boolean {
  const code = (error.code ?? "").toLowerCase();
  const message = (error.message ?? "").toLowerCase();
  return (
    code === "otp_disabled" ||
    code === "signup_disabled" ||
    code === "user_not_found" ||
    message.includes("signups not allowed") ||
    message.includes("signup is disabled") ||
    message.includes("user not found")
  );
}

function json(
  body: ApiResponse<LoginResponse>,
  status: number,
): NextResponse<ApiResponse<LoginResponse>> {
  return NextResponse.json(body, { status });
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<LoginResponse>>> {
  try {
    // 1. Parse + validate the body. A malformed email is the ONLY surfaced
    // failure (400 invalidEmail); everything else resolves to the same success.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "invalidEmail");
    }
    const parsed = loginBodySchema.safeParse(raw);
    if (!parsed.success) {
      throw new AppError(400, "invalidEmail");
    }
    const { email } = parsed.data;

    // 2. Dispatch the login magic link via the RLS-scoped SERVER client. The link
    // lands cross-device on `/auth/confirm` (SiteURL token_hash flow). NO
    // claim_token (claim-only), NO data.role (would clobber the user's role).
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);

    const origin = req.nextUrl.origin;
    const redirectTo = `${origin}/auth/confirm`;

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: false,
        emailRedirectTo: redirectTo,
      },
    });

    if (otpError) {
      // Always log the provider outcome (server-side; never leaked to the client).
      reportError(new Error(otpError.message), {
        route: "/api/login",
        stage: "signInWithOtp",
      });
      // A genuine transport/send failure is surfaced (502 sendFailed) so the
      // user can retry. A no-user / "signups not allowed" outcome is SWALLOWED
      // into the success envelope below — it is the only enumeration-revealing
      // signal and must be indistinguishable from a valid send.
      if (!isNoUserOutcome(otpError)) {
        throw new AppError(502, "sendFailed");
      }
    }

    return json({ data: { sent: true }, error: null }, 200);
  } catch (err) {
    if (err instanceof AppError) {
      return json({ data: null, error: err.userMessage }, err.statusCode);
    }
    reportError(err, { route: "/api/login" });
    return json({ data: null, error: "genericError" }, 500);
  }
}
