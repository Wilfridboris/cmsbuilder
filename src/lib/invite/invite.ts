import "server-only";

import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { User } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { MemberRole } from "@/types/db";
import { requireAdmin } from "@/lib/auth/rbac";

/**
 * Core invite bootstrap (Story 2.3) — the narrow, service-role membership
 * provisioning for team invites, mirroring `finalizeClaim`.
 *
 * `inviteMember` is the single place the invite action:
 *   1. resolves the INVITER's org + asserts they are an `admin` of it (server-
 *      enforced authorization — a non-admin / non-member is rejected with a 403,
 *      never UI-only gating);
 *   2. handles the three membership cases for the invitee's email:
 *        - already a member of THIS org  → idempotent success (no duplicate row,
 *          no error) — a resend confirms they are on the team;
 *        - already a Scheza account NOT in this org → `409 accountExists`
 *          (cross-org add is deferred; the invitee cannot be silently moved);
 *        - a brand-new email → `admin.inviteUserByEmail` (creates the account +
 *          sends the branded Supabase→Resend invite email carrying the cross-
 *          device `token_hash` confirm link) with the chosen `role` on the user
 *          metadata, then inserts the `org_members` row scoped to the inviter's
 *          org with that same authoritative role.
 *
 * Role is written in BOTH places at invite time: `org_members.role` (durable,
 * per-org authority) and the user-metadata `role` via the invite `data` (the JWT
 * convenience 2.4 enforcement reads) — so an invited Member never transiently
 * reads as Admin. Login (2.2) never sends `data.role`, so sign-in cannot clobber
 * it.
 *
 * Never leaks provider output: every failure resolves to an `AppError` carrying
 * only a translated code.
 */

export type InviteMemberInput = {
  /** The authenticated caller (must be an admin of their org). */
  inviterUserId: string;
  /** The invitee's email (already trimmed + validated by the route). */
  email: string;
  /** The role to grant the invitee (Member preselected at the form). */
  role: MemberRole;
  /** Service-role client — the narrow membership-bootstrap seam. */
  adminClient: SupabaseClient;
  /** Request origin, for the `${origin}/auth/confirm` invite redirect. */
  origin: string;
};

/** Resolve an existing auth user's id by email via the admin `listUsers` scan. */
async function findUserIdByEmail(
  adminClient: SupabaseClient,
  email: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase();
  // GoTrue admin has no email filter; scan the (small, MVP-scale) user pages.
  for (let page = 1; page <= 50; page += 1) {
    const { data, error } = await adminClient.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) {
      throw new AppError(500, "genericError", `listUsers failed: ${error.message}`);
    }
    const users = data?.users ?? [];
    const match = users.find(
      (u) => (u.email ?? "").toLowerCase() === target,
    );
    if (match) {
      return match.id;
    }
    // Last page reached (fewer than a full page returned).
    if (users.length < 200) {
      break;
    }
  }
  return null;
}

/** True when the (org, user) membership already exists. */
async function isMemberOfOrg(
  adminClient: SupabaseClient,
  orgId: string,
  userId: string,
): Promise<boolean> {
  const { data, error } = await adminClient
    .from("org_members")
    .select("id")
    .eq("organization_id", orgId)
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    throw new AppError(500, "genericError", `membership read failed: ${error.message}`);
  }
  return Boolean(data);
}

export async function inviteMember(input: InviteMemberInput): Promise<void> {
  const { inviterUserId, email, role, adminClient, origin } = input;

  // 1. Assert the caller is an Admin of their org via the shared RBAC guard
  // (Story 2.4) — the single reusable enforcement primitive. A non-member or a
  // Member is rejected with a 403 before any create/send; the invite action is
  // admin-only and server-enforced (frontend hiding is never the sole gate).
  // The route already 401s a null caller, so `inviterUserId` is always present.
  const membership = await requireAdmin(
    { id: inviterUserId } as User,
    adminClient,
  );
  const { orgId } = membership;

  // 2. If the email already has a Scheza account, branch on membership: an
  // existing member of THIS org is an idempotent success; anyone else is a
  // deferred cross-org add (409). Only a brand-new email is invited below.
  const existingUserId = await findUserIdByEmail(adminClient, email);
  if (existingUserId) {
    if (await isMemberOfOrg(adminClient, orgId, existingUserId)) {
      // Idempotent resend to an existing teammate — no duplicate row, no error.
      return;
    }
    throw new AppError(409, "accountExists");
  }

  // 3. Brand-new invitee: create the account + send the branded invite email
  // (cross-device token_hash confirm link) with the role on user metadata.
  const { data: invited, error: inviteError } =
    await adminClient.auth.admin.inviteUserByEmail(email, {
      data: { role },
      redirectTo: `${origin}/auth/confirm`,
    });

  if (inviteError || !invited?.user) {
    // Provider/SMTP failure — never leak the raw message.
    throw new AppError(
      502,
      "sendFailed",
      `inviteUserByEmail failed: ${inviteError?.message ?? "no user returned"}`,
    );
  }

  // 4. Insert the org-scoped membership with the authoritative role. The unique
  // (organization_id, user_id) index makes a race/resend idempotent.
  const { error: memberError } = await adminClient.from("org_members").insert({
    id: randomUUID(),
    organization_id: orgId,
    user_id: invited.user.id,
    principal_type: "human",
    role,
  });
  if (memberError && memberError.code !== "23505") {
    throw new AppError(
      500,
      "genericError",
      `Failed to create membership: ${memberError.message}`,
    );
  }
}
