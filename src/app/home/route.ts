import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { resolveUserPrimaryOrgSlug } from "@/lib/auth/org";
import { reportError } from "@/lib/observability/report";

/**
 * `GET /home` — the installed PWA's `start_url` resolver (Story 8.2).
 *
 * The manifest's `start_url` points here (NOT `/`, which must keep rendering the
 * public PromptBuilder for everyone). When a user launches the installed app
 * from their home-screen icon, this route resolves their session server-side and
 * lands them directly on their `/{slug}` dashboard:
 *
 *   session + primary org -> /{slug}
 *   no session            -> /login
 *   session but no org    -> /login?login=no-org
 *
 * Mirrors the canonical session->slug redirect in `auth/confirm`: the same
 * RLS-scoped server client to read the session, then `resolveUserPrimaryOrgSlug`
 * under the already-allowlisted admin client (no new privilege). Any thrown
 * fault degrades to `/login` rather than a raw error screen.
 */

export const dynamic = "force-dynamic";

/**
 * Redirect with `Cache-Control: no-store`. The `start_url` resolver is per
 * session — its 307 target varies by caller (`/{slug}` vs `/login`), so a cached
 * redirect could land a user on the wrong org or a stale login. `no-store` keeps
 * any intermediary/browser from caching it (`force-dynamic` only governs Next's
 * own render cache, not downstream caching of the redirect response).
 */
function redirectNoStore(url: URL): NextResponse {
  const res = NextResponse.redirect(url);
  res.headers.set("Cache-Control", "no-store");
  return res;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const loginUrl = new URL("/login", req.nextUrl.origin);

  try {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);

    const {
      data: { user },
      error: userError,
    } = await supabase.auth.getUser();

    // No valid session -> send to login (the PWA shell will land here on a cold,
    // logged-out launch). An auth error is treated the same as "no session".
    if (userError || !user) {
      return redirectNoStore(loginUrl);
    }

    const adminClient = createAdminClient();
    const resolved = await resolveUserPrimaryOrgSlug(user.id, adminClient);

    if (resolved) {
      return redirectNoStore(new URL(`/${resolved.slug}`, req.nextUrl.origin));
    }

    // Signed in but no org yet (mirrors auth/confirm's no-org status).
    loginUrl.searchParams.set("login", "no-org");
    return redirectNoStore(loginUrl);
  } catch (err) {
    reportError(err, { route: "/home", stage: "resolveStartUrl" });
    return redirectNoStore(loginUrl);
  }
}
