---
title: 'Create a Single-Select Field (with Values) via Chat'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: '86620efa30cfe3263aec1428cbb63e7904cc8fde'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 13.1 gave the data model, validator, and mutator full support for a `select` field (type + normalized/deduped `options`), but the conversational editor cannot create one: its LLM contract only offers scalar `add_field` types and the route never forwards `options`. So an Admin cannot do the one thing the epic promises -- "add a status field with Paid, Unpaid, Rejected" in a single sentence.

**Approach:** Teach the editor's `add_field` LLM contract to emit `type: 'select'` with an `options` array when the owner names a fixed set of choices, and thread those `options` from the model output through the existing Admin-gated route into the already-ready `validateAddField` → `addField` path, which persists an additive select field to `org_schemas` with no new validator/mutator logic.

## Boundaries & Constraints

**Always:**
- A select field is created only as a single new COLUMN on an EXISTING table, via one `add_field` operation carrying `type: 'select'` and an `options[]` of `{label, value}`. It flows through the unchanged pipeline: Admin-gated `/api/schema/edit` → `assertEditorOperationAllowed` (allowlist + raw-SQL fence) → `validateAddField` / `validateSelectOptions` → `addField` mutator → `org_schemas`.
- The model emits `type: 'select'` ONLY when the owner explicitly names the set of allowed choices (e.g. "status: Paid, Unpaid, Rejected"). Each option gets a human `label` in the owner's language and a `value` token; the validator normalizes and dedupes values, and the stored `value` (never the label) is what records hold. The model never invents choices the owner did not state.
- Target-table inference and the write-nothing-until-confirmed clarify behavior are reused unchanged from Story 5.1 (named table, or the single current table when unambiguous, otherwise `needs_clarification`).
- When the owner asks for a dropdown / single-select / status column but names no values, the editor asks a clarifying question for the values via the existing `needs_clarification` → `clarify` path and writes nothing until the owner lists them (decision: ask for the values; never guess them, never silently fall back to a text column).
- Additive only: the write is a JSONB metadata edit to `org_schemas` -- no DDL, no row migration, all existing rows stay valid. 100% of LLM calls keep the hardened identity-masking system prompt; the blocklist and reserved-key rules are unchanged.
- All user-facing outcome copy reuses the existing editor keys (`successApplied`, `rejection`, `clarify`) with no new static strings and no em-dash; any clarifying-question text is model-generated in the owner's language.

**Never:**
- No value-management of an existing select (add / rename / archive a value) -- that is Story 13.4; this story does not wire `add_select_option` / `rename_select_option` / `archive_select_option` handlers.
- No `select` columns inside `add_table` (new-table creation stays scalar-only), no multi-select, no colored pills / per-value styling, no `required` flag, no select-as-displayField.
- No changes to `validator.ts`, `schema-mutate.ts`, `overrides.ts`, or `src/types/db.ts` (Story 13.1 is frozen and already supports select); no changes to the generation / hard-fallback pipeline (13.5) or intake / CSV import (13.6).
- Do NOT add `select` to `GENERATION_FIELD_TYPES` / `GENERATION_FIELD_TYPES_WITH_RELATION` (those drive the generation path and the `add_table` nested enum); teach `select` only through the editor `add_field` branch.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Named/current table + values | "add a status field with Paid, Unpaid, Rejected" on (or viewing) Jobs | one `add_field`, `type:'select'`, 3 normalized unique options persisted to `org_schemas`; existing rows unchanged; `kind:'applied'` | N/A |
| Values given, no resolvable table | "add a status with Paid, Unpaid" (no table named, not inferable) | `needs_clarification` → `clarify`; nothing written | N/A |
| Malformed values | "...with Paid, Paid" / empty / unlabeled options | `validateSelectOptions` rejects (13.1); handler returns `kind:'rejected'` with translated copy | rejection, no raw leak |
| Select requested, no values named | "add a status dropdown to Jobs" (no choices listed) | `needs_clarification` → `clarify` asking for the values; nothing written | N/A |
| New-table request naming choices | "create a Leads table with a status open/closed" | `add_table` with scalar fields (existing behavior); NOT a select column | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/gemini/prompts.ts` -- `buildEditorPrompt` add_field rule (#1, ~249-253): extend so that when the owner names a fixed set of choices the model emits `type:'select'` plus an `options` array of `{label, value}` (value = a short token of the label; validator re-normalizes) and never invents choices; otherwise keep the scalar branch. `EDITOR_RESPONSE_SCHEMA` (309-449): add `"select"` to the top-level `type` enum (350-355, the add_field type) and ADD an `options` ARRAY property (items object `{label, value}`, both required) described as present when `kind==='add_field'` and `type==='select'`; append `options` to `propertyOrdering`. Do NOT touch the nested `fields[].type` enum (367-371) -- `add_table` stays scalar.
- `src/app/api/schema/edit/route.ts` -- `GeminiEditorOutput` type (134-155): add `options?: unknown`. `handleAddField` (338-398): when `output.type === 'select'`, include `options: output.options` in the `AddFieldInput` passed to `addField` (357); scalar path, the shapeless-output guard (342-351), and success/rejection copy unchanged.
- Reuse UNCHANGED (Story 13.1): `validateAddField` + `validateSelectOptions` (`src/lib/schema/validator.ts` ~324-367, 801-876) already accept, normalize, dedupe, and reject empty/duplicate/missing-label options; `addField` (`src/lib/data/schema-mutate.ts` 194-222) already threads `options` through `addFieldTransform` into `org_schemas`; `PERMITTED_OPERATIONS` already lists `add_field`; `resolveWritableAdminIdentity` (Admin gate) and `assertEditorOperationAllowed` (allowlist + raw-SQL fence) unchanged; target-table inference / `needs_clarification` → `clarify` unchanged.
- Do NOT touch: `validator.ts`, `schema-mutate.ts`, `overrides.ts`, `src/types/db.ts` (13.1 frozen); value-management ops (13.4); `buildGenerationPrompt` / hard-fallback template (13.5); intake + CSV (13.6).
- Tests: `tests/unit/route-schema-edit.test.ts` mocks `callGeminiWithTimeout` + `addField` and asserts handler wiring -- the seam for 13.3. `tests/unit/schema-validator.test.ts` / `schema-add-field.test.ts` already cover select validator accept/reject (13.1) -- reference only.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/gemini/prompts.ts` -- extend the `buildEditorPrompt` add_field rule to emit `type:'select'` + `options[]` when the owner names a fixed set of choices (never invent choices; when no values are named, ask for them via `needs_clarification` and write nothing), and extend `EDITOR_RESPONSE_SCHEMA`: add `'select'` to the add_field `type` enum (not the `add_table` `fields[].type` enum), add the `options` array property (`{label, value}` required), and add `options` to `propertyOrdering` -- teaches the model to produce a validated select `add_field`.
- [x] `src/app/api/schema/edit/route.ts` -- add `options?: unknown` to `GeminiEditorOutput` and forward `output.options` into the `AddFieldInput` in `handleAddField` when `type === 'select'` -- threads options from model output to the already-ready validator/mutator; scalar path and guards unchanged.
- [x] `tests/unit/route-schema-edit.test.ts` -- add a select `add_field` case (Gemini returns `type:'select'` + options → assert `addField` is called with `options` in its input and the result is `applied`) and a malformed-options case (validator rejection → `kind:'rejected'`, translated copy, no raw leak) -- locks the new handler wiring and the I/O matrix rows.

**Acceptance Criteria:**
- Given an Admin in the chat editor on (or naming) an existing table, when they describe a single-select field and name its values in one sentence, then exactly one validated `add_field` with `type:'select'` and those options is persisted to `org_schemas`, the new dropdown field appears on that table, and all existing rows are preserved (FR96, aligns FR16).
- Given a select-creation request that does not resolve to exactly one target table, when it is processed, then the editor asks a clarifying question (reusing Story 5.1) and writes nothing until the target is confirmed.
- Given option values that normalize to duplicates, are empty, or lack a label, when the request is validated, then it is rejected with a plain-language message and nothing is written (reusing the Story 13.1 validator), with no raw JSON / SQL / error leaked.

## Implementation Notes

- Thin seam only, as planned. `src/lib/gemini/prompts.ts`: `buildEditorPrompt` rule #1 now emits `type:'select'` + required `options[]` when the owner names a fixed set of choices (lists only owner-stated choices, never invents) and routes a no-values dropdown request to `needs_clarification`; rule #4 extended to ask for the values. `EDITOR_RESPONSE_SCHEMA` gains `"select"` in the add_field `type` enum, an `options` array (`{label, value}` both required), and `options` in `propertyOrdering` — the `add_table` nested `fields[].type` enum stays scalar-only. `src/app/api/schema/edit/route.ts`: `GeminiEditorOutput` gains `options?: unknown`; `handleAddField` forwards `output.options` into `AddFieldInput` only when `type === 'select'`, scalar path and guards unchanged. No changes to the frozen 13.1 `validator.ts` / `schema-mutate.ts` / `overrides.ts` / `db.ts`.
- The clarify behavior for "no resolvable table" and "select requested with no values" is enforced by the prompt (model returns `needs_clarification`); the route's existing clarify path needed no change. This matches how all other editor target-inference works and is not unit-testable without a live LLM — covered by the pre-existing `needs_clarification` route test (route behavior) and the manual Playwright check.
- Verification run in this session: `npm run test -- tests/unit/route-schema-edit.test.ts tests/unit/schema-validator.test.ts` → 116 passed (both new 13.3 cases green; 13.1 select validator cases still green, no regression); `npm run type-check` clean. Manual Playwright check (localhost:3000, Admin, live Gemini) not run in this automated pass.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

Edge-case-hunter: 0 findings (all spec claims verified; every boundary from the changed lines guarded downstream by the frozen 13.1 validator). Verification-gap: 0 gaps (the one behavioral change — option forwarding in `handleAddField` — is pinned by two passing tests; LLM-contract parts correctly out of scope).

- **Select success copy reuses `successApplied`, does not name the saved values** (blind-hunter) — **low → reject**. Verified: `handleAddField` reuses `t("successApplied",{field,table})` for every field type, so a select is acknowledged exactly as a scalar add; the owner sees the new dropdown immediately on the table. The missing value-enumeration is a nicety with no named harm, and the proposed fix adds new en+fr strings — forbidden by the frozen "no new static strings" constraint and given to no other field type.
- **No select-specific test for the two `needs_clarification` matrix rows** (blind-hunter) — **low → reject**. Verified: the route's `needs_clarification` → `clarify` + no-write dispatch is type-agnostic and already covered by the pre-existing clarify test in `route-schema-edit.test.ts`. A mocked `callGeminiWithTimeout` returning `needs_clarification` cannot exercise the prompt decision that selects clarification for a no-values / no-table select (the mock replaces the prompt), so a select-flavored clarify test duplicates route coverage without protecting the prompt behavior. The route behavior (no write on clarify) is already pinned.
- **Rejected-options test omits `expect(body.error).toBeNull()`** (blind-hunter) — **low → patch**. Verified: the new rejection test asserts `kind`, `assistantText`, and no `addFieldFailed` leak, but unlike the sibling applied test does not pin the 200 envelope's `error` channel to null. Pinning it directly strengthens the "no raw leak" AC; one-line assertion, no new surface.
- **No test for scalar `add_field` carrying stray `options`** (blind-hunter) — **low → reject**. Verified: the handler's else-branch constructs `{label,type}` and cannot include `options` for any non-select type; the pre-existing scalar test asserts `call[2]` deep-`toEqual({label,type:'date'})`, which already fails if `options` ever leaked into a scalar input. A stray-options scalar output hits the identical code path and assertion — redundant.
- **`question` property `description` in `EDITOR_RESPONSE_SCHEMA` still mentions only "naming the candidate tables"** (blind-hunter) — **low → patch**. Verified: the diff updated prose rule #4's `question` guidance to also cover "ask which values the dropdown should offer," but the structured-output schema's `question` `description` (prompts.ts ~448) was left describing only the table-naming case. The two descriptions of the same field have drifted; the schema description is sent to Gemini and can nudge it away from value-asking questions. Trivial string edit to align, no em-dash.
- **Applied test "would pass even if the route downgraded select to scalar"** (blind-hunter) — **false**. Refutation: the applied test asserts `addField.mock.calls[0][2]` deep-`toEqual({label:"Status",type:"select",options:[...]})`; stripping `type:"select"`/`options` before the mutator would fail that exact `toEqual`. The reviewer's own parenthetical ("the applied test does this") contradicts the finding.

## Design Notes

Select is a VARIANT of the existing `add_field` outcome, not a new editor `kind`: the LLM contract gains only a `type:'select'` value and an `options` array, so the allowlist, Admin gate, target inference, and raw-SQL fence all apply unchanged. The validator and mutator built in Story 13.1 already accept and persist options; 13.3 is the thin seam that lets the chat path reach them. The prompt deliberately constrains `select` to owner-stated choices so free-text categories are not silently turned into closed picklists.

Example model output for "add a status field with Paid, Unpaid, Rejected" on Jobs:
`{ "kind":"add_field", "tableKey":"jobs", "label":"Status", "type":"select", "options":[{"label":"Paid","value":"paid"},{"label":"Unpaid","value":"unpaid"},{"label":"Rejected","value":"rejected"}] }`

## Verification

**Commands:**
- `npm run test -- tests/unit/route-schema-edit.test.ts` -- expected: new select `add_field` + rejection cases pass.
- `npm run test -- tests/unit/schema-validator.test.ts` -- expected: existing 13.1 select validator cases still pass (no regression).
- `npm run type-check` -- expected: clean across the new `options` field and response-schema enum.
- `npm run lint` -- expected: clean.

**Manual checks:**
- On localhost:3000 (Playwright MCP, as an Admin): in the editor chat, "add a status field with Paid, Unpaid, Rejected" on a table creates the field and its Add-form dropdown shows the three options; a request naming no table asks which table and writes nothing; existing rows remain intact after refresh.
