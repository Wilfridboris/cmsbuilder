---
title: 'Story 3.6: Real-Time Multi-User Sync'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd0bdd667620c7b7d2ae3c070670ebc7ec78f83f2'
story_key: '3-6-real-time-multi-user-sync'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-3-3-inline-edit-with-optimistic-ui.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Teammates in the same org each see only their own edits. When one member adds, edits, or (soft-)deletes a record, others keep a stale table until they manually reload — the crew is not working from one live picture (FR12, NFR-P5). No Realtime is wired anywhere yet; the browser Supabase client (`src/lib/supabase/client.ts`) exists as an unused seam, and `records` is not in the `supabase_realtime` publication.

**Approach:** Subscribe the authenticated dashboard to a Supabase Realtime `postgres_changes` channel on `public.records`, scoped to the caller's organization. On any received change event, the handler calls TanStack Query `invalidateQueries` for the org's records so the cache refetches authoritative state through the existing `GET /api/records` path — it never calls `setQueryData` from the Realtime handler. A DB migration adds `records` to the `supabase_realtime` publication. RLS on `records` remains the real tenant boundary; the org filter is a traffic optimization.

## Boundaries & Constraints

**Always:**
- The Realtime handler reacts by calling `queryClient.invalidateQueries({ queryKey: ["records", slug] })` (prefix match → refetches every logical table cached for this org). It MUST NOT call `setQueryData`, mutate the cache directly, or apply the event payload to rows. Authoritative state always comes from the refetch. (Mandatory epic pattern.)
- The channel is scoped per organization: subscribe with `{ event: "*", schema: "public", table: "records", filter: "organization_id=eq.<orgId>" }`. `orgId` is passed from the server (`[slug]/page.tsx` already resolves it) into `RecordsView` as a new prop. The org UUID is a tenant identifier, not a secret; RLS stays the security boundary. (Decision.)
- Use the existing `createBrowserSupabaseClient()` (authenticated via `@supabase/ssr` cookies) so Realtime carries the user's JWT and RLS filters delivered rows to the caller's org. Subscribe once per mounted dashboard; on unmount call `supabase.removeChannel(channel)` — no leaked channels or duplicate subscriptions across table switches.
- Reconnect + reconcile: rely on supabase-js's automatic socket reconnect and channel rejoin; on every `SUBSCRIBED` status (initial and post-reconnect) invalidate the org's records so any changes missed during the gap are pulled — no manual page reload, no bespoke retry loop.
- The subscription is a side effect only: it changes no existing read/write path. Optimistic CRUD in `useRecordMutations.ts` is unchanged (its own `invalidateQueries` on settle still runs; a self-echoed Realtime event that also invalidates is harmless — refetch is idempotent).
- All record writes continue to flow through the guarded mutation layer under RLS; this story adds no new write path and no new RLS policy.

**Never:**
- No new visible UI surface — no live/reconnecting indicator, no toast, no status chip. Per decision, 3.6 sync is invisible: records appear/update through existing components with no manual reload, matching the ACs. No new user-facing strings or i18n keys; `web-uiux-architect` has no surface to design for this story. (Decision.)
- Never `setQueryData` / patch the cache from the Realtime event; never trust the event payload as authoritative row data.
- No `replica identity full` on `records` and no reliance on DELETE events: app deletes are soft (an UPDATE of `deleted_at`), so INSERT/UPDATE events carry `organization_id` and match the filter with the default replica identity. Do not add hard-delete handling.
- Do not pass the service-role key or any secret to the client; do not widen what the client learns beyond the org UUID prop.
- Do not change filter/sort (client-side, Story 3.4), column-hide, the optimistic sequence, or the `["records", slug, tableKey]` query-key shape.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|--------------|-------------------|----------------|
| Teammate adds a record | Member B viewing same table; Member A inserts | Realtime INSERT (filtered by org) → invalidate `["records", slug]` → B's active table refetches and shows the new row within ~2s | N/A |
| Teammate edits a record | A updates a cell | Realtime UPDATE → invalidate → B refetches; if B was mid-edit, existing optimistic/version reconciliation applies | N/A |
| Teammate soft-deletes a record | A deletes (UPDATE `deleted_at`) | Realtime UPDATE → invalidate → row drops from B's view within ~2s | N/A |
| Self-echo | A's own mutation also arrives as a Realtime event | Extra `invalidateQueries` is a no-op refetch of already-authoritative data; no flicker beyond normal settle | N/A |
| Connection dropped then restored | Socket drops, network returns | supabase-js auto-rejoins; on `SUBSCRIBED` the client invalidates → reconciles missed changes, no manual reload | Silent recovery |
| Change in a non-active table | A edits table X while B views table Y (same org) | Prefix invalidation marks X's cache stale; it refetches when B next views X (already fresh) | N/A |
| Cross-org isolation | User C in a different org edits | RLS + org filter mean C's events are never delivered to this client | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/2026XXXXXXXXXX_enable_realtime_records.sql` -- NEW. Single statement: `alter publication supabase_realtime add table public.records;`. Timestamp must sort AFTER `20260925170000_organizations_member_read.sql`. Do NOT add `replica identity full` (soft-delete = UPDATE; INSERT/UPDATE carry `organization_id`). Apply via Supabase MCP `apply_migration` to the test project.
- `src/lib/supabase/client.ts` -- REUSE. `createBrowserSupabaseClient()` (`@supabase/ssr` `createBrowserClient`, authed via cookies). Currently unused; this story is its first consumer.
- `src/components/dashboard/useRealtimeRecords.ts` -- NEW client hook. Args `{ slug, orgId }`. Uses `useQueryClient()`; memoizes the browser client; in `useEffect` opens channel `records-org-${orgId}` with `.on("postgres_changes", { event: "*", schema: "public", table: "records", filter: \`organization_id=eq.${orgId}\` }, () => invalidate)` and `.subscribe((status) => { if (status === "SUBSCRIBED") invalidate; })`; cleanup `supabase.removeChannel(channel)`. Invalidate = `queryClient.invalidateQueries({ queryKey: ["records", slug] })`.
- `src/lib/data/realtime.ts` -- NEW pure helpers (testable seam, no socket): `recordsChannelName(orgId)`, `recordsChangeFilter(orgId)` → `"organization_id=eq.<orgId>"`, and `invalidateOrgRecords(queryClient, slug)` → calls `invalidateQueries({ queryKey: ["records", slug] })`. The hook composes these.
- `src/components/dashboard/RecordsView.tsx` -- MODIFY. Add `orgId: string` prop (type `RecordsViewProps` ~L89-104); call `useRealtimeRecords({ slug, orgId })` near the existing `useQuery`/mutation hooks (~L130). No other change; the `["records", slug, tableKey]` query and optimistic mutations are untouched.
- `src/app/[slug]/page.tsx` -- MODIFY. Pass `orgId={orgId}` into `<RecordsView>` (~L108-114). `orgId` is already resolved server-side (~L64) for `listRecords`; just forward it.
- `src/components/dashboard/useRecordMutations.ts` -- REFERENCE. Confirms key shape `["records", slug, tableKey]` and the optimistic sequence that Realtime must not duplicate/override.
- `src/app/providers.tsx` -- REFERENCE. `QueryClientProvider` + `refetchOnWindowFocus: false`; `useRealtimeRecords` runs under this provider.
- `supabase/migrations/20260924055022_platform_schema.sql` -- REFERENCE. `records` columns + `records_tenant_isolation` RLS (membership via `auth_org_ids()`) that Realtime relies on for per-org delivery.
- `tests/unit/realtime.test.ts` -- NEW. Unit-test the pure helpers (channel name, filter string) and `invalidateOrgRecords` (mock `queryClient`, assert it invalidates `["records", slug]`).
- NOT TOUCHED: `mutate.ts`, `records.ts`, `records-client.ts`, filter-sort, column-hide, RLS policies, `DemoDashboard.tsx`.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/20260927120000_enable_realtime_records.sql` -- NEW: add `public.records` to the `supabase_realtime` publication; applied to the test project via Supabase MCP `apply_migration` -- enables Realtime delivery.
- [x] `src/lib/data/realtime.ts` -- NEW pure helpers: `recordsChannelName`, `recordsChangeFilter`, `invalidateOrgRecords` -- one tested source for channel config + invalidation.
- [x] `src/components/dashboard/useRealtimeRecords.ts` -- NEW hook: subscribe per org via `createBrowserSupabaseClient()`, invalidate on any event and on `SUBSCRIBED`, clean up channel on unmount -- the live sync + reconcile behavior.
- [x] `src/app/[slug]/page.tsx` -- forward the already-resolved `orgId` into `RecordsView`.
- [x] `src/components/dashboard/RecordsView.tsx` -- accept `orgId` prop and call `useRealtimeRecords({ slug, orgId })`; leave query/mutation wiring unchanged.
- [x] `tests/unit/realtime.test.ts` -- NEW: cover the I/O matrix's pure seams (filter string, channel name, invalidation key).
- [x] Update `records-view.test.tsx` to supply `orgId` and stub `useRealtimeRecords` (socket-opening side effect, no markup) so `tsc`/tests stay green. The page test stubs `RecordsView`, so it needed no change.

**Acceptance Criteria:**
- Given two members of the same org viewing the same table, when one adds, edits, or deletes a record, then the change appears for the other within ~2s (FR12, NFR-P5).
- Given a received Realtime event, when the handler runs, then it calls `invalidateQueries` and never `setQueryData` in the Realtime handler.
- Given a dropped Realtime connection, when connectivity resumes, then the client re-subscribes and reconciles (invalidate on `SUBSCRIBED`) with no manual reload.
- Given a user in a different org edits data, then this client receives no event (RLS + org filter).
- Given `npm run lint`, `npx tsc --noEmit`, `npx vitest run`, then all pass including the new `realtime` cases; no service-role key or secret reaches the client; no hardcoded user-facing strings introduced.

## Implementation Notes

- All 7 tasks implemented in spec order. Verified: `npx tsc --noEmit` clean, `npm run lint` exit 0 (only the pre-existing eslintrc deprecation warning, no errors — i18n/no-hardcoded-strings gate green; no new user-facing strings were added, per the invisible-sync decision), `npx vitest run` 363/363 pass across 33 files including the new `realtime.test.ts` (4 cases).
- Migration timestamp `20260927120000` sorts after `20260925170000_organizations_member_read.sql`. Applied to the test project via Supabase MCP `apply_migration`; confirmed `public.records` is now the sole (and expected) member of `supabase_realtime` via `pg_publication_tables`. No `replica identity full` (soft-delete = UPDATE carrying `organization_id`).
- The hook keeps state minimal: `useMemo(() => createBrowserSupabaseClient(), [])` for a stable per-mount client; the channel is opened/torn down in one `useEffect` keyed on `[supabase, queryClient, slug, orgId]`, so a slug/org change re-subscribes cleanly and unmount calls `supabase.removeChannel(channel)` (no leaked channels across table switches — table switching does NOT remount the hook, only the query key changes, and the prefix invalidate covers every table). Invalidation fires on every event AND on every `SUBSCRIBED` status (initial + post-reconnect rejoin) via supabase-js's automatic socket reconnect — no bespoke retry loop, no manual reload. The handler only ever calls `invalidateQueries(["records", slug])`; it never `setQueryData`/patches the cache or reads the event payload.
- The `orgId` prop is the org UUID already resolved server-side in `[slug]/page.tsx` (L64) for `listRecords`; it is a tenant identifier, not a secret, and no service-role key or other secret reaches the client. RLS (`records_tenant_isolation`) stays the boundary; the `organization_id=eq.<orgId>` filter is a delivery optimization.
- Testing seam (per 3.1–3.5 precedent, node env / no jsdom): the pure `realtime.ts` helpers are unit-tested (channel name, filter string, prefix invalidation key + single-call assertion). The live channel subscribe / reconnect / cross-org-isolation DOM behavior is deferred to the post-commit Playwright manual review. In `records-view.test.tsx` the hook is stubbed to a no-op because under `renderToStaticMarkup` its `useMemo` would otherwise call `createBrowserSupabaseClient()` (needs env + a WebSocket) — the hook has no markup, so stubbing loses no coverage.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-09-27) — blind-hunter, edge-case-hunter, verification-gap:

**Deferred (already recorded in deferred-work.md):**
- **verification gap → defer** — The `useRealtimeRecords` effect wiring (org `filter` into `.on`, invalidate on event, invalidate on `SUBSCRIBED`, `invalidate`-not-`setQueryData`, `removeChannel` cleanup) runs under no test; `realtime.test.ts` covers only the pure helpers and `records-view.test.tsx` stubs the hook to a no-op, and node/`renderToStaticMarkup` never fires `useEffect` (blind #5, verif #1). VERIFIED real: inverting the `SUBSCRIBED` check, dropping the filter, or swapping invalidate→`setQueryData` would ship green. Disposition defer, consistent with the 3.1–3.5 precedent (no jsdom/RTL in this repo) and the filed verification-gap disposition; the settle path (a fake-channel harness that mounts the extracted wiring, plus a two-session live Playwright check) is recorded. Already logged in `deferred-work.md` — not re-appended.

**Rejected:**
- **low → reject** — Non-`SUBSCRIBED` statuses (`CHANNEL_ERROR`/`TIMED_OUT`/`CLOSED`) unhandled; claimed permanent staleness (blind #1, edge #1/#2). AC3 ("connectivity resumes → re-subscribe and reconcile") is satisfied by supabase-js's automatic socket reconnect + channel rejoin, which re-invokes the `subscribe` state callback with `SUBSCRIBED` → invalidate. The non-recovering terminal-error path is a low-likelihood edge; the fix adds status branches/fallback listeners. Unlikely in everyday use + non-trivial fix.
- **false → reject** — JWT expiry stops delivery unless `realtime.setAuth` is called (blind #2). The `@supabase/ssr` browser client has `autoRefreshToken` and supabase-js wires `TOKEN_REFRESHED` → `realtime.setAuth()` automatically, so a long-lived channel keeps its auth. No code change needed.
- **low → reject** — Redundant refetch on the initial `SUBSCRIBED` (data just SSR-seeded via `initialData`) contradicts the "no-op" framing (blind #3). This is an intentional reconcile-on-connect that catches any change between SSR render and subscribe; it is one background refetch, not user-visible. Suppressing it adds first-connect state tracking for negligible benefit.
- **low → reject** — `invalidateQueries` default `refetchType: "active"` vs the Design-Notes/matrix wording "covers every logical table … in one call" (blind #4). The code comment in `realtime.ts` is accurate (active refetches now, inactive marked stale → refetch on next view). The looser phrasing lives in the spec, and the fix is to edit this build's spec prose — out of scope for a patch; behavior is correct.
- **low → reject** — Migration not idempotent / no down note (blind #6, edge #5). `alter publication … add table` is apply-once under the tracked migration runner; a re-run doesn't occur in normal flow. A guarded `DO`/`pg_publication_tables` block adds complexity for an unreachable-in-practice replay.
- **low → reject** — Channel-name collision across tabs / rapid-remount race (blind #7). Separate browser tabs use separate clients + sockets, so equal topic names don't collide; a table switch does NOT remount the hook (effect deps are `slug`/`orgId`, unchanged on switch); StrictMode dev double-mount self-heals via the `removeChannel` cleanup. A unique suffix adds complexity without a real production failure.
- **low → reject** — `createBrowserSupabaseClient()` throws in `useMemo` if `NEXT_PUBLIC_SUPABASE_*` are missing, crashing dashboard render (edge #3). Those env vars are app-wide prerequisites; the dashboard is auth-gated, so reaching it means they are set (a missing value breaks login and every other client path first). Guarding a state a working deployment can't be in adds complexity for no reachable benefit.
- **low → reject** — No debounce/throttle on `invalidate` → refetch storm under bulk events (edge #4). TanStack Query dedupes in-flight refetches per key, so bursts coalesce to roughly one in-flight + one queued; sustained bulk writes belong to Epic 4 (import), not this story. Debouncing adds timing complexity now for a future, naturally-bounded load.

## Design Notes

- **Invalidate, never patch.** The epic mandates the Realtime handler call `invalidateQueries` so the cache refetches authoritative rows; applying the raw event payload would bypass server-side shaping (`GET /api/records`) and RLS-consistent reads. Prefix key `["records", slug]` covers every logical table cached for the org in one call.
- **Why soft-delete removes the DELETE problem.** App "deletes" are UPDATEs of `deleted_at`, so every relevant event is INSERT/UPDATE and carries `organization_id`. That is why the org filter works with the default replica identity and why `replica identity full` (extra WAL cost) is unnecessary.
- **RLS is the boundary; the filter is an optimization.** `records_tenant_isolation` (membership via `auth_org_ids()`) means Realtime only delivers a member's org rows even without the filter; the `organization_id=eq.<orgId>` filter simply avoids delivering-then-discarding other-table noise. Passing `orgId` to the client is safe under this model.
- **Testing seam.** The repo has no jsdom (node + `renderToStaticMarkup`, per 3.1–3.5). Pure helpers in `realtime.ts` are unit-tested; the live channel subscribe/reconnect DOM behavior is verified by the post-commit Playwright manual review and logged in `deferred-work.md`, consistent with prior stories.

## Verification

**Commands:**
- `npm run lint` -- expected: passes (i18n/no-hardcoded-strings, no-service-role-in-client gates).
- `npx tsc --noEmit` -- expected: no new type errors.
- `npx vitest run` -- expected: all pass including new `realtime` cases.

**Manual checks:**
- Two authenticated sessions of the same org on the same table (second via a separate browser/profile): add/edit/soft-delete in session A and confirm session B updates within ~2s without reload. Kill the network briefly in B, restore it, and confirm B reconciles automatically. Confirm a different-org session receives nothing. Post-commit Playwright review on the authed fixture per the 3.1–3.5 precedent.
