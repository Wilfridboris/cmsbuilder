import { NextResponse, type NextRequest } from 'next/server';

/**
 * Edge middleware seam.
 *
 * Story 1.1 (scaffold only): this is a pass-through. It is the documented seam
 * where later stories add:
 *   - Supabase session-cookie refresh (@supabase/ssr) — Story 1.2+
 *   - IP-based rate limiting for generation endpoints — later epic
 *
 * The active locale is resolved from the NEXT_LOCALE cookie in the next-intl
 * request config (src/lib/i18n/request.ts); no URL-prefix routing is used, so
 * no locale rewriting happens here. This file intentionally contains no
 * business logic.
 */
export function middleware(_request: NextRequest): NextResponse {
  return NextResponse.next();
}

export const config = {
  // Run on application routes, excluding Next internals and static assets.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|icons/|sw.js).*)'],
};
