import "server-only";

import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";

import { createServerSupabaseClient } from "@/lib/supabase/server";

/**
 * Server-side identity helper (Story 2.1) — the single source for "who is the
 * authenticated caller" on protected routes (`/{slug}` today; invite/settings
 * later).
 *
 * Reads the session from the request cookies through the RLS-scoped server
 * client and returns the authenticated `User`, or `null` when there is no valid
 * session. Uses `getUser()` (which validates the JWT with the auth server)
 * rather than `getSession()` (which trusts the cookie) so a tampered cookie can
 * never impersonate a user.
 */
export async function getCurrentUser(): Promise<User | null> {
  const cookieStore = await cookies();
  const supabase = createServerSupabaseClient(cookieStore);

  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    return null;
  }
  return data.user;
}
