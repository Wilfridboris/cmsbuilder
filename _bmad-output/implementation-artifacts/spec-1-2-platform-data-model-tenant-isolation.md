---
title: 'Story 1.2: Platform Data Model & Tenant Isolation (Walking Skeleton)'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
baseline_commit: 'c68eff5a4a175df762c2fb8c7e95cd8ea5d43781'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The app is scaffolded but has no data layer. Every later Epic 1 story (LLM generation, fallback, dashboard) provisions into and reads from a multi-tenant store that does not exist, and the epic's hard rule — no org may read another org's rows, proven by an automated test before any data reaches the frontend — has nothing to enforce it yet.

**Approach:** Migrate the fixed platform schema via the Supabase CLI (`organizations`, `org_members`, shared-JSONB `records`, `org_schemas`) with a single static membership-based RLS policy on `records` backed by a `SECURITY DEFINER` `auth_org_ids()` function; build the identity-agnostic guarded write layer (`mutate.ts`) and JSONB read layer (`records.ts`); prove the pipeline end-to-end by seeding a hardcoded schema + rows and rendering them as a live read-only table; and gate CI with an RLS isolation test run against a real (local) Supabase instance.

## Boundaries & Constraints

**Always:**
- Shared-JSONB model only. `records(id, organization_id, table_key, data JSONB, actor_id, version, created_at, updated_at, deleted_at)`; a "table" is logical (`table_key` + an `org_schemas.definition` row). NO per-tenant physical tables, NO runtime DDL — provisioning is metadata insert + row inserts.
- `organization_id` is a real FK to `organizations.id` (never a user UID). `org_members` carries `principal_type ('human'|'agent')`. Isolation is a single static policy: `USING (organization_id IN (SELECT auth_org_ids()))` + matching `WITH CHECK`; `auth_org_ids()` is `SECURITY DEFINER STABLE` reading `org_members` by `auth.uid()`.
- All tenant writes flow through `mutate.ts`. It takes identity as an explicit parameter (a caller-supplied Supabase client + `actorId` + `orgId`) — never reads `cookies()`; accepts optional `idempotencyKey`; enforces optimistic concurrency via `version`. Reads flow through `records.ts`, also identity-agnostic (caller supplies the client).
- Define the "active record" billable unit in the model now (non-deleted rows per org) so metering needs no later migration. `deleted_at` is soft-delete; data is retained.
- Service-role/admin client is bootstrap-only (here: seeding the demo org and the pre-auth demo read). No code path writes tenant rows with the raw service-role key on behalf of an authenticated user.
- Apply `normalizeTableName()` to any `table_key`/field key before persistence. All user-facing strings in the demo route resolve through next-intl.

**Never:**
- No LLM code, Gemini client, or Schema Validator logic (Stories 1.3+). The seed schema is hardcoded.
- No auth/login, magic-link, claim, or org-creation UI (Epic 2). No full CRUD, delete, filter/sort, column-hide, edit UI, or real-time sync in the demo (later stories) — the demo is read-only.
- Do not create a hosted Supabase project, push migrations to a remote, or add real secrets. Config + local migrations + documented manual steps only (matches Story 1.1's infra decision).
- Do not weaken isolation for convenience (no disabling RLS, no `USING (true)`, no policy keyed on `auth.uid()`).

**Decisions (resolved):**
- **RLS test environment: hosted Supabase test project.** The isolation test runs against a dedicated ca-central-1 Supabase test project. CI reads `SUPABASE_TEST_URL`, `SUPABASE_TEST_ANON_KEY`, `SUPABASE_TEST_SERVICE_ROLE_KEY` from GitHub Actions secrets; local runs read the same from a git-ignored `.env.test.local`. The agent authors the migration + `supabase` config + the wired CI step and documents the manual human steps (create the test project, apply the migration, set the three secrets); it does NOT create the project or set secrets itself. The `supabase` CLI is still added (devDep) for authoring/validating migrations locally.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Member reads own org | RLS-scoped client for a user in `org_members` of Org A | `records.ts` returns Org A's non-deleted rows for the `table_key` | N/A |
| Stranger reads Org A | RLS-scoped client for a user NOT in Org A | Zero rows returned (RLS filters silently) | N/A |
| Stranger writes Org A | Stranger client inserts a row with `organization_id = A` | Insert rejected by `WITH CHECK` | Surfaced as `AppError`, no raw SQL leaked |
| Optimistic concurrency | `mutate` update with stale `expectedVersion` | Update affects 0 rows; caller told to retry | `AppError` (409-style), version unchanged |
| Idempotent retry | `mutate` insert re-sent with same `idempotencyKey` | Single logical write; no duplicate row | N/A |
| Soft-delete count | Rows with `deleted_at` set | Excluded from `records.ts` reads and active-record count | N/A |
| Walking-skeleton demo | Seeded `org_schemas` + `records` for demo org | Demo route renders a live read-only table (headers from definition, rows from `data`) | Never an error screen |

</frozen-after-approval>

## Code Map

- `src/lib/utils.ts` -- REUSE `normalizeTableName()` (already correct: `'  Job Tracking! '` → `'job_tracking'`) for `table_key`/field keys. Do not modify.
- `src/types/api.ts` -- REUSE `ApiResponse<T>` and `AppError(statusCode, userMessage)` for mutate/read return + error contract.
- `src/lib/supabase/` -- `.gitkeep` only. CREATE `admin.ts` (service-role/bootstrap client), `server.ts` (RLS-scoped `@supabase/ssr` server client from a cookie store — the seam; unused by routes this story), `client.ts` (browser anon client, seam).
- `src/lib/data/` -- `.gitkeep` only. CREATE `mutate.ts` (guarded write layer) and `records.ts` (JSONB read layer).
- `src/types/` -- CREATE `db.ts` (row types for organizations, org_members, records, org_schemas; `SchemaDefinition`/`TableDefinition`/`FieldDefinition` shape for `definition`).
- `vitest.config.ts` -- `include: ['tests/**/*.test.{ts,tsx}']`, `environment: 'node'`. Integration test lands under `tests/integration/`.
- `tests/unit/smoke.test.ts` -- existing pattern for Vitest tests.
- `.github/workflows/ci.yml` -- lines 35–43 hold the commented RLS-step placeholder to activate.
- `.env.example` -- already lists `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (placeholders). `@supabase/ssr@0.10.3` + `@supabase/supabase-js@2.105.4` already installed.
- `src/lib/i18n/en.json` / `fr.json` -- add any static demo-route strings under a new `Demo` key (both catalogs).
- NOTE: scaffold is at the **repo root** (`C:/code/cmsbuilder/`), not a `snapbusy/` subfolder — Story 1.1's note is stale; CI and all paths are root-relative.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/config.toml` + `supabase/migrations/<timestamp>_platform_schema.sql` -- add `supabase` CLI (devDep) + init config; write the migration: create `organizations`, `org_members` (with `principal_type`/`role` checks, unique `(organization_id, user_id)`), `records` (+ `gin(data)` and partial `(organization_id, table_key)` indexes), `org_schemas`; the `auth_org_ids()` `SECURITY DEFINER` function; `ENABLE ROW LEVEL SECURITY` on all four; the membership `USING`+`WITH CHECK` policy on `records` and `org_schemas`; deny-default RLS (no permissive policy) on `organizations`/`org_members` (reached via the definer function + admin client only); `org_active_record_counts` view + a `comment` defining the billable unit. -- the fixed platform schema + isolation.
- [x] `src/lib/supabase/admin.ts`, `server.ts`, `client.ts` -- create the three client factories; `admin.ts` uses the service-role key (bootstrap only), `server.ts` builds an RLS-scoped client from a cookie store via `@supabase/ssr`, `client.ts` the browser anon client. -- client seam.
- [x] `src/types/db.ts` -- row + `definition` types shared by mutate/records/tests. -- typed data layer.
- [x] `src/lib/data/mutate.ts` -- guarded write layer: `mutate(identity: {client, actorId, orgId}, op: 'insert'|'update'|'delete', tableKey, data, opts?: {idempotencyKey?, expectedVersion?})`; writes only through `identity.client`; `update`/`delete` gated on `version === expectedVersion` (increment on success, 0-row → concurrency `AppError`); `delete` sets `deleted_at`; `idempotencyKey` de-dupes inserts; returns `ApiResponse<{id, version}>`. -- single tenant write path (reused by Epics 3–5).
- [x] `src/lib/data/records.ts` -- `listRecords(client, orgId, tableKey)` returning non-deleted rows' `data` (+ id/version); `getSchema(client, orgId)` returning the `org_schemas.definition`. Identity-agnostic. -- JSONB read layer.
- [x] `src/lib/data/seed.ts` (or a `supabase/seed`-invoked script) -- hardcoded demo schema (e.g. one "clients" table def) + 5–8 seed rows, provisioned through `mutate.ts` under the admin client with a system `actorId` and stable `idempotencyKey`s; upserts a fixed demo org. -- walking-skeleton provisioning.
- [x] `src/app/demo/page.tsx` -- server component: read the demo org's schema + rows via `records.ts` + admin client (pre-auth bootstrap read, clearly commented), render a live read-only table (shadcn Table if trivially addable, else a semantic Tailwind table); static labels via next-intl. -- proves the pipeline to the frontend.
- [x] `src/lib/i18n/en.json`, `fr.json` -- add the `Demo` static strings to both catalogs. -- i18n compliance.
- [x] `tests/integration/rls-isolation.test.ts` -- against the hosted Supabase test project (via `SUPABASE_TEST_*` env): seed Org A + Org B, create auth users (member of A; stranger) with the service-role admin client, build RLS-scoped clients from their JWTs, assert member reads A's rows (>0), stranger reads A → 0, stranger insert into A rejected; clean up seeded data after. -- the hard isolation gate.
- [x] `tests/unit/mutate.test.ts` -- unit-cover the I/O matrix mechanics that don't need a DB (version mismatch → concurrency error, idempotency key de-dupe, soft-delete excluded from reads) using a fake/stub client. -- edge-case coverage.
- [x] `package.json` + `.github/workflows/ci.yml` + `.env.example` + `README.md` -- add `test:rls` (and any migration `db:*`) scripts; activate the RLS CI step reading `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`/`SUPABASE_TEST_SERVICE_ROLE_KEY` from GitHub secrets; add those three as `.env.example` placeholders; document the manual human steps in README (create the ca-central-1 test project, apply the migration to it, set the three CI secrets, add them to a git-ignored `.env.test.local` for local runs). -- CI gate + handoff.

**Acceptance Criteria:**
- Given the Supabase CLI migration, when applied to a clean database, then `organizations`, `org_members` (with `principal_type`), `records` (with the exact JSONB columns + `deleted_at`), and `org_schemas` exist with no per-tenant tables and no runtime DDL, and the active-record billable unit is queryable from the model.
- Given the `records` table, when inspected, then RLS is enabled with a single static membership policy `organization_id IN (SELECT auth_org_ids())`, `auth_org_ids()` is `SECURITY DEFINER` reading `org_members`, and `organization_id` FKs `organizations.id`.
- Given a tenant write, when it goes through `mutate.ts`, then it runs under the caller-supplied RLS-scoped client, takes identity as an explicit param (no `cookies()`), honors `idempotencyKey`, and rejects a stale `version`; and no path writes tenant rows with the raw service-role key on behalf of an authenticated user.
- Given the hardcoded seed, when the demo route loads, then the seeded logical table renders as a live read-only data table sourced through the JSONB read layer.
- Given `tests/integration/rls-isolation.test.ts` against a real Supabase instance, when CI runs, then it passes only if a member of Org A can read Org A's records AND a stranger cannot, and it is wired as a hard CI gate.

## Implementation Notes

**Scaffold is at the repo root.** Story 1.1's note about a `snapbusy/` subfolder is stale — `package.json`, `src/`, `tests/`, and CI all live at `C:/code/cmsbuilder/`. All new paths are root-relative.

**Migration (`supabase/migrations/20260924055022_platform_schema.sql`).** Four tables + `auth_org_ids()` (`SECURITY DEFINER STABLE`, `search_path=public`) + membership `for all` policy (`USING`+`WITH CHECK`) on `records` and `org_schemas`; `organizations`/`org_members` get RLS enabled with **no** permissive policy (deny-all to anon/authenticated; reached only via the definer function and the service-role client — avoids policy recursion). Added a `records.idempotency_key` column + partial-unique index `(organization_id, table_key, idempotency_key)` to back the guarded layer's idempotency (a spec-required capability; not in AC1's column list but consistent with it). `pgcrypto` extension enabled for `gen_random_uuid()`. `org_active_record_counts` view defines the billable unit (non-deleted rows per org); per-cycle windowing is Epic 7's concern.

**Guarded layer.** `mutate.ts` is identity-agnostic (`{client, actorId, orgId}` explicit param, never `cookies()`); insert de-dupes on `idempotencyKey` (with a unique-violation race fallback that reads the winner); update/delete gate on `expectedVersion` (0 rows → 409-style `AppError`), delete is soft (`deleted_at`). The bootstrap seed routes through `mutate.ts` under the admin client, keeping a single write path. `/demo` is a **dynamic** route (next-intl cookie locale makes it server-rendered on demand), so `createAdminClient()` is never called at build time — the CI build with no Supabase env passes.

**Verification (independently re-run against the diff).** `type-check`, `lint`, `build` pass. `npm run test` → 7 pass (mutate concurrency/idempotency/soft-delete). `test:rls` self-skips green with no secrets. Started a **real local Supabase** (Docker), applied the migration, and ran the committed `test:rls` against it → **all 3 RLS isolation assertions pass** (member reads Org A; stranger reads Org A → 0; stranger insert into Org A rejected by `WITH CHECK`). Stopped the stack afterward.

**Human handoff (per approved decision).** The RLS gate runs against a hosted ca-central-1 Supabase **test** project. The human must: create it, apply the migration, and set `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`/`SUPABASE_TEST_SERVICE_ROLE_KEY` as GitHub secrets (and a git-ignored `.env.test.local` for local runs). Until set, the CI RLS step self-skips (does not fail the build); it enforces once the secrets exist. Documented in README.

**Out-of-scope artifact flagged.** `_bmad-output/phase3-agent-engine.md` appeared during the session; it is a Phase-3 vision doc, not a Story 1.2 code deliverable (the forward-compat seam is satisfied by `mutate.ts`'s identity param, not this doc). Left in place for the human to keep or remove.

## Spec Change Log

## Review Triage Log

### Review pass 1 (2026-09-24)

**Patched (applied directly; verification re-run green):**
- **[patch] `listRecords` didn't normalize `table_key` while `mutate` does** — VERIFIED read/write asymmetry: a caller passing `"Clients"` would silently get 0 rows against the stored `clients`. Fixed: `records.ts` now normalizes on read.
- **[patch] `getSchema` returned malformed data for the DB-default `'{}'` definition** — VERIFIED: it guarded a missing row but not an empty definition (`{}` has no `tables`), so `demo`'s `.tables.find` could throw. Not reachable via the seed (which writes a full schema) but a latent footgun in a reused read layer. Fixed: always returns `{ tables: [...] }`.
- **[patch] Delete path's stale-version rejection was untested** — VERIFIED: only `update`'s stale path was covered; a regression dropping `delete`'s version guard would ship silently. Fixed: added a `mutate.test.ts` case (stale delete → 409, `deleted_at` stays null).
- **[patch] RLS insert-rejection test could pass for the wrong reason** — VERIFIED: it asserted only `data` null / `error` non-null. Fixed: added an admin-side check that no malicious row actually landed in Org A (passes against real Supabase).
- **[patch] `org_schemas` isolation policy shipped but untested** — VERIFIED: the same membership policy guards `org_schemas`, but only `records` was tested. Fixed: added member-reads / stranger-blocked assertions (pass against real Supabase).
- **[patch] A partial `SUPABASE_TEST_*` secret set silently disabled the hard gate** — VERIFIED: 1–2 of 3 secrets → `HAS_ENV` false → silent skip. Fixed: the test now throws loudly on incomplete config (verified: exit 1); full set → 5 pass; none → skip green.

**Deferred:**
- **[defer] Idempotency `23505` race-recovery branch untested** — VERIFIED untested: the `FakeClient` never returns a unique violation, so the de-dupe test only exercises the pre-insert lookup; the concurrent-retry branch (backed by `records_idempotency_key_idx`) is genuinely uncovered. Settling needs a fake modeling the partial-unique index returning `23505`, or a concurrent-insert integration case. Logged to deferred-work.

**Rejected:**
- **[low → reject] `records.actor_id` has no FK (BH1)** — the column comment documents its purpose; the absence of an `auth.users` FK is intentional (the seed's synthetic system actor and future non-`auth` agent ids must be allowed). No integrity defect.
- **[low → reject] Missing `updated_at` auto-update trigger (BH2)** — every current writer sets `updated_at` (mutate + seed upserts); no bad outcome today, and a `moddatetime` trigger adds DB surface for undemonstrated future writers.
- **[false → reject] `.env.test.local` not scaffolded (BH7)** — REFUTED: both the `.env.example` comment block and README §4 explicitly place the three `SUPABASE_TEST_*` values in a git-ignored `.env.test.local`, not `.env.local`.
- **[low → reject] FakeClient `.then` swallows the reject path → `listRecords` error branch uncovered (BH9)** — that branch is a trivial `return { error: "Failed to load records." }`; testing it needs fake rework for negligible value.
- **[low → reject] `formatCell` currency hardcoded `en-CA`/CAD (BH10 / VG-other)** — currency is correctly CAD (Ontario); only the number-format locale differs under FR. A read-only walking-skeleton proof; threading locale into the formatter is UI-polish, better placed in a later dashboard story.
- **[low → reject] `createAdminClient()` throws uncaught on missing env at request time (EC2)** — reachable only under total misconfiguration (no Supabase env = the whole app is down); wrapping adds a guard for undemonstrated state.
- **[low → reject] `expectedVersion` validated by `typeof` only (EC4)** — reachable only via a buggy caller; every real caller passes a prior read's positive integer version, and none in this story does otherwise.
- **[reject] `23505` from a future non-idempotency unique index (EC5)** — speculative ("if such an index is added later"); `records` has no other insert-path unique constraint today.
- **[low → reject] `tableCaption` absent in the empty state (EC6)** — cosmetic; the empty state is a single sentence that needs no table caption.
- **[false → reject] Migration comment "not re-evaluated per row" is plan-dependent (EC7)** — the comment is accurate: `IN (SELECT stable_srf())` plans as a once-evaluated InitPlan. No defect.
- **[reject — fix edits frozen spec] Intent prose says "a real (local) Supabase instance" but the resolved Decision + code use a hosted test project (EC8)** — the frozen Intent's parenthetical is stale relative to the later-resolved Open Question. A finding whose fix edits this build's spec is rejected here; flagged to the human, who alone can amend the frozen wording.

## Design Notes

**RLS on the auxiliary tables.** `records` and `org_schemas` (both tenant data) get the membership policy. `organizations`/`org_members` get RLS enabled with no permissive policy → deny-all to `anon`/`authenticated`, reached only via the `SECURITY DEFINER` `auth_org_ids()` (definer rights bypass RLS, so no policy recursion) and the `service_role` admin client (bypasses RLS). Per-user read policies on those two are deferred to Epic 2 when auth lands. This satisfies "strict isolation" without introducing recursive policies in the walking skeleton.

**Pre-auth demo read.** Epic 1 has no authenticated users, so an anonymous visitor has no `auth.uid()` and RLS on `records` would return nothing. The demo route therefore reads via the admin client scoped to the fixed demo org — a documented bootstrap path (same category as anonymous generation). RLS *enforcement* is proven by the integration test with real JWTs, not by the demo route. `records.ts` stays identity-agnostic so the same function serves both.

**Seed through `mutate.ts`.** Routing the bootstrap seed through `mutate.ts` (passing the admin client as `identity.client`, a system `actorId`, and stable `idempotencyKey`s) keeps a single write path and exercises the guarded layer, while staying within the "service-role is bootstrap-only" rule.

**Test project credentials.** The isolation test and `test:rls` read `SUPABASE_TEST_URL`/`SUPABASE_TEST_ANON_KEY`/`SUPABASE_TEST_SERVICE_ROLE_KEY` from env (GitHub secrets in CI; a git-ignored `.env.test.local` locally). The service-role key is used only inside the test to seed orgs/users and never reaches a client bundle. All three are added to `.env.example` as placeholders. The test seeds unique orgs per run and cleans up, so it is safe to re-run against the shared hosted project.

## Verification

**Commands:**
- `supabase db reset` (local) or `supabase db push` (to the linked test project) -- expected: migration applies cleanly; the four tables, `auth_org_ids()`, policies, and active-record view exist.
- `npm run test:rls` -- expected: RLS isolation test passes against the hosted test project (member reads, stranger blocked, stranger write rejected).
- `npm run test` -- expected: unit tests (incl. `mutate.test.ts`) pass green.
- `npm run type-check` -- expected: `tsc --noEmit` passes.
- `npm run lint` -- expected: passes; no service-role key in client-bundled code; no hardcoded demo strings.
- `npm run build` -- expected: production build succeeds (demo route renders).

**Manual checks:**
- Load `/demo`: a populated read-only table renders with no empty/error state.
- Inspect the migration: `records` policy uses `auth_org_ids()`; `organization_id` is an FK to `organizations.id`.
