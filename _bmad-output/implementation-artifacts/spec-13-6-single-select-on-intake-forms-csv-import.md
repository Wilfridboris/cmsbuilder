---
title: 'Single-Select on Intake Forms & CSV Import'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '3acaca213ceb84a0c54736825426c96dc8bff6bf'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 13 built the `select` type end to end (13.1–13.5), but the two remaining data-entry surfaces still cannot handle it. The public intake form renders a `select` field as a free-text `<Input>` (no dropdown), and both the intake write and CSV import accept any string into a select cell, so a value that is not a valid option can be stored, breaking the type's integrity.

**Approach:** Render a native `<select>` of non-archived options on the public intake form and validate the submitted value server-side against the field's options; for CSV import, validate each cell of a select-mapped column against the target field's options and flag unmatched values before the write. Introduce one shared pure matcher reused by both surfaces; reuse the 13.1 type model and 13.2 helpers unchanged.

## Boundaries & Constraints

**Always:**
- One source of truth for "is this a valid select value": a new pure helper `matchSelectValue(options, raw)` in `src/lib/forms/select-input.ts`, reused by BOTH the intake route and import commit. It trims; blank → `omit`; matches a non-archived option by exact `value` token first, then by case-insensitive `label`, returning that option's `value`; anything else → `invalid`. Archived options never match (intake/import create NEW records; archived = not selectable for new records, per 13.4).
- Intake form: a `select` field renders a native `<select>` of its non-archived options with a leading blank placeholder option (the field is never required); the stored draft and submitted value is the option `value` token. The server (`/api/intake/[slug]`) validates every select field via `matchSelectValue`: `omit` → drop the key, `ok` → write the token, `invalid` → reject the whole submission with the existing generic 400 (no per-field leak on the public surface).
- CSV import: a column mapped onto an EXISTING select field has every cell validated via `matchSelectValue`; matched cells store the option `value` token, blank cells are omitted. **Decision — validate at commit:** if any non-blank cell matches no active option, `planCommit` throws a typed `CommitPlanError("Import.error.selectValueInvalid")` naming the field and the distinct unmatched values, and the commit route rejects with that translated message so NOTHING is written; the Admin fixes the source values or skips/remaps the column via the existing resolve UI, then re-imports. The commit never writes a non-option or archived token (zero data loss, zero invalid tokens). A richer per-value remap flow is a future enhancement (logged to deferred-work), out of scope here.
- Reuse unchanged: `SelectOption`/`FieldDefinition` (13.1), `partitionSelectOptions`/`selectDraftToData` (13.2), the `intakeFields` allowlist (already lets `select` through — only `relation` is excluded), `coerceImportValue` for every non-select type, the guarded `mutate.ts` write, and the identity-masked generation pipeline (untouched here).

**Never:**
- No change to the frozen type model (`src/types/db.ts`), `validateSelectOptions`, or any schema operation/validator rule — this story only READS existing `field.options`; it adds no schema op.
- No creating a new select field, and no add/rename/archive of options, during intake or import (that is 13.3/13.4 chat territory; import creating a brand-new select field stays deferred).
- The intake form must NOT import dashboard-coupled components (e.g. the Radix `SelectDropdown`); it uses only shared `@/components/ui/*` primitives + the pure helper, matching its existing `<Input>`/`BooleanChoice` pattern.
- No colored pills or per-value styling, no multi-select, no DDL, no row migration, no change to any existing stored record.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Intake: pick an option | visitor selects a non-archived option on `/forms/{slug}` | draft holds the option `value` token; server `matchSelectValue` → `ok`; record stores the token; only non-archived options are offered | N/A |
| Intake: leave select blank | select left on the placeholder | `matchSelectValue` → `omit`; key dropped from `data` (never required) | N/A |
| Intake: forged invalid/archived value | client posts a token that is no active option, or an archived option's value | `matchSelectValue` → `invalid`; whole submission rejected, nothing written | generic 400, no field leak |
| Import: cell matches an option | mapped select column; cell equals an option `value` or (case-insensitively) its `label` | coerced to that option's `value` token and written | N/A |
| Import: blank cell | mapped select column; empty cell | omitted from that row's payload | N/A |
| Import: cell matches no active option | mapped select column; value is not an active option (or is an archived option) | flagged; commit rejects with `selectValueInvalid`, writes nothing | typed import error, no partial write |

</frozen-after-approval>

## Code Map

Intake (Epic 6):
- `src/components/intake/IntakeForm.tsx` -- add a `select` branch in `IntakeField` (currently boolean + `<Input>` fallback, ~263-286): render a native `<select id={id}>` over `field.options.filter(o => !o.archived)` with a leading `<option value="">{t("selectPlaceholder")}</option>`, `value` = the draft token, `onChange` → `onChange(e.target.value)`. Style to mirror `<Input>`: `min-h-12 w-full rounded-md border border-input bg-background px-3 pe-10 appearance-none`, a muted right-aligned Lucide `ChevronDown` (`size-4 pointer-events-none`), `focus-visible:ring-2 focus-visible:ring-ring`, `disabled:opacity-50`. `blankDraft` (71-77) already seeds non-boolean fields to `""` → placeholder. The submit loop (118-130) needs NO coercion change: a select's draft value is already the stored token, and blank omits via the existing path.
- `src/app/api/intake/[slug]/route.ts` -- in the field loop (78-109), add a `field.type === "select"` branch BEFORE the scalar `coerceAddValue` path: `matchSelectValue(field.options, String(submitted ?? ""))` → `omit` (skip), `ok` (write `value`), `invalid` (`throw new AppError(400, "genericError")`). Boolean, scalar, empty-guard (121-123), `mutate`, and notification paths unchanged.
- `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add `IntakeForm.selectPlaceholder` ("Choose an option" / "Choisir une option"). No em-dash.

Shared helper:
- `src/lib/forms/select-input.ts` -- add pure `matchSelectValue(options: SelectOption[] | undefined, raw: string): { kind: "omit" } | { kind: "ok"; value: string } | { kind: "invalid" }` with the semantics above (mirrors the archived filter in `partitionSelectOptions`).

Import (Epic 4) — validate at commit (decided):
- `src/lib/import/commit.ts` -- carry `options` into the plan: add `options?: SelectOption[]` to the `buildTargetIndex` entry (133-151) and `ResolvedTarget` (58-63). In the row-projection loop (221-233) branch when `fieldType === "select"`: use `matchSelectValue` (`omit` → skip, `ok` → write token, `invalid` → collect `{field, value}`); after projecting all rows, if any invalid were collected, throw the new `CommitPlanError("Import.error.selectValueInvalid")` (add the key to the union + constructor, 27-38). Non-select fields keep `coerceImportValue`.
- `src/app/api/import/_lib.ts` (`importErrorForKey`, 99-111) + `src/app/api/import/commit/route.ts` -- map the new `Import.error.selectValueInvalid` key to an `AppError(400)` so the commit route rejects it like `unresolvedColumns`/`schemaChanged`.
- `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add `Import.error.selectValueInvalid` (EN + FR).
- Do NOT touch: `src/lib/import/mapping.ts` / the propose prompt (a select field is just a `{table,field}` target — column mapping already works), `src/lib/import/resolve.ts` (unless Option B is chosen), `parse.ts`, `validator.ts`, `src/types/db.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/forms/select-input.ts` -- add the pure `matchSelectValue` matcher -- one source of truth for a valid select value across intake + import.
- [x] `src/components/intake/IntakeForm.tsx` -- render a native `<select>` of non-archived options with a blank placeholder for a `select` field -- the public form offers a real dropdown, not free text.
- [x] `src/app/api/intake/[slug]/route.ts` -- validate every select field via `matchSelectValue` (`omit`/`ok`/`invalid`→400) -- the server authoritatively rejects a non-option or archived token on the unauthenticated surface.
- [x] `src/lib/import/commit.ts` -- carry `options` into the plan and validate select cells via `matchSelectValue`, throwing `selectValueInvalid` on any unmatched non-blank value -- import never writes an invalid/archived select token.
- [x] `src/app/api/import/_lib.ts` + `src/app/api/import/commit/route.ts` -- translate the new error key to a 400 -- the commit route surfaces unmatched values instead of a generic 500.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add `IntakeForm.selectPlaceholder` and `Import.error.selectValueInvalid` (EN + FR, no em-dash) -- localized copy for both surfaces.
- [x] `tests/unit/select-input.test.ts` -- cover `matchSelectValue` (value match, case-insensitive label match, archived→invalid, blank→omit, unknown→invalid) -- pins the shared matcher.
- [x] `tests/unit/intake-submit-route.test.ts` -- add a select field: valid value writes the token, invalid/archived → 400, blank → omit -- pins the public write path.
- [x] `tests/unit/import-commit.test.ts` -- add a select target: value- and label-matched cells store the token, blank omits, unmatched/archived throws `selectValueInvalid` -- pins the import path.

**Acceptance Criteria:**
- Given an intake form with a select field, when a visitor opens `/forms/{slug}`, then only non-archived options appear in a native dropdown with a blank default, and submitting a chosen option stores that option's `value` token.
- Given the frozen boundary, when the suite runs, then the type model, `validateSelectOptions`, and all schema operations are unchanged, and the intake form imports no dashboard-coupled component.

## Implementation Notes

**Deviation — surfacing the import error detail (beyond the Code Map).** The Code Map scoped the import error wiring to "map the new key to `AppError(400)`" and listed no client change, but the I/O matrix requires the unmatched values to be surfaced to the Admin. Because the API response envelope (`error: string | null`) cannot carry next-intl interpolation params, the commit route (`src/app/api/import/commit/route.ts`) composes the translated message server-side via `getTranslations("Import")` with `CommitPlanError.params` (`{field, values}`) and throws `AppError(400, <composed message>)`; `importErrorForKey` still maps the bare key to 400 as a uniform fallback. On the client, `ImportView.resolveCommitError` was given a small branch: a non-`Import.error.`-prefixed code that contains whitespace (i.e. a composed sentence) is shown verbatim, while a bare unknown token still falls back to the generic `commitFailed` copy. `CommitPlanError` gained an optional `params` field for this. The frozen boundary (type model, `validateSelectOptions`, schema ops, `coerceImportValue` for non-select types) is untouched.

**Multiple bad select columns.** If more than one mapped select column has unmatched values, `planCommit` collects all of them but the thrown error names only the first field + its distinct values (the commit still writes nothing). The Admin fixes/skips that column and re-imports; a subsequent import surfaces the next. Acceptable for MVP.

**Verification (run in this session, not just the subagent's report):** full suite 1436 passed (119 files; one flaky settings-page dynamic-import test failed once then passed on re-run — unrelated to this story); `npm run type-check` clean; `npm run lint` clean (only the pre-existing eslintrc-deprecation warning).

**Post-merge manual review (Playwright MCP, localhost:3000, authed fixture /session-1f4fa453).** Exercised the rich path on both surfaces.
- Intake: added a single-select `Lead Source` field (Website/Referral/Phone) via chat to the resolved intake table (Quotes & Jobs), opened `/forms/session-1f4fa453`, and confirmed the field renders as a native `<select>` with the "Choose an option" blank placeholder selected by default and only the non-archived options listed. Submitted with `Website` selected → "Message sent"; the new record landed on the dashboard with Lead Source rendering the label **Website** (token→label resolution).
- Import: uploaded a CSV mapping a `Lead Source` column holding `Website, Referral, TikTok` onto the select field (AI mapped it at 98%). Clicking Import rejected the whole commit with the composed message naming the field and the unmatched value ("...not valid options: TikTok. Nothing was saved..."), and the dashboard confirmed zero partial write (none of JOB-IMP-1/2/3 landed). Both surfaces work end to end.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

Three layers (blind-hunter N=6, edge-case-hunter, verification-gap). One patch (test-only); all other findings rejected. No intent_gap / bad_spec → no loopback.

- **End-to-end import error surfacing is untested** (verification-gap, blind-hunter) — **low → patch**. Verified: `route-import-commit.test.ts` SCHEMA has no `select` field and its error-mapping cases cover only unresolved/schemaChanged/commitFailed, so the commit route's `selectValueInvalid` composition branch (route.ts:119-130) is unrun; `resolveCommitError` (private, ImportView.tsx:509) is called but has no test. The planner throw IS tested, so the feature works today, but a regression in the route-compose or client-verbatim branch would silently drop the field/values guidance with the suite green. Fix is test-only. → add a route test (select column + bad cell → 400 with the composed message) and a `resolveCommitError` unit test (verbatim for a spaced non-key string, generic fallback for a bare token).
- **Multi-field invalid-select reports only the first field** (edge-case-hunter, blind-hunter) — **low → reject**. Verified at commit.ts: `invalidSelect` collects every bad field but the throw uses `[...entries()][0]`. Within the spec's singular "naming the field" wording; two select columns both holding bad values in one import is uncommon; the message template is singular, so reporting all would add i18n/message complexity. Already recorded as accepted MVP behavior in Implementation Notes. No data loss (nothing is written).
- **`importErrorForKey` selectValueInvalid case is unreachable; route `else→commitFailed` is dead** (blind-hunter, edge-case-hunter, verification-gap) — **low → reject**. Verified: `importErrorForKey` is only called with parse/zod keys, never with the planner's `selectValueInvalid`; and `planCommit` always passes `params`. Harmless defensive code; if the `_lib.ts` branch were ever hit it returns `"Import.error.selectValueInvalid"` as the message, which the client collapses to generic `commitFailed` (no raw-key leak reaches the user). No named harm.
- **`resolveCommitError` whitespace heuristic is fragile for future error strings** (blind-hunter) — **low/maybe-false → reject**. Verified it is correct today: every existing commit-route error code is a space-free key (`Import.error.*`, `genericError`), and only the composed `selectValueInvalid` sentence carries spaces, so the sniff distinguishes them. The concern is speculative future-proofing; the proposed fix (typed marker/prefix) adds public surface for no current harm.
- **`matchSelectValue` label-matching / collision risk on the public intake surface** (blind-hunter) — **false → reject**. Verified: the matcher only ever returns a NON-archived option's canonical `value`; a value-vs-label "collision" still resolves to a legitimate active option, so no invalid or archived token can ever be stored. The stated harm ("resolve to an unintended option") produces a valid, selectable option deterministically — not corruption. Splitting intake (value-only) from import (value+label) would add a parameter for no data-integrity gain.
- **Duplicate/inconsistent `selectPlaceholder` copy** (blind-hunter) — **low → reject**. Verified two keys in DIFFERENT namespaces: `selectPlaceholder` "Choose a value" (dashboard add-record, en.json:457) and "Choose an option" (IntakeForm, en.json:815). No technical collision; surface-appropriate copy on two screens a user never sees side by side. Negligible.
- **Intake `<select>` has no client required/blank feedback; `aria-invalid` wiring dead; render untested** (blind-hunter, verification-gap) — **false/low → reject**. Verified: never-required is intended (frozen Boundaries + matrix "leave blank → omit"), so a selectable blank placeholder is correct, not an omission; the `aria-invalid`/`aria-describedby` wiring is harmless and consistent with the other fields; the render is presentational and the data contract is enforced AND tested server-side (the intake route rejects forged/archived tokens with a 400 and never calls `mutate`), so a render regression cannot corrupt data.

## Design Notes

- Control choice (web-uiux-architect): a native `<select>`, not the dashboard's Radix `SelectDropdown`, because the public form is mobile-first and session-free — native yields the OS picker (best touch UX), is accessible by default, needs no hydration, and adds zero bundle weight; the Radix control's "+ Add value"/archived-current affordances are authed-dashboard needs the public surface lacks. `appearance-none` + a Lucide `ChevronDown` keeps the shadcn look while staying a native element, consistent with the existing `<Input>` and `BooleanChoice`.
- Matching by `label` (case-insensitive) as well as by `value` token matters for import: external spreadsheets carry human labels ("In progress"), not normalized tokens ("in_progress"); the matcher resolves either to the stored `value`. The intake client only ever sends tokens, but sharing one matcher keeps a single rule across both surfaces.

## Verification

**Commands:**
- `npm run test -- tests/unit/select-input.test.ts tests/unit/intake-submit-route.test.ts tests/unit/import-commit.test.ts` -- expected: new matcher/intake/import assertions pass; existing intake and import-commit cases still green.
- `npm run type-check` -- expected: clean across the new matcher, the `ResolvedTarget.options` addition, and the new error key.
- `npm run lint` -- expected: clean.

**Manual checks:**
- On localhost:3000 (Playwright MCP): create (via chat) a select field on an intake-eligible table, open `/forms/{slug}`, confirm the field renders as a dropdown of non-archived options with a blank default, submit a choice, and confirm the dashboard record shows the option label. Then import a CSV whose mapped column holds a mix of matching labels and one non-matching value onto that select field, and confirm the unmatched value is surfaced with no partial write.
