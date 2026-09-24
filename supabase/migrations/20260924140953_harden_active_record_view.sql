-- ===========================================================================
-- Story 1.2 follow-up — harden the metering view (found by Supabase security
-- advisors after the platform_schema migration was applied to a real project).
--
-- Postgres views default to SECURITY DEFINER, so `org_active_record_counts`
-- would run as its creator and BYPASS RLS on `records` — leaking cross-tenant
-- active-record counts to any caller via /rest/v1. Recreate it as
-- security_invoker so direct API reads honor the querying user's RLS. The
-- service-role metering path (Epic 7) still sees all rows — it bypasses RLS
-- regardless of this setting.
-- ===========================================================================

drop view if exists public.org_active_record_counts;

create view public.org_active_record_counts
  with (security_invoker = on) as
  select
    organization_id,
    count(*)::bigint as active_record_count
  from public.records
  where deleted_at is null
  group by organization_id;

comment on view public.org_active_record_counts is
  'Billable unit: the count of non-deleted (active) records per organization. '
  'security_invoker=on so direct API reads honor RLS on records; service-role '
  'metering bypasses RLS as before. Defined in the model now so metering needs '
  'no later migration.';
