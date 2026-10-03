---
title: 'Render & Edit Single-Select Across Views & Forms'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
baseline_commit: '84467cfb4c667207428c633ce6208168db79f769'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 13.1 added the `select` field type to the schema model and validator, but no surface renders or edits it. A `select` cell currently shows its raw stored token (e.g. `paid`) instead of the option label (`Paid`), and there is no dropdown to pick a value on the add form or inline edit, so a select field is unusable in the data UI.

**Approach:** Resolve a select cell to its option `label` in the shared cell formatter so every authenticated read surface renders plain text, and add a dropdown control (built on the existing Radix `Select` primitive) to the Add form and inline edit that lists the non-archived options and persists the option `value`, reusing the established optimistic-update + rollback path unchanged.

## Boundaries & Constraints

**Always:**
- Read rendering shows the matching option's `label` as plain text (no pills, no per-value styling). An archived option still resolves to its `label` so existing rows render correctly. A value that matches no option falls back to the raw stored value (defensive), never throws.
- The dropdown lists only NON-archived options. Selecting one persists that option's `value` (never the label) into `records.data`; the write reuses `useUpdateRecord` / the add path so optimistic update + rollback are preserved exactly as for other field types.
- Because the schema has no `required` flag, a select is clearable: the add form may leave it blank (omit the key) and inline edit may clear it to empty, mirroring existing optional-field behavior.
- When an existing cell holds an archived value, the edit control still displays that value's label as the current selection, but archived values are not offered as new choices.
- All new user-facing copy routes through the `SlugDashboard` next-intl namespace in both `en` and `fr`, with no em-dash.
- Decision (affordance): the Admin-only "+ Add value" affordance is deferred to Story 13.4. `SelectDropdown` reserves an optional add-value slot prop that renders nothing in 13.2, so no dead/half-wired control ships; 13.4 wires the callback and its `add_select_option` path.

**Never:**
- No colored pills, no multi-select, no per-value styling.
- No "+ Add value" affordance rendered in 13.2 (deferred to 13.4), and no value-management backend (`add_select_option` / `rename_select_option` / `archive_select_option` handlers, mutators, or route wiring) — that is Story 13.4. No changes to `/api/schema/edit`, `schema-mutate.ts`, or `validator.ts`.
- No select rendering on intake emails or CSV import (Story 13.6), and no changes to generation/fallback emission (Story 13.5) or the pre-auth demo/generate reveal.
- Do not change how filter/sort compares a select field (it continues to operate on the stored `value` token); only display is addressed here.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Render active value | cell `paid`; options incl. `{value:'paid',label:'Paid'}` | renders `Paid` as plain text | N/A |
| Render archived value | cell `rejected`; that option `archived:true` | still renders `Rejected` (existing rows resolve) | no throw |
| Render unknown value | cell `foo`; no matching option | falls back to raw `foo` | no throw |
| Add-form pick / blank | user picks `Unpaid` / leaves unchosen | `data[key]='unpaid'` / key omitted | N/A |
| Inline edit pick | user picks a non-archived option | commits immediately (`onCommit ok`); optimistic update then settle | rollback on server error (existing path) |
| Inline edit clear / reselect | user clears / re-picks current value | `onCommit omit` / no-op, closes editor | N/A |
| Dropdown option set | field has archived + active options | only non-archived selectable; archived current value shown but not re-selectable | N/A |

</frozen-after-approval>

## Code Map

- `src/types/db.ts` -- `SelectOption` + `FieldDefinition.options` already defined by 13.1 (20–75). Reference only.
- `src/lib/format.ts` -- `formatCell` (82–118): add optional `options?: SelectOption[]` param + a `type==='select'` branch returning the matching option's `label` (search ALL options incl. archived), falling back to `String(value)` when no match. Pure/node-testable; mirror the defensive `relation` branch (97).
- `src/components/dashboard/CellText.tsx` -- add optional `options?: SelectOption[]` prop; forward to `formatCell`.
- `src/components/dashboard/SelectDropdown.tsx` -- NEW client component on `src/components/ui/select.tsx`. Props mirror `RelationPicker`: `{ value: string|null; onChange: (v: string|null)=>void; options: SelectOption[]; ariaLabel; disabled?; id? }`. Lists non-archived options; a "Clear" item (→ `onChange(null)`); if `value` is an archived option, render it as a disabled item so the trigger shows its label. Reserve an optional, unused "+ Add value" slot prop (`SelectSeparator` + button); 13.4 wires it.
- `src/components/dashboard/AddRecordForm.tsx` -- control select (150–182): add a `select` branch rendering `SelectDropdown` (mirror `relation` at 160). `handleSubmit` (86–122): add a `select` branch mirroring `relation` (99–106) — blank → omit, else `data[key]=value`.
- `src/components/dashboard/InlineEditCell.tsx` -- read: pass `field.options` to the two `<CellText>` (193, 218). edit: in `InlineEditor` after boolean (~272) add a `select` branch rendering `SelectDropdown`, commit-immediately (pick → `onCommit ok`; clear → `omit`; reselect → `onCancel`), mirroring boolean discipline.
- `RecordReverseListDialog.tsx` (236), `RecordDetail.tsx` (209), `RelatedRecordsList.tsx` -- read surfaces using `CellText`: pass `field.options` so they render labels too.
- `src/lib/i18n/en.json` + `fr.json` -- `SlugDashboard` ns: select placeholder + clear label. No em-dash.
- Reuse unchanged: `useRecordMutations.useUpdateRecord` (optimistic + rollback — a select value is just a `data` key), `ui/select.tsx`, `cn`.
- Do NOT touch: `api/schema/edit/route.ts`, `schema-mutate.ts`, `validator.ts`; `intake-notification.ts` + CSV (13.6); demo/generate (13.5).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/format.ts` -- add optional `options` param + `select` branch to `formatCell` (label lookup incl. archived, raw fallback) -- the single source of truth for select display across every read surface.
- [x] `src/components/dashboard/CellText.tsx` -- thread an optional `options` prop into `formatCell` -- so read call sites opt in by passing `field.options`.
- [x] `src/components/dashboard/SelectDropdown.tsx` -- NEW dropdown on the Radix `Select` primitive: non-archived options, clear item, archived-current display, 48px touch target, `focus-visible` ring, `aria-label`, disabled state -- the shared edit control for add + inline.
- [x] `src/components/dashboard/AddRecordForm.tsx` -- render `SelectDropdown` for select fields and persist the option `value` on submit (blank → omit) -- Add path.
- [x] `src/components/dashboard/InlineEditCell.tsx` -- resolve labels on read (pass `field.options` to `CellText`) and render `SelectDropdown` in `InlineEditor` with commit-immediately semantics -- inline read + edit path.
- [x] `src/components/dashboard/RecordReverseListDialog.tsx`, `RecordDetail.tsx`, `RelatedRecordsList.tsx` -- pass `field.options` to `CellText` -- select labels render on the remaining authenticated read surfaces.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add the new `SlugDashboard` copy (placeholder, clear) with no em-dash.
- [x] `tests/unit/format.test.ts` -- add Story 13.2 cases covering the I/O matrix render rows (active label, archived label, unknown fallback, blank) -- unit coverage for the formatter branch.
- [x] `src/lib/forms/select-input.ts` (NEW) + `tests/unit/select-input.test.ts` (NEW) -- extract the pure select edit-decision logic (`partitionSelectOptions`, `fromDropdownValue`/`SELECT_CLEAR_SENTINEL`, `resolveSelectCommit`, `selectDraftToData`) used by `SelectDropdown`/`InlineEditCell`/`AddRecordForm`, and unit-test the I/O matrix EDIT rows -- node-testable coverage (mirrors the `field-input.ts` split) for behaviors the Radix `Select` portal makes awkward to drive in jsdom.

**Acceptance Criteria:**
- Given a `select` field in a table or card view, when records render, then each cell shows its option `label` as plain text and archived values on existing rows still render their label.
- Given the Add form or an inline cell edit, when the user edits a `select` field, then a dropdown of non-archived options is presented, selecting one persists the option `value`, clearing omits the value, and optimistic update + rollback behave exactly as for other field types.
- Given `SelectDropdown`, when it is built, then it reserves an unused add-value slot that renders nothing in 13.2 (no dead control), and the Admin-only "+ Add value" affordance plus its `add_select_option` wiring are left to Story 13.4.

## Implementation Notes

- Extracted the select edit-decision logic into a new pure module `src/lib/forms/select-input.ts` (`partitionSelectOptions`, `fromDropdownValue` + `SELECT_CLEAR_SENTINEL`, `resolveSelectCommit`, `selectDraftToData`) and refactored `SelectDropdown`/`InlineEditCell`/`AddRecordForm` to use it — no behavior change. This is beyond the planned Code Map: it exists so the I/O-matrix EDIT rows are covered by node-level unit tests, since the repo's test env is `node` and it has no Radix `Select` portal-interaction tests. Mirrors the established `field-input.ts` pure-helper split.
- `RelatedRecordsList.tsx` needed no direct edit: it renders cells via `InlineEditCell` (including `editable={false}`), so it inherits the `field.options` label resolution.
- Verification: `tests/unit/format.test.ts` + `tests/unit/select-input.test.ts` → 29 passed; `npm run type-check` clean; `npm run lint` clean (only the pre-existing eslintrc-deprecation warning). Full-suite note from implementation: the 2 failing `invoice-issue-db` integration tests are pre-existing "real Supabase" tests timing out with no DB reachable — unrelated to this story (no file it touches).

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **Orphaned/unknown current value shows placeholder in edit** (edge-case) — **low** → defer. Verified at `SelectDropdown.tsx`: `partitionSelectOptions` surfaces a disabled item only for an *archived* current value, so a stored token matching NO option renders Radix `value` with no matching `SelectItem` → trigger shows the placeholder as if empty. Read mode is guarded (`formatCell` → raw fallback, matrix row 3). Unreachable in 13.2 (options are only added, never removed; archive is 13.4, off-list import is 13.6), so it guards an undemonstrated state — defer to the story that first makes it reachable.
- **Public intake form renders select as unvalidated text `Input`** (blind-hunter) — **medium** → defer. Verified: `intakeFields` excludes only `relation`, and `IntakeForm` has no `select` branch, so a select field would render a plain `Input` coerced via `coerceAddValue("select")` (accepts any string). Not touched by this diff and explicitly owned by Story 13.6 (Single-Select on Intake Forms); also latent until a select field exists (13.3/13.5).
- **No server-side validation that a written select value is an allowed option** (blind-hunter) — **medium** → defer. Verified: `mutate.ts` enforces relation referential integrity (Story 3.8, throws `invalidReference`) but has no select-option membership check; `coerceAddValue`/record schema pass select through. Net-new hardening beyond 13.2's render/edit intent (adds surface, guards undemonstrated API-direct writes); analog to the relation guard, and latent until select fields exist.
- **Filter/sort has no select support — token-order sort, no filter operators** (blind-hunter) — **low** → defer. Verified: `operatorsForType` has no `select` case (`default: []`) and `applyFilterSort` special-cases only `relation` for label-ordered sort, so select sorts by the stored token. Deliberately excluded by the frozen intent ("Do not change how filter/sort compares a select field … only display is addressed here"); recorded as future work for when select fields become real.
- **No component-level render/wiring tests for select surfaces** (blind-hunter + verification-gap, pre-dispositioned defer) — **low** → defer. The pure decision logic (`format.test.ts`, `select-input.test.ts`) is covered, but the `CellText` `options` pass-through at 4 read sites, the `SelectDropdown` archived/clear rendering, and the commit dispatch in `InlineEditCell`/`AddRecordForm` are untested end-to-end. Residual risk is prop pass-through / Radix-portal wiring; the repo has no component-render harness for these surfaces, so closing it is disproportionate to this story.
- **Add vs inline normalize the current value differently** (blind-hunter) — **low** → reject. `InlineEditCell` coerces via `String(value)`; `AddRecordForm` passes the draft string. A select cell always stores a string option `value` by construction, so `String()` is a no-op and the draft is already a string — the divergence never manifests. No named harm; the proposed shared-helper fix adds surface beyond a direct correction.

## Design Notes

Select follows the `relation` precedent, not the scalar one: the stored token is opaque and the human label is resolved for display, and editing uses a dedicated picker (here a closed dropdown rather than relation's searchable typeahead). Resolution lives in `formatCell` (synchronous — options are embedded in the field definition) rather than a `useRelationLabels`-style async resolver, so every `CellText` consumer renders labels by passing one extra prop.

Example resolved render: field `{type:'select', options:[{value:'paid',label:'Paid'},{value:'unpaid',label:'Unpaid'}]}`, cell `'unpaid'` → `Unpaid`.

## Verification

**Commands:**
- `npm run test -- tests/unit/format.test.ts` -- expected: new Story 13.2 formatter cases pass.
- `npm run type-check` -- expected: no errors across the new `options` prop/param and `SelectDropdown`.
- `npm run lint` -- expected: clean.

**Manual checks:**
- On localhost:3000 (Playwright MCP review): a table with a select field renders labels; add-form and inline edit show the dropdown of non-archived options; picking persists and survives refresh; clearing empties the cell; an archived value on an existing row still shows its label.
