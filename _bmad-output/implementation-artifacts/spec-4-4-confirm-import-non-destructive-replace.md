---
title: 'Story 4.4: Confirm Import (Non-Destructive Replace)'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '79330d09979226ea41c61d15df438fe831f05a22'
context:
  - '_bmad-output/implementation-artifacts/epic-4-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After 4.3 the Admin has resolved every flagged column and the Import button is enabled, but clicking it does nothing: the confirmed mapping is never written. This is the activation payoff of the whole epic. The Admin must be able to confirm and have their real rows land in the live tables, non-destructively replacing any remaining synthetic/demo rows while every real record already in place is preserved.

**Approach:** Wire the 4.3 Import seam to a new Admin-only `POST /api/import/commit`. The client re-uploads the same file plus the confirmed decisions and a stable import id; the route re-parses server-side (never trusting client rows), validates every mapped target against the live schema, soft-deletes the affected tables' remaining synthetic rows, then bulk-inserts the mapped rows through the guarded mutation layer with per-row idempotency so a retried commit cannot double-write. The UI shows commit progress, a success summary, and a translated retryable error, and invalidates the records cache. This is the commit/write phase; parse (4.1), propose (4.2), and resolve (4.3) are unchanged.

## Boundaries & Constraints

**Always:**
- Commit is the ONLY write phase. It runs only after 4.3's gate (`isReadyToImport`) is satisfied; the route independently re-validates that no decision is `unresolved` and rejects otherwise. It never trusts client-parsed rows: it re-runs `parseSpreadsheet` on the re-uploaded bytes/sheet under the same ≤5 MB + extension guard as analyze/propose.
- Auth mirrors analyze/propose exactly: authenticate, `resolveOrgIdentity(slug, user.id)` (non-member → 403), `requireAdmin` (Member → 403), `membership.slug === slug` (cross-org Admin → 403), all before any parse or write. `export const dynamic = "force-dynamic"`.
- All row writes flow through the guarded mutation layer (`src/lib/data/mutate.ts`) under the caller's RLS-scoped client with explicit identity; the service-role key is NEVER used for tenant rows (only inside `requireAdmin`'s narrow membership read).
- Re-validate every decision `{table, field}` against a fresh `getSchema` read (RLS client): the target must be a real, non-hidden field. A decision that no longer resolves is rejected (schema drift), never silently written. `skip` decisions drop that column.
- Synthetic identification: synthetic/demo rows are exactly the live rows whose `actor_id = SYSTEM_ACTOR_ID` (`00000000-0000-0000-0000-0000000000a0`, the seed marker). On commit, soft-delete (set `deleted_at`) only those rows, scoped to the AFFECTED table_keys (the distinct target tables in the confirmed mapping) with `deleted_at IS NULL`. Real rows (any live row with a human `actor_id`) are never touched, so this is a no-op once claim has already cleared demo data.
- Idempotency: the client generates a stable `importId` on first click and reuses it on every retry; per-row idempotency keys derive from it (e.g. `import-${importId}-${tableKey}-${rowIndex}`) so a retried commit dedupes to the same logical write instead of duplicating rows. The synthetic-clear is an idempotent soft-delete.
- Ordering for crash-safety: insert first, then clear synthetic. A mid-commit failure leaves no half-corrupted table (inserts dedupe on retry; the clear re-runs idempotently); on any failure the client surfaces a translated status and offers Retry.
- Server-side row bound: reject a file whose parsed data-row count exceeds `MAX_IMPORT_ROWS` (5000, matching the epic performance guarantee) with a translated error and no write.
- Return the `{ data, error }` envelope where `error` is a translation KEY; `data` on success carries a per-table imported-row summary. Never expose raw stacks, SQL, or schema JSON. All UI copy resolves through next-intl (en + fr): real French, no em-dashes, a11y baseline preserved.
- On success, invalidate the TanStack Query records cache (`["records", slug]`) so the dashboard shows the imported rows.
- Decision (2026-09-28): on success the import page shows a success summary with per-table imported counts plus a "Go to dashboard" link and an "Import another" action; it does NOT auto-redirect.
- Decision (2026-09-28): commit is ADDITIVE with respect to real data — it inserts the mapped rows regardless of any existing non-synthetic rows in the affected tables (only synthetic rows are cleared). Re-importing the same content can therefore create duplicate records; this is accepted for MVP (a future append/replace choice is out of scope).

**Never:**
- Never write with the service-role client, never create or alter schema fields (importing uses only existing fields; adding a new field remains out of scope, logged in `deferred-work.md`).
- Never import into relation-type target fields: relationship-aware import (matching source values to referenced records) is deferred to Epic 9. A column whose confirmed target is a `relation` field is dropped from the write, not stored as a raw value (which would create a dangling reference).
- Never hard-delete any row; synthetic clearing is a soft-delete only.
- Never change 4.1/4.2/4.3 behavior (parse, propose, resolve). The only 4.3 touch is wiring the existing `onImport` seam.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy commit | Admin confirms a fully-resolved mapping | Synthetic rows in affected tables soft-deleted; mapped rows bulk-inserted; success summary with per-table counts; records cache invalidated | N/A |
| Skipped column | A column's decision is `skip` | That column contributes no field to any inserted row | N/A |
| Multi-table mapping | Columns target more than one table | Each source row yields one record per distinct target table, carrying that table's mapped fields | N/A |
| Relation target | A confirmed target is a `relation` field | That column is dropped from the write; other columns import normally | N/A |
| Unresolved decision reaches route | Any decision is `unresolved` | Rejected before any write | `Import.error.unresolvedColumns` (400) |
| Schema drift | A mapped `{table, field}` no longer resolves to a live non-hidden field | Rejected before any write | `Import.error.schemaChanged` (409) |
| Too many rows | Parsed data rows > MAX_IMPORT_ROWS | Rejected before any write | `Import.error.tooManyRows` (413) |
| Retried commit | Same file + same `importId` re-sent | No duplicate rows; returns the same success summary | N/A |
| Commit failure mid-write | Insert or clear throws | No half-corrupted table; translated error + Retry; retry is idempotent | `Import.error.commitFailed` (500) |
| File/parse errors | Empty / oversized / unreadable / missing file | Rejected before any write, translated retryable error | `Import.error.empty` / `.tooLarge` / `.unreadable` / `.noFile` |
| Non-Admin / anon | Member, anon, or missing session | Rejected before any parse or write | `forbidden` (403) / `unauthorized` (401) |

</frozen-after-approval>

## Code Map

- `src/app/api/import/commit/route.ts` -- NEW. Mirror `propose/route.ts` auth chain + `errorForKey` + `{data,error}` envelope + `dynamic`. Read `formData` (slug, file, sheet, `decisions` JSON, `import_id`); guard via the commit schema; `parseSpreadsheet`; `getSchema` (RLS client); call the pure commit planner; execute the synthetic-clear + bulk insert; return the summary.
- `src/app/api/import/propose/route.ts` -- EXEMPLAR to mirror (auth chain, formData read, errorForKey, envelope). Do NOT modify.
- `src/app/api/import/schemas.ts` -- EXTEND: add `commitInputSchema` (reuse file/size/extension + optional `sheet`; add `decisions` as JSON-string → parsed `DecisionMap`, and `import_id` non-empty string). Reuse `MAX_UPLOAD_BYTES`, `ACCEPTED_EXTENSIONS`. Add `MAX_IMPORT_ROWS = 5000`.
- `src/lib/import/commit.ts` -- NEW pure module: `planCommit(rows, decisions, schema): { tables: Array<{ tableKey; rows: Array<Record<string,unknown>> }>; affectedTables: string[] }`. Iterates confirmed `map` decisions, groups mapped columns by target table, drops `skip` + relation-type targets, resolves targets against the schema (via `normalizeTableName`), throws typed errors for unresolved/schema-drift. No I/O, no framework imports.
- `src/lib/data/mutate.ts` -- EXTEND: add `bulkInsertRecords(identity, tableKey, rows: Array<{ data; idempotencyKey }>): Promise<ApiResponse<{ insertedCount }>>` — single guarded array insert under the RLS client with per-row idempotency (upsert-ignore-duplicates on the idempotency index), reusing the module's insert conventions. Keep existing `mutate`/`insertRecord` intact.
- `src/lib/claim/claim.ts` -- REUSE `SYSTEM_ACTOR_ID` (line 38); mirror the synthetic soft-delete pattern (lines 246-262) but scope it to affected `table_key`s and `actor_id = SYSTEM_ACTOR_ID` under the RLS client. Export the constant (or lift to `src/lib/data/`) so commit shares one source of truth.
- `src/lib/data/import-client.ts` -- EXTEND: add `commitImport(slug, file, decisions, importId, sheet?): Promise<CommitResult>` posting multipart, parsing the envelope, throwing `ImportApiError(code)`. Mirror `proposeMapping`.
- `src/lib/import/resolve.ts` -- REUSE `MappingDecision`, `DecisionMap`, `isReadyToImport`. The confirmed decisions ARE the commit input.
- `src/types/import.ts` -- EXTEND: add `CommitResult` (`{ importedCount: number; tables: Array<{ tableKey: string; count: number }> }`). Do not change frozen `ColumnMapping`/`ImportProposal`.
- `src/components/import/ImportView.tsx` -- EXTEND: generate a stable `importId` (`crypto.randomUUID`) on first Import click held in state; wire `ImportGate`'s button `onClick` to `commitImport`; own commit state (`idle|committing|done|error`); render progress, a success summary (per-table counts + "Go to dashboard" link + "Import another"), and translated error/Retry; call `useQueryClient().invalidateQueries({ queryKey: ["records", slug] })` on success; no auto-redirect. The button seam is at lines 238-240; `session.file`/`session.sheet` are available.
- `src/components/dashboard/useRecordMutations.ts` -- REFERENCE for the `["records", slug, tableKey]` query-key shape used by cache invalidation.
- `src/lib/i18n/en.json` + `fr.json` -- EXTEND the `Import` namespace: `Import.commit.*` (committing, success heading + per-table summary, go-to-dashboard, import-another) and `Import.error.*` (`unresolvedColumns`, `schemaChanged`, `tooManyRows`, `commitFailed`). Real French, no em-dashes.
- `_bmad-output/implementation-artifacts/deferred-work.md` -- APPEND: "map to a NEW field on import" and "relationship-aware CSV import" remain deferred (Epic 9 / editor).
- `tests/unit/import-commit.test.ts` -- NEW: `planCommit` matrix (map/skip/relation-drop/multi-table/unresolved/schema-drift). `tests/unit/route-import-commit.test.ts` -- NEW: route auth gates before write, row-cap rejection, synthetic-clear scope, bulk-insert call, idempotent retry, error-key→status mapping (mock `parseSpreadsheet`, `getSchema`, mutate layer, auth).

## Tasks & Acceptance

**Execution:**
- [x] `src/types/import.ts` -- add `CommitResult`; keep frozen types intact.
- [x] `src/lib/import/commit.ts` -- pure `planCommit`: group confirmed `map` decisions by target table, drop `skip` + relation targets, resolve against schema, throw typed unresolved/schema-drift errors.
- [x] `src/lib/data/mutate.ts` -- add `bulkInsertRecords` (guarded array insert, per-row idempotency); export/share `SYSTEM_ACTOR_ID` or import it from claim.
- [x] `src/app/api/import/schemas.ts` -- add `commitInputSchema` (+ `decisions` JSON, `import_id`) and `MAX_IMPORT_ROWS`.
- [x] `src/app/api/import/commit/route.ts` -- auth chain (mirror propose), guard, re-parse, row-cap check, `getSchema`, `planCommit`, bulk insert then synthetic soft-delete (scoped to affected tables + SYSTEM_ACTOR_ID), return `CommitResult`; map failures to matrix keys.
- [x] `src/lib/data/import-client.ts` -- add `commitImport(...)` posting multipart, throwing `ImportApiError`.
- [x] `src/components/import/ImportView.tsx` -- stable `importId`, wire the Import button to commit, own commit state, render progress + success summary (per-table counts, go-to-dashboard link, import-another) + error/Retry, invalidate the records cache on success (no auto-redirect). Built per `/web-uiux-architect`.
- [x] `src/lib/i18n/en.json` + `fr.json` -- add `Import.commit.*` and the new `Import.error.*` keys (real French, no em-dashes).
- [x] `_bmad-output/implementation-artifacts/deferred-work.md` -- append the new-field + relationship-import deferrals.
- [x] `tests/unit/import-commit.test.ts` + `tests/unit/route-import-commit.test.ts` -- cover the I/O matrix (planner + route).

**Acceptance Criteria:**
- Given an Admin with a fully-resolved mapping, when they click Import, then the mapped rows appear in the live tables, any synthetic rows in the affected tables are gone, all pre-existing real rows remain, and the records cache reflects the new data (verify via UI + DB).
- Given the same file and import id re-submitted (e.g. a retried request), when commit runs again, then no duplicate rows are created and the same success summary is returned.
- Given a non-Admin or unauthenticated caller, when `/api/import/commit` is called, then it returns 403/401 before any parse or write.
- Given the `fr` locale, when the commit progress, success, or error surfaces render, then all copy is real French via next-intl with no hardcoded strings and no em-dashes.

## Implementation Notes

- **Critical fix caught in verification: `bulkInsertRecords` cannot use `ON CONFLICT` upsert.** The first implementation used `client.from("records").upsert(payload, { onConflict: "organization_id,table_key,idempotency_key", ignoreDuplicates: true })`. The idempotency index (`records_idempotency_key_idx`) is a PARTIAL unique index (`where idempotency_key is not null`), and Postgres cannot infer a partial index as an `ON CONFLICT` arbiter from a bare column target — verified against the real DB with `EXPLAIN`, which raised `42P10: there is no unique or exclusion constraint matching the ON CONFLICT specification`. That would have failed EVERY commit with `Import.error.commitFailed`, and the mocked unit tests could not catch it. Rewrote `bulkInsertRecords` to a deterministic idempotency pre-check + plain array insert: read whether the batch's first row key already exists (the per-table array insert is a single atomic statement, so a prior attempt wrote all rows or none), skip re-insert if so, and treat a `23505` on the insert as idempotent success (concurrent-retry winner). Behavior verified: `EXPLAIN` of the bare-`DO NOTHING` path plans cleanly; the corrected function needs no `ON CONFLICT` at all.
- **Verification gap (accepted):** `bulkInsertRecords`'s real DB path is not unit-tested (the route tests mock the mutate layer, per repo convention). The corrected SQL shape was validated directly against the live schema via `EXPLAIN` instead. `insertedCount` reports the requested row count (not a DB-affected count) so a retried commit returns the same summary; logged in `deferred-work.md`.

- **Review Pass 1 patches applied (2026-09-28).** The three `patch` findings were applied directly (the harness offers no way to re-engage the original implementation subagent): (BH4) `ImportView.runCommit` now guards `crypto.randomUUID` with the repo's `typeof crypto !== "undefined" && crypto.randomUUID ? … : Math.random().toString(36).slice(2)` fallback; (VG1) added a `bulkInsertRecords` describe block in `tests/unit/mutate.test.ts` (pre-check short-circuit, fresh-batch payload shape, 23505→idempotent success, non-unique error envelope, empty batch); (VG2/BH9/BH10) `tests/unit/route-import-commit.test.ts` now records the clear via an `onClear` hook and asserts `order === ["insert","clear"]`, plus new tests that the clear is skipped on insert failure and on an empty (all-skip) plan; removed the dead `origClient` lines. Full suite 593 pass, tsc clean (baseline `claim/route` error only), lint clean.

## Spec Change Log

## Review Triage Log

### Pass 1 (2026-09-28)

- **[VG1] `bulkInsertRecords` real body has no test that runs it** — verification-gap, pre-verified → **patch**. The route tests fully mock the mutate layer (`vi.fn()`), and `mutate.test.ts` only exercises the single-row `mutate()` path; the new array-insert / first-key pre-check / 23505-idempotent-success / error-envelope branches are unverified. This is the sole tenant-write in the import pipeline. Add a direct unit test.
- **[VG2/BH9] "orders insert BEFORE the synthetic clear" test does not assert ordering** — `low` (verification integrity) → **patch**. The test only pushes `"insert"` to `order` and never records the clear, so `order[0]==="insert"` passes even if the clear ran first; `origClient` is dead code. The ordering is structurally guaranteed by the route's straight-line code, but the test claiming to lock the central safety property does not. Also no test asserts the clear is skipped when the insert fails. Strengthen it.
- **[BH10] No route test for the empty-`affectedTables` branch** — `low` → **patch** (bundled with VG2). The `if (plan.affectedTables.length > 0)` clear-skip guard is a real branch with no route-level coverage.
- **[BH4] `ImportView` uses bare `crypto.randomUUID()` without the repo's guarded fallback** — `low` → **patch**. `useRecordMutations.ts:86` / `useRecordActions.ts:86` use `typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : <fallback>`; the new import id at `ImportView.tsx:149` diverges, so a non-secure context (http on a LAN IP) throws synchronously before any commit state is set, hanging the button. Fix is a direct correction mirroring the existing pattern.
- **[BH1/EC2] Synthetic clear does not bump `version` and is a raw `client.update`, not the guarded mutate layer** — `low`, rejected. Soft-deleted rows are excluded from all reads and never re-updated (mutate update/delete filter `.is deleted_at null`), so a stale `version` has no consumer; the clear uses the caller's RLS-scoped client (security holds) and mirrors the established `claim.ts` raw synthetic soft-delete. A per-row version bump would need an RPC/loop (more than a direct correction) for zero demonstrated harm.
- **[BH2] Idempotency pre-check can be fooled by a soft-deleted prior row, skipping re-insert** — `false`. Unreachable: `importId` is regenerated on every fresh import and cleared on start-over, so a key repeats only across retries within ONE commit flow, during which the inserted real rows (human `actor_id`) are never soft-deleted (the clear targets only `SYSTEM_ACTOR_ID`). Even then a plain insert would raise `23505` (the partial index includes soft-deleted rows) and return the same idempotent success.
- **[BH3/EC1] `insertedCount` can diverge from reality on a partial batch; atomicity asserted not verified** — `false` for correctness. A single array `.insert` is one atomic Postgres statement (all-or-none is a DB guarantee, not an assertion), so a partial batch cannot occur. The testing concern is covered by VG1.
- **[BH5] All-skipped / relation-only mapping yields a benign "0 records imported" success with no guard** — `low`, rejected. Reachable but harmless (no data written, the count is shown, the Admin can retry); users normally map real fields. A guard adds a branch + new copy (more than a direct correction) for an everyday-unlikely state.
- **[BH6] Other locales missing keys / em-dash in copy** — `false`. Only `en.json` + `fr.json` exist (no missing-locale leakage); the new `commit.*` copy contains no em-dashes (the em-dashes in `en.json` are all pre-existing keys, not this change).
- **[BH7] `resolveCommitError` allow-list duplicates the server key list and can drift** — `low`, rejected. Maintainability only; every current key is handled and an unknown code degrading to `commitFailed` is an acceptable fallback. A shared source-of-truth adds public surface for no runtime defect (mirrors 4.3 F8).
- **[BH8] Route trusts the client `decisions` map wholesale; no reconciliation of parsed columns vs decision keys** — `low`, rejected (unreachable via UI). The client re-sends the SAME `File` it parsed for propose and seeds decisions from those parsed columns, so keys match; the server re-parses rows (client rows are never trusted). An API-direct mismatch only writes empty values into the caller's own org.
- **[EC4] Intent/Approach prose says "soft-deletes ... then bulk-inserts" (delete-first), contradicting the insert-first code** — `low`, rejected. No code defect: the code matches the authoritative frozen **Boundaries** ("insert first, then clear"); the Approach is intent-level narrative and the only fix would edit this build's frozen spec.

**Outcome:** No `intent_gap` or `bad_spec`; no loopback. Three `patch` entries (VG1 add bulkInsertRecords tests; VG2+BH9+BH10 strengthen ordering/branch tests; BH4 guarded randomUUID). All other findings verified `low` or `false` and rejected per the triage rules.

## Design Notes

- **Atomicity via ordering + idempotency, not a DB transaction.** The Supabase JS client cannot span statements in one transaction without a Postgres function, and the epic bans DDL/RPC sprawl. Instead: a single array-insert statement is atomic on its own, a single soft-delete statement is atomic on its own; run insert-then-clear so a failure between them leaves data visible (never an emptied table), and make both idempotent (per-row idempotency keys; soft-delete re-run is harmless) so the client's Retry converges. This satisfies "no half-corrupted table" without a migration.
- **Multi-table + relation handling** falls out of the frozen 4.3 picker (which offers any non-hidden field across tables): `planCommit` groups mapped columns by target table so one source row can yield a record per distinct table, and drops relation-type targets (Epic 9) so no dangling reference is written.

## Verification

**Commands:**
- `npm run test -- tests/unit/import-commit.test.ts tests/unit/route-import-commit.test.ts` -- expected: all planner + route tests pass.
- `npx tsc --noEmit` -- expected: no new type errors (the pre-existing unrelated `src/app/api/claim/route.ts` baseline error may remain).
- `npm run lint` -- expected: clean (only the project-wide eslintrc-deprecation warning).

**Manual checks:**
- On `/[slug]/import` as an Admin: upload a CSV, resolve any flagged columns, click Import; confirm progress then success, and that the dashboard shows the imported rows with no synthetic rows and any prior real rows intact. Re-run the same import and confirm no duplicates. Toggle `fr` and confirm progress/success/error copy is real French.
