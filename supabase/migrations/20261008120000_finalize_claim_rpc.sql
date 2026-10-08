-- ===========================================================================
-- Story 15.1 — finalize_claim() RPC (atomic claim promotion)
--
-- finalizeClaim (src/lib/claim/claim.ts) previously ran five sequential
-- service-role writes with no wrapping transaction: a mid-sequence fault could
-- leave a half-provisioned org (membership created but no slug, trial started
-- but records not cleared, etc). This RPC performs those writes in ONE
-- transaction so the promotion is all-or-nothing.
--
-- Modeled on issue_invoice() (20260928120900_issue_invoice.sql): a single
-- plpgsql function doing only the atomic state change. Token resolution,
-- idempotent-re-entry (consumed_at), and the expiry check stay in the TS layer
-- (so the shared ClaimError semantics and the cross-device /auth/confirm
-- contract are unchanged); this function is called only once the TS side has
-- confirmed the claim is unconsumed and unexpired.
--
-- SECURITY DEFINER: the TS caller already holds the service-role client, but
-- running the function as its owner keeps it callable the same way regardless of
-- the invoking role and matches the bootstrap-only reach of pending_claims /
-- organizations / org_members (all RLS deny-all to anon/authenticated).
--
-- Idempotency / "exactly once" guarantees preserved inside the transaction:
--   * membership insert is ON CONFLICT DO NOTHING on the unique(org,user) index
--     (a duplicate is a no-op, never an error) — a not-yet-consumed retry is safe;
--   * the slug + display-name are NOT touched here (the business name was already
--     set on the org at claim-submit, and the slug is set below from the guarded
--     base resolved to uniqueness by the TS caller);
--   * the trial clock is set only when trial_expires_at IS NULL, so a retry never
--     resets an already-started trial;
--   * synthetic records are soft-deleted only where deleted_at IS NULL;
--   * the token is consumed (consumed_at set) only when still null.
--
-- The caller passes the already-resolved unique slug (ensureUniqueSlug runs in
-- TS against organizations.slug, excluding this org) so the function performs no
-- collision loop — it only writes the final value transactionally.
-- ===========================================================================

create or replace function public.finalize_claim(
  p_claim_id   uuid,
  p_org        uuid,
  p_user       uuid,
  p_slug       text,
  p_actor      uuid,
  p_trial_until timestamptz
)
  returns void
  language plpgsql
  security definer
  set search_path = public
as $$
begin
  -- 1. Admin membership (human). Idempotent on the unique(organization_id,user_id)
  --    index: a duplicate from a mid-sequence retry is a no-op, not a failure.
  insert into public.org_members (id, organization_id, user_id, principal_type, role)
    values (gen_random_uuid(), p_org, p_user, 'human', 'admin')
    on conflict (organization_id, user_id) do nothing;

  -- 2. Set the resolved unique slug on the org. The display name was written at
  --    claim-submit and is deliberately left untouched here (Story 15.1: the
  --    typed business name is authoritative; no slug round-trip).
  update public.organizations
    set slug       = p_slug,
        updated_at = now()
    where id = p_org;

  -- 3. Start the 14-day no-card trial exactly once. The guard makes a retry a
  --    no-op once the clock is already set.
  update public.organizations
    set subscription_status = 'trial',
        trial_expires_at    = p_trial_until,
        updated_at          = now()
    where id = p_org
      and trial_expires_at is null;

  -- 4. Soft-delete the synthetic demo records (data retained, excluded from reads).
  update public.records
    set deleted_at = now(),
        actor_id   = p_actor,
        updated_at = now()
    where organization_id = p_org
      and deleted_at is null;

  -- 5. Consume the token so a later callback with the same token no-ops. Guarded
  --    on consumed_at so a retry does not re-stamp it.
  update public.pending_claims
    set consumed_at = now()
    where id = p_claim_id
      and consumed_at is null;
end;
$$;

comment on function public.finalize_claim(uuid, uuid, uuid, text, uuid, timestamptz) is
  'Story 15.1 — atomically promote a claimed session org in ONE transaction: '
  'admin membership insert (idempotent on unique(org,user)), set the pre-resolved '
  'unique slug (display name untouched — set at claim-submit), start the 14-day '
  'trial exactly once (trial_expires_at IS NULL guard), soft-delete synthetic '
  'records, and consume the pending-claim token. Token resolution, consumed/expiry '
  'checks, and slug uniqueness run in the mutation layer before this call.';

-- This is a SECURITY DEFINER bootstrap function reached ONLY by the service-role
-- admin client (which bypasses grants). Unlike the SECURITY INVOKER issue_invoice
-- RPC, it must NOT be reachable via PostgREST by anon / authenticated: a signed-in
-- caller could otherwise invoke it with arbitrary args to promote an arbitrary org
-- to themselves, bypassing the token/expiry gate that lives in the TS layer. Revoke
-- PUBLIC + role EXECUTE so only service_role can call it (matching the deny-all RLS
-- on pending_claims / org_members / organizations).
revoke execute on function public.finalize_claim(uuid, uuid, uuid, text, uuid, timestamptz) from public;
revoke execute on function public.finalize_claim(uuid, uuid, uuid, text, uuid, timestamptz) from anon;
revoke execute on function public.finalize_claim(uuid, uuid, uuid, text, uuid, timestamptz) from authenticated;
