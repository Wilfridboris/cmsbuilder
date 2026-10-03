---
title: 'Manage Single-Select Values via Chat (Append-Only)'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: '529a292c8ef15cc9a5f2d70383a2cbf573ea8e8d'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 13.1–13.3 let an Admin create a `select` field and its initial values and render/edit them everywhere, but the values are then frozen: there is no way to add, rename, or retire a value afterward. Story 13.1 already allowlisted the three append-only ops (`add_select_option`, `rename_select_option`, `archive_select_option`) with no handler, waiting on this story.

**Approach:** Wire the three append-only value-management ops end to end through the conversational editor's existing guarded pipeline: teach the model the three ops and show it each select field's current values, then dispatch through the unchanged fence to new focused validators → pure transforms → `withSchemaWrite` mutators → `org_schemas`. All edits are additive JSONB metadata — no DDL, no row migration. (The Admin-only inline "+ Add value" dropdown affordance is split to a follow-up; see deferred-work.)

## Boundaries & Constraints

**Always:**
- Append-only is the governing invariant. `add_select_option` appends a new `{value,label}` (value normalized via `normalizeTableName`, unique against ALL existing option values including archived). `rename_select_option` edits ONLY the matched option's `label`; its stored `value` never changes, so existing records are untouched. `archive_select_option` sets `archived:true` on the matched option and NEVER removes the option object, so existing `records.data` values stay valid and still render their label (13.2).
- All three ops target an existing field whose `type === 'select'` on a visible table; rename/archive target an existing option by its stored `value`. Anything unresolvable (field/option not found, ambiguous target, or no value named for an add) is returned as `needs_clarification` with nothing written, reusing Story 5.1 target inference unchanged.
- `archive_select_option` refuses to archive the LAST non-archived option (mirrors the Story 5.7 `canHideTable` last-visible guard) so a select is never left with zero selectable values; an already-archived option is rejected (nothing to do).
- Chat reaches the ops through the UNCHANGED fence: Admin-gated `/api/schema/edit` → `assertEditorOperationAllowed` (allowlist + raw-SQL fence) → focused validator → mutator. The prompt's per-table serialization is extended so each select field lists its current values (`value=Label`, archived marked) and the model can target one; 100% of LLM calls keep the hardened identity-masking system prompt.
- All chat outcome copy reuses translated i18n keys in both `en` and `fr` (new success keys for the three ops; existing `rejection`/`clarify`), with no em-dash, and never leaks raw JSON/SQL/errors.

**Never:**
- No inline "+ Add value" dropdown affordance, no new direct HTTP endpoint, no UI component or role threading — split to a follow-up (deferred-work). This story is the chat path + the shared validator/transform/mutator core only.
- No hard-delete of a value, even an unused one: a removal request always archives (append-only). Hard-remove of unused values is deferred (deferred-work).
- No multi-select, no colored pills / per-value styling, no reordering of options, no un-archive op.
- No changes to the frozen 13.1 type model (`src/types/db.ts`) or `validateSelectOptions`; no changes to generation / hard-fallback (13.5) or intake / CSV import (13.6).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Chat add value | "add 'Partial' to the status field on Invoices" | one `add_select_option`; `{value:'partial',label:'Partial'}` appended; existing rows unchanged; `applied` | N/A |
| Chat rename value | "rename Paid to Settled on Invoices status" | one `rename_select_option`; option `paid` keeps value, label → "Settled"; records unchanged; `applied` | N/A |
| Chat archive value | "remove the Draft status from Invoices" | one `archive_select_option`; option set `archived:true`; existing Draft rows still render "Draft"; `applied` | N/A |
| Duplicate value add | add a value normalizing to an existing (active or archived) value | validator rejects; `rejected` + translated copy; nothing written | rejection, no raw leak |
| Archive last active / already archived | archive the only non-archived option, or one already archived | validator rejects; `rejected` + plain-language copy; nothing written | rejection |
| Unresolvable / ambiguous target | op naming no resolvable table/field/option, or several plausible | model returns `needs_clarification` → `clarify`; nothing written | N/A |
| Non-select field target | value op on a text/number field | validator rejects; `rejected`; nothing written | rejection |

</frozen-after-approval>

## Code Map

- `src/lib/schema/validator.ts` -- add three focused validators after `validateAddField` (~876), mirroring its shape: `validateAddSelectOption(schema, tableKey, fieldKey, { label })` (field exists, visible, `type==='select'`; normalize label→value via `normalizeTableName`; reject empty label and any value colliding with an existing option value incl. archived; return `{valid, option:{value,label}}`), `validateRenameSelectOption(schema, tableKey, fieldKey, { value, label })` (option with `value` exists; new label non-empty; return sanitized), `validateArchiveSelectOption(schema, tableKey, fieldKey, { value })` (option exists, not already archived, not the last non-archived). Reuse `normalizeTableName`, `isNonEmptyString`, `reportRejection`, the `validateAddField` table/field lookup pattern. `PERMITTED_OPERATIONS` already lists the 3 ops (13.1) — unchanged.
- `src/lib/schema/overrides.ts` -- add three pure transforms mirroring `addRelationField`/`hideField` (table→fields map): `addSelectOption` (append option to `field.options`), `renameSelectOption` (set matched option `label` only), `archiveSelectOption` (set matched option `archived:true`, never remove). Immutable; callers pre-validate.
- `src/lib/data/schema-mutate.ts` -- add `addSelectOption` / `renameSelectOption` / `archiveSelectOption` mutators via `withSchemaWrite` mirroring `addRelationField` (155–183): each validates (throw `AppError(400,reason)` with no write), calls its transform, returns `{tableKey,fieldKey,...}`.
- `src/app/api/schema/edit/route.ts` -- `GeminiEditorOutput` (134–162): add the 3 kinds + `optionValue?: unknown`. Table summary (220–234): include `options` for select fields. Dispatch (311–324): add 3 cases → new handlers `handleAddSelectOption`/`handleRenameSelectOption`/`handleArchiveSelectOption` mirroring `handleHideField`/`handleAddField` (validate output fields, call the mutator, map success→`applied` with the new i18n copy, `AppError(400)`→`rejected` via `t("rejection")`, 5xx→`degraded`).
- `src/lib/gemini/prompts.ts` -- `ChatFieldSummary` (131): add `options?: {value:string;label:string;archived?:boolean}[]`. `buildEditorPrompt` field serialization (193–201): for a select field, append its current values (`value=Label`, mark archived) so the model can target one. Prose (232, 247): add rules 9/10/11 for the three ops (target by the exact table/field key and the option value shown above; a removal request = archive; a value with no resolvable field/option or no named value → `needs_clarification`), update the "SIX things"/"eight outcomes" counts, and narrow the "cannot rename anything" caveat to tables/columns (a value's label may now be renamed). `EDITOR_RESPONSE_SCHEMA` (310–473): add the 3 kinds to the `kind` enum, add an `optionValue` STRING property, append `optionValue` to `propertyOrdering`. Do NOT touch the `add_field`/`add_table` type enums or the `options` array (13.3).
- `src/lib/i18n/en.json` + `fr.json` -- editor namespace: `successValueAdded`, `successValueRenamed`, `successValueArchived` (reuse existing `rejection`/`clarify`/`degraded`). No em-dash.
- Reuse UNCHANGED: `withSchemaWrite`, `resolveWritableAdminIdentity`, `assertEditorOperationAllowed`, `validateSelectOptions` (13.1, reference for value normalization rules), `formatCell` select branch (13.2, resolves archived labels), `visibleTables`.
- Do NOT touch: `src/types/db.ts`, `validateSelectOptions` body (13.1 frozen); `SelectDropdown`/`AddRecordForm`/`InlineEditCell`/`RecordsView` (inline affordance is deferred); generation/fallback (13.5); intake/CSV (13.6).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/schema/validator.ts` -- add `validateAddSelectOption` / `validateRenameSelectOption` / `validateArchiveSelectOption` (append-only rules above; reuse existing helpers) -- the gate for all three ops.
- [x] `src/lib/schema/overrides.ts` -- add `addSelectOption` / `renameSelectOption` / `archiveSelectOption` pure transforms (append / label-only / archived-flag; immutable) -- the metadata edits.
- [x] `src/lib/data/schema-mutate.ts` -- add the three mutators via `withSchemaWrite` -- validate-then-transform-then-persist, org-scoped.
- [x] `src/lib/gemini/prompts.ts` -- extend `ChatFieldSummary` + field serialization to expose select values, add prose rules 9/10/11 (updating the operation counts and the rename caveat), and extend `EDITOR_RESPONSE_SCHEMA` (3 kinds + `optionValue` + propertyOrdering) -- teach the model to emit the three ops against real values.
- [x] `src/app/api/schema/edit/route.ts` -- extend `GeminiEditorOutput`, thread `options` into the table summary, and add the three chat handlers + dispatch cases -- the chat path end to end.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add the three editor success keys (no em-dash) -- user-facing outcome copy.
- [x] `tests/unit/schema-validator.test.ts`, `tests/unit/overrides.test.ts`, `tests/unit/schema-mutate.test.ts` -- cover the three validators (accept + each rejection: duplicate, last-active archive, already-archived, unknown field/option, non-select field), the three transforms (append / label-only / archived + immutability), and the three mutators (org-scoped re-derived write; no write on 400) -- the I/O matrix write rows.
- [x] `tests/unit/route-schema-edit.test.ts` -- cover the three chat handlers (each applied + a rejected case) and assert a select field's options are surfaced in the prompt's table summary -- handler wiring.

**Acceptance Criteria:**
- Given an Admin in the chat editor, when they ask to add, rename, or remove a value of an existing select field in one sentence, then exactly one validated `add_select_option` / `rename_select_option` / `archive_select_option` is persisted to `org_schemas`, rename changes only the label (records keep their value), archive sets `archived:true` without removing the option (existing rows still render it), and all existing rows are preserved.
- Given a value-management request that does not resolve to exactly one field/option (or an add naming no value), when it is processed, then the editor asks a clarifying question (reusing Story 5.1) and writes nothing.
- Given a request that would duplicate a value, archive the last active value, archive an already-archived value, or target a non-select field, when it is validated, then it is rejected with plain-language copy and nothing is written, with no raw JSON / SQL / error leaked.

## Implementation Notes

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

Edge-case-hunter: 0 findings (all paths guarded at both route and validator layers; every claim verified). Verification-gap: 1 finding (success-message arg resolution) — pre-verified, routed to patch below.

- **Success-message argument resolution for the three ops is unverified** (verification-gap; overlaps blind-hunter's "raw fieldKey fallback") — **low → patch**. The three `applied` route tests assert `assistantText` equals the bare i18n key because the global `getTranslations` mock echoes keys (`route-schema-edit.test.ts:104-106`), so the handlers' interpolation args are never observed — notably `handleArchiveSelectOption`'s token→label lookup (`route.ts:266-268`, exists solely to avoid showing the raw value token) and the `targetField?.label ?? result.data.fieldKey` field resolution in all three. A regression surfacing a raw token (`paid`) or raw key (`status`) in the owner-facing confirmation would keep every test green. Fix is a test-only strengthening; patched below.
- **Dead `if (!value)` guard in `validateAddSelectOption`** (blind-hunter) — **low → reject**. Verified unreachable (`normalizeTableName` never returns empty — `utils.ts:60-67`), but it is clearly-commented defense-in-depth identical to the branch 13.1 review already dispositioned "low → reject (a wash)". No harm; not worth churn.
- **Degenerate label (`!!!`, emoji, non-Latin) yields a synthetic `field_<hash>` value token** (blind-hunter) — **low → reject**. Verified, but this is the established, documented `normalizeTableName` contract used for every key in the codebase (and for 13.1 option values); the Latin-script FR/EN target market makes it a non-everyday case, and 13.1 review dispositioned the identical concern "low → reject". The claim that `validateSelectOptions` guards against it is false — it normalizes the same way, so there is no divergence.
- **`rename_select_option` does not reject a new label duplicating another option's display label** (blind-hunter) — **low → reject**. Verified: renaming "Paid"→"Unpaid" yields two options with the same label (distinct values). But labels are not unique anywhere in the system (`validateSelectOptions` dedupes values, not labels — two options may share a label from creation), so the behavior is consistent with the frozen invariant; it is self-inflicted and recoverable, renders without crash (React-keyed by value, `formatCell` resolves by value), and a uniqueness guard would add a new invariant + branch the rest of the system lacks.
- **`findSelectField` double-normalizes the table key** (blind-hunter) — **low → reject**. Verified, but `normalizeTableName` is idempotent so it is harmless, and keeping the validator self-normalizing makes it robust to direct callers (the unit tests pass raw keys). No named harm.
- **`findSelectField` uses an unchecked `as` cast instead of a structural narrowing** (blind-hunter) — **low → reject**. The cast follows a runtime `field.type !== "select"` check that guards it; the "shape could drift" harm is speculative future-proofing with no current defect, and the fix adds complexity.
- **Missing test: add a label that normalizes to an existing value but differs in display** (blind-hunter) — **low → reject**. Already covered: the existing "rejects a value colliding with an existing ACTIVE option" test adds label "Paid" which normalizes to the stored value "paid" — the normalize-then-compare path with case folding is exercised; a "PAID" variant is the identical path.
- **Missing test: rename-to-same-label (no-op) and rename-to-colliding-label** (blind-hunter) — **low → reject**. Both behaviors are correct (no-op write is benign; colliding label is the rejected finding above), so the missing tests pin benign/already-dispositioned cases, not a demonstrated risk.
- **No end-to-end/UI coverage for archived-option render/exclusion** (blind-hunter) — **false/low → reject**. The archived-value render path (`formatCell` searches all options incl. archived) and the new-choice exclusion (`partitionSelectOptions`) were built AND unit-tested in Story 13.2 and are unaffected by 13.4's additive `archived:true` flag; the behavioral promise is verified, just in 13.2's suites. The general "no component harness" gap is already logged in deferred-work from 13.2; not caused by this story.
- **French archive copy house-style / native-speaker check** (blind-hunter) — **false → reject**. Verified no em-dash in the fr copy; a "please have a native speaker confirm tone" note is not an actionable defect with named harm.

## Design Notes

The three ops reuse the established editor spine exactly: 13.1 already allowlisted them and froze the type model + `validateSelectOptions`, so this story adds only focused validators, pure transforms, mutators, and handlers — one op each, no new fence. Rename and archive are the two surfaces where the model must identify an EXISTING option, so the prompt now serializes each select field's current values; without that the model cannot target `optionValue`. Archive (not delete) for removal is the whole point of append-only: an archived option is retained so every existing `records.data` token still resolves to its label via the 13.2 `formatCell` branch.

Example chat output for "rename Paid to Settled on the Invoices status":
`{ "kind":"rename_select_option", "tableKey":"invoices", "fieldKey":"status", "optionValue":"paid", "label":"Settled" }`

## Verification

**Commands:**
- `npm run test -- tests/unit/schema-validator.test.ts tests/unit/overrides.test.ts tests/unit/schema-mutate.test.ts` -- expected: new validator/transform/mutator cases pass; 13.1 cases still green.
- `npm run test -- tests/unit/route-schema-edit.test.ts` -- expected: three chat handlers (applied + rejected) pass; 13.3 cases still green.
- `npm run type-check` -- expected: clean across the new `optionValue`, the `options` table summary, and the mutators.
- `npm run lint` -- expected: clean.

**Manual checks:**
- On localhost:3000 (Playwright MCP, as an Admin, live Gemini): on a table with a select field, chat "add Partial to the Invoices status", "rename Paid to Settled", and "remove the Draft status" each apply and survive refresh, with existing rows intact (an archived value still shows its label); a request naming no table/field or no value asks a clarifying question and writes nothing.
