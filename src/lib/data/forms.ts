import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { FormRow } from "@/types/db";

/**
 * Forms read layer (Epic 14, Story 14.1).
 *
 * Identity-agnostic: the caller supplies the RLS-scoped Supabase client, so a
 * cross-org form simply never comes back (the `forms_tenant_isolation` policy hides
 * it). The explicit `organization_id` filter is defense in depth and lets the query
 * use the org index. Reads are never gated and never surface raw SQL.
 */

/** List the org's forms, newest first. RLS scopes visibility to the caller's org. */
export async function listForms(
  client: SupabaseClient,
  orgId: string,
): Promise<FormRow[]> {
  const { data, error } = await client
    .from("forms")
    .select("*")
    .eq("organization_id", orgId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(`Failed to load forms: ${error.message}`);
  }

  return (data ?? []) as FormRow[];
}

/**
 * Load a single form by id within the org, or `null` when it does not exist under this
 * org (RLS-hidden cross-org id, or an unknown id). Lets the caller surface a 404 for a
 * cross-org / missing form id without leaking its existence.
 */
export async function getFormById(
  client: SupabaseClient,
  orgId: string,
  formId: string,
): Promise<FormRow | null> {
  const { data, error } = await client
    .from("forms")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", formId)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load form: ${error.message}`);
  }

  return (data as FormRow | null) ?? null;
}
