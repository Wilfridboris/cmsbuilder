---
title: 'Realtime CHANNEL_ERROR/TIMED_OUT Recovery'
type: 'bugfix'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd55d6755acb7cb141ad871375a0f0c1dedc38594'
context:
  - '_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Story 3.6 realtime records subscription (`useRealtimeRecords`) only reconciles cache state when the subscribe status callback fires `SUBSCRIBED`. On a `CHANNEL_ERROR` or `TIMED_OUT` (an errored or timed-out socket), nothing refetches: no catch-up happens at the error, and if supabase-js does not auto-rejoin cleanly the dashboard can silently show stale data indefinitely, violating the real-time reconcile-without-manual-reload expectation (epic-3 retro D6; MVP mobile-LTE reliability).

**Approach:** Reconcile (the existing `invalidateOrgRecords` → `GET /api/records` refetch, which runs over HTTP independent of the WebSocket) not only on `SUBSCRIBED` but also on `CHANNEL_ERROR` and `TIMED_OUT`, so a dropped/errored socket triggers an authoritative refetch instead of silently staling. Keep supabase-js's own auto-rejoin (no bespoke retry loop) and the mandatory epic pattern (invalidate/refetch, never patch from the payload). Factor the status→reconcile decision into a pure, node-testable helper.

## Boundaries & Constraints

**Always:**
- The subscribe status callback reconciles on `SUBSCRIBED` (initial subscribe AND post-reconnect rejoin, unchanged) AND additionally on `CHANNEL_ERROR` and `TIMED_OUT`. The decision is a pure, exported helper in `src/lib/data/realtime.ts` (socket-free, node-testable), consumed by the hook.
- "Reconcile" is the existing `invalidateOrgRecords` (invalidate the `["records", slug]` and `["relation-labels", slug]` prefixes) — a `GET /api/records` refetch that works even while the socket is down, so it is a genuine fallback. The handler NEVER `setQueryData`/patches the cache from the socket payload (mandatory epic pattern).
- supabase-js keeps owning reconnection: no manual re-subscribe, no backoff timer, no bespoke retry loop. On a successful auto-rejoin, `SUBSCRIBED` fires again and reconciles. Channel creation, name, filter, and unmount cleanup are unchanged.

**Never:**
- No reconcile on `CLOSED` (the intentional `removeChannel`/unmount path — refetching a tearing-down view is wasted work).
- No new UI (no reconnecting banner/toast), no new React state, no manual retry/backoff loop. No change to the mutation-time invalidation, the channel name/filter, the `GET /api/records` path, or `invalidateOrgRecords` itself.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Initial subscribe | status `SUBSCRIBED` | reconcile (invalidate records + relation-label prefixes) | N/A |
| Socket error | status `CHANNEL_ERROR` | reconcile via HTTP refetch (catch up on missed changes) | N/A |
| Join timeout | status `TIMED_OUT` | reconcile via HTTP refetch | N/A |
| Post-reconnect rejoin | status `SUBSCRIBED` again | reconcile | N/A |
| Intentional close / unmount | status `CLOSED` | no reconcile, no refetch | N/A |
| Any other/unknown status | e.g. a future status string | no reconcile | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/data/realtime.ts` -- ADD pure `shouldReconcileOnStatus(status: string): boolean` → `true` for `"SUBSCRIBED"`, `"CHANNEL_ERROR"`, `"TIMED_OUT"`; `false` otherwise (including `"CLOSED"` and any unknown string). Existing `recordsChannelName` / `recordsChangeFilter` / `invalidateOrgRecords` unchanged.
- `src/components/dashboard/useRealtimeRecords.ts` -- in the `.subscribe((status) => { ... })` callback (lines 65-72) replace `if (status === "SUBSCRIBED") invalidate();` with `if (shouldReconcileOnStatus(status)) invalidate();` (import the new helper). Update the docstring to note the error/timeout fallback refetch.
- `tests/unit/realtime.test.ts` -- ADD a `shouldReconcileOnStatus` describe covering the matrix (true for the three reconcile statuses; false for `CLOSED` and an unknown status), matching the existing pure-helper test style.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/data/realtime.ts` -- add the pure `shouldReconcileOnStatus` helper per the Always rules.
- [x] `src/components/dashboard/useRealtimeRecords.ts` -- call `shouldReconcileOnStatus(status)` in the subscribe callback instead of the bare `SUBSCRIBED` check; update the docstring.
- [x] `tests/unit/realtime.test.ts` -- cover the I/O matrix for `shouldReconcileOnStatus` (SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT → true; CLOSED and an unknown status → false).

**Acceptance Criteria:**
- Given a mounted dashboard whose realtime socket errors or times out, when the subscribe status callback fires `CHANNEL_ERROR` or `TIMED_OUT`, then the org's records (and relation-label) queries are invalidated so authoritative state is refetched over HTTP, and the dashboard does not silently stay stale (epic-3 D6).
- Given an intentional channel close (`CLOSED`, e.g. on unmount), when the status callback fires, then no reconcile/refetch is triggered.
- Given the change, when any realtime status or event is handled, then the handler only invalidates/refetches and never applies the socket payload to the cache, and introduces no new UI, state, or manual retry loop.

## Implementation Notes

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **defer** — Hook subscribe-callback wiring is unverified by any automated test (blind-hunter, verification-gap pre-verified). Only the pure `shouldReconcileOnStatus` is unit-tested; no test renders `useRealtimeRecords` or invokes the `.subscribe` callback (the one hook reference, `records-view.test.tsx`, mocks it to a no-op), so a one-line predicate regression would silently return the D6 bug. Real but pre-existing: the repo is node-only (no jsdom) and the whole 3.1-3.6 Realtime seam pushes socket/DOM wiring to Playwright/manual review, which the frozen spec already documents. Recorded to deferred-work.
- **low -> reject** — Refetch storm on a sustained/flapping outage: each `CHANNEL_ERROR`/`TIMED_OUT` fires an unthrottled `invalidateOrgRecords` → `GET /api/records` (blind-hunter, edge-case-hunter). Real but bounded: React Query dedups in-flight refetches, supabase-js reconnect uses increasing backoff (not a tight loop), and during an actual outage the GET fails fast without reaching the server; a brief flap's refetch-on-recovery is the desired catch-up. A debounce/throttle would add the timer+state the spec's "Never" scoped out, for negligible gain.
- **low -> reject** — `shouldReconcileOnStatus(status: string)` widens the param from the supabase `REALTIME_SUBSCRIBE_STATES` union, so a literal typo compiles (blind-hunter). The `string` type is the deliberate basis of the frozen "any unknown status -> false" contract and the tests passing arbitrary strings; a typo in the 3-line predicate fails the existing unit assertions (e.g. `shouldReconcileOnStatus("SUBSCRIBED")` toBe true). Narrowing the type would contradict the contract.
- **false -> reject** — Doc comment claims the refetch "runs over HTTP independent of the WebSocket" is an unverified assumption (blind-hunter). Verified accurate: `invalidateOrgRecords` triggers the records query's `GET /api/records` (app Next.js route via `fetchRecords`), a separate HTTP transport from the Realtime socket; edge-case-hunter independently confirmed it as standard behavior, not a defect.
- **low -> reject** — Tests omit the empty-string and case-sensitivity cases and use a single unknown token (blind-hunter). The frozen matrix ("CLOSED -> false", "any unknown -> false") is already pinned by the CLOSED case plus one unknown token; the extra assertions are a trivial, zero-risk optional add, not a defect.
- **low -> reject** — The SUBSCRIBED/CHANNEL_ERROR/TIMED_OUT/CLOSED rationale is restated in the hook JSDoc, the inline callback comment, and the helper JSDoc (blind-hunter). Comment-only duplication with low drift risk now that the decision lives in one named helper; cosmetic, no behavior impact.

## Design Notes

**Why invalidate on error, not just on rejoin.** `invalidateOrgRecords` triggers `GET /api/records`, an HTTP path independent of the WebSocket, so it reconciles authoritative state even while the socket is down — the "fallback refresh" D6 asks for. supabase-js still auto-rejoins on its own; when it succeeds `SUBSCRIBED` fires and reconciles again, so no bespoke retry loop is needed. `CLOSED` is excluded because it is the intentional teardown path (unmount/`removeChannel`), where a refetch would be wasted on a disappearing view.

**Testing boundary.** The live socket/DOM behavior stays Playwright/manual-verified (this repo has no jsdom), consistent with the 3.6 seam precedent; the new, pure status→reconcile decision is unit-tested in `realtime.test.ts`.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors.
- `npm run lint` -- expected: clean.
- `npx vitest run tests/unit/realtime.test.ts` -- expected: new `shouldReconcileOnStatus` cases pass; existing cases green. Full `npx vitest run` green.

**Manual checks:**
- A forced socket error is impractical to simulate in the node test env; the pure decision is unit-covered and the hook wiring is a one-line predicate swap. Optional: in the browser, open the dashboard, kill the network briefly to force a channel error, restore it, and confirm the table reconciles to current server state without a manual reload.
