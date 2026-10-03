---
title: "Real-Time Push to Owner's Dashboard"
type: 'feature'
created: '2026-10-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'e016a454cf9ab78d2b6a6d26fba4fad355b3aa3b'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 6.2 persists each external intake submission as a normal `records` row (org-scoped, `actor_id = INTAKE_ACTOR_ID`, written through the guarded `mutate.ts`). Story 6.3 (FR27, NFR-P5) requires that row to appear in the owner's dashboard table in real time — within 2 seconds — behaving like any other record, reusing the exact Epic 3 Realtime -> `invalidateQueries` path with no new mechanism.

**Approach:** Investigation confirms the guarantee already holds via existing infrastructure, so this story adds no production code or DB change: it pins the one cross-cutting invariant with a regression test and proves live 2-second delivery via the post-commit Playwright manual review. (The decisive facts are in Design Notes.)

## Boundaries & Constraints

**Always:**
- Reuse the Epic 3 path verbatim: the per-org `records` subscription in `useRealtimeRecords` and the prefix invalidation in `invalidateOrgRecords`. The intake row reaches the owner through this path with no intake-specific wiring, because the handler is payload-agnostic (it invalidates on any event and never inspects `actor_id`).
- The subscription filter stays scoped by `organization_id` only. This is the invariant that lets anonymous public-intake rows (`actor_id = INTAKE_ACTOR_ID`) reach the owner's subscription exactly like a dashboard write; it must never gain an actor predicate.
- A delivered intake row is a normal record: viewable, editable, filterable, and sortable like any other row, via the authoritative `GET /api/records` refetch (never a cache patch from the event payload).
- On a dropped-then-reconnected socket, the existing `SUBSCRIBED`-status re-invalidate reconciles a submission missed during the gap — no bespoke retry.

**Never:**
- No new Realtime mechanism, channel, migration, publication change, or RLS change; no change to the intake write path (6.2), `mutate.ts`, or `GET /api/records`.
- No new user-facing UI for 6.3: no toast, badge, highlight, or "new lead" cue. The row simply appears in the table (AC: "appears as a normal record"); the owner's active new-lead signal is the Story 6.4 email. Adding a cue is out of scope.
- No change to optimistic CRUD in `useRecordMutations`; the Realtime hook stays a side effect only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Admin on the intake table | External visitor submits a valid intake form | The new row appears in that table within ~2s with no manual refresh, via the per-org Realtime event -> `invalidateOrgRecords` -> `GET /api/records` refetch | N/A |
| Admin on a different table | Intake submission writes to the intake target table | The org prefix invalidates; the viewed table refetches (no-op change) and the intake table is marked stale, showing the row when the Admin switches to it | N/A |
| Delivered row behaves normally | Intake row now in the owner's table | It is editable / filterable / sortable like any dashboard-authored row (no `INTAKE_ACTOR_ID` special-casing in the read path) | N/A |
| Socket drop during submit | Realtime connection drops, visitor submits, socket auto-rejoins | On `SUBSCRIBED` rejoin the handler re-invalidates and the missed row is reconciled on refetch | Missed-event gap closed by rejoin invalidate |

</frozen-after-approval>

## Code Map

Read-only references — reused, DO NOT change in this story:
- `src/components/dashboard/useRealtimeRecords.ts:35-78` -- the per-org `postgres_changes` subscription (`event: "*"`, `table: records`, filter `organization_id=eq.{orgId}`); handler is `() => invalidateOrgRecords(queryClient, slug)`, payload-agnostic; re-invalidates on `SUBSCRIBED`. The path 6.3 relies on.
- `src/lib/data/realtime.ts:16-52` -- pure seams: `recordsChannelName`, `recordsChangeFilter` (org-only filter), `invalidateOrgRecords` (invalidates `["records", slug]` + `["relation-labels", slug]`, never patches).
- `src/components/dashboard/RecordsView.tsx:237,264` -- mounts `useRealtimeRecords({ slug, orgId })`; record queries keyed `["records", slug, tableKey, relationFilterKey]` (matched by the prefix invalidation).
- `src/app/api/intake/[slug]/route.ts:112-118` -- the 6.2 intake write: `mutate(identity={ client: createAdminClient(), actorId: INTAKE_ACTOR_ID, orgId }, "insert", target.table.key, data, { idempotencyKey })`.
- `src/lib/data/mutate.ts:51,216-279` -- `INTAKE_ACTOR_ID`; `insertRecord` does a plain `.from("records").insert(...)` stamping `organization_id`, `table_key`, `actor_id` — the WAL INSERT that Realtime broadcasts.
- `supabase/migrations/20260927120000_enable_realtime_records.sql`, `..._130000_records_replica_identity_full.sql` -- `records` is in `supabase_realtime`; REPLICA IDENTITY FULL (for UPDATE/soft-delete; INSERT already carries the full tuple).

Edited in this story:
- `tests/unit/realtime.test.ts:30-34` -- extend the `recordsChangeFilter` block with the 6.3 regression guard (below).

## Tasks & Acceptance

**Execution:**
- [x] `tests/unit/realtime.test.ts` -- add a 6.3-labeled test asserting `recordsChangeFilter(orgId)` scopes the subscription by `organization_id` only and contains no `actor_id` / actor predicate, with a comment documenting that this is the invariant letting anonymous public-intake rows (`actor_id = INTAKE_ACTOR_ID`) reach the owner's subscription identically to a dashboard write. Rationale: this is the single automated anchor for 6.3 — it fails fast if a future change narrows the filter in a way that would silently stop delivering intake rows. (No production code changes; live delivery is proven by the manual review below, per the repo's no-jsdom Realtime convention.)

**Acceptance Criteria:**
- Given an Admin viewing the intake target table, when an external visitor submits the intake form, then the new record appears in that table within ~2 seconds through the Epic 3 Realtime -> `invalidateQueries` path, with no new Realtime mechanism and no manual refresh (FR27, NFR-P5).
- Given a delivered intake record, when it lands in the dashboard, then it is a normal record — viewable, editable, filterable, and sortable like any other row, with no `INTAKE_ACTOR_ID` special-casing.
- Given the subscription config, when the regression test runs, then the records change filter is proven to be org-scoped only (no actor predicate), locking anonymous-row delivery.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter + edge-case-hunter + verification-gap):

- **BH1 + BH3 + BH5 + BH7 — low, patch (grouped, shared root cause: the test's assertions and comment overstate what is guarded).**
  - BH1: the exact `toBe("organization_id=eq.${ORG_ID}")` fully pins the string, so the three follow-on `not.toContain` assertions cannot fail independently — verified real; they read as guards but add no discriminating power.
  - BH5: `not.toContain("actor")` is vacuous because the UUID fixture has no "actor" substring; only the `not.toContain("&")` check meaningfully guards against an added predicate — verified real.
  - BH3: the comment claims the whole delivery chain (`event: "*"`, payload-agnostic handler re-invalidating `GET /api/records`) but the test only exercises `recordsChangeFilter` — verified real (those live in `useRealtimeRecords.ts`, not asserted here).
  - BH7: the comment hard-codes "the single automated anchor for 6.3", coupling prose to suite state — verified real.
  - Fix: keep `toBe` + `not.toContain("&")`, drop the two vacuous `actor` substring assertions, and reword the comment to state only what is pinned (org-only filter, no compound predicate) and that live delivery / `event` / handler behavior is Playwright-verified. AC3's invariant stays fully locked by `toBe`. Test-only, no new surface.
- **BH2 — low, subsumed.** Claim: the new test duplicates the existing `recordsChangeFilter` equality test. Real overlap, but the labeled 6.3 test is intentional traceability and, after the BH1/BH5 patch, adds the distinctive compound-predicate (`&`) guard the existing test lacks. No separate action.
- **BH4 — low, rejected.** Claim: nothing pins `event: "*"`, so a future event narrowing could leave the anchor green. Verified the gap is real, but `event: "*"` is set inline in the hook's `.on(...)` call (not a pure helper), so pinning it needs a hook refactor extracting the subscription config (new public surface); and an `event` change that would actually drop intake INSERTs is implausible and would break all dashboard realtime sync, caught immediately and Playwright-covered. Unlikely in everyday use + fix exceeds a direct correction.
- **BH6 — rejected, out of scope + negligible.** Claim: no assertion that the filter is injection-safe / `orgId` is a UUID. `recordsChangeFilter` is a pure string helper only ever handed a server-validated org UUID (RLS is the real boundary, per its own doc comment); a guard on a pure helper adds complexity for a boundary the intent does not raise.
- **Edge-case-hunter: no findings.** Every checkable spec claim holds against the traced code; broader end-to-end claims are delegated to the Playwright manual review and unchanged Epic 3 code.
- **Verification-gap: no gaps.** The change is test-only; the asserted filter string matches the live subscription at `useRealtimeRecords.ts:61`, and the new test runs normally (no skip/only).

## Design Notes

Why no production code — the end-to-end guarantee already holds: (1) the intake insert is a plain WAL-emitting `.insert()` into `public.records` carrying the org's `organization_id`; (2) `records` is in the `supabase_realtime` publication; (3) Postgres Changes delivery evaluates RLS against the subscribing Admin, so the service-role writer is irrelevant and the row reaches that org's channel; (4) the hook invalidates on any event without reading the payload, so `actor_id = INTAKE_ACTOR_ID` is not special-cased. The honest deliverable is to lock the one invariant that could regress this (the org-only filter) and prove live latency, not build a redundant second path.

## Verification

**Commands:**
- `npx vitest run tests/unit/realtime.test.ts` -- expected: pass, including the new 6.3 filter guard.
- `npm run lint` -- expected: clean.
- `npx tsc --noEmit` -- expected: no type errors.

**Manual review (Playwright, post-commit) — the primary acceptance evidence.** Against the running dev app on `localhost:3000`, exercise the rich path end to end: in one authenticated context open the Admin dashboard on the intake target table of a claimed org (e.g. `jobs_and_quotes` for `session-1f4fa453`); in a separate logged-out context open `/forms/{slug}` and submit a valid lead. Confirm the new row appears in the Admin's open table within ~2 seconds with no manual refresh, that it renders as a normal record (open/edit/filter/sort it), and that the browser console is clean. Optionally confirm reconnect reconciliation: drop the network briefly on the dashboard tab, submit during the gap, and confirm the row appears on rejoin.
