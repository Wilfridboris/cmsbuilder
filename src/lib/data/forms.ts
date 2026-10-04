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

/**
 * Published-gated read for the PUBLIC per-form route (Epic 14, Story 14.2).
 *
 * Load a single PUBLISHED form by its `(organization_id, slug)` within the org, or
 * `null` when none matches (unknown slug, or a form that exists but is unpublished).
 * The caller supplies the service-role admin client (the public visitor has no
 * session); the explicit `organization_id` + `published = true` filters are the gate,
 * so an unpublished or cross-org form never comes back. Reads never surface raw SQL —
 * an error throws a generic message the resolver collapses to `null`.
 */
export async function getPublishedFormBySlug(
  client: SupabaseClient,
  orgId: string,
  slug: string,
): Promise<FormRow | null> {
  const { data, error } = await client
    .from("forms")
    .select("*")
    .eq("organization_id", orgId)
    .eq("slug", slug)
    .eq("published", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load form: ${error.message}`);
  }

  return (data as FormRow | null) ?? null;
}

/**
 * The org's PRIMARY published form for the legacy bare-org route (Epic 14, Story 14.2).
 *
 * With no `published_at` column, "primary" is the oldest published row by `created_at`
 * (the original, most stable form). Returns `null` when the org has no published form
 * (the default state until publishing lands in 14.3). The caller supplies the
 * service-role admin client; `published = true` is the gate. A secondary `id` sort
 * makes the choice fully deterministic when two forms share a `created_at`.
 */
export async function getPrimaryPublishedForm(
  client: SupabaseClient,
  orgId: string,
): Promise<FormRow | null> {
  const { data, error } = await client
    .from("forms")
    .select("*")
    .eq("organization_id", orgId)
    .eq("published", true)
    .order("created_at", { ascending: true })
    .order("id", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load form: ${error.message}`);
  }

  return (data as FormRow | null) ?? null;
}
