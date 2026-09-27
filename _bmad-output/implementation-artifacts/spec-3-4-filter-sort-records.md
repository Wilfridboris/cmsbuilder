---
title: 'Story 3.4: Filter & Sort Records'
type: 'feature'
created: '2026-09-26'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '3f9bd31d2066d1886288b2e852e16badddd28297'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A team member sees every record in fixed `created_at` order with no way to narrow or reorder them; on real data they cannot quickly find the records they care about (FR10). No filter/sort capability exists anywhere in the stack.

**Approach:** Add filter & sort as a **client-side view concern** over the rows already cached under `['records', slug, tableKey]` — no server, API, or query-key changes. A shared responsive toolbar above the surface drives single-column sort (asc→desc→off) and one-or-more ANDed field filters; desktop column headers double as sort affordances. State lives in `RecordsView` and is applied identically to the desktop table and mobile cards. A filters-produced empty result shows a translated "No records found" state (distinct from empty-table) with a Clear-filters action.

## Boundaries & Constraints

**Always:**
- Client-side only, computed from cached rows; reuse `['records', slug, tableKey]` untouched so optimistic writes and future real-time invalidation keep working.
- Same filter/sort result renders in the desktop table and mobile cards; switching the active table resets filter/sort.
- Sort is single-column cycling asc → desc → unsorted (`created_at` fallback). Multiple filters combine with AND. Sorting is type-aware (numeric/date/currency compare numerically; text case-insensitive `localeCompare`; boolean/blank ordered deterministically, never throwing on missing values).
- Filter operators are type-aware, capped to exactly: text = contains/equals; number & currency = =, <, >, between; date/datetime = before/after/on/between; boolean = is. (Decision.)
- Filter/sort state is ephemeral: in-memory in `RecordsView`, reset on page reload and on active-table change. Not persisted to URL, storage, or the server. (Decision.)
- Only visible (non-`hidden`), non-`relation` fields are filter/sort targets.
- New user-facing strings go through `useTranslations("SlugDashboard")` in `en.json` + `fr.json` (i18n CI gate), no em-dashes. Controls are keyboard-operable, `focus-visible`, ≥48×48px on touch.
- All filter/sort/predicate logic lives in a pure node-testable module; interactive DOM is verified by the post-commit Playwright review (repo has no jsdom), per the 3.1–3.3 precedent.

**Never:**
- No changes to `listRecords`, `/api/records`, `records-client.ts`, query keys, or `mutate.ts`. No pagination or server-side query params.
- No filter/sort by relationship or relation-field targets (Story 3.8). No multi-column sort. No saved/named views or persisted user preferences.
- No data-model, migration, or schema write. No LLM. Do not import/modify `DemoDashboard.tsx`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|--------------|-------------------|----------------|
| Sort column | Activate sort on a visible column | Rows reorder by that field; re-activate → desc; again → cleared to `created_at` order; indicator reflects state | N/A |
| Sort parity | Sort active | Identical order in desktop table and mobile cards | N/A |
| Single filter | One filter applied | Only matching rows shown in both presentations | N/A |
| Multiple filters | Two+ filters | Only rows matching ALL (AND) shown | N/A |
| Filter → 0 matches | Active filter, no matches | Translated "No records found" state (not empty-table, not error) + Clear-filters control | Never an error |
| Clear filters | Clear action | Filters removed, full table returns; active sort retained | N/A |
| Table switch | Change active table | Filter/sort reset for the new table | N/A |
| Ineligible fields | Table has hidden and/or relation fields | Those fields absent from filter/sort choices | N/A |
| Blank sort values | Sorted field missing/empty in some rows | Blanks grouped deterministically at one end; no throw | N/A |
| Edit under filter | Inline edit makes a row stop matching | Write commits (3.3 unchanged); next render re-evaluates and the row drops out; no crash | Rollback per 3.3 |

</frozen-after-approval>

## Code Map

- `src/components/dashboard/RecordsView.tsx` -- MODIFY. Keep switcher/`useQuery`/add/edit/delete/swipe untouched. Add per-table `sort`+`filters` state (reset on active-table change via the existing `draftTableKey` render-time reset pattern). Derive `visibleRows = applyFilterSort(rows, filters, sort, fields)` and feed it to `RecordsTable` (446-525) and `RecordsCards` (528-637) instead of raw `rows`. Render `<RecordsToolbar>` in the slot after `StatusMessage` (~L309). Wire desktop `TableHead` cells (477-487) as sort buttons with `aria-sort`. Select filtered-empty vs `EmptyTable` based on whether filters are active (desktop ~L339, mobile ~L358).
- `src/components/dashboard/RecordsToolbar.tsx` -- NEW. Responsive filter/sort surface: sort field+direction control, add-filter control, active filters as removable chips, Clear-filters. Reuse shadcn `Select`/`Popover`/`Button` + Lucide (`ArrowUpDown`/`ArrowUp`/`ArrowDown`/`Filter`/`X`). Field list = `eligibleFields`. Props `{ fields, filters, sort, onChange…, cellStrings }`. ≥48×48px, `focus-visible`, ARIA.
- `src/lib/data/filter-sort.ts` -- NEW pure module. `SortState`, `FilterState`; `applyFilterSort(rows, filters, sort, fields)` (filter then stable sort; never mutates); per-`type` comparators + predicates; `eligibleFields(fields)` (visible & non-relation). Value coercion consistent with `field-input.ts`.
- `src/lib/data/records.ts`, `records-client.ts`, `useRecordMutations.ts`, `src/app/api/records/*` -- REFERENCE ONLY. `listRecords` returns all non-deleted rows `created_at` asc; query key `['records', slug, tableKey]`. Do not modify.
- `src/lib/format.ts` -- REFERENCE. `formatCell(value, type, cellStrings)` + `CellStrings` for chip/value display.
- `src/types/db.ts` -- REFERENCE. `FieldDefinition.type` (text|number|date|datetime|boolean|currency|email|phone|relation), `hidden?`; `RecordData` `{ id, version, data }`; `TableDefinition.fields`.
- `src/components/ui/{select,popover,button,card,table}.tsx` -- shadcn primitives to reuse.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- MODIFY. Add `SlugDashboard` keys (see Tasks).
- `tests/unit/filter-sort.test.ts` -- NEW. Cover the pure matrix rows.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/data/filter-sort.ts` -- implement `eligibleFields`, per-type comparators/predicates, and `applyFilterSort` (filter-then-sort, stable, non-mutating, deterministic blanks) honoring the resolved operator model.
- [x] `src/components/dashboard/RecordsToolbar.tsx` -- build the responsive sort + filter toolbar (field/direction controls, active-filter chips, Clear-filters) with shadcn primitives; translated labels; ≥48×48px; `focus-visible`; ARIA.
- [x] `src/components/dashboard/RecordsView.tsx` -- add per-table `sort`/`filters` state (reset on table switch), render `<RecordsToolbar>`, derive `visibleRows`, wire header sort buttons, and pick the filtered-empty vs empty-table state.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add `SlugDashboard` keys in both locales: sort label/aria (asc/desc/clear), filter label, per-operator labels, add-filter, remove-filter/clear-filters, filtered-empty "No records found". No em-dashes.
- [x] `tests/unit/filter-sort.test.ts` -- unit-test every pure matrix row: single/multi (AND) filter, each type's compare/predicate, sort cycle, blank ordering, `eligibleFields` excludes hidden+relation, non-mutation/stability.

**Acceptance Criteria:**
- Given a table view, when the user applies a sort on a column, then records reorder asc/desc within the current logical table, cycling to unsorted `created_at` order on the third activation (FR10).
- Given a table view, when the user applies one or more filters, then only rows matching ALL active filters show, identically in the desktop table and mobile cards (FR10).
- Given an active filter matching nothing, then an accessible translated "No records found" empty state shows (distinct from empty-table, never an error) with a control to clear filters.
- Given filter/sort is available, then its controls are keyboard-operable, ≥48×48px on touch, EN/FR-translated, and relation/hidden fields are never offered as targets.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (2026-09-26) — blind-hunter, edge-case-hunter, verification-gap:

**Patched:**
- **low → patch** — Accessibility label keys authored but never wired (blind BH1/BH2). `sortUnsorted` and `filterLabel` are defined in en/fr but referenced nowhere; the desktop header sort `<button>` has no `aria-label`, so its accessible name is only the field label with no indication it is a sort control or its current direction. Verified in `RecordsView.tsx` (header button) and `RecordsToolbar.tsx` (no filter-group label). Fixed: wire `sortUnsorted`/`sortAscending`/`sortDescending` into the header button `aria-label` by state, and use `filterLabel` as the filter controls' group `aria-label`; no dead keys remain.

**Deferred (see deferred-work.md):**
- **low → defer** — `datetime` `on` (and mixed date/datetime boundary) precision depends on the stored value's granularity (blind BH7, edge EC1/EC2, filter-sort.ts:868-889/800-807). App-entered datetime uses minute-precision `datetime-local` for both the cell and the filter value, so `on` matches; only full-ISO values with seconds/tz (not produced by the app until spreadsheet import, Epic 4) would fail to match. Real but latent; the clean fix (day/minute bucketing) changes semantics with no spec claim on granularity, and ties to the pre-existing datetime string-handling limitation from 3.2/3.3.

**Rejected:**
- **false** — Direction-toggle `aria-label` is contradictory while disabled (blind BH4). Refuted: when `!sort` the button is disabled and `sortAriaLabel` resolves to `sortToggleAria` ("Change sort direction"); the "clear sorting" wording only applies when a desc sort is active and the button is enabled. No contradiction. The "cannot jump straight to descending" part is the intended asc→desc→off cycle, not a defect.
- **false** — Mobile cards have no sort affordance / desktop-mobile parity broken (blind BH3). Refuted: `RecordsToolbar` (sort Select + direction toggle) renders in the shared region above both the `md:block` table and `md:hidden` cards, so mobile sorts via the toolbar — the spec's explicit design (cards have no headers). Header sort buttons are a desktop-only enhancement; parity of the sorted result holds via the single `visibleRows`.
- **false** — `boolean` filter silently treats non-`'true'` strings as false (edge EC3). Refuted: `AddFilterPopover.canApply` gates boolean to exactly `"true"`/`"false"` and the value Select offers only those two; a garbage boolean value is unreachable via the UI.
- **false** — `applyFilterSort` untested for `datetime`/`phone`/`email` and reversed-bounds `between` (blind BH6). Refuted: `datetime` shares the identical `type === "date" || type === "datetime"` branch already exercised by the `date` tests; reversed `between` bounds are tested in `matchesFilter` (currency). The verification-gap layer independently found no coverage gap — every reachable deterministic branch is asserted.
- **low → reject** — Filter chips render the raw entered value, not `formatCell`'d (blind BH5). The chip reflects exactly what the user typed into the filter input, which is a reasonable representation; formatting it would require threading `cellStrings` + per-type formatting branches into the toolbar for a cosmetic gain — more than a direct fix for a negligible everyday issue.
- **low → reject** — `filter-sort.ts` docblock claims coercion "mirrors `field-input.ts`" but there is no shared helper or drift test (blind, uncounted note). Maintainability observation only; the fix (extract a shared module or add a cross-reference test) adds surface for no user-facing harm, and the two coercion sites are small and independently tested.

Verification-gap layer: no verification gaps found (deterministic behavior fully asserted by `filter-sort.test.ts`, which runs in the normal `vitest run` path; untested surface is exclusively interactive DOM, Playwright-verified per the 3.1–3.3 precedent).

## Design Notes

- Build the toolbar, header sort affordances, and filtered-empty state with the `/web-uiux-architect` skill: CSS-first motion (no Framer Motion for hover/active/focus), shadcn `Select`/`Popover`/`Button`, Lucide icons, `size-*` + 8pt spacing, dark-mode variants, `focus-visible:ring-2`. Keep parity with 3.1–3.3 tokens.
- One flex-wrap toolbar (`flex flex-wrap gap-2`) above both presentations governs table and cards. Active filters render as removable chips; sort shows current field + direction. Desktop `TableHead` becomes a full-width `<button>` (≥48px tall, `aria-sort` on the `<th>`); mobile uses the toolbar sort control since cards have no headers.
- Read/write seam stays intact: `applyFilterSort` transforms only the rendered array, never the cache. Edits/adds/deletes flow through the existing hooks + query key; after settle+invalidate the refetched rows re-flow through `applyFilterSort`, so a no-longer-matching row simply drops on the next render.

## Verification

**Commands:**
- `npm run lint` -- expected: passes, incl. the i18n/no-hardcoded-strings gate.
- `npx tsc --noEmit` -- expected: no new type errors (pre-existing `api/claim` typed-route build blocker is logged in deferred-work; `next dev` runs).
- `npx vitest run` -- expected: all pass, incl. the new `filter-sort.test.ts`.

**Manual checks:**
- Signed-in member on a populated table: sort a column (asc→desc→clear), apply one then multiple filters, confirm identical results on desktop table and mobile cards; a no-match filter shows the translated "No records found" state with Clear-filters; switching tables resets filter/sort. EN/FR toggle renders all new strings. Touch targets ≥48×48px.
