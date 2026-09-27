---
title: 'Inline Edit with Optimistic UI (authenticated dashboard)'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '6e1dc87c8cf3555a6fbf098e74123562e68bec17'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After Stories 3.1–3.2 the authenticated dashboard (`/[slug]` → `RecordsView`) lets a team member browse, add, and delete records, but every value is read-only — to fix a typo or update a field the only path is delete-and-re-add. That fails FR8 (edit a value inline, auto-save on blur, no modal/Save button) and leaves Epic 3's "daily driver" promise incomplete.

**Approach:** Make each visible, editable cell in the active table click-to-edit: clicking (or keyboard-activating) a value swaps it for a schema-typed input seeded with the current value; committing on blur or Enter auto-saves through a new optimistic `useUpdateRecord` mutation, Escape reverts. Saves call a new `PATCH /api/records/[id]` that resolves the caller's org under RLS and writes the full merged row `data` through the existing guarded `mutate.ts` `update` op (version-gated). The UI runs the mandatory TanStack optimistic sequence (cancel → snapshot → optimistic set → roll back on error → invalidate on settle); a stale/failed write rolls back and shows a translated, non-technical message.

## Boundaries & Constraints

**Always:**
- Edit happens IN PLACE with no modal and no explicit Save button: activating a value renders an input seeded with the current value; commit on blur OR Enter; Escape reverts to the original with no write. This applies to BOTH the desktop `<Table>` cells and the mobile card values (headline + `<dl>`), matching the 3.1/3.2 desktop+mobile parity — mobile is the primary device.
- Each edit control matches the field `type` exactly as the add form does (reuse `HTML_INPUT_TYPE` + `inputModeFor`): `boolean` → the two-choice toggle that commits immediately on selection; `number`/`currency` → `inputMode="decimal"`; `email`/`phone`/`date`/`datetime`/`text` → the matching input. Every edit input has a real accessible name (schema `field.label`), never placeholder-only (NFR-A4).
- The edited field is coerced with the existing `coerceAddValue` semantics: a valid `number`/`currency` writes a finite number; a non-numeric value shows an inline `role="alert"` and blocks the save (stays in edit mode) until corrected; clearing a value (empty after trim) omits the key so the cell reads empty. Booleans always write a real boolean.
- A save sends the FULL merged row `data` (`{ ...row.data, [key]: value }`, or the key dropped when cleared) plus the row's current `version` as `expectedVersion`. The guarded `update` replaces `records.data` and bumps `version`; a version mismatch (0 rows) is the 409 concurrency case → remap to `versionConflict`.
- CRUD uses the TanStack optimistic sequence against `['records', slug, tableKey]`: `cancelQueries` → snapshot → optimistic `setQueryData` (new `data`) → roll back to snapshot on error → `invalidateQueries` on settle; reconcile the row's `version` from the server result on success. No spinner on the surface; the editing cell owns any pending affordance.
- The PATCH route mirrors POST `/api/records`: `getCurrentUser()` → 401; Zod-validate body; RLS-scoped client from cookies; resolve org by `slug` under that client (non-member/bad slug → 403); `mutate(identity, 'update', table, data, { recordId, expectedVersion })`; `{ data, error }` envelope; `reportError` on 5xx; `export const dynamic = 'force-dynamic'`.
- Any authenticated org member (Admin or Member) may edit — no role gate on record CRUD (role gating begins at Story 3.5).
- New user-facing strings resolve through next-intl under `SlugDashboard` in BOTH `en.json` and `fr.json`; all edit controls are keyboard-operable, screen-reader labelled, and ≥48×48px.

**Never:**
- No filter/sort, column hide, real-time sync, or record-detail modal — those are Stories 3.4–3.6. Inline edit only.
- Do NOT inline-edit `relation`-type fields — they need the Story 3.7 record picker, which does not exist yet; render them as read-only formatted text (label/id) for now.
- Do NOT allow editing a not-yet-settled optimistic (temp-id) row; its `id`/`version` match no server row (mirror the 3.2 `isOptimisticId` guard on delete).
- Do NOT modify the write/read logic of `mutate.ts`, `records.ts`, `format.ts`, `overrides.ts`, or `types/db.ts`; do NOT add a field `type` or a `required` flag. Do NOT reuse/modify `DemoDashboard.tsx` or `RecordDetail.tsx` (mirror the field-input pattern only).
- Never expose raw errors, stacks, SQL, or LLM output to the client; every failure resolves to a translated code via the `{ data, error }` envelope.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Activate an editable cell | click / Enter / Space on a value | the value is replaced by a `type`-matched input seeded with the current value and focused | N/A |
| Commit a valid text/number edit | edited input, blur or Enter | value updates optimistically; `PATCH` writes merged `data`; row reconciles to server `version` on settle | N/A |
| Escape while editing | Esc pressed in the input | input reverts to the original value; no write | N/A |
| Clear a value | field emptied, then commit | key omitted from `data`; cell reads the empty placeholder; record updated | N/A |
| Commit an invalid number | non-numeric in `number`/`currency` | inline `role="alert"`; stays in edit mode; no `PATCH` | client-side pre-write validation |
| Toggle a boolean cell | select the other choice | writes the boolean optimistically and saves immediately (no separate commit) | N/A |
| Relation or hidden field | `type === "relation"` / `field.hidden` | rendered read-only (relation shown by label/id; hidden not shown) — no edit affordance | N/A |
| Edit an optimistic row | row id has the `optimistic-` prefix | the edit affordance is inert until the add settles to a real row | N/A |
| Server rejects the update | `PATCH` returns an error envelope | optimistic change rolls back; translated non-technical message; query invalidated | rollback + message |
| Stale edit (version conflict) | row changed since load → 409 | edit rolls back; translated "record changed / refreshed" message; query invalidated to show current state | rollback + refetch |
| Unauthenticated API call | `PATCH` with no valid session | `401 { data:null, error:'unauthorized' }` (middleware already redirects the page) | envelope 401 |
| Non-member slug | valid session, slug the caller can't access | org lookup under RLS returns nothing → `403` envelope; no write attempted | envelope error |

</frozen-after-approval>

## Code Map

- `src/components/dashboard/RecordsView.tsx` -- MODIFY. Keep switcher/`useQuery`/add/delete/swipe untouched. Add `useUpdateRecord(slug, tableKey)`; in `RecordsTable` cells and `RecordsCards` values, render `<InlineEditCell>` for editable fields (non-`relation`, non-hidden) and plain `formatCell` for the rest; a commit builds the merged `data` and calls `updateRecord.mutate({ id: row.version-gated, data, expectedVersion: row.version })`, reusing the existing `resolveError`/`setMessage` rollback line. Guard edits on `isOptimisticId(row.id)`.
- `src/components/dashboard/InlineEditCell.tsx` -- NEW client component. Owns local `editing` + draft-string state for ONE cell. Read mode: a focusable trigger showing `formatCell(value, type, cellStrings)` with an accessible name (`editValueLabel`). Edit mode: a `type`-matched input (mirror `AddRecordForm`'s `HTML_INPUT_TYPE` + `inputModeFor`) seeded from `value`, committing on blur/Enter, reverting on Escape; `boolean` → the two-choice toggle committing immediately; invalid number → inline `role="alert"` (`invalidNumber`), stays editing. Props: `{ field, value, cellStrings, onCommit(result), pending, editable }`. Not editable → renders read-only `formatCell`.
- `src/components/dashboard/useRecordMutations.ts` -- MODIFY. Add `useUpdateRecord(slug, tableKey)`: optimistic sequence against `['records', slug, tableKey]` using `applyOptimisticUpdate`; `onSuccess` reconcile `version` from the server row; `onError` rollback; `onSettled` invalidate. Reuse `recordsKey`, `RecordApiError`, `isOptimisticId`.
- `src/lib/data/records-client.ts` -- MODIFY. Add `updateRecord(slug, id, table, data, expectedVersion): Promise<RecordData>` — `PATCH /api/records/[id]`, JSON body `{ slug, table, data, expectedVersion }`, `parseEnvelope`.
- `src/lib/forms/field-input.ts` -- MODIFY. Add pure `applyOptimisticUpdate(list, id, data, version?)` (returns a NEW array; sets `data`, and `version` when given; no-op if id absent). Reuse `coerceAddValue` for the single edited field (empty→omit clears; invalid number→error; else value).
- `src/app/api/records/[id]/route.ts` -- MODIFY. Add `PATCH` beside `DELETE`: auth → Zod body → org-by-slug under RLS → `mutate(identity, 'update', table, data, { recordId: id, expectedVersion })`; on the `CONCURRENCY_MESSAGE` → `versionConflict`; other error → `writeFailed`; success → `{ data: { id, version, data }, error: null }`.
- `src/app/api/records/schemas.ts` -- MODIFY. Add `updateBodySchema = z.object({ slug, table, data: z.record(z.string(), z.unknown()), expectedVersion: z.coerce.number().int().nonnegative() })`.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- MODIFY. Add `SlugDashboard` keys in both: `editValueLabel` ("Edit {field}"), `editHint`/`saveEdit`/`cancelEdit` as needed for the input's accessible names. Reuse existing `invalidNumber`, `boolTrue`/`boolFalse`, `writeFailed`, `versionConflict`, `genericError`.
- `src/lib/data/mutate.ts` -- REFERENCE (do not modify). `mutate(identity,'update',tableKey,data,{recordId,expectedVersion})` REPLACES `records.data`, gates on `version`, 409-style `concurrencyError` on 0 rows.
- `src/app/api/records/route.ts` -- REFERENCE for the PATCH handler shape (`resolveIdentity`, `handleError`, envelope). `[id]/route.ts` DELETE is the closest sibling (`CONCURRENCY_MESSAGE` remap).
- `tests/unit/route-records.test.ts` -- MODIFY. Add a `PATCH /api/records/[id]` describe mirroring the DELETE block.
- `tests/unit/field-input.test.ts` -- MODIFY. Add `applyOptimisticUpdate` cases.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/forms/field-input.ts` -- add the pure `applyOptimisticUpdate(list, id, data, version?)` cache updater (new array; no mutation; no-op on missing id).
- [x] `src/app/api/records/schemas.ts` -- add `updateBodySchema` (slug, table, data record, coerced non-negative int `expectedVersion`).
- [x] `src/app/api/records/[id]/route.ts` -- add the `PATCH` handler (auth → Zod → RLS org resolve → `mutate` update → `versionConflict`/`writeFailed` mapping → `{ id, version, data }` envelope).
- [x] `src/lib/data/records-client.ts` -- add the `updateRecord` client wrapper parsing the envelope into a `RecordData`.
- [x] `src/components/dashboard/useRecordMutations.ts` -- add `useUpdateRecord` with the optimistic sequence + version reconcile on success.
- [x] `src/components/dashboard/InlineEditCell.tsx` -- create the click-to-edit cell (read trigger ↔ typed input; boolean toggle commits immediately; blur/Enter commit, Esc revert; inline invalid-number error; read-only when not editable).
- [x] `src/components/dashboard/RecordsView.tsx` -- wire `useUpdateRecord`; render `<InlineEditCell>` in desktop cells + mobile card values for editable fields; build merged `data` on commit; guard optimistic rows; reuse the rollback message line.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add the new `SlugDashboard` edit keys in both locales.
- [x] `tests/unit/field-input.test.ts` -- unit-test `applyOptimisticUpdate` (updates data, sets version when given, no-op on missing id, immutability).
- [x] `tests/unit/route-records.test.ts` -- add PATCH coverage: 200 update (asserts op `update`, `recordId`, `expectedVersion`, merged `data`), 401, 403, 400 bad body, 409 `versionConflict`, 500 `writeFailed`.

**Acceptance Criteria:**
- Given a populated table, when the user activates an editable value, then it becomes a `type`-matched input seeded with the current value; committing writes through `mutate.ts` under the caller's RLS client with `actorId` set, updates optimistically, and reconciles to the server `version`.
- Given an edit, when the server rejects it or the row changed (409), then the optimistic change rolls back, a translated non-technical message shows (never a raw error), and the query is invalidated to reflect current state.
- Given inline edit is available, then it works identically on the desktop table and the mobile card list, all controls are keyboard-operable and ≥48×48px, and `relation`/hidden fields expose no edit affordance.

## Implementation Notes

- All 10 tasks implemented in spec order. Verified: `npx vitest run` 319/319 pass (35 in the two touched test files), `npx tsc --noEmit` clean, `npm run lint` clean (incl. the i18n/no-hardcoded-strings gate).
- `InlineEditCell` splits into a read `<button>` trigger and an `InlineEditor` that is remounted on each entry into edit mode, so initializers read the current value without an effect-driven resync. Scalar edits use a one-shot `done` latch so the Enter→blur pair commits once, and an unchanged-draft check (`draft.trim() === original.trim()`) skips the write entirely. Boolean edits commit immediately on selecting the other choice; selecting the current choice cancels.
- The `[id]/route.ts` refactor made the `json` helper generic and extracted a shared `handleError<T>`; DELETE now routes through it too (behavior unchanged) so PATCH and DELETE share identical error/envelope handling.
- Merged-data model: the client sends the FULL row `data` (a cleared value drops the key) plus `row.version` as `expectedVersion`; `mutate`'s update replaces `records.data` wholesale and version-gating turns a concurrent foreign edit into a clean 409 rather than a silent clobber.
- Known limitations (consistent with 3.1/3.2 precedent, not regressions): (1) `updateRecord.isPending` is mutation-global, so during an in-flight save every editable trigger is briefly disabled — safe single-flight behavior, no surface spinner; (2) `date`/`datetime` inputs seed from `String(value)`, mirroring the existing `RecordDetail` limitation (no special date reformatting requested); (3) interactive DOM (activate, Escape-revert, boolean toggle, relation/hidden read-only, optimistic-row guard) is not unit-tested — this repo has no jsdom (Vitest node env), so those matrix rows are verified by the post-commit Playwright manual review, matching the deferred-work precedent. Pure logic and route handlers ARE node-tested.

## Spec Change Log

## Review Triage Log

Pass 1 (2026-09-26) — blind-hunter, edge-case-hunter, verification-gap:

**Patched:**
- **high → patch** — A `date`/`datetime` cell whose stored value can't seed the native control (e.g. a `datetime` stored as a full ISO instant renders the `datetime-local` input blank) is SILENTLY CLEARED when the user merely clicks the cell and blurs without typing: empty draft → `coerceAddValue` omit → `handleCellCommit` deletes the key. Verified against `InlineEditCell.tsx` `ScalarEditor.commit` + `toInputString` (blind BH7 / edge EC2). Fixed via a `dirty` flag: an untouched input never commits.
- **medium → patch** — After committing/cancelling an edit (notably Enter), the `InlineEditor` unmounts and focus falls to `<body>`, breaking keyboard flow; the frozen spec requires keyboard-operable controls (blind BH1). Fixed: focus returns to the read-mode trigger `<button>` on transition back to read mode.
- **low → patch** — A boolean whose stored value is undefined/null maps to `current=false`, so selecting "No" is treated as already-current → silent no-op; an unset boolean can never be explicitly set to false (edge EC1). Reachable via seed/imported rows lacking the key. Fixed: when the value is unset, either selection is a real write.
- **low → patch** — The new inline-edit read-mode structure (editable cells render an edit trigger; relation/hidden fields stay read-only) was unasserted, so flipping the `editable` gate would pass unit tests (verification-gap Other). Fixed cheaply in-pattern: added `renderToStaticMarkup` assertions to `records-view.test.tsx`.

**Deferred (see deferred-work.md):**
- **defer** — Interactive `InlineEditCell` behaviors (activate, Escape-revert, boolean toggle, commit-once latch, invalid-number-blocks-save) and the `useUpdateRecord` hook + `updateRecord` client wrapper + the PATCH `req.json()`-throw branch are not unit-tested (verification-gap VG1/VG2, blind BH9). Repo is Vitest node env with no jsdom; interactive DOM is verified by the post-commit Playwright review, matching the standing 3.1/3.2 precedent. Read-mode structure is now statically asserted (see patch above).
- **defer** — PATCH inherits two pre-existing records-route patterns: no server-side conformance validation of `data` against the table's field definitions (`mutate` stores JSONB verbatim; own-tenant under RLS, no cross-tenant risk) (blind BH8), and the brittle exact-string coupling of `CONCURRENCY_MESSAGE` between `mutate.ts` and the route (a wording change silently demotes 409→500) (blind BH10). Both are shared with the POST/DELETE siblings from Story 3.2.

**Rejected:**
- **false** — "No aria-live region announces the rollback/failure" (blind BH3). Refuted: `RecordsView`'s `StatusMessage` already renders `<motion.p role="alert">`, so the rollback message is announced to screen readers.
- **false** — "Concurrent delete during edit is unhandled" (blind BH4). Refuted: a commit against a soft-deleted row fails the `version`+`deleted_at IS NULL` gate → 0 rows → 409 → rollback + invalidate refetch drops the row. Graceful, not a defect (just absent from the matrix).
- **false** — "`editHint`/`saveEdit`/`cancelEdit` specified but not added" (blind BH2). Refuted: the Code Map said "as needed"; the editor's accessible name is `editValueLabel`, which was added. The fix would edit this spec's Code Map — out of scope.
- **low → reject** — `editPending` is mutation-global, so an in-flight save briefly disables every cell's trigger (blind BH5). Acknowledged in Implementation Notes; negligible on a normal connection and the per-row-pending fix adds real complexity for a cosmetic gain.
- **low → reject** — The unchanged-draft skip compares `draft.trim()` vs `original.trim()` (raw strings), not coerced values, so `"12"`→`"12.0"` writes a redundant (self-healing, non-corrupting) update, contradicting the Design Notes' "coerced value" wording (blind BH6 / edge EC3, low confidence). Unlikely in everyday use and the coerced-compare fix adds complexity; the `dirty` patch already suppresses the untouched case.

## Design Notes

- Build `InlineEditCell` and the RecordsView edit wiring with the `/web-uiux-architect` skill (per the build request): read↔edit transition, focus handling, the boolean toggle, pending/saving affordance, and mobile touch ergonomics — within the Boundaries. Respect `useReducedMotion`; keep parity with 3.1/3.2 tokens.
- Reuse, don't fork, the 3.2 field-input logic: `HTML_INPUT_TYPE` + `inputModeFor` for the control, `coerceAddValue` for the single edited value (empty→omit is exactly "clear the field" here). Keep all new pure logic in `field-input.ts` so it's node-testable (no jsdom in this repo — interactive DOM is verified by manual/Playwright review, matching the 3.1/3.2 precedent).
- Client sends the full merged `data` (like POST), not a field patch: `mutate`'s update replaces `records.data` wholesale, and `expectedVersion` gating turns a concurrent foreign edit into a clean 409 rather than a silent clobber — the epic's "no silent overwrite" rule.
- Commit-once discipline: a blur triggered by pressing Enter (which also fires a commit) must not double-submit; commit should be idempotent for an unchanged draft and skip the write when the coerced value equals the original.

## Verification

**Commands:**
- `npm run lint` -- expected: passes, including the i18n/no-hardcoded-strings gate.
- `npx tsc --noEmit` -- expected: no new type errors (note the pre-existing `api/claim` typed-route build blocker logged in deferred-work; `next dev` runs).
- `vitest run` -- expected: all pass, including the new `applyOptimisticUpdate` and PATCH cases.

**Manual checks:**
- Signed-in member on a claimed org: click a cell (desktop) and a card value (mobile), edit, blur/Enter → value persists after refresh; Escape reverts; clearing a value empties it; a bad number blocks save with an inline message; a boolean toggles and saves; a forced server failure rolls back with a translated message. EN/FR toggle renders new strings in both. Touch targets ≥48×48px.
