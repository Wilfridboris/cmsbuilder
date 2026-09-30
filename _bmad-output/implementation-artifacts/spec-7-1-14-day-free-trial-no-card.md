---
title: '14-Day Free Trial (No Card)'
type: 'feature'
created: '2026-09-30'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'ea56d5ece6c22d42ad3cdcdc8cae32b8b9884ee6'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Newly claimed Scheza accounts have no subscription/trial state — the `organizations` table has no billing columns, so nothing records that an account is in a 14-day trial and later billing/gating stories (7.2–7.5) have no access source of truth to read. FR29 requires a 14-day, no-card trial that begins when the account is claimed.

**Approach:** Add `subscription_status` and `trial_expires_at` to the `organizations` record and stamp `subscription_status='trial'` with a 14-day expiry at claim finalization — once, idempotently. No payment is collected and no quota is imposed: the trial grants full unlimited read-write access, and the org's cached subscription state becomes the single authoritative access state later stories read and gate on.

## Boundaries & Constraints

**Always:**
- The trial clock starts at claim finalization (the account becoming real), not at anonymous session-org creation. Expiry = claim time + 14 days.
- Trial stamping is idempotent: re-running claim finalization (including consumed-token re-entry or a mid-sequence retry) must never reset an already-started trial clock.
- `subscription_status` on the org is the cached access source of truth; during trial the account has full unlimited access (records, team members) with no quota, meter, or payment prompt.
- Follow existing migration conventions (timestamped SQL in `supabase/migrations`, CHECK constraint on the status column, column comments) and keep `src/types/db.ts` `OrganizationRow` in sync with the schema.

**Never:**
- Never request or collect payment information anywhere in this story (FR29).
- Never introduce record/team-member quotas, usage meters, or spend caps (flat-tier model).
- Never add read-only gating logic — 7.1 only records state; enforcement on lapse is Story 7.4.
- Never build the trial-expiry banner (Story 7.4), the billing/tier card (Story 7.5), Stripe Checkout, or webhooks — this story is the trial-state foundation only.
- Never add any user-facing UI in 7.1 — **decided backend-only** (schema + claim-flow wiring + tests); every trial surface is deferred to Story 7.4/7.5, so the `/web-uiux-architect` skill is not exercised this story.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First claim finalize | Session org with `trial_expires_at` null; valid unconsumed token | Org `subscription_status='trial'`, `trial_expires_at` = claim time + 14 days | Existing claim error paths unchanged |
| Idempotent re-entry | Token already consumed (`consumed_at` set) | Returns slug; `trial_expires_at` unchanged (clock not reset) | N/A |
| Retry before consume | `finalizeClaim` re-runs with `trial_expires_at` already set | Trial fields left as-is (guarded on null) | N/A |
| Anonymous session org | `resolveOrg` upsert, pre-claim | `subscription_status` defaults to `'trial'`, `trial_expires_at` null (clock not started) | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/20260924055022_platform_schema.sql` -- current `organizations` table (id, name, slug, created_at, updated_at) and CHECK-constraint style (`check (role in (...))`); new migration mirrors it.
- `supabase/migrations/` -- destination for the NEW timestamped migration; latest existing is `20260929120000_constrain_invoice_money_columns_numeric_15_2.sql`, so the new file sorts after it.
- `src/lib/claim/claim.ts` -- `finalizeClaim()` (~230-242) updates the org (slug/name) on first claim; trial stamping goes here. Note the consumed-token early return at ~196-202 (idempotent re-entry) that returns before this block.
- `src/lib/generation/provision.ts` -- `resolveOrg()` (~96-114) upserts anonymous session orgs; relies on the DB default for the new column, no code change expected.
- `src/types/db.ts` -- `OrganizationRow` (~94-100); add the two fields plus a `SubscriptionStatus` union.
- `tests/unit/claim.test.ts` -- existing `finalizeClaim` unit tests; extend with trial-stamping + idempotency assertions.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20260930120000_add_subscription_trial_to_organizations.sql` -- NEW migration: `alter table public.organizations add column subscription_status text not null default 'trial'` with `check (subscription_status in ('trial','active'))`, and `add column trial_expires_at timestamptz` (nullable); add column comments in repo style. Existing rows adopt the default.
- [x] `src/lib/claim/claim.ts` -- in `finalizeClaim`, after the slug/name update, add a guarded org update that sets `subscription_status='trial'` and `trial_expires_at` = now + 14 days, filtered `.is("trial_expires_at", null)` so the clock starts exactly once at first claim and is never reset on retry/re-entry. Surface failures via the existing `ClaimError("failed", ...)` pattern.
- [x] `src/types/db.ts` -- extend `OrganizationRow` with `subscription_status: SubscriptionStatus` and `trial_expires_at: string | null`; add `export type SubscriptionStatus = "trial" | "active";`.
- [x] `tests/unit/claim.test.ts` -- add unit tests covering the I/O matrix: first finalize stamps `status='trial'` and expiry ≈14 days out (with tolerance); a second finalize (consumed token / re-run) leaves `trial_expires_at` unchanged; assert no payment or quota side effect is introduced.

**Acceptance Criteria:**
- Given a newly claimed account, when claim finalization runs, then the org's `subscription_status` is `'trial'` and `trial_expires_at` is 14 days from claim time, and no payment information is requested at any point (FR29).
- Given an account in trial, when the user creates records or invites team members, then no quota, meter, or payment gate blocks them (unlimited access during trial).
- Given a claim finalized more than once (idempotent re-entry or a mid-sequence retry), when finalization re-runs, then the original `trial_expires_at` is preserved (the trial clock is never reset).
- Given the org's cached `subscription_status`, when later stories read access state, then the `organizations` row is the single authoritative source (no separate trial table).

## Implementation Notes

- Migration `supabase/migrations/20260930120000_add_subscription_trial_to_organizations.sql`: two additive columns on `organizations`, `subscription_status text not null default 'trial'` (CHECK `in ('trial','active')`) + nullable `trial_expires_at`, with repo-style column comments.
- `src/lib/claim/claim.ts`: added exported `TRIAL_DURATION_MS = 14 days`; in `finalizeClaim`, step "5b" is a separate guarded update (`.eq("id", orgId).is("trial_expires_at", null)`) so the clock stamps exactly once. The consumed-token early return preserves idempotent re-entry; failures use the existing `ClaimError("failed", ...)` path.
- `src/types/db.ts`: `SubscriptionStatus` union + two fields on `OrganizationRow`.
- `tests/unit/claim.test.ts`: fake `OrgsQuery` extended with a lazy thenable + `.is()` null-filter so both the always-run slug update and the guarded trial update apply correctly; added trial assertions and a dedicated `finalizeClaim — trial stamping` block.
- Verified independently (not just via the implementer report): `npm run test -- tests/unit/claim.test.ts` → 28 passed; `type-check` clean; `lint` clean (only the pre-existing eslintrc-deprecation warning). Matrix row 4 (anonymous session-org default) is a schema-level guarantee not exercisable by the mock client — confirmed directly on the linked `snapbusy-test` project: `subscription_status` default `'trial'::text` NOT NULL, `trial_expires_at` nullable no-default, CHECK `(trial|active)` present, and all 174 existing rows adopted `'trial'` with null expiry.
- Note: `npm run db:reset` could not run locally (Docker/Supabase not up); the migration was instead validated against the linked test project via MCP. The repo migration file is authoritative for local `db reset`/`db push`.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **EC-1 (edge-case) — `low` → patch.** claim.ts step-5b comment claims the `.is("trial_expires_at", null)` guard makes 5b a no-op on *consumed-token re-entry*. Verified inaccurate: the consumed-token path returns early (claim.ts ~203) before reaching 5b, so the early return — not the guard — preserves the clock there; the guard protects the not-yet-consumed mid-sequence retry. Trivial comment correction, no behavior/surface change.
- **BH-1 (blind) — `low` → reject.** "Pre-existing claimed orgs get `trial`/null-expiry and are never re-stamped." True mechanically, but unlikely to be met: this is a pre-production greenfield app with no production legacy data (the 169 claimed rows are shared-test-project data), `trial`+null is a spec-documented valid state, and a backfill would require inventing trial-start values for orgs whose claim time is unknown (more than a direct correction). Reject per low-rule.
- **BH-2 (blind) — `low` → reject.** "Add a cross-column CHECK forcing `trial_expires_at` non-null when status=`trial`." The `trial`/null state is intended for unclaimed session orgs (I/O matrix row 4); there is no `claimed` column to condition the CHECK on, so the guard would forbid a permitted state. No named harm; fix adds complexity.
- **BH-3 (blind) — `low` → reject.** "No partial index on `trial_expires_at` for 7.4's lapse sweep." No query reads the column in this change; the lapse-sweep reader and its index belong to Story 7.4. Pre-emptive surface for a non-existent query; no current harm.
- **BH-4 (blind) — `false`.** "Required new `OrganizationRow` fields break other literals / type-check." Refuted: `npm run type-check` passed clean, and both other layers confirmed `OrganizationRow` is only referenced as a type, never constructed as a literal elsewhere. The test's local `OrgRow` is a separate intentionally-partial fake, not the production row.
- **BH-5 (blind) — `low` → reject.** "`FinalizeClaimResult` not extended to return trial fields on re-entry." 7.1 has no requirement to return trial fields and no consumer reads them (repo-wide search found none); extending the result adds public surface for no caller.
- **BH-6 (blind) — `low` → reject.** "Redundant `updated_at` double-write across step 5 and 5b." The split is required by design: step 5 (slug/name) must always run; step 5b must be separately guarded by `.is(null)` — they cannot merge without breaking one guarantee. One extra write on the one-time claim path is negligible.
- **BH-7 (blind) — `low` → reject.** "Test tolerance is one-sided; comment says 'drift'." Cosmetic test-comment nit; the test passes with a 60s window and the behavior is correct.
- **BH-8 (blind) — `low` → reject.** "Migration lacks `if not exists` / rollback." Matches repo convention — Supabase forward-only migrations; no existing migration guards `add column` or ships a down migration.
- **verification-gap — no findings.** Layer reported "No verification gaps found"; its observation (migration default/CHECK are verified by the HAS_ENV-gated integration suite, matching repo convention) is explicitly not a gap.

## Design Notes

- The CHECK constraint allows only `('trial','active')` — the two states in play through Story 7.2. Story 7.4 (read-only gating) will `ALTER` the constraint to add lapse/grace states once their naming is settled; 7.1 deliberately does not pre-lock those still-ambiguous names, and does not decide whether the column stores app-level access states or raw Stripe statuses.
- The trial clock is stamped in application code rather than as a DB default because it must begin at claim, not at row creation; the anonymous session org keeps `trial_expires_at` null until claimed.
- Idempotency comes from a *separate* guarded update (`.is("trial_expires_at", null)`) so the always-run slug/name update at ~232 stays intact while trial stamping fires exactly once.

## Verification

**Commands:**
- `npm run test -- tests/unit/claim.test.ts` -- expected: all claim unit tests pass, including the new trial-stamping and idempotency assertions.
- `npm run type-check` -- expected: no type errors (all `OrganizationRow` consumers compile against the new fields).
- `npm run lint` -- expected: clean.
- `npm run db:reset` -- expected: the new migration applies cleanly and `organizations` has `subscription_status` (default `'trial'`) and `trial_expires_at`.
