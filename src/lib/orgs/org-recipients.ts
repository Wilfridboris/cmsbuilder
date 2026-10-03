import "server-only";

import { AppError } from "@/types/api";
import type { BusinessProfileLanguage } from "@/types/db";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Shared org-notification recipient helpers (Story 6.4).
 *
 * Extracted verbatim from the trial-lifecycle cron (Story 7.4) so the cron and the
 * public intake-notification path (Story 6.4) share one implementation of "who are
 * this org's admins, and in what language do we write to them". Both run through the
 * service-role admin client (platform-ops paths that act across tenants), so this is
 * `server-only` and never reaches a client bundle.
 */

/**
 * Resolve the org's notification recipients: every admin member's email. Uses the
 * service-role GoTrue admin API to map `org_members` (role 'admin') user ids to
 * emails. A member with no resolvable email is skipped (never a crash).
 */
export async function resolveAdminEmails(
  adminClient: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<string[]> {
  const { data: admins, error } = await adminClient
    .from("org_members")
    .select("user_id")
    .eq("organization_id", orgId)
    .eq("role", "admin");
  if (error) {
    throw new AppError(500, "genericError", error.message);
  }

  const emails: string[] = [];
  for (const row of (admins ?? []) as { user_id: string }[]) {
    const { data, error: userError } =
      await adminClient.auth.admin.getUserById(row.user_id);
    if (userError || !data?.user?.email) {
      continue;
    }
    emails.push(data.user.email);
  }
  return emails;
}

/** Resolve the org's default language (its business profile), defaulting to 'en'. */
export async function resolveOrgLanguage(
  adminClient: ReturnType<typeof createAdminClient>,
  orgId: string,
): Promise<BusinessProfileLanguage> {
  const { data } = await adminClient
    .from("business_profiles")
    .select("default_language")
    .eq("organization_id", orgId)
    .maybeSingle();
  const lang = (data as { default_language?: string } | null)?.default_language;
  return lang === "fr" ? "fr" : "en";
}
