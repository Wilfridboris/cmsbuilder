import "server-only";

import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report";

/**
 * Shared HTTP helpers for the records/schema API routes (Story 3.2+). Every one
 * of those routes repeats the same three seams — envelope response, org-by-slug
 * resolution under RLS, and error collapsing — so they live here once. Any new
 * route (Epic 4 import, etc.) reuses these instead of copying a fresh set.
 *
 * `import "server-only"`: these touch cookies and the server Supabase client and
 * must never enter a client bundle.
 */

/** JSON `{ data, error }` envelope response with an explicit status. */
export function json<T>(
  body: ApiResponse<T>,
  status: number,
): NextResponse<ApiResponse<T>> {
  return NextResponse.json(body, { status });
}

/** The caller's RLS-scoped client plus the resolved acting identity + org id. */
export type OrgIdentity = {
  client: SupabaseClient;
  actorId: string;
  orgId: string;
};

/**
 * Resolve the org id for `slug` under the caller's RLS-scoped client. RLS returns
 * the row only for a member, so a non-member (or bad slug) yields nothing → a
 * `forbidden` AppError. Mirrors `[slug]/page.tsx`. Never uses the admin client
 * and never trusts a client-supplied org id.
 */
export async function resolveOrgIdentity(
  slug: string,
  actorId: string,
): Promise<OrgIdentity> {
  const cookieStore = await cookies();
  const client = createServerSupabaseClient(cookieStore);

  const { data: org, error } = await client
    .from("organizations")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw new AppError(500, "genericError", error.message);
  }
  if (!org) {
    // RLS hid the org (non-member) or the slug does not exist — same outcome.
    throw new AppError(403, "forbidden");
  }

  return { client, actorId, orgId: org.id as string };
}

/**
 * Require an authenticated session, returning the Supabase `User` (Story 12.x, retro
 * [A2]). Throws `401 unauthorized` when there is no session. Every invoice/business-profile
 * route calls this BEFORE parsing the body so an unauthenticated request never reaches
 * request-body handling — shared here so the 8 invoice routes stop each redefining it.
 */
export async function requireUser(): Promise<User> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AppError(401, "unauthorized");
  }
  return user;
}

/**
 * Resolve the acting admin's org identity for `slug` (Story 12.x, retro [A2]): resolve the
 * org under the caller's RLS client, then require the caller be an admin of the SAME org
 * (the membership slug must equal the addressed slug, else `403 forbidden`). Mirrors the
 * gate every invoice route repeated locally; extracted so there is one definition.
 */
export async function resolveAdminIdentity(
  slug: string,
  user: User,
): Promise<OrgIdentity> {
  const identity = await resolveOrgIdentity(slug, user.id);
  const membership = await requireAdmin(user, createAdminClient());
  if (membership.slug !== slug) {
    throw new AppError(403, "forbidden");
  }
  return identity;
}

/**
 * Collapse any thrown value into the `{ data, error }` envelope. An `AppError`
 * keeps its status + translated code; anything else is masked as a 500. 5xx are
 * logged via `reportError` tagged with `route`. Raw SQL/stacks are never leaked.
 */
export function handleError<T>(
  err: unknown,
  route: string,
): NextResponse<ApiResponse<T>> {
  if (err instanceof AppError) {
    if (err.statusCode >= 500) {
      reportError(err, { route });
    }
    return json<T>({ data: null, error: err.userMessage }, err.statusCode);
  }
  reportError(err, { route });
  return json<T>({ data: null, error: "genericError" }, 500);
}
