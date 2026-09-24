import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Service-role (bootstrap-only) Supabase client.
 *
 * BOOTSTRAP / PLATFORM OPS ONLY. This client uses the service-role key, which
 * bypasses RLS. Per architecture.md (NFR-FC1) it is permitted only for narrow
 * platform-bootstrap paths — in Story 1.2: seeding the fixed demo org and the
 * pre-auth demo read. It MUST NEVER write tenant rows on behalf of an
 * authenticated user (that path is the RLS-scoped `server.ts` client) and MUST
 * NEVER be imported into any client-bundled file. `server-only` and the ESLint
 * service-role gate enforce this.
 */
export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY for the admin client.",
    );
  }

  return createClient(url, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
