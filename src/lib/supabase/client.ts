import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Browser anon client (seam).
 *
 * Uses the public anon key + the browser's session cookies, so it too is
 * RLS-scoped to the signed-in user. Unused by Story 1.2 routes; provided so the
 * client-side data seam exists for later interactive stories.
 */
export function createBrowserSupabaseClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY for the browser client.",
    );
  }

  return createBrowserClient(url, anonKey);
}
