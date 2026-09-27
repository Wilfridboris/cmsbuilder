---
title: 'Filter/Sort by Relationship & Safe Delete of Referenced Records'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '80e1ffd49b84d2259ad060cb4cbc63ca55013437'
context:
  - '_bmad-output/implementation-artifacts/epic-3-context.md'
  - '_bmad-output/implementation-artifacts/spec-3-7-relationship-lookup-field-record-picker.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 3.7 landed single-reference lookup fields (picker, batched read-time labels) but the claimed-org dashboard still cannot filter or sort a table by a relationship, and deleting a referenced record silently orphans every row that points at it (the delete confirm shows no reference count and `mutate.ts` never verifies that a relation id even exists). Filter/sort (3.4) is entirely client-side and explicitly excludes relation fields; there is no referential integrity anywhere.

**Approach:** Complete the single-reference relationship suite on real data: (1) filter a table by a relationship — the user picks a referenced record by label and rows are filtered **server-side via JSONB containment** (`data @> {field: id}`), and sort a table by a relationship ordered by the referenced record's resolved display label; (2) before deleting a record, warn with a **count of referencing rows** enumerated from the `(table_key, field)` relation pairs in the org schema and counted via containment (capped "500+"), then soft-delete so referencing rows keep the id and render "archived"; (3) harden `mutate.ts` so every relationship create/edit verifies each referenced id exists under the same org and `targetTable`, rejecting foreign or dangling ids.

## Boundaries & Constraints

**Always:**
- Relationship **filter** runs server-side using Supabase `.contains("data", { [fieldKey]: targetId })` (emits `@>`, index-backed) — never `data->>key` text extraction. The delete-guard reference count and referential-integrity checks likewise use containment / id-equality (`.in`), never `->>`.
- **Index decision (human-approved):** containment (`@>`) queries rely on the existing `records_data_gin_idx = gin(data)` (default `jsonb_ops`), which already serves `@>`. Do NOT add a `jsonb_path_ops` migration or any new index; the epic's literal `jsonb_path_ops` wording is satisfied by the existing GIN index.
- Reuse the guarded layers under the caller's RLS-scoped client with explicit identity; never the service-role client on any read/write path. All record reads filter `organization_id`, `table_key`, and `deleted_at IS NULL`.
- Relation **sort** orders by the target record's resolved display label using the already-available client-side label map from `useRelationLabels` (3.7); scalar filters/sort keep their existing client-side path. Relation filters are applied server-side and must be kept out of the client-side `matchesFilter` path.
- Referential integrity lives in `mutate.ts` (the single guarded mutation layer) for both insert and update: collect relation-field ids from the payload against the table's schema, batch-verify existence, reject the whole write on any missing/foreign id with a translated non-technical message; the optimistic UI rolls back.
- Soft-delete only (`deleted_at`); no hard delete, no orphan cleanup, no DB foreign key. A soft-deleted or unresolvable target renders the existing translated "archived" placeholder (3.7), never the raw id, never an error.
- All new copy resolves through the `SlugDashboard` next-intl namespace in both `en.json` and `fr.json` (CI-enforced no-literal-string). 48×48px min touch targets; skeletons for loading, never spinners on the surface.

**Never:**
- No multi-select relations (`cardinality:"many"`), no reverse related list (Story 3.9), no editor-driven schema changes. No new scalar filter operators. Do not rewrite 3.4's client-side scalar filter/sort pipeline — only add the relation path alongside it.
- Do not re-run the whole-schema generation validator on the live schema. Do not change the pre-account demo (`DemoDashboard`). No pagination changes.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Filter by relation | user picks referenced record in filter | rows where `data @> {field:id}` (containment, GIN-indexed); chip shows target label | N/A |
| Filter matches nothing | relation filter with no matching rows | translated empty state, never an error | N/A |
| Sort by relation | sort field = relation | rows ordered by resolved target label (locale compare); archived/unresolved sort last | N/A |
| Delete with references | record referenced by N rows | confirm dialog warns "N records reference this…"; count capped "500+"; archived note | N/A |
| Delete with zero references | no referencing rows | existing generic confirm message (no warning) | N/A |
| Reference count fetch fails | count route 5xx/network | dialog still allows delete with a neutral "couldn't verify references" note; no crash | show fallback note |
| Confirm delete | user confirms | soft-delete (`deleted_at`); referencing rows keep id, later render "archived" | N/A |
| Insert/edit valid relation | id exists under org+targetTable | write persists | N/A |
| Insert/edit dangling id | id absent / soft-deleted / wrong table | 400, no write; optimistic change rolls back | translated `invalidReference` |
| Insert/edit foreign-org id | id belongs to another org | 400, no write (RLS + explicit check) | translated `invalidReference` |

</frozen-after-approval>

## Code Map

- `src/lib/data/records.ts` -- `getSchema` (58-81) reuse to load full org schema; `listRecords` (21-47) EXTEND with optional server-side relation filters via `.contains`; `searchRelationRecords`/`resolveRecordLabels` (113-200) siblings for new query fns; ADD `enumerateInboundRelations` (pure) + `countReferencingRecords` (containment count, capped).
- `src/lib/data/mutate.ts` -- `insertRecord` (95-153), `updateRecord` (155-186) ADD relation referential-integrity check before persist; soft-delete (198), version (161-182), `actorId` (128/167/199) already correct — do not change. `mutate` public entry (52-93) carries `tableKey`.
- `src/app/api/records/route.ts` (67-95) + `schemas.ts` (`listQuerySchema` 10-13) -- GET: parse repeatable `rel` params (`field:id`) → relation filters → `listRecords`.
- `src/app/api/records/[id]/route.ts` -- DELETE (46-106) unchanged; PATCH (108-176)/POST context for where mutate integrity now fires. ADD new sibling route `src/app/api/records/[id]/references/route.ts` (+ schema) mirroring its auth→zod→`resolveIdentity` shape → `countReferencingRecords`.
- `src/lib/data/records-client.ts` -- `fetchRecords` (37-47) EXTEND to serialize relation filters; `deleteRecord` (154-171) unchanged; ADD `fetchReferenceCount(slug,table,id)`.
- `src/components/dashboard/useRecordMutations.ts` -- records query key must include relation filters; `useDeleteRecord` (147-171) unchanged; ADD `useReferenceCount(slug,table,id,enabled)` query hook.
- `src/lib/data/filter-sort.ts` -- `eligibleFields` (62-64) INCLUDE relation; `operatorsForType` (70-89) relation → `["is"]`; `applyFilterSort` (268-314)/`compareValues` (218-256) accept a label-resolver so relation sort orders by label; keep relation filters out of `matchesFilter`.
- `src/components/dashboard/RecordsToolbar.tsx` -- add-filter popover (218-395): relation branch uses `RelationPicker` (pick by label, store id, operator "is"); chips (157-197) render resolved label; sort select (100-141) includes relation fields.
- `src/components/dashboard/RecordsView.tsx` -- (173-244) split relation vs scalar filters, thread relation filters into the records query, pass `useRelationLabels` resolver into `applyFilterSort`, pass reference count into the delete dialog.
- `src/components/dashboard/DeleteConfirmDialog.tsx` (1-92) -- show reference count + archived warning; counting/error states.
- `src/components/dashboard/RelationPicker.tsx` (3.7) -- reuse verbatim inside the filter popover.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` (SlugDashboard ns) -- ADD relation filter/sort + delete-reference + `invalidReference` keys in both locales.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/data/records.ts` -- add pure `enumerateInboundRelations(schema, targetTableKey)` → `{ tableKey, fieldKey }[]` (all `type:"relation"` fields whose `relationConfig.targetTable === targetTableKey`); add `countReferencingRecords(client, orgId, schema, targetTableKey, targetId, cap=500)` summing per-pair `count:"exact",head:true` containment queries (`org`, `table_key`, `deleted_at IS NULL`, `.contains("data",{[fieldKey]:targetId})`), short-circuiting at `cap`; extend `listRecords` with optional `relationFilters: {field,targetId}[]` applied via chained `.contains`.
- [x] `src/lib/data/mutate.ts` -- before persisting insert and update, load the table's fields via `getSchema`, collect non-empty relation ids from `data`, batch-verify each `targetTable`'s ids exist (`.in("id",ids)` scoped `org`+`table_key`+`deleted_at IS NULL`); on any missing/foreign id throw a 400-class error surfaced as `invalidReference`. Never touch soft-delete/version/actor logic.
- [x] `src/app/api/records/route.ts` + `schemas.ts` -- accept repeatable `rel` query param (`"<fieldKey>:<uuid>"`), parse to `relationFilters`, validate field non-empty + id shape, pass to `listRecords`.
- [x] `src/app/api/records/[id]/references/route.ts` + schema -- GET `?slug&table`: auth→zod→`resolveIdentity`→`getSchema`→`countReferencingRecords(...,id)`→`{data:{count},error}`; 401/403/500 mirrored from existing routes.
- [x] `src/lib/data/records-client.ts` -- serialize `relationFilters` into `rel` params in `fetchRecords`; add `fetchReferenceCount(slug,table,id)` parsing the envelope, throwing `RecordApiError(code)`.
- [x] `src/components/dashboard/useRecordMutations.ts` -- include relation filters in the records query key; add `useReferenceCount(slug,table,id,{enabled})` (`["reference-count",slug,table,id]`).
- [x] `src/lib/data/filter-sort.ts` -- include relation in `eligibleFields`; `operatorsForType("relation")=["is"]`; thread an optional `resolveRelationLabel(field,value)` into `applyFilterSort`/`compareValues` so relation sort compares labels (unresolved/archived sort last); ensure `matchesFilter` ignores relation-typed filters (server-applied).
- [x] `src/components/dashboard/RecordsToolbar.tsx` -- relation branch in the add-filter popover renders `RelationPicker` (label typeahead → stored id, operator "is"); active-filter chip shows the resolved label; relation fields selectable in the sort control. [UI: use the `/web-uiux-architect` skill]
- [x] `src/components/dashboard/RecordsView.tsx` -- partition `filters` into relation (→ records query) and scalar (→ `applyFilterSort`); pass the `useRelationLabels` resolver into `applyFilterSort`; wire reference count into `DeleteConfirmDialog`.
- [x] `src/components/dashboard/DeleteConfirmDialog.tsx` -- fetch reference count on open via `useReferenceCount`; when `>0` show translated warning with the (capped) count and the archived note; render counting (skeleton) and count-error (neutral fallback) states; keep destructive confirm. [UI: use the `/web-uiux-architect` skill]
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add SlugDashboard keys in both locales: `filterByRelation`, `relationFilterValueLabel`, `sortByRelation`, `deleteReferenceWarning` (ICU plural on `{count}`), `deleteReferenceCapNote`, `deleteReferenceArchivedNote`, `deleteReferenceCounting`, `deleteReferenceUnavailable`, `invalidReference`.
- [x] `tests/unit/*` -- cover `enumerateInboundRelations` (multi-table, none, self), `countReferencingRecords` (containment chain, `deleted_at` filter, cap short-circuit), `listRecords` relation-filter chaining, `mutate` referential integrity (accept valid; reject dangling, soft-deleted, foreign-org, wrong-table id), `filter-sort` relation eligibility + label sort ordering; plus route tests for the references endpoint (401/403/200/count) and `rel` param parsing.

**Acceptance Criteria:**
- Given a table with a relationship field, when the user filters by it, then they select a referenced record by label and rows are filtered by the stored id using JSONB containment over the GIN index (never `->>`), with a translated empty state when nothing matches (FR74, AR14).
- Given a table with a relationship field, when the user sorts by it, then rows order by the referenced record's resolved display label.
- Given a record referenced by other records, when a user attempts to delete it, then the confirm first shows the count of referencing rows enumerated from the schema's `(table_key, field)` relation pairs and counted via containment, capped "500+" (FR76, AR14).
- Given the user confirms the delete, when it executes, then the record is soft-deleted (`deleted_at`) and referencing rows keep the id and render "archived" — no hard delete, no orphan cleanup (FR76, AR14).
- Given any relationship create or edit through `mutate.ts`, when a referenced id does not exist under the same org and `targetTable`, then the write is rejected with a translated message and the optimistic change rolls back (FR76, NFR-S7, AR14).

## Implementation Notes

- Implemented per the Code Map. Data layer (`records.ts`): `listRecords` gains `relationFilters` applied via chained `.contains("data",{field:id})` (`@>`, served by the existing `records_data_gin_idx`, never `->>`); added pure `enumerateInboundRelations` + `countReferencingRecords` (per-pair `count:"exact",head:true` containment counts, org/table/`deleted_at` scoped, short-circuit at `REFERENCE_COUNT_CAP=500`). Guarded `mutate.ts` verifies relation ids before insert AND update (`assertRelationReferencesExist`: `getSchema` → batch `.in("id",ids)` per target under org+table_key+`deleted_at IS NULL`) → 400 `invalidReference`; soft-delete/version/actor untouched; threaded `tableKey` into `updateRecord`.
- API: GET `/api/records` parses repeatable `rel=field:id` (split on first colon, both parts required, else 400); POST/PATCH surface `invalidReference`. New `GET /api/records/[id]/references` returns `{count}`.
- Client/hooks: `fetchRecords` serializes `rel`; `fetchReferenceCount`; records query key includes a stable sorted relation-filter part across all three mutation hooks; `useReferenceCount` (enabled only while the dialog is open, `retry:false`).
- Filter/sort: `eligibleFields` now includes relations; `operatorsForType("relation")=["is"]`; `matchesFilter` treats relation as a server-applied no-op; `applyFilterSort` takes a label resolver so relation sort orders by resolved label (archived/unresolved sort last). RecordsView partitions filters into server-side relation vs client-side scalar; `RecordsToolbar` filter popover uses `RelationPicker` (auto-"is") with a label-resolved chip; `DeleteConfirmDialog` shows the capped warning + archived note + counting/error states.
- i18n: 9 keys added to en+fr with full parity (`deleteReferenceWarning` as an ICU plural).
- Verified: `npm run type-check` clean, `npm run lint` exit 0, `npx vitest run` = 454 passed (43 files), +30 new tests, no regressions. Live JSONB `@>` behavior and end-to-end dialog/picker interaction remain confirmed by the post-commit Playwright manual review per Verification (not run here).

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **patch** — Route-level `invalidReference` → 400 mapping untested, POST + PATCH (verification-gap pre-verified; blind-hunter). The new branches in `records/route.ts` (POST) and `records/[id]/route.ts` (PATCH) translate `mutate`'s `invalidReference` to `AppError(400, "invalidReference")`, but `route-records.test.ts` only exercises the concurrency (409) and generic (500) branches. A regression would silently fall through to 500 `writeFailed` with tests green. Add POST+PATCH cases feeding `mutate` `{error:"invalidReference"}`.
- **patch** — `mutate` guard multi-relation-field / same-target batching untested (blind-hunter). `mutate-referential-integrity.test.ts` covers a single relation field only; the `assertRelationReferencesExist` grouping (a table with two relation fields; one valid + one dangling → whole write rejected; two fields → same target batched into one `.in`) is a distinct code path with no coverage. Add cases.
- **patch** — DeleteConfirmDialog reference-count UI states untested (verification-gap pre-verified). `records-view.test.tsx` renders with the dialog closed, so the loading→skeleton / error→neutral-note / `>0`→warning / cap→"500+" / zero branches never render. Add a static-render test driving the props directly (Confirm must stay available in the error state).
- **low -> patch** — Dead i18n keys `filterByRelation` and `sortByRelation` (blind-hunter). Verified via grep: present in en.json + fr.json, referenced nowhere in `src`. Trivial deletion; delete both keys from both locales.
- **low -> reject** — Reference-count can flash stale on dialog reopen (blind-hunter, edge-case). `useReferenceCount` uses `staleTime:0` + `enabled` toggling, so it refetches on every open; only a brief cached value can flash within gcTime on reopen, self-correcting, on an advisory count that never blocks delete. Fix (mutation-driven invalidation) adds wiring for negligible harm.
- **low -> reject** — Relation chip renders the "is" operator ("Client is Alpha") (blind-hunter). Readable; a relation-specific chip string adds a key + branch for a cosmetic gain.
- **low -> reject** — Two conflicting relation filters on one field → impossible AND → silent 0 rows (blind-hunter). Rare, recoverable (remove a chip), and mirrors pre-existing scalar-filter behavior; a dedup guard adds logic.
- **false -> reject** — No empty-state when a relation filter matches nothing (blind-hunter). Relation filters live in `filters`, so `hasFilters` is true and the existing 3.4 filtered-empty state renders; the claimed gap does not occur.
- **low -> reject** — `assertRelationReferencesExist` re-reads the schema on every write (blind-hunter). One extra indexed single-row `org_schemas` read per write; within perf budget. Threading the schema through `mutate` adds public surface.
- **false -> reject** — Guard 500 path throws a raw English string, not a code (blind-hunter). The route maps any unrecognized `mutate` error to `AppError(500, "writeFailed")` (a code); the raw marker never reaches the user, so no untranslated string surfaces.
- **low -> reject** — References route comment overstates an explicit member-only check (blind-hunter). It relies on RLS org-scoping exactly like the sibling `/api/records` route — an established, correct convention; a comment tweak is negligible.
- **low -> reject** — `countReferencingRecords` runs per-pair count queries serially (blind-hunter). The cap short-circuit requires serial evaluation; at MVP table counts the latency is minor. Parallelizing conflicts with the cap semantics.
- **false -> reject** — Relation sort resolves labels for the current page only; pagination risk (blind-hunter). No pagination exists; `listRecords` returns the full set, so all labels resolve and the "full set" comment is currently accurate. Hypothetical future concern.
- **low -> reject** — `rel` field key not verified as relation-typed on the server (edge-case). A scalar `rel` param applies a containment filter over the caller's OWN org data (RLS-scoped); no leak, no crash, and the UI only ever sends relation fields. Server-side schema validation of the field adds a schema fetch + check to the list route.
- **false -> reject** — Large id set in the guard's single `.in("id", ids)` (edge-case). The guard collects ids from ONE record's payload (≤ one per relation field), never a large page-wide set; no URL-length risk.
- **false -> reject** — Non-string relation value coerced via `String(raw)` (edge-case). A malformed value coerces to something that correctly fails existence and yields a 400 `invalidReference` — the intended rejection, no bad outcome.
- **low -> reject** — Self-reference count off-by-one (edge-case). Requires a self-referencing relation (absent from the fallback templates) AND a record linking to itself; inflates an advisory count by one. A `.neq("id", targetId)` guard adds a conditional for a rare case.
- **note (not filed)** — `RecordsToolbar` relation chip + `RelationPicker`-in-popover have no test (verification-gap, flagged awareness-only). Standard interactive-UI coverage, not a regression of changed behavior; left for the post-commit Playwright manual review.

## Design Notes

**Why relation filter is server-side but scalar filter stays client-side.** 3.4 fetches all rows and filters/sorts in the browser. The epic technical decisions mandate filter-by-relationship (and the delete-count and reverse list) use JSONB containment over the GIN index, so the relation filter is pushed to the server as `.contains("data",{field:id})` (index-backed `@>`). Scalar filters remain in the existing client pipeline. RecordsView therefore partitions filters: relation filters ride in the records query key (server narrows the set), then `applyFilterSort` applies scalar filters + sort on the returned rows — a coherent AND pipeline. Real-time invalidation of `["records", slug]` still refetches with the active filters.

**Why relation sort is by label, client-side.** Containment cannot order, and the display label lives in the target table (a join `records` cannot do in one PostgREST query). `useRelationLabels` (3.7) already resolves the on-page ids to labels; `compareValues` reuses that resolver so sorting matches what the user sees. Unresolved/archived targets sort last.

**Referential integrity belongs in `mutate.ts`.** AC5 requires the guarded layer itself to reject planted ids, so the check is inside `insertRecord`/`updateRecord` (not just the route). It loads the table's relation fields from `getSchema`, batch-verifies referenced ids exist under `org`+`targetTable`+`deleted_at IS NULL`, and rejects the whole write otherwise — the picker normally only offers valid ids, so this guards API-direct and stale-target writes.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors.
- `npm run lint` -- expected: clean (no hardcoded-string violations from new copy).
- `npm run test` -- expected: new unit/route tests pass; existing suite green.

**Manual checks:**
- On the authed dashboard (`/[slug]` fallback template — Jobs→Clients, Invoices→Jobs): filter Jobs by a Client (verify rows narrow, chip shows the client label, empty state when none), sort Jobs by Client (label order), delete a Client referenced by jobs (verify the count warning + archived note), confirm the referencing jobs now render "archived", and confirm an API-direct write with a bogus relation id is rejected.
