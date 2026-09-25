-- ===========================================================================
-- Story 2.1 follow-up — members must read their own organization row.
--
-- Epic 1's platform_schema left `organizations` with RLS enabled but NO policy
-- (service-role bootstrap only). Now that Epic 2 introduces authenticated
-- members, the post-claim /{slug} dashboard resolves the org by reading
-- `organizations` under the caller's RLS-scoped client — which returned nothing
-- (deny-all), so a legitimate Admin could not view their own dashboard.
--
-- Add a membership-scoped SELECT policy mirroring the org_schemas / records
-- tenant-isolation policies. Read-only: members may SELECT organizations they
-- belong to (via auth_org_ids()); INSERT/UPDATE/DELETE remain service-role only
-- (org provisioning stays in the claim bootstrap; org mutation is later work).
-- Cross-tenant isolation is preserved — a member sees only their own org rows.
-- ===========================================================================

create policy organizations_member_read
  on public.organizations
  for select
  using (id in (select public.auth_org_ids()));
