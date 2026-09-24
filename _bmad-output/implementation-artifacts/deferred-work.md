# Deferred Work

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-platform-data-model-tenant-isolation.md`
  summary: The idempotency unique-violation (23505) race-recovery branch in mutate.ts insertRecord is untested.
  evidence: The FakeClient never returns a Postgres unique violation, so the de-dupe unit test only exercises the pre-insert lookup path; the concurrent-retry branch (guarded by records_idempotency_key_idx) has zero coverage. Settling it needs a fake that models the partial-unique index and returns 23505, or a concurrent-insert case in the real-Supabase integration suite.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-ai-schema-synthetic-data-generation.md`
  summary: Ephemeral pre-claim anonymous organizations minted per generation session have no TTL/cleanup mechanism.
  evidence: Story 1.4's resolved persistence decision mints a real organizations row per anonymous generation session (reusing records/org_schemas, read via admin client). Unclaimed sessions accumulate orphan orgs indefinitely. Needs a scheduled cleanup (cron) of pre-claim orgs older than a TTL (architecture implies 24h) that were never promoted via org_members at claim — belongs with the cross-org cron/offboarding work (Epic 8) or a dedicated maintenance story.
