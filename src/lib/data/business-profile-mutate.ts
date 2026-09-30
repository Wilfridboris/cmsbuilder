import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { BusinessProfileRow } from "@/types/db";
import type { BusinessProfileWritable } from "@/app/api/business-profile/schemas";

/**
 * Guarded Business Profile mutation layer (Story 12.1) — the single, targeted path
 * that upserts an org's singleton `business_profiles` row.
 *
 * Deliberately mirrors `schema-mutate.ts`'s identity-agnostic contract: the caller
 * supplies an RLS-scoped Supabase client and the acting identity, so this layer
 * never reads cookies and never touches the service-role key. The upsert runs under
 * the caller's RLS client, and the `business_profiles_tenant_isolation` policy scopes
 * it to the caller's own org — a cross-tenant write is impossible.
 *
 * The row is keyed by `organization_id` (UNIQUE / primary key), so the upsert is a
 * last-write-wins save: first save inserts, a later save with changes updates the
 * same row. `actor_id` records the writer; `logo_path` is NOT written here — it is
 * server-owned and persisted only by the logo route, so a plain profile save never
 * clobbers an existing logo.
 */

export type BusinessProfileMutateIdentity = {
  /** RLS-scoped Supabase client (never the service-role admin client). */
  client: SupabaseClient;
  /** The acting user id, recorded in `actor_id`. */
  actorId: string;
  /** The org whose profile is being saved; scopes the upsert. */
  orgId: string;
};

/**
 * Upsert the org's singleton Business Profile from validated writable columns.
 * Returns the persisted row in the `ApiResponse` envelope; raw SQL is never leaked.
 * `logo_path` is intentionally excluded from the write set so a profile save
 * preserves any previously uploaded logo.
 */
export async function upsertBusinessProfile(
  identity: BusinessProfileMutateIdentity,
  writable: BusinessProfileWritable,
): Promise<ApiResponse<BusinessProfileRow>> {
  try {
    const { client, actorId, orgId } = identity;

    const { data, error } = await client
      .from("business_profiles")
      .upsert(
        {
          organization_id: orgId,
          ...writable,
          actor_id: actorId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "organization_id" },
      )
      .select("*")
      .single();

    if (error || !data) {
      throw new AppError(500, "writeFailed", error?.message);
    }

    return { data: data as BusinessProfileRow, error: null };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Persist ONLY the `logo_path` for the org's singleton profile (called by the logo
 * route after a validated upload). If no profile row exists yet, this inserts a
 * minimal placeholder so the logo key is not lost — legal name is required at the
 * DB level, so the placeholder carries an empty legal name that the owner fills in
 * on their next profile save. Returns the persisted row.
 */
export async function setBusinessProfileLogoPath(
  identity: BusinessProfileMutateIdentity,
  logoPath: string,
): Promise<ApiResponse<BusinessProfileRow>> {
  try {
    const { client, actorId, orgId } = identity;

    // Read the current row (if any) under RLS so we upsert without disturbing
    // the other identity columns.
    const { data: existing, error: readError } = await client
      .from("business_profiles")
      .select("organization_id")
      .eq("organization_id", orgId)
      .maybeSingle();

    if (readError) {
      throw new AppError(500, "writeFailed", readError.message);
    }

    if (existing) {
      const { data, error } = await client
        .from("business_profiles")
        .update({
          logo_path: logoPath,
          actor_id: actorId,
          updated_at: new Date().toISOString(),
        })
        .eq("organization_id", orgId)
        .select("*")
        .single();
      if (error || !data) {
        throw new AppError(500, "writeFailed", error?.message);
      }
      return { data: data as BusinessProfileRow, error: null };
    }

    // No profile yet — insert a minimal row carrying the logo. legal_name is NOT
    // NULL, so seed it empty; the owner completes it on the next profile save.
    const { data, error } = await client
      .from("business_profiles")
      .insert({
        organization_id: orgId,
        legal_name: "",
        logo_path: logoPath,
        actor_id: actorId,
      })
      .select("*")
      .single();
    if (error || !data) {
      throw new AppError(500, "writeFailed", error?.message);
    }
    return { data: data as BusinessProfileRow, error: null };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}
