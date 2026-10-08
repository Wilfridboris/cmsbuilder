import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";

import { createServerSupabaseClient } from "@/lib/supabase/server";
import { reportError } from "@/lib/observability/report";

/**
 * `POST /auth/signout` (Story 15.1) — end the session and return home.
 *
 * Calls `supabase.auth.signOut()` through the RLS-scoped server client (which
 * clears the session cookies via its cookie bridge onto the redirect response),
 * then redirects to `/`. A signOut error must NOT strand the user: it is logged
 * and we still redirect home (the auth-aware home then simply shows the claim UI
 * if the cookie did clear, or the signed-in card if it did not — never a dead
 * end). Uses a 303 so the browser follows with GET after the POST.
 */

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest): Promise<NextResponse> {
  const home = new URL("/", req.nextUrl.origin);
  try {
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);
    const { error } = await supabase.auth.signOut();
    if (error) {
      reportError(new Error(error.message), {
        route: "/auth/signout",
        stage: "signOut",
      });
    }
  } catch (err) {
    reportError(err, { route: "/auth/signout" });
  }
  return NextResponse.redirect(home, { status: 303 });
}
