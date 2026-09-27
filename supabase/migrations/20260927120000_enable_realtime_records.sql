-- ===========================================================================
-- Story 3.6 — Real-Time Multi-User Sync.
--
-- Add `public.records` to the `supabase_realtime` publication so the
-- authenticated dashboard can subscribe to a `postgres_changes` channel and
-- receive INSERT/UPDATE events for its organization's rows in near real time.
--
-- No `replica identity full`: app "deletes" are soft (an UPDATE of `deleted_at`),
-- so every relevant event is INSERT/UPDATE and its payload carries
-- `organization_id` under the default replica identity. That is what lets the
-- per-org channel filter (`organization_id=eq.<orgId>`) work without the extra
-- WAL cost of full replica identity. RLS (`records_tenant_isolation`, membership
-- via `auth_org_ids()`) remains the real tenant boundary; the filter is only a
-- delivery optimization.
-- ===========================================================================

alter publication supabase_realtime add table public.records;
