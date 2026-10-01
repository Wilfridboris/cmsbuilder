import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import type { SupabaseClient, User } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/auth/session";
import { requireAdmin } from "@/lib/auth/rbac";
import { createAdminClient } from "@/lib/supabase/admin";
import { reportError } from "@/lib/observability/report";
import { assertWritable } from "@/lib/billing/access";
import type { SubscriptionStatus } from "@/types/db";

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
  /**
   * The org's cached access state (Story 7.4), read for free as part of the
   * org-by-slug lookup. The writable-identity resolvers assert over these two
   * fields; plain reads ignore them (reads are never gated).
   */
  subscriptionStatus: SubscriptionStatus;
  trialExpiresAt: string | null;
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

  // Story 7.4: the org row carries the cached access state. Selecting it here
  // (alongside `id`) is free — it is the same lookup identity resolution already
  // performs — so the writable gate costs no extra query.
  const { data: org, error } = await client
    .from("organizations")
    .select("id, subscription_status, trial_expires_at")
    .eq("slug", slug)
    .maybeSingle();

  if (error) {
    throw new AppError(500, "genericError", error.message);
  }
  if (!org) {
    // RLS hid the org (non-member) or the slug does not exist — same outcome.
    throw new AppError(403, "forbidden");
  }

  return {
    client,
    actorId,
    orgId: org.id as string,
    subscriptionStatus: org.subscription_status as SubscriptionStatus,
    trialExpiresAt: (org.trial_expires_at as string | null) ?? null,
  };
}

/**
 * Resolve a *writable* org identity for `slug` (Story 7.4). Resolves the org under
 * RLS exactly like {@link resolveOrgIdentity}, then asserts the org may perform a
 * guarded write — a `read_only` org, or a `trial` whose `trial_expires_at` has
 * passed, is rejected with `AppError(403, "readOnly")` before the mutation.
 *
 * The read-only DECISION is single-sourced in `billing/access.ts` (`assertWritable`/
 * `isReadOnly`); this resolver is how a slug-based write route reaches it. Routes
 * whose shape does not fit a slug+RLS resolve reach the same predicate another way:
 * admin slug routes via {@link resolveWritableAdminIdentity}; the invite route (acts
 * on the caller's own membership org, no slug) via {@link assertOrgWritable}; the
 * import pipeline via `resolveImportRequest` + `assertWritable`. Read (GET) routes
 * stay on the plain {@link resolveOrgIdentity} and are never gated.
 */
export async function resolveWritableOrgIdentity(
  slug: string,
  actorId: string,
): Promise<OrgIdentity> {
  const identity = await resolveOrgIdentity(slug, actorId);
  assertWritable({
    subscription_status: identity.subscriptionStatus,
    trial_expires_at: identity.trialExpiresAt,
  });
  return identity;
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
 * Resolve a *writable* admin identity for `slug` (Story 7.4): the full admin gate of
 * {@link resolveAdminIdentity} PLUS the writable assertion. The admin/cross-org/
 * member gates still run first (so a non-admin sees 403 forbidden, not readOnly);
 * only an authorized admin of a non-writable org gets `AppError(403, "readOnly")`.
 * Admin-only write routes (invoices, business profile, schema) resolve this; their
 * GET siblings stay on {@link resolveAdminIdentity}.
 */
export async function resolveWritableAdminIdentity(
  slug: string,
  user: User,
): Promise<OrgIdentity> {
  const identity = await resolveAdminIdentity(slug, user);
  assertWritable({
    subscription_status: identity.subscriptionStatus,
    trial_expires_at: identity.trialExpiresAt,
  });
  return identity;
}

/**
 * Assert a guarded write is allowed for `orgId` using an already-resolved client
 * (Story 7.4 / retro [A1]). For a write route whose shape does not fit the slug-based
 * writable resolvers — the invite route acts on the caller's OWN membership org and
 * has no slug — this reads the two access fields and funnels them through the SAME
 * `assertWritable` predicate, so the read-only decision stays single-sourced in
 * `billing/access.ts` and is never re-derived inline. An absent row defaults to the
 * writable `trial`/null state (a real resolved membership always has a row).
 */
export async function assertOrgWritable(
  client: SupabaseClient,
  orgId: string,
): Promise<void> {
  const { data, error } = await client
    .from("organizations")
    .select("subscription_status, trial_expires_at")
    .eq("id", orgId)
    .maybeSingle();
  if (error) {
    throw new AppError(500, "genericError", error.message);
  }
  assertWritable({
    subscription_status: (data?.subscription_status ??
      "trial") as SubscriptionStatus,
    trial_expires_at: (data?.trial_expires_at as string | null) ?? null,
  });
}

/**
 * Authorize a Vercel Cron request via the shared `CRON_SECRET` bearer token, read at
 * call time (retro [A3c]). Throws `AppError(401, "unauthorized")` when the secret is
 * unset or the `Authorization` header is not `Bearer ${CRON_SECRET}` — the caller does
 * NO work on a bad token. Shared by the lifecycle + reconcile crons so the gate lives
 * in one place instead of being re-implemented per sweep.
 */
export function authorizeCron(req: NextRequest): void {
  const secret = process.env.CRON_SECRET;
  const header = req.headers.get("authorization");
  if (!secret || header !== `Bearer ${secret}`) {
    throw new AppError(401, "unauthorized");
  }
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
