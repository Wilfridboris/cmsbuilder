import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { cookies } from "next/headers";

/** The awaited return of Next's `cookies()` — the request cookie store. */
type CookieStore = Awaited<ReturnType<typeof cookies>>;

/**
 * RLS-scoped server client — the guarded seam for authenticated tenant access.
 *
 * Built from the anon key + the caller's session cookies via `@supabase/ssr`,
 * so every read/write runs under the acting user's org-scoped identity and is
 * subject to RLS. This is the client that authenticated routes will hand to
 * `mutate.ts` / `records.ts` once auth lands (Epic 2). No route uses it in
 * Story 1.2 — it exists so the data layer is identity-agnostic from day one.
 *
 * The caller supplies the cookie store (from `cookies()`), keeping this factory
 * free of a hard dependency on the request lifecycle.
 */
export function createServerSupabaseClient(
  cookieStore: CookieStore,
): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for the server client.",
    );
  }

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component where cookies are read-only. Safe to
          // ignore when a middleware refreshes the session on write paths.
        }
      },
    },
  });
}
