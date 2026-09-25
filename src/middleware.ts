import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

/**
 * Edge/proxy middleware (Story 2.1) — @supabase/ssr session refresh + route
 * protection.
 *
 * On every matched request it rebuilds the Supabase session from the request
 * cookies, calls `getUser()` (which refreshes an expiring access token and, via
 * the cookie bridge below, writes the rotated cookies onto the response), and
 * protects the tenant dashboard at `/{slug}`:
 *   - unauthenticated requests to a protected `/{slug}` redirect to the claim /
 *     login entry point (`/`), never an error screen;
 *   - `/`, `/generate`, `/demo`, `/api/*`, `/auth/*` stay public.
 *
 * RLS is still the hard isolation gate on the data itself — this only refreshes
 * the cookie session and gates the page shell. Membership/role are enforced on
 * the server route/`mutate.ts` layer, not here (frontend gating is never the
 * sole enforcement).
 *
 * NOTE: `middleware.ts` is deprecated in Next 16 (renamed `proxy.ts`) but
 * remains functional; this project's Code Map targets `src/middleware.ts`.
 */

/** Top-level paths that are public and must never be treated as a tenant slug. */
const PUBLIC_TOP_LEVEL = new Set(["", "generate", "demo", "privacy", "terms"]);

export async function middleware(request: NextRequest): Promise<NextResponse> {
  // Build a response we can attach refreshed cookies to.
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  // Without Supabase env we cannot refresh a session; pass through (dev safety).
  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // IMPORTANT: getUser() refreshes the session and triggers the cookie writes
  // above. Do not run other logic between creating the client and this call.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;
  const firstSegment = pathname.split("/")[1] ?? "";

  // A single top-level segment that is NOT a known public path is a tenant slug
  // and is protected. (`/api/*` and `/auth/*` are excluded by the matcher.)
  const isProtectedSlug =
    firstSegment !== "" && !PUBLIC_TOP_LEVEL.has(firstSegment);

  if (isProtectedSlug && !user) {
    const loginUrl = new URL("/", request.nextUrl.origin);
    loginUrl.searchParams.set("auth", "required");
    return NextResponse.redirect(loginUrl);
  }

  return response;
}

export const config = {
  // Run on application routes, excluding Next internals, static assets, API,
  // and the auth callback (which manages its own session exchange).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|icons/|sw.js|api/|auth/).*)",
  ],
};
