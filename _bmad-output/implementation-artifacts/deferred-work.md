# Deferred Work

- source_spec: `_bmad-output/implementation-artifacts/spec-1-2-platform-data-model-tenant-isolation.md`
  summary: The idempotency unique-violation (23505) race-recovery branch in mutate.ts insertRecord is untested.
  evidence: The FakeClient never returns a Postgres unique violation, so the de-dupe unit test only exercises the pre-insert lookup path; the concurrent-retry branch (guarded by records_idempotency_key_idx) has zero coverage. Settling it needs a fake that models the partial-unique index and returns 23505, or a concurrent-insert case in the real-Supabase integration suite.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-4-ai-schema-synthetic-data-generation.md`
  summary: Ephemeral pre-claim anonymous organizations minted per generation session have no TTL/cleanup mechanism.
  evidence: Story 1.4's resolved persistence decision mints a real organizations row per anonymous generation session (reusing records/org_schemas, read via admin client). Unclaimed sessions accumulate orphan orgs indefinitely. Needs a scheduled cleanup (cron) of pre-claim orgs older than a TTL (architecture implies 24h) that were never promoted via org_members at claim — belongs with the cross-org cron/offboarding work (Epic 8) or a dedicated maintenance story.

- source_spec: `_bmad-output/implementation-artifacts/spec-1-5-hard-fallback-template.md`
  summary: When the hard fallback provisions into a REUSED session org that a prior successful generation already seeded with a same-normalized table_key (e.g. `clients`), read-back merges both row sets into the visible reveal.
  evidence: The Story 1.5 fallback reuses `existingOrgId` from the session cookie and provisions its clients/jobs/invoices template; `listRecords(admin, orgId, "clients")` then returns the prior real-generation rows PLUS the new `fallback-clients-*` rows under one table, showing a mixed dataset. The `idempotencyPrefix` change deliberately prevents key-collision dedup but not row coexistence. Only reachable on same-session real-generation → double-failure with a colliding normalized table_key; the primary single-generation flow is unaffected. A correct fix is non-trivial (Story 1.4's review established that soft-delete-before-reseed collides with the 1.2 partial-unique idempotency index — it needs content-based keys or an index change) and belongs with the same reused-org/ephemeral-org cleanup + claim-time reset work (the claim flow clears synthetic/demo data anyway).
