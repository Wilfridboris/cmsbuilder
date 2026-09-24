# Deferred Work

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-platform-data-model-tenant-isolation.md`
  summary: The idempotency unique-violation (23505) race-recovery branch in mutate.ts insertRecord is untested.
  evidence: The FakeClient never returns a Postgres unique violation, so the de-dupe unit test only exercises the pre-insert lookup path; the concurrent-retry branch (guarded by records_idempotency_key_idx) has zero coverage. Settling it needs a fake that models the partial-unique index and returns 23505, or a concurrent-insert case in the real-Supabase integration suite.
