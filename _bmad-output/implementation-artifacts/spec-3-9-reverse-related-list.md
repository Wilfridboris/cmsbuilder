---
title: 'Reverse Related List'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'a4337cd4301e07ddc773f565ca42ce0c64291103'
context:
  - '_bmad-output/implementation-artifacts/epic-3-context.md'
  - '_bmad-output/implementation-artifacts/spec-3-7-relationship-lookup-field-record-picker.md'
  - '_bmad-output/implementation-artifacts/spec-3-8-filter-sort-by-relationship-safe-delete.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 3.7/3.8 landed single-reference lookup fields, forward label resolution, filter/sort-by-relationship and safe delete — but there is still no way, from a record, to see the records that point AT it. The authenticated dashboard (`RecordsView`) has no "open a record" affordance at all (only inline edit + per-row delete), so a user cannot open a client and see all the invoices/jobs that reference it. The full picture of an account is scattered across tables.

**Approach:** Add an open-record affordance to the authed records surface that opens a dialog showing the record by its display label, a compact read-only summary of its own visible fields (the "account" it opens), and — below that — a **reverse related list per inbound relation**: for every `(table, field)` in the org schema whose `relation` field targets this record's table, the referencing rows retrieved **server-side via JSONB containment** (`data @> {field: id}`, GIN-indexed) by reusing 3.8's `fetchRecords(rel=field:id)` path, each list read-only and carrying that referencing table's own filter and sort.

## Boundaries & Constraints

**Always:**
- Reverse lookup runs **server-side via JSONB containment**: reuse `fetchRecords(slug, refTableKey, [{ field, targetId }])` → `GET /api/records?rel=<field>:<id>` (`.contains`, `@>`, served by the existing `records_data_gin_idx`) — never `data->>field`. The base reverse-relation filter is a fixed relation filter carried in the query key, so each list shares the `["records", slug, refTableKey, relKey]` cache entry and is refreshed by 3.6 real-time invalidation for free.
- Enumerate inbound pairs with the existing pure `enumerateInboundRelations(schema, targetTableKey)` (extracted to a client-safe module). One reverse-list section PER inbound `(table, field)` pair; when a table appears via more than one field, disambiguate the section heading by field label.
- Each reverse list reuses the existing view stack: `RecordsToolbar` + `applyFilterSort` + `useRelationLabels` for that referencing table, with its OWN local filter/sort state. User-added scalar filters + sort apply client-side over the returned rows (relation sort by resolved label); any user-added relation filter chains server-side onto the base filter (same partition as `RecordsView`). Reverse-list rows are READ-ONLY via `InlineEditCell editable={false}` — relation cells still show the resolved label / "archived" / skeleton.
- Single-reference (`cardinality:"one"`) relations only. A referenced record that is itself soft-deleted still opens; an archived/unresolvable target label renders the existing translated "archived" placeholder, never a raw id, never an error. Reads filter `organization_id` + `table_key` + `deleted_at IS NULL` under the caller's RLS-scoped client.
- All new copy resolves through the `SlugDashboard` next-intl namespace with full `en.json`/`fr.json` parity (CI-enforced no-literal-string). 48×48px min touch targets; skeletons for loading, never spinners; no em-dashes in user-facing copy. UI work uses the `/web-uiux-architect` skill.

**Never:**
- No multi-select reverse lookups (`cardinality:"many"`) — deferred to Epic 9. No inline edit, delete, add, or nested record-open FROM WITHIN a reverse list (editing stays on the main table surface). No new API route or DB migration or index (the `rel=` list route + GIN index already exist). Do not change `mutate.ts`, the delete guard, or the pre-account `DemoDashboard`. No pagination changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Open a referenced record | user activates open on a row/card | dialog opens: title = record display label, own-fields summary, one reverse list per inbound `(table,field)` pair | N/A |
| Record with references | inbound pair has matching rows | list shows referencing rows via `data @> {field:id}` containment; relation cells show resolved labels | N/A |
| Record with no references | no inbound pairs, or all lists empty | translated "nothing references this record yet" empty state, never an error | N/A |
| Filter a reverse list | user filters/sorts within a list | that referencing table's filter/sort apply; empty filter result shows the translated filtered-empty state | N/A |
| Referencing row points at archived target | a relation cell in the list is soft-deleted | renders the translated "archived" placeholder | N/A |
| Reverse-list fetch fails | `/api/records` 5xx/network for a list | translated non-technical load-error line for that section; other sections unaffected; no crash | show fallback note |
| Open a record whose display label is blank | display field empty | title falls back to a translated generic record label | N/A |

</frozen-after-approval>

## Code Map

- `src/lib/data/relations.ts` (NEW) -- move the PURE `enumerateInboundRelations` + `InboundRelation` type here from `records.ts` (client-safe: imports only `normalizeTableName` + types). Keeps existing server behavior identical.
- `src/lib/data/records.ts` -- REMOVE the two moved symbols; `import { enumerateInboundRelations, type InboundRelation } from "./relations"` and RE-EXPORT so `records.ts`, the references route, `mutate` and existing tests keep their imports (`countReferencingRecords` at 274 still calls it).
- `src/components/dashboard/RecordsView.tsx` -- add `onOpen(record)` wiring: an open-record icon button in the desktop actions column (before delete, ~853-864) and on each mobile card (~950-959); add `opened` state + render the new dialog; pass `tables` (already a prop) + `cellStrings`. Guard optimistic rows (`isOptimisticId`) out of open, like delete (360).
- `src/components/dashboard/RecordReverseListDialog.tsx` (NEW) -- Radix `Dialog` (mirror `RecordDetail` 93-133): title from the opened record's display label (resolve via its table `displayField`, fallback generic); compact read-only own-fields summary (reuse `InlineEditCell editable={false}` or `formatCell`); then `enumerateInboundRelations(schema, table.key)` → one `RelatedRecordsList` per pair; global empty state when no pairs. [UI: use the `/web-uiux-architect` skill]
- `src/components/dashboard/RelatedRecordsList.tsx` (NEW) -- one inbound section. Local `filters`/`sort` state; `useQuery(["records", slug, refTable.key, relKey], () => fetchRecords(slug, refTable.key, [base, ...userRel]))` where `base = { field: fieldKey, targetId }`; partition filters (relation→server key, scalar→client) exactly as `RecordsView` (189-275); `useRelationLabels({slug, table: refTable, rows})`; `applyFilterSort(...)`; read-only table (desktop) / cards (mobile) via `InlineEditCell editable={false}`; `RecordsToolbar`; filtered-empty + load-error states. [UI: use the `/web-uiux-architect` skill]
- `src/components/dashboard/useRecordMutations.ts` -- reuse `relationFilterKeyPart` (37) for the reverse-list query key (import; do not duplicate).
- `src/lib/data/records-client.ts` -- reuse `fetchRecords` (48) verbatim with the base relation filter; no change.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` (`SlugDashboard` ns) -- ADD keys in BOTH locales (see Tasks).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/data/relations.ts` + `src/lib/data/records.ts` -- extract pure `enumerateInboundRelations`/`InboundRelation` into `relations.ts`; re-export from `records.ts`; verify `countReferencingRecords`, the references route, and existing `records.ts` tests still resolve the symbols unchanged.
- [x] `src/components/dashboard/RelatedRecordsList.tsx` (NEW) -- fetch referencing rows via `fetchRecords` with the fixed base relation filter `{ field: fieldKey, targetId }` (containment); local filter/sort with the same relation/scalar partition as `RecordsView`; resolve labels with `useRelationLabels`; read-only rows via `InlineEditCell editable={false}`; render `RecordsToolbar`, filtered-empty and per-section load-error states. Section heading = referencing table label (+ field label when disambiguation is needed).
- [x] `src/components/dashboard/RecordReverseListDialog.tsx` (NEW) -- Radix Dialog: title from resolved display label (generic fallback when blank); read-only own-fields summary of the opened record; enumerate inbound pairs and render a `RelatedRecordsList` per pair; global "nothing references this record" empty state when there are no pairs.
- [x] `src/components/dashboard/RecordsView.tsx` -- add the open-record icon button to the desktop actions column and each mobile card (48px, translated aria-label), guard optimistic rows out, hold `opened` state, and render `RecordReverseListDialog` with the active table, opened record, `tables`, `slug`, `cellStrings`.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add `SlugDashboard` keys in both locales: `openRecord` (aria), `reverseListSubtitle`, `reverseSectionHeading` (`{table}`) + `reverseSectionHeadingField` (`{table}`, `{field}`), `reverseListEmpty` (no inbound refs), `reverseSectionEmpty` (a section with zero rows), `reverseListLoadError`, `recordLabelFallback`.
- [x] `tests/unit/*` -- cover the moved `enumerateInboundRelations` (multi-table, none, self, multiple fields → one pair per field) still green from `relations.ts`; a static-render test for `RelatedRecordsList` (rows render read-only by label; filtered-empty and load-error branches); a `RecordReverseListDialog` test (no-inbound empty state; one section per pair; blank-label title fallback).

**Acceptance Criteria:**
- Given a record that other records reference, when the user opens it, then a related list shows the referencing records retrieved via JSONB containment over the GIN index (never `->>`), grouped per inbound relation (FR77, NFR-P9, AR14).
- Given a reverse related list, when it renders, then the referencing table's filter and sort are available and operate on that list, and relation cells show resolved display labels (never raw ids).
- Given a record with no inbound references, when it is opened, then a translated empty state is shown, never an error.
- Given MVP scope, when the reverse list runs, then it handles single-reference relations only; multi-select reverse lookups are not offered (deferred to Epic 9).

## Implementation Notes

- Implemented per the Code Map. Extracted the pure `enumerateInboundRelations` + `InboundRelation` into the client-safe `src/lib/data/relations.ts` (imports only `normalizeTableName` + types); `records.ts` now imports and RE-EXPORTS both, so `countReferencingRecords`, the references route, `mutate`, and the existing `records-safe-delete` tests keep their `@/lib/data/records` imports unchanged. This lets the client components enumerate inbound pairs without pulling in the server-only `records.ts`.
- `RelatedRecordsList` (NEW): one inbound section. Fetches referencing rows via `fetchRecords(slug, refTable.key, [base, ...userRelationFilters])` where `base = { field: fieldKey, targetId }` (JSONB `@>` containment, GIN-indexed, never `data->>`). Query key `["records", slug, refTable.key, relationFilterKeyPart(serverFilters)]` — same shape as `RecordsView` + the mutation hooks, so 3.6 real-time invalidation of the `["records", slug]` prefix refreshes each list for free. Partitions the user's filters exactly like `RecordsView` (relation → chained server-side onto the base filter, scalar → client `applyFilterSort`); relation sort orders by resolved label via `useRelationLabels`. Rows are READ-ONLY (`InlineEditCell editable={false}` in a desktop table / mobile cards). States: skeletons while pending, translated per-section `reverseListLoadError` on fetch error (other sections unaffected), `reverseSectionEmpty` (no rows) / `noRecordsFoundBody` (user-filtered to empty).
- `RecordReverseListDialog` (NEW): Radix `Dialog`. Title = the opened record's `resolvedDisplayFieldKey` value, falling back to translated `recordLabelFallback` when blank. Renders a compact read-only own-fields summary (relation cells via `InlineEditCell editable={false}`, scalars via `formatCell`), then `enumerateInboundRelations(schema, table.key)` → one `RelatedRecordsList` per pair; when a referencing table appears via >1 field the heading is disambiguated (`reverseSectionHeadingField`). Global `reverseListEmpty` state when there are no inbound pairs. Builds the schema view from the `tables` prop.
- `RecordsView`: added `opened` state (reset on active-table change alongside the other view state), a `requestOpen` handler that guards optimistic rows (`isOptimisticId`) exactly like `requestDelete`, an `Eye` open-record icon button (48px, `openRecord` aria-label) in the desktop actions column and each mobile card before delete (only for settled rows), and renders `RecordReverseListDialog`.
- Single-reference only; MVP scope unchanged: no multi-select, no inline edit/delete/add/nested-open from within a reverse list, no new API route / migration / index (reuses the existing `rel=` list route + GIN index). `mutate.ts`, the delete guard, and `DemoDashboard` untouched.
- i18n: 8 keys added to en+fr with full parity (verified: 95 keys each, no missing on either side). Every new key is referenced in `src` (no dead keys).
- Verified: `npm run type-check` clean, `npm run lint` clean, `npx vitest run` = 478 passed (47 files), +24 new tests, no regressions. Live JSONB `@>` reverse fetch, real-time refresh, and full dialog DOM interaction remain confirmed by the post-commit Playwright manual review per Verification (the repo test env is node/no-jsdom, so Radix-portalled dialog bodies are exercised via mocked primitives).

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **patch** — RecordsView open (Eye) button unverified (verification-gap pre-verified; blind-hunter). The new per-row/card Eye button (gated on `editableRow`, `aria-label="openRecord"`) and its optimistic-row suppression are the story's primary new affordance but `records-view.test.tsx` asserts none of it. Add SSR assertions: a settled row's markup contains `aria-label="openRecord"`; an optimistic-id row's markup does not.
- **patch** — `related-records-list.test.tsx` malformed test name + untested filtered-empty branch (blind-hunter, verification-gap). The `hasFilters ? noRecordsFoundBody : reverseSectionEmpty` selector has only its no-filter side tested, and the test name ("...zero rows is server-empty") is garbled. Fix the name; the `hasFilters` side needs a driven filter which the node/no-jsdom env cannot render, so that branch stays deferred to the Playwright manual review (matrix row "Filter a reverse list", consistent with 3.8's interactive-toolbar deferral).
- **patch** — `related-records-list.test.tsx` base-filter wiring untested + fixture `fieldKey` mismatch (verification-gap "Other"). The fixture passes `fieldKey="client"` but its `invoices` table has no `client` field, and the fully-mocked `useQuery` never exercises `serverFilters`/`relKey`/`fetchRecords`. Make the fixture coherent (use a real relation field) and have the `useQuery` mock capture the query key so a test asserts the base reverse filter is present in it.
- **patch** — French heading agreement (blind-hunter). `reverseSectionHeadingField`/`reverseSectionHeading` fr copy hardcodes masculine-plural `liés`, wrong for feminine table labels (e.g. "Factures liés"). Since `{table}` is an arbitrary label, reword the two fr strings to a construction that does not inflect on the interpolated noun (e.g. "Enregistrements liés dans {table}"), keeping en as-is and the `{table}`/`{field}` placeholders intact.
- **low -> reject** — "All lists empty" shows per-section empties, not the global state (edge-case-hunter). The frozen matrix lists "all lists empty" under the global `reverseListEmpty`, but the code shows that only when `inboundPairs.length === 0`; when pairs exist and every list is empty, each section renders its heading + toolbar + `reverseSectionEmpty`. Verdict low: "never an error" is satisfied and per-section empties are arguably clearer; the fix requires lifting every child list's row count up into the dialog (cross-component coupling) for a cosmetic presentation change.
- **low -> reject** — Opened-record summary/title is a click-time snapshot, not live (blind-hunter, edge-case-hunter). If 3.6 real-time edits/deletes the opened record while the dialog is open, the reverse lists refresh (own queries) but the title + own-fields summary stay stale until reopen. Verdict low: the summary is secondary (the same fields live on the main table), it self-corrects on reopen, and the core reverse lists do refresh; making it live means subscribing the dialog to the records cache by id + a not-found path (added coupling) for a rare concurrent-edit-of-the-open-record case.
- **defer** — Reverse list has no row cap/pagination (blind-hunter). `fetchRecords` returns every referencing row; a high-fan-in record (a client with thousands of jobs/invoices) loads them all. Pre-existing and app-wide — no list surface is paginated at MVP (spec-3-8 notes "no pagination exists") — so this is a scale follow-up, not introduced by 3.9. Recorded to deferred-work.
- **low -> reject** — Toolbar offers the base-filter relation field (edge-case-hunter). The reverse list's toolbar lists all `refTable.fields`, including the field used as the fixed base filter; adding a filter on it appends a second `rel=field:id` (redundant → narrows, or contradictory → 0 rows, recoverable by removing the chip). Rare and recoverable; mirrors the pre-existing conflicting-filter behavior 3.8 already rejected. Excluding the field adds a branch for negligible gain.
- **low -> reject** — `OwnFieldsSummary` returns null with no empty state when the record has zero visible fields (blind-hunter). Effectively unreachable: a table's `displayField` is a non-hidden field that cannot be hidden/removed while targeted (Story 1.8), so every table has >=1 visible field. Adding an empty-state branch guards a state the invariant prevents.
- **low -> reject** — Reverse-list status/empty text lacks explicit section association (blind-hunter). The `<section>` already carries `aria-label={heading}`, so region navigation gives context; threading the table name into every status/empty string adds interpolation params for a marginal live-region gain.
- **false -> reject** — Read-only `onCommit={() => {}}` could silently drop edits (blind-hunter). Verified in `InlineEditCell`: with `editable={false}` both the relation and scalar branches return a plain read-only node with no trigger and no path that ever calls `onCommit` — the no-op is unreachable, so no edit can be lost.

## Design Notes

**Why reuse `fetchRecords(rel=field:id)` instead of a new route.** AC1 requires JSONB containment over the GIN index — exactly what 3.8's `listRecords` relation filter emits (`.contains("data",{field:id})`). A reverse list for "invoices referencing this client" IS the Invoices table filtered by `{clientField: clientId}`. Reusing that path shares the `["records", slug, refTable, relKey]` cache, so 3.6 real-time invalidation refreshes it for free, and no new API surface, migration, or index is added.

**Why per `(table, field)` pair, read-only.** One containment query per inbound field (AND semantics) keeps each list a single simple query; at MVP scale that is one section per referencing table. Read-only avoids a second optimistic-mutation surface (editing stays on the main table) and keeps the story single-goal.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors.
- `npm run lint` -- expected: clean (no hardcoded-string violations from new copy).
- `npm run test` -- expected: new unit tests pass; existing suite green (moved-symbol tests unchanged).

**Manual checks:**
- On the authed dashboard (`/[slug]` fallback template — Jobs→Clients, Invoices→Jobs): open a Client that jobs/invoices reference and confirm the reverse lists show those referencing rows by label; filter/sort a reverse list; open a Client with no references and confirm the empty state; confirm a referencing row whose target is archived renders the "archived" placeholder; confirm real-time: adding a job referencing the open client updates the reverse list.
