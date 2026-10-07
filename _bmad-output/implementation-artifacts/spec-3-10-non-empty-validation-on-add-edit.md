---
title: 'Non-Empty Validation on Add/Edit'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd070fcc1064671f51bd2d3b27d1a1fcf547ed75c'
context:
  - '_bmad-output/implementation-artifacts/epic-3-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The add-record (`POST /api/records`) and inline-edit (`PATCH /api/records/[id]`) paths accept a completely blank record. The Zod body schemas take `data: z.record(z.string(), z.unknown())`, which permits `{}`, and `mutate.ts` stores it verbatim, so a user (or a direct API caller) can create or edit a record into an all-empty state, leaving unusable rows (FR99).

**Approach:** Add a single shared, pure server-side validator that rejects a write whose `data` has no non-blank value, invoked in BOTH write routes before any `mutate()` call. It is the first slice of the broader server-side `data`-vs-schema conformance seam (key-existence, value-type, and per-field-required conformance remain deferred). The rejection surfaces the existing translated-error-code envelope so the add form and inline edit show a non-technical message and the optimistic edit rolls back.

## Boundaries & Constraints

**Always:**
- The non-empty check runs **server-side** in both write routes (POST `/api/records` and PATCH `/api/records/[id]`), via ONE shared pure validator, invoked AFTER identity/membership resolution (so a non-member still gets 403, never an "empty" hint) but BEFORE any `mutate()` call (FR99). It throws `AppError(400, "emptyRecord")`, which propagates straight to the existing `handleError` `{ data, error }` envelope. No `result.error` remap is added (the rejection happens before mutate, unlike the relation/select guards that live inside mutate).
- "Blank" mirrors the existing client coercion EXACTLY: a value is blank when it is `null`, `undefined`, an empty or whitespace-only string, or its key is absent. Boolean `false` and number `0` are real values (never blank), consistent with `AddRecordForm` ("booleans are never blank") and `coerceAddValue` (blank scalars/relations/selects are omitted). A record is rejected only when EVERY value in `data` is blank (including `{}`).
- The PATCH payload is the FULL merged row `data` (not a partial field patch), so the edit-path check evaluates the record's resulting state: clearing the last populated field (merged `data` → `{}`) is rejected and the optimistic edit rolls back through the existing TanStack sequence.
- The client resolves the `emptyRecord` code to a translated, non-technical message through the existing `translateError` switch and renders it on the existing `message` status line — no new UI surface. Both `en.json` and `fr.json` gain the key with full parity (CI no-literal-string). No em-dashes in copy.

**Never:**
- No per-field required (`nullable:false`) enforcement — explicitly out of scope / deferred to keep fast mobile entry frictionless.
- No schema-aware key-existence or value-type conformance in this slice (remains deferred per the `deferred-work.md` spec-3-2 / spec-3-3 entries). The check is a pure value inspection and does NOT fetch or need the org schema.
- No change to the Zod body schemas (they still accept `data: {}` — the empty-check is a separate semantic layer), to `mutate.ts`, to the relation/select guards, to the client coercion, or to the optimistic hooks. No new DB migration, index, or API route. No change to the pre-account demo (unauth) dashboard.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add all-blank record | POST `data` is `{}` (table with no boolean field, nothing filled) | rejected before `mutate`; translated `emptyRecord` message; nothing written | `AppError(400,"emptyRecord")` |
| Add with one field populated | POST `data` has >=1 non-blank value | written normally via guarded `mutate` (unchanged 3.2 behavior) | N/A |
| Only field is boolean `false` | POST `data` is `{ someBool: false }` | accepted (false is a value; mirrors client) | N/A |
| Only field is number `0` | POST `data` is `{ qty: 0 }` | accepted (0 is a value) | N/A |
| Inline-edit clears last field | PATCH merged `data` → `{}` | rejected before `mutate`; optimistic edit rolls back; translated message | `AppError(400,"emptyRecord")` |
| Edit leaves >=1 field populated | PATCH merged `data` has a non-blank value | written normally, version-gated (unchanged 3.3 behavior) | N/A |
| Direct API all-blank payload | `data` is all null / "" / whitespace | rejected (defense-in-depth; bypasses client coercion) | `AppError(400,"emptyRecord")` |

</frozen-after-approval>

## Code Map

- `src/lib/data/record-conformance.ts` (NEW) -- pure, synchronous module. `isBlankValue(value)`: `null`/`undefined`/empty-or-whitespace string → blank; `false`/`0`/non-empty string/any other value → not blank. `assertRecordNotEmpty(data)`: throws `AppError(400, "emptyRecord")` when every value in `data` is blank (including `{}`). First slice of the data-vs-schema conformance seam; imports only `AppError` from `@/types/api`. No DB, no schema.
- `src/app/api/records/route.ts` -- POST (~line 90): call `assertRecordNotEmpty(data)` AFTER `resolveWritableOrgIdentity`, BEFORE `mutate(identity, "insert", ...)`. The thrown `AppError` is caught by the existing `try/catch` → `handleError` (no `result.error` remap needed).
- `src/app/api/records/[id]/route.ts` -- PATCH (~line 113): same call AFTER `resolveWritableOrgIdentity`, BEFORE `mutate(identity, "update", ...)`.
- `src/components/dashboard/useRecordActions.ts` -- `translateError` (~lines 69-82): add `case "emptyRecord": return t("emptyRecord");` so the add form and inline edit show the specific message rather than the `genericError` default.
- `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- `SlugDashboard` namespace (near `invalidSelectValue`, ~line 550): add `"emptyRecord"` in BOTH locales with parity.
- `src/components/dashboard/AddRecordForm.tsx` (line 97) + `src/lib/forms/field-input.ts` (`coerceAddValue`, line 53) -- REFERENCE ONLY (the source of truth for blank semantics); do NOT change.
- `src/components/dashboard/useRecordMutations.ts` (`UpdateVars.data` ~line 113) -- REFERENCE ONLY; confirms the PATCH payload is the full merged row; do NOT change.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/data/record-conformance.ts` (NEW) -- implement `isBlankValue` + `assertRecordNotEmpty` per the blank semantics; throw `AppError(400, "emptyRecord")` on an all-blank `data` (including `{}`).
- [x] `src/app/api/records/route.ts` -- invoke `assertRecordNotEmpty(data)` after identity resolution and before the insert `mutate` call.
- [x] `src/app/api/records/[id]/route.ts` -- invoke `assertRecordNotEmpty(data)` after identity resolution and before the update `mutate` call.
- [x] `src/components/dashboard/useRecordActions.ts` -- add the `emptyRecord` case to `translateError`.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add the `emptyRecord` `SlugDashboard` key in both locales with parity; non-technical, no em-dash.
- [x] `tests/unit/record-conformance.test.ts` (NEW) -- cover the I/O matrix: `{}` rejects; all-`null` / all-`""` / whitespace-only rejects; `{ bool: false }` accepts; `{ num: 0 }` accepts; `{ text: "x" }` accepts; mixed (one real value among blanks) accepts; assert the thrown value is an `AppError` with code `emptyRecord` and status 400.

**Acceptance Criteria:**
- Given the Add Entry form or an inline edit, when the user attempts to save a record in which every field is blank, then the write is rejected before any call to `mutate.ts` and a translated, non-technical message is shown (never a raw error) (FR99).
- Given a save with at least one field populated (including a boolean `false` or number `0`), when the user saves, then the record is written normally through the guarded `mutate.ts` layer, with no change to existing Story 3.2 / 3.3 behavior.
- Given this story's scope, when validation runs, then per-field required (`nullable:false`) enforcement is explicitly not performed (deferred).

## Implementation Notes

- Post-commit Playwright manual review (authed dashboard `/session-1f4fa453`, FR locale) — all three I/O paths passed and were confirmed at the DB layer:
  - Add all-blank record (Customers, no boolean field → `data {}`): rejected, FR `emptyRecord` alert ("Veuillez remplir au moins un champ avant d'enregistrer.") shown, row count unchanged (4), no row written.
  - Add with one field populated: written normally (row appeared; DB row `{"customer_name":"QA Temp Record"}`).
  - Inline-edit clearing the last populated field (merged → `{}`): rejected, optimistic edit rolled back to the prior value, same translated alert shown; DB confirmed the value never cleared. Temp record soft-deleted afterward to restore the fixture.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **defer** — Intake write path keeps a divergent empty-guard, not migrated to the shared helper (blind-hunter). `src/lib/intake/submit.ts:131` still checks `Object.keys(data).length === 0` → `AppError(400,"genericError")` rather than `assertRecordNotEmpty`, so the empty-record check has two sources of truth. Real but pre-existing and outside this story's intent (FR99 = the authed Add form / inline edit, not the Epic 6/14 public intake surface); the intake guard predates this change and is deliberately different (generic code, no per-field leak, boolean-vacuity "left as-is by design"). Recorded to deferred-work for consolidation when the broader conformance seam lands.
- **false** — "mirrors EXACTLY" overstated; all-blank add on a boolean-bearing table yields `{bool:false}` and is accepted (blind-hunter). The boolean-accept is intentional, documented verbatim in the frozen Design Notes ("a table that has a boolean field can never be all-blank via the UI") and the I/O matrix, and unit-tested (`accepts a boolean false`). `isBlankValue` does mirror `coerceAddValue`'s blank definition exactly; booleans being always-present is a separate, documented consequence, not a defect.
- **low -> reject** — No client-side pre-check; an all-blank submit still does a server round-trip + optimistic-add-then-rollback (blind-hunter). The behavior is correct and is the epic's standard optimistic pattern; the intent (FR99) is a server-side guard "before any call to mutate.ts", and the spec's "Never" scopes out changes to client coercion / optimistic hooks. Rare user action; the fix adds client guards/branches for negligible gain.
- **low -> reject** — `isBlankValue` treats nested empty object/array (`{a:{}}`, `{a:[]}`) as real, so such a record is accepted as non-empty (blind-hunter). The client never produces object/array field values (coercion emits only strings/numbers/booleans/ids/tokens); only a direct API caller could, and rejecting structurally-empty values is value-type conformance, explicitly deferred and already logged in the spec-3-2 / spec-3-3 deferred-work entries. Per the spec's narrow blank definition ("any other non-string value is a real value") this is intended.
- **low -> reject** — The new `translateError` `emptyRecord` case is untested, so a missing/renamed i18n key could pass CI silently (blind-hunter, confirmed by verification-gap as consistent with the repo boundary). The sibling cases (`invalidReference`, `invalidSelectValue`, `versionConflict`) are all verified only at the server-route envelope boundary, never through the client switch; the route tests reproduce that pattern and the key ships in both `en.json` and `fr.json`. The fix would add a test harness the repo deliberately omits.
- **false** — PATCH test sends `{}`, not a keys-present-all-blank merged payload like `{name:"",note:null}`, leaving the "realistic inline-edit" branch untested (blind-hunter). `assertRecordNotEmpty` is path-agnostic (`Object.values(data).some(!isBlankValue)`) with no `{}`-vs-keys-present branch; the keys-present-all-blank case is covered by the POST route test (`{name:"",note:"   ",ref:null}`) and the unit tests (`{a:"",b:null}`, whitespace), so no distinct branch goes unexercised.

## Design Notes

**Why route-level, not a `mutate` guard.** AC1 requires rejection "before any call to `mutate.ts`", so the check is invoked in each write route immediately before `mutate(...)` and throws straight to `handleError`. This differs from the relation/select conformance guards, which live inside `mutate` and are re-mapped from `result.error`; those need the DB (referential integrity, option membership), whereas the non-empty check is a pure payload inspection.

**Why schemaless (no org-schema fetch).** The client already omits blank scalars/relations/selects and always sends booleans as real values, so an all-blank record reliably arrives as `{}` (and a direct API caller sends all-blank values). Detecting "no non-blank value" needs only the payload, so the first slice does not fetch the schema; key-existence and value-type conformance stay deferred to the broader seam.

**Boolean/number consequence (intentional).** A table that has a boolean field can never be all-blank via the UI because the boolean is always present as `true`/`false`; `0` is likewise a value. This mirrors the client's established "booleans are never blank" stance and the standard treatment of `0`, and is a deliberate semantic, not a gap.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors.
- `npm run lint` -- expected: clean (no hardcoded-string violations from the new key).
- `npx vitest run` -- expected: new `record-conformance` tests pass; existing suite green.

**Manual checks:**
- On the authed dashboard (`/[slug]` fallback template): submit the Add form with nothing filled on a table that has no boolean field and confirm the translated empty-record message shows and no row is added; add again with one field filled and confirm the row appears; inline-edit a record down to its last populated field and clear it, and confirm the edit rolls back and the message shows; confirm a record whose only populated field is a boolean or a number `0` saves normally.
