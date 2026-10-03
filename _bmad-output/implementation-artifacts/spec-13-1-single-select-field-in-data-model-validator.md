---
title: 'Single-Select Field in the Data Model & Validator'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: '00409247d6c32380f31e1adb749d7532b62b021b'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The product's user journeys already promise dropdowns (a Status of Paid / Unpaid / Rejected, a "Type of Issue" picker), but there is no `select` field type behind them — the schema model and Schema Validator only know scalar + `relation` types. Epic 13's every other surface (chat create, generation, rendering, intake, import) needs one well-formed, validated list-of-values type to build on.

**Approach:** Add a single-select (`select`) field type to the schema type model, extend the Schema Validator so both its entry points (`validateGeneratedSchema` and `validateAddField`) accept a `select` field only with a non-empty list of unique, normalized options, and extend the conversational-editor operation allowlist with the three append-only value-management op names so later stories can dispatch them through the same fence. This is the foundation only: no chat routing, no rendering, no value-management handlers, no generation prompt changes.

## Boundaries & Constraints

**Always:**
- `FieldType` gains `'select'`; `SelectOption` carries a stable normalized `value`, a display `label`, and an optional `archived` flag; `FieldDefinition` gains `options?: SelectOption[]` (present only when `type === 'select'`). A select cell stores exactly one option `value` in `records.data`.
- A `select` field is valid only with a non-empty `options[]` whose normalized `value`s are all unique and each has a non-empty `label`; otherwise reject via the existing rejection/logging path. Option `value`s are normalized with the same `normalizeTableName` helper used for keys; option `label`s are free text, never keyword-checked (Story 2.5).
- `select` is accepted via its own validator branch (parallel to `relation`) — NOT by adding it to `SCALAR_FIELD_TYPES` or `GENERATION_FIELD_TYPES`. Reserved-key and `BLOCKED_KEYWORDS` rules stay unchanged; the three new op names (`add_select_option`, `rename_select_option`, `archive_select_option`) join `PERMITTED_OPERATIONS` (no blocked substring) so they pass `assertEditorOperationAllowed` and ride the raw-SQL fence.
- All changes are additive/backward-compatible: `options` is optional, existing schemas/records need no migration, no DB DDL.

**Never:**
- No rendering/editing UI (13.2), no chat routing or prompt/model-enum changes that would make the model emit `select` (13.3/13.5), no `add/rename/archive_select_option` focused validators, `overrides.ts` transforms, `schema-mutate.ts` mutators, or route handlers (13.4), no generation/fallback-template emission (13.5), no intake/import behavior (13.6).
- Never silently dedupe duplicate option values — reject the field instead. Never carry an `archived: true` option in through the generation or add-field path (new options are never archived; archiving arrives only via 13.4).
- No multi-select, no colored pills / per-value styling.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Generation accepts select | `validateGeneratedSchema` batch with a field `{ type:'select', options:[{value:'Paid',label:'Paid'},{value:'Unpaid',label:'Unpaid'}] }` | Accepted; sanitized field carries `type:'select'` + normalized unique option values (`paid`, `unpaid`), labels trimmed, no `archived` | N/A |
| Add-field accepts select | `validateAddField` with `{ label:'Status', type:'select', options:[…3 unique…] }` against existing visible table | `{ valid:true, field:{ key:'status', label:'Status', type:'select', options:[…] } }` | N/A |
| Empty options | select field with `options` missing / `[]` / not an array | Rejected | generation → `error` (generic copy) + `reportRejection`; add-field → `reason:'addFieldFailed'` + `reportRejection` |
| Duplicate option values | options whose normalized `value`s collide (e.g. `Paid` + `paid`) | Rejected (not deduped) | same as above |
| Option missing label | an option with empty/missing `label` (or value normalizes empty) | Rejected | same as above |
| New allowlisted ops | `assertEditorOperationAllowed` on each of the 3 new op kinds (well-formed) | `{ allowed:true, kind }` | op whose raw output carries SQL → discarded `rawSqlRejected`; unknown kind → `operationNotAllowed` |
| Blocklist unchanged | select/option op names + existing blocklist suite | `BLOCKED_KEYWORDS` set and whole-word key guard behavior identical to before | N/A |

</frozen-after-approval>

## Code Map

- `src/types/db.ts` -- `FieldDefinition` (lines ~11–50): add `'select'` to the `type` union and `options?: SelectOption[]`; add new exported `SelectOption` type. `SchemaDefinition`/`RecordRow` unchanged (a select value is just one `data` key).
- `src/lib/schema/validator.ts` -- the gate. `PERMITTED_OPERATIONS` (66–89): append the 3 op names. `validateGeneratedSchema` (302–540): the `isSupported` check (403–412) and the per-field sanitize (432–494) — add a `type === 'select'` branch mirroring the `relation` branch (438–486) that validates options and sets `sanitizedField.options`. `SCALAR_FIELD_TYPES` (651–660) stays scalar-only. `AddFieldInput` (665–670) + `validateAddField` (698–754): accept `type === 'select'` with options. Add a shared `validateSelectOptions` helper. Reuse `normalizeTableName`, `keyIsBlockedVerb`, `RESERVED_KEYS`, `isNonEmptyString`, `reportRejection` as-is.
- `src/lib/gemini/prompts.ts` -- `GENERATION_FIELD_TYPES` (44–53): DO NOT add `select` (keeps the model from emitting it until 13.5). Referenced only to confirm it is untouched.
- `src/lib/utils.ts` -- `normalizeTableName` (50–68): reused verbatim to normalize option `value`s.
- `tests/unit/schema-validator.test.ts` -- Vitest suite; mirror the existing Story 5.4 allowlist/raw-SQL describe blocks and the "full blocklist" pins. Add a Story 13.1 describe block.
- Do NOT touch: `src/lib/schema/overrides.ts`, `src/lib/data/schema-mutate.ts`, `src/app/api/schema/edit/route.ts` — their select work belongs to 13.4.

## Tasks & Acceptance

**Execution:**
- [x] `src/types/db.ts` -- add exported `SelectOption = { value: string; label: string; archived?: boolean }`, add `'select'` to `FieldDefinition.type`, add `options?: SelectOption[]` to `FieldDefinition` with a doc comment (present only when `type === 'select'`; stores one option `value` in `records.data`; append-only archive) -- the shared type model every Epic 13 surface depends on.
- [x] `src/lib/schema/validator.ts` -- add a `validateSelectOptions(raw): { valid:true; options } | { valid:false; detail }` helper (non-empty array; each option has non-empty `label` and a `value` that normalizes non-empty via `normalizeTableName`; reject duplicate normalized values; output `{ value, label }` only, no `archived`); wire it into `validateGeneratedSchema` (accept `type === 'select'`, carry `options`) and `validateAddField` (extend `AddFieldInput` with `options?`, accept `type === 'select'`, carry `options`); append the 3 op names to `PERMITTED_OPERATIONS` -- the validator must understand select and allowlist the value-management ops.
- [x] `tests/unit/schema-validator.test.ts` -- add a Story 13.1 describe block covering the I/O & Edge-Case Matrix rows (generation + add-field select acceptance with normalized/unique options; empty, duplicate, and missing-label rejection on both paths; the 3 new ops accepted by `isPermittedOperation`/`assertEditorOperationAllowed`, discarded under raw SQL, and an unknown op still rejected; a pin asserting `BLOCKED_KEYWORDS` and the whole-word key guard are unchanged) -- AC3 requires CI coverage of exactly these cases.

**Acceptance Criteria:**
- Given the schema types, when a `select` field is defined, then `FieldDefinition.type` includes `'select'`, `FieldDefinition` carries `options?: SelectOption[]`, and `SelectOption` has a normalized `value`, a `label`, and an optional `archived` flag.
- Given a proposed `add_field` with `type: 'select'` on either validator path, when the Schema Validator runs, then it is accepted only with a non-empty `options[]` of unique normalized values each with a label, and rejected (through the existing rejection/logging path) otherwise; reserved-key and blocklist rules are unchanged.
- Given the validator unit tests, when they run in CI (`npm run test`), then they cover select acceptance, empty/duplicate/missing-label rejection, the three new allowlisted ops (membership + raw-SQL fence + unknown-op rejection), and confirm the blocklist is unchanged.
- Given existing generated/stored schemas and records, when this change ships, then nothing requires migration and non-select fields behave exactly as before.

## Implementation Notes

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **`select` allowed as a table `displayField`** (edge-case, blind-hunter) — **medium** → patch. Verified at `validator.ts:616-621`: the generation-path `displayField` guard rejects `target.type === "relation"` but not `"select"`. A select cell stores the opaque normalized `value` (`paid`), not the label (`Paid`) — the identical reason the relation branch exists — so a table whose `displayField` names a select field would render the raw token. Fix is a one-token extension of the existing guard + a test.
- **Missing add-field "archived dropped" test** (blind-hunter) — **low** → patch. Verified: the generation suite pins the archived-drop, the add-field suite does not, yet the frozen Boundaries invariant ("Never carry `archived` through generation OR add-field path") covers both. Behavior is already correct (shared `validateSelectOptions` helper); only the test coverage of that frozen invariant is one-sided.
- **No pin that `SCALAR_FIELD_TYPES`/`GENERATION_FIELD_TYPES` stay select-free** (blind-hunter) — **low** → patch. Verified: the diff adds a verbatim `BLOCKED_KEYWORDS` pin but none locking the load-bearing boundary (frozen Boundaries) that keeps the model from emitting `select` until 13.5. A trivial `not.toContain("select")` pin on each array locks it.
- **Dead `if (!value)` branch / "value normalizes empty" unreachable** (edge-case, blind-hunter) — **low** → reject. True that `normalizeTableName` never returns empty, so the branch is unreachable; but the earlier `isNonEmptyString(o.value)` guard already satisfies the matrix's reject-empty-value intent, and the branch is clearly-commented defense-in-depth. Removing vs keeping is a wash; not worth churn.
- **Non-Latin option `value`s become synthetic `field_<hash>` tokens** (edge-case, blind-hunter) — **low** → reject. Verified behavior, but it is the established, documented contract of `normalizeTableName` used for every key in the codebase (noted in the `SelectOption` doc comment), not a defect this change introduced; the target market is Latin-script French/English.
- **`reason`/`sensitive` dropped on the add-field select return** (blind-hunter) — **false**. The scalar add-field return (`{key,label,type}`) also omits them and `AddFieldInput` has no such fields, so the select return (`{key,label,type,options}`) introduces no asymmetry — the generation path carries them only because its input does.
- **Missing "extra/unknown option keys stripped" test** (blind-hunter) — **low** → reject. The `{value,label}`-only narrowing is correct and type-enforced downstream; pinning a sub-contract the spec never stated adds little.
- **Test-header sub-case comment undercounts the cases present** (blind-hunter) — **low** → reject. Cosmetic; no behavioral impact.

No intent_gap or bad_spec entries — all actionable findings are trivial patches, so no loopback.

## Design Notes

Allowlisting the three op names with no handler is intentional and safe: `assertEditorOperationAllowed` is only a guard, the edit route is untouched, and the model is never told these ops exist, so none can be dispatched until 13.4 wires the handlers — the allowlist + raw-SQL fence (AC3) is simply proven now.

Example sanitized select field: `{ key:"status", label:"Status", type:"select", options:[{value:"paid",label:"Paid"},{value:"unpaid",label:"Unpaid"}] }`.

## Verification

**Commands:**
- `npm run test -- tests/unit/schema-validator.test.ts` -- expected: all cases pass, including the new Story 13.1 block and the unchanged blocklist/allowlist pins.
- `npm run type-check` -- expected: no errors (new `SelectOption`/`options` typecheck across callers).
- `npm run lint` -- expected: clean.
