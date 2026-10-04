---
title: 'Choose Target Table Per Form'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '5c4812ab194d937ef670a3ccfe630364c8e61cf7'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A form's target table is chosen once by the creation-time intake heuristic (14.1) and shown READ-ONLY in the editor. An Admin cannot correct or change where a form collects, even though the stored `target_table_key` is the runtime authority. The epic requires the owner's explicit choice to override the heuristic.

**Approach:** Replace the read-only Target card in the form editor with a `Select` picker listing the org's visible tables (the stored `target_table_key` pre-selected), plus a Save action, mirroring the rename/slug cards. A new guarded `updateFormTarget` mutation on the existing `/api/forms/[formId]` PATCH route validates the chosen table is visible, writes `target_table_key`, and revalidates `field_config` by dropping entries whose field no longer exists in the new table.

## Boundaries & Constraints

**Always:**
- The picker offers exactly the org's VISIBLE tables (`visibleTables(schema)`), labelled by their human `label`, valued by `key`. The form's current `target_table_key` is pre-selected; a stale/hidden stored key matches no item and the picker shows its placeholder until the Admin picks a valid table. Any visible table is selectable — including one with no eligible intake fields (the publish gate, not the picker, enforces publishability).
- `updateFormTarget` is server-authoritative: it rejects (translated key, no write) a `targetTableKey` that is not a currently-visible table, and 404s a form id not in the caller's org. It writes through the existing `form-mutate.ts` guarded layer under the caller's RLS client and identity (`actor_id`/`updated_at` bumped), exactly like `renameForm`; the PATCH route re-runs the writable-admin gate and maps failures to `Forms.error.*` via the `{ data, error }` envelope.
- The target is locked while the form is PUBLISHED (decision; mirrors the 14.3 slug lock, so a live form never silently redirects where responses land). `updateFormTarget` rejects a change on a published form with `Forms.error.targetLocked` (no write, checked before validating the new key), and the editor disables the picker + Save with a hint to unpublish first. Unpublishing re-enables it.
- On a target change, `field_config` is revalidated against the new table: entries whose `key` is not a field of the new table are dropped (selective filter, not a wholesale reset); matching entries are preserved. Today `field_config` is always `[]`, so this is a no-op in practice, but the filter is implemented correctly for when 14.5 populates it.
- The stored `target_table_key` remains the sole runtime authority for public rendering/submission (14.2); this story only lets the Admin set it. The heuristic stays a creation-time default only (14.1) and is not re-run here.
- WCAG AA: the `Select` has an associated `<Label>`, `>=44px` trigger (`min-h-12`), visible focus ring, keyboard operable; the Save control shows a pending spinner and an inline `role="alert"` error / `role="status"` saved confirmation, matching the rename/slug cards. Mobile-first. All new copy resolves through the `Forms` namespace (EN + FR); no hardcoded strings; no em-dash.

**Never:**
- Do not change the public route/resolver (14.2), `publishForm`/`updateFormSlug`/`createForm` behavior, `middleware.ts`, or `mutate.ts`. Do not re-run or change the intake heuristic. Do not add per-field visibility/label/order editing UI — reading/writing individual `field_config` entries beyond the drop-stale filter is 14.5. Do not add branding/intro (14.6) or abuse protection (14.7).
- Do not widen the picker to hidden tables, other orgs' tables, or non-table entities. Do not auto-select or silently mutate the target without the Admin's Save action.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Change target to another visible table | `PATCH /api/forms/{id}` `{slug, targetTableKey}` naming a visible table | `target_table_key` persisted; `field_config` filtered to the new table's fields; `200 {id,slug}`; publish gate re-evaluates (editor reflects new publishability) | N/A |
| Picker render | GET editor; form has a stored target | `Select` lists all visible tables, stored target pre-selected; Save disabled until a different table is chosen | N/A |
| Stored target is stale (hidden/deleted) | Stored `target_table_key` not in visible tables | Picker shows placeholder (no match); Admin must choose a valid table | N/A |
| Choose a table with no eligible fields | Save a visible table whose only fields are relation/hidden | Save succeeds (target set); the publish gate then reports `invalid-target` and blocks publishing | N/A |
| Invalid / non-visible target key | `targetTableKey` naming a hidden/unknown/other-org table | No write; `400 Forms.error.targetInvalid` | No internals leaked |
| Target change while published | `{targetTableKey}` on a `published` form | No write; `409 Forms.error.targetLocked`; editor picker disabled with unpublish hint | No write |
| Unknown / cross-org form id | `formId` not in caller's org | `404 Forms.error.notFound` | RLS-hidden |
| Non-admin / cross-org PATCH | Member or cross-org admin | `403`; editor page already redirects non-admins | No internals leaked |

</frozen-after-approval>

## Code Map

- `src/types/db.ts:632-664` -- `FormFieldConfig` (`{key,label?,included?,order?}`), `FormRow` (`target_table_key`, `field_config`, `published`). No change.
- `src/lib/schema/overrides.ts:29` -- `visibleTables(schema)` → `TableDefinition[]` ({key,label,fields}). Source of picker options and the validity check.
- `src/lib/data/records.ts` -- `getSchema(client, orgId)`.
- `src/lib/data/form-mutate.ts` -- guarded mutations; `FormMutateIdentity`, `FormMutateResult`, `renameForm` (pattern to mirror). ADD `updateFormTarget(identity, {formId, targetTableKey})`.
- `src/lib/forms/publishability.ts` -- `evaluateFormPublishability(client, orgId, form)` → `{publishable, reason}`. Re-used by the editor loader so the publish toggle reflects the new target.
- `src/app/api/forms/[formId]/route.ts:72-98` -- PATCH; discriminates publish → slug → rename. ADD a target branch (`targetBodySchema`, place after publish, before slug/rename).
- `src/app/api/forms/schemas.ts` -- Zod bodies + `firstFormErrorKey`. ADD `targetBodySchema` (`{slug, targetTableKey:string}`).
- `src/lib/data/forms-client.ts` -- client fetch wrappers. ADD `updateFormTarget(slug, formId, targetTableKey)`.
- `src/app/[slug]/forms/_shared.ts:91-149` -- `loadFormForEditor` returns `{form, publishable, reason}`. CHANGE to also return `tables: {key,label}[]` (from `visibleTables(getSchema())`) for the picker.
- `src/app/[slug]/forms/[formId]/page.tsx` -- pass the `tables` list to `FormEditor`.
- `src/components/forms/FormEditor.tsx:254-271` -- the read-only Target card. REPLACE the Badge/`targetNone` display with a `Select` picker + Save control (own `useTransition`/error/saved state, like the slug card); disable the picker + Save with an unpublish hint when the form is published (reuse the lifted `published` state that already drives the slug lock).
- `src/components/invoices/LinkedRecordPicker.tsx:156-173` -- exemplar Select-of-tables pattern (value=`table.key`, children=`table.label`). Mirror, do not import.
- `src/components/ui/select.tsx` -- `Select`/`SelectTrigger`/`SelectValue`/`SelectContent`/`SelectItem`.
- `src/lib/i18n/en.json` & `src/lib/i18n/fr.json` -- `Forms` namespace. ADD target-picker copy (label/help/placeholder/save/saved + published lock hint) and `error.targetInvalid` + `error.targetLocked` in EN + FR.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/data/form-mutate.ts` -- add `updateFormTarget(identity, {formId, targetTableKey})`: 404 unknown id; reject a change on a published form (`Forms.error.targetLocked`, before validating the key); reject non-visible target (`Forms.error.targetInvalid`); drop `field_config` entries whose `key` is not a field of the new table; write `target_table_key`+filtered `field_config`+`actor_id`+`updated_at` -- guarded target write.
- [x] `src/app/api/forms/schemas.ts` -- add `targetBodySchema` (`{slug, targetTableKey: z.string().min(1)}`) -- validated target body.
- [x] `src/app/api/forms/[formId]/route.ts` -- add a target branch to PATCH, after publish and before slug/rename (discriminated by a `targetTableKey` field) -- route the target mutation with the existing admin gate + envelope.
- [x] `src/lib/data/forms-client.ts` -- add `updateFormTarget(slug, formId, targetTableKey)` mirroring `renameForm` -- client wrapper.
- [x] `src/app/[slug]/forms/_shared.ts` -- extend `loadFormForEditor` to also return `tables: {key,label}[]` (visible tables) -- picker options, server-resolved.
- [x] `src/app/[slug]/forms/[formId]/page.tsx` -- pass `tables` to `FormEditor` -- feed the picker.
- [x] `src/components/forms/FormEditor.tsx` -- replace the read-only Target card with a `Select` (visible tables; current target pre-selected) + Save control with pending/error/saved states; disable per the published-lock decision -- the story's UI, mirroring the slug card + `LinkedRecordPicker`.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add `Forms` target-picker keys (label/help/placeholder/save/saved + the published lock hint) and `error.targetInvalid` + `error.targetLocked` (EN + FR) -- no hardcoded strings, no em-dash.
- [x] `tests/unit/form-target-mutation.test.ts` -- cover the matrix: change to a visible table (field_config filtered), non-visible/unknown target rejected (`targetInvalid`, no write), 404 unknown id, field_config drop-stale filter, and the published-lock rejection (`targetLocked`, no write) -- lock the target-write invariants.
- [x] `tests/unit/forms-route.test.ts` -- add a case asserting `{slug, targetTableKey}` dispatches to `updateFormTarget` (not slug/rename/publish) and that the target branch ordering holds -- route-level dispatch coverage.

**Acceptance Criteria:**
- Given a form, when an Admin opens its target-table selector, then every visible table is offered with the stored `target_table_key` pre-selected, and choosing a different visible table and saving persists it as the new runtime target (the public form then collects into that table).
- Given a saved target change, when it is written, then `field_config` entries for fields that do not exist in the new table are dropped and entries for fields that still exist are preserved.
- Given a chosen target that is not a currently-visible table (hidden, deleted, or cross-org), when the Admin saves (or a direct PATCH is sent), then the write is rejected with `Forms.error.targetInvalid` and the stored target is unchanged, leaking no internals.

## Implementation Notes

- **Mutation guard order exactly matches the spec:** `updateFormTarget` reads the form (404 first), rejects a published form with `targetLocked` BEFORE reading the schema or validating the key, then validates the key against `visibleTables` (`targetInvalid`, fail-closed on a schema read error), then writes `target_table_key` + the drop-stale-filtered `field_config` + `actor_id`/`updated_at`.
- **Editor target state is lifted like the slug:** `targetKey` (live selection) + `savedTarget` (persisted); Save is disabled until the selection differs from `savedTarget` and is not empty, and the whole card disables on the already-lifted `published` state with an unpublish hint. A stale/hidden stored key simply matches no `SelectItem`.
- **`loadFormForEditor` reads the schema a second time** for the visible-tables list (kept the 14.3 `evaluateFormPublishability` signature unchanged, as the spec permitted); degrades to `[]` on a schema read failure.
- **Verification (reality-checked against the diff):** `npx vitest run` on the target + route tests → 23/23 pass (full form suite 120 per the implementer); `npx tsc --noEmit` → no in-project errors (pre-existing `scheza-marketing-v1/` errors unrelated); `npm run lint` → clean.
- **Matrix verification gap (for step-04):** logic rows (change, drop-stale, targetInvalid, 404, targetLocked, schema fail-closed) are unit-covered; route dispatch + ordering covered. UI-render rows (picker render, stale-key placeholder, disabled-when-published) are not unit-testable in this harness and are exercised by the Manual checks / post-commit Playwright review.

## Spec Change Log

_No bad_spec loopback occurred._

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **Publish state goes stale after a target change** (blind-hunter + edge-case-hunter) — `medium`, PATCH. `FormEditor` passes page-load `publishable`/`publishReason` to the Publish card; after `handleTarget` saves a new target, nothing re-evaluates, so the Publish toggle can show the OLD verdict until a manual reload — contradicting the matrix row 1 promise ("editor reflects new publishability"). Server still re-gates on actual publish (security intact). Fixed: `router.refresh()` on a successful target save.
- **`loadFormForEditor` tables assembly untested** (verification-gap, pre-verified + blind-hunter) — `medium`, PATCH. The schema→`visibleTables`→`{key,label}` mapping and degrade-to-`[]` fallback feed the entire picker; a regression would silently remove it with no red test. Fixed: added `tests/unit/form-editor-context.test.ts` (visible/hidden mapping, `[]` on schema error, null on unknown id).
- **`FormEditor` target picker render/lock untested** (verification-gap, pre-verified) — `medium`, PATCH. No executing test rendered the component; the client-side published lock + picker-vs-empty branch were manual-only. Fixed: added `tests/unit/form-editor.test.tsx` (SSR render: picker vs `targetNone`, published lock hint EN + FR, disabled control).
- **Test header says "409 targetInvalid" but code/test use 400** (edge-case-hunter) — `low`, PATCH. Comment-only contradiction in `form-target-mutation.test.ts`; corrected to 400.
- **Redundant i18n key `targetSaved` duplicating `saved`** (blind-hunter) — `low`, PATCH. The slug/rename cards reuse the shared `saved`; the target card now does too and `targetSaved` is removed from both locales (direct dedup, avoids locale drift).
- **`field_config` drop-filter keeps hidden fields of the new table** (blind-hunter) — `low`, rejected. The AC says drop fields that "no longer exist"; a hidden field still exists in the table, and the public form already renders only `intakeFields` (non-hidden, non-relation). `field_config` is `[]` today; whether config may reference hidden fields is a 14.5 decision. Not a this-story defect.
- **No test that a rejected `updateFormTarget` surfaces its key/status through the route** (blind-hunter) — `low`, rejected. `updateFormTarget` throws `AppError` and the route's `AppError`→envelope mapping via `handleError` is already exercised by the route suite's 401/403 cases; the `result.error` guard is dead and consistent with the sibling slug/publish branches.
- **Stored target hidden when the visible-tables list is empty** (blind-hunter + edge-case-hunter) — `low`, rejected. Only when an org hides ALL tables or a schema read transiently fails; the `targetNone` guidance ("add a table before publishing") is reasonable for that state, the form is unpublishable/not-available anyway, and surfacing a now-invalid stale key adds a branch for a rare case.
- **`targetHelp` copy can read oddly above the empty-state note** (blind-hunter) — `low`, rejected. Only in the rare zero-visible-tables state; cosmetic, and the pre-existing copy had the same shape. Conditional copy adds complexity for negligible benefit.
- **Target Save disabled-when-unchanged diverges from the slug card** (blind-hunter) — `low`/`false`, rejected. The disable-when-unchanged behavior is intentional and better UX (prevents a redundant no-op save); the slug card's always-enabled Save is the weaker pattern, not a correctness baseline. No harm.

## Design Notes

- **Mirror the slug card + `LinkedRecordPicker`.** The Target card becomes `Select` (options = `tables.map(t => <SelectItem value={t.key}>{t.label})`) + a "Save table" button with the same `useTransition`/`role="alert"`/`role="status"` pattern the rename and slug cards already use. Keep the existing Card/semantic-token styling; do not hand-author `dark:` variants.
- **Field-config drop is forward-looking.** `field_config` is `[]` today and read nowhere, but the AC requires the drop-stale filter. Implement `config.filter(c => newTableFieldKeys.has(c.key))` so 14.5 inherits correct behavior; do not add any other field_config handling.
- **One schema read is preferable.** `loadFormForEditor` already needs the schema for the tables list; reuse it rather than reading twice where practical (a second read on an admin page load is acceptable if it keeps the 14.3 `evaluateFormPublishability` signature unchanged).
- **Lock reuses the existing published state.** 14.3 already lifted `published` into `FormEditor` to lock the slug card; the Target card disables on the same state (and the server `targetLocked` check mirrors `updateFormSlug`'s `slugLocked`), so the lock is consistent and needs no new state plumbing.

## Verification

**Commands:**
- `npm run lint` -- expected: passes, including `eslint-plugin-i18next` (no hardcoded strings) and the `server-only`/admin-client import gates.
- `npx tsc --noEmit` -- expected: no in-project type errors; new props and `updateFormTarget` resolve at all call sites.
- `npm test -- form-target-mutation forms-route` -- expected: target-write + route-dispatch edge cases green.

**Manual checks:**
- In the editor, open the target selector: confirm all visible tables are listed with the current target pre-selected; pick another and save, then open the public form and confirm it now collects into the new table. Pick a table with no eligible fields and confirm the publish toggle reports it cannot be published.
