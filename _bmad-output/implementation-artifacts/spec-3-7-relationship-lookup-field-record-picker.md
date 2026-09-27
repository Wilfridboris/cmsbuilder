---
title: 'Relationship Lookup Field & Record Picker'
type: 'feature'
created: '2026-09-27'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'aaf713d19fa4a6c2d09b170fe1631f0df3272a35'
context:
  - '_bmad-output/implementation-artifacts/epic-3-context.md'
  - '_bmad-output/implementation-artifacts/spec-1-8-generated-relationships-display-fields.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 1.8 landed the relationship *data model* (a `relation` field type, `relationConfig.targetTable`, per-table `displayField`, read-time label resolution over an in-session array) but the claimed-org dashboard has no way to *create* a lookup field, no picker to *set* one, and no batched label display for real data. Team members still type client/job names by hand, causing misspellings and orphaned references.

**Approach:** Deliver the single-reference lookup field end to end on the claimed org's real data: (1) an Admin-only "Add relationship field" control that adds a `relation` field targeting another table in the same org, validated by a focused relation-field validator and persisted through the guarded schema-write layer; (2) a searchable, server-side-typeahead record picker (built from the installed `radix-ui` Popover, no new dependency) used in the add-record form and inline edit, showing candidates by the target table's `displayField` label; (3) batched read-time label display in the desktop table and mobile cards via a single `id IN (...)` lookup per referenced table per rendered page, never the raw id, always reflecting the target's current value.

## Boundaries & Constraints

**Always:**
- Reuse the guarded layers under the caller's RLS-scoped client with explicit identity: record writes through `mutate.ts`, schema writes through `schema-mutate.ts`. Never the service-role client on any read/write path (admin client only inside `requireAdmin` to read `org_members`, as `/api/schema/columns` does).
- Admin-only schema writes: server `requireAdmin` + `membership.slug === slug` is the real boundary; the UI gate (`role === "admin"`) is UX only. Mirror `/api/schema/columns` exactly.
- Relation values store the target record's **id** inside JSONB `data`; labels are resolved at read time via the target table's `resolvedDisplayFieldKey`, batched `id IN (...)` per page, never copied into the referencing row, never per-row queries.
- Every referenced-table read (search + label resolution) filters `organization_id`, `table_key`, and `deleted_at IS NULL`; a soft-deleted or unresolvable target renders a translated "archived/unavailable" placeholder, never the raw id, never an error.
- All new copy resolves through the `SlugDashboard` next-intl namespace in both `en.json` and `fr.json` (ESLint `i18next/no-literal-string` is CI-enforced). 48×48px min touch targets (`min-h-12`/`size-12`); skeletons for loading, never spinners on the surface.
- Real-time (3.6) and mutation invalidation must also refresh resolved labels so AC4 holds.

**Never:**
- Do NOT re-run the whole-schema generation validator (`validateGeneratedSchema`) on the stored/live schema: it strips `hidden` (3.5) and other post-generation metadata. Use a focused, targeted transform + validation, mirroring 3.5.
- No multi-select relations (`cardinality: "many"`) — force `"one"`; keep the `growth`-phase gate untouched. No filter/sort-by-relationship, no delete reference-count guard, no reverse related list (Stories 3.8/3.9). No general "add field" UI for scalar types — this control adds relation fields only. No DB migration, no DDL, no foreign key. Do not change the relation display in the pre-account demo (`DemoDashboard`).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Typeahead match | picker open, query "map" over 50k-row target | ≤N (e.g. 20) candidates by `displayField` label, bounded LIMIT, p95 <500ms | N/A |
| Typeahead no match | query matches nothing | translated "no results" empty state | N/A |
| Typeahead empty target | target table has no rows | translated empty state; picker still clearable | N/A |
| Typeahead request fails | search route 5xx/network | translated inline error inside popover; no value change | show `pickerError`, keep prior value |
| Select candidate | user picks a row | draft/cell value = target id; picker shows that row's label | N/A |
| Clear value | user clears optional relation | value omitted (add) / set null (edit); label cleared | N/A |
| Label display | page has relation values | one `id IN (...)` per target table → id→label map; cells show label | N/A |
| Label unresolvable | target id soft-deleted or missing | translated "archived" placeholder | never raw id, never throw |
| Target label changes | referenced row edited | referencing view re-renders updated label after invalidation | N/A |
| Admin add relation field | valid `{label, targetTable}` in same org | `relation` field appended (`cardinality:"one"`), persisted; `router.refresh()` shows it | N/A |
| Add field bad target | targetTable not in org schema | 400, no write | translated `addFieldFailed` |
| Add field dup/blocked key | derived key collides / reserved / blocked verb | 400, no write | translated `addFieldFailed` |
| Add field as Member | non-admin caller | 403, no write | translated `addFieldForbidden` |
| Add field cross-org admin | admin of a different org | 403, no write | translated `addFieldForbidden` |

</frozen-after-approval>

## Code Map

- `src/types/db.ts` (11-50) -- `FieldDefinition` (`type:"relation"`, `relationConfig{targetTable,cardinality}`), `TableDefinition.displayField`, `RecordData`. No change expected.
- `src/lib/schema/relations.ts` (28-50, 172-210) -- `displayFieldKey`, `resolvedDisplayFieldKey` (reuse to pick the target's label field); `buildRelationResolver` is demo-only (in-session) — do NOT reuse for the authed batched path.
- `src/lib/schema/validator.ts` (156-313) -- existing generation relation gate; ADD a focused `validateRelationField` export reusing `normalizeTableName`, `keyIsBlockedVerb`, `RESERVED_KEYS`, and the target-exists check. Leave the generation path + `uiSourceAllowed`/`manyAllowed` gates unchanged.
- `src/lib/schema/overrides.ts` (93-140) -- pure transforms (`hideField`/`showField`); ADD `addRelationField` mirroring them.
- `src/lib/data/schema-mutate.ts` (45-93) -- guarded schema write (`setFieldVisibility`); ADD `addRelationField` guarded write (read schema → `validateRelationField` → `overrides.addRelationField` → write back under RLS).
- `src/lib/data/records.ts` (21-47) -- `listRecords`; ADD `searchRecords` (bounded ILIKE on `data->>displayField`, LIMIT) and `resolveRecordLabels` (`id IN (...)` batched), both RLS-scoped, `deleted_at IS NULL`, `{data,error}`.
- `src/app/api/schema/columns/route.ts` -- template for the new admin field route (session→zod→`requireAdmin`→`membership.slug===slug`→`resolveIdentity`→guarded layer).
- `src/app/api/records/route.ts` (46-95) -- `resolveIdentity` + envelope template for the two new GET routes.
- `src/lib/data/records-client.ts` (37-102) -- client fetch wrappers + `RecordApiError`; ADD `searchRelationRecords`, `fetchRelationLabels`.
- `src/lib/data/realtime.ts` (16-44) -- `invalidateOrgRecords` invalidates `["records", slug]`; EXTEND to also invalidate `["relation-labels", slug]`.
- `src/components/dashboard/RecordsView.tsx` (~104, ~415, 625-867) -- server-passed `role`, schema, records; toolbar (add `AddRelationFieldControl` beside `ColumnVisibilityControl` when admin); table/card cell render; wire label resolver into cells + `InlineEditCell`.
- `src/components/dashboard/AddRecordForm.tsx` (137-159) -- control-selection switch; ADD `relation` branch → `RelationPicker`.
- `src/components/dashboard/InlineEditCell.tsx` (75-154, 183) -- read-mode display + editor switch; ADD `relation` branch (editor → `RelationPicker`; read → resolved label / archived).
- `src/components/dashboard/ColumnVisibilityControl.tsx` -- pattern for the Admin popover + inline POST + `RecordApiError` handling.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` (SlugDashboard ns) -- ADD picker + add-field keys in both locales.
- `src/components/ui/{popover,input,button,label,skeleton}.tsx` -- existing primitives to compose the picker.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/schema/validator.ts` -- add exported `validateRelationField(schema, tableKey, { label, targetTable })` returning normalized `{ key, label, relationConfig:{ targetTable, cardinality:"one" } }` or a reject reason: target table exists & visible in schema; derived key is normalized, non-empty, unique in the table, not a blocked verb, not reserved; label non-empty. Reuse existing primitives; do not touch the generation gate.
- [x] `src/lib/schema/overrides.ts` -- add pure immutable `addRelationField(schema, tableKey, field)` that appends the sanitized relation field to the table's `fields` (input never mutated); no-op for unknown table.
- [x] `src/lib/data/schema-mutate.ts` -- add `addRelationField(identity, tableKey, { label, targetTable })`: `getSchema` → `validateRelationField` (400 on reject) → `overrides.addRelationField` → write full definition back under RLS; `{data,error}` envelope, `writeFailed` on 5xx.
- [x] `src/lib/data/records.ts` -- add `searchRelationRecords(client, orgId, targetTableKey, displayFieldKey, query, limit)` (ILIKE `data->>displayFieldKey`, `LIMIT`, ordered by label, `deleted_at IS NULL`) and `resolveRecordLabels(client, orgId, targetTableKey, displayFieldKey, ids[])` (`.in("id", ids)` batched) → `{ id, label }[]`.
- [x] `src/app/api/records/search/route.ts` + `schemas.ts` -- GET `?slug&table&query`: auth→zod→`resolveIdentity`→`getSchema` to find target `resolvedDisplayFieldKey`→`searchRelationRecords`→`{data:{results},error}`.
- [x] `src/app/api/records/labels/route.ts` + `schemas.ts` -- GET `?slug&table&ids`: auth→zod (cap ids count)→`resolveIdentity`→resolve target displayField→`resolveRecordLabels`→`{data:{labels},error}`.
- [x] `src/app/api/schema/fields/route.ts` + `schemas.ts` -- POST `{slug,tableKey,label,targetTable}`: mirror `/api/schema/columns` (auth→zod→`requireAdmin`→`membership.slug===slug`→`resolveIdentity`→`schema-mutate.addRelationField`).
- [x] `src/lib/data/records-client.ts` -- add `searchRelationRecords(slug,table,query)` and `fetchRelationLabels(slug,table,ids)` wrappers parsing the envelope, throwing `RecordApiError(code)`.
- [x] `src/components/dashboard/useRelationLabels.ts` (new) -- hook: from active table + current records, extract distinct referenced ids per relation field grouped by `targetTable` (pure, testable helper), batch-fetch labels via TanStack (`["relation-labels", slug, targetTable, sortedIds]`), return `resolve(field, value) => { label } | { archived } | null`.
- [x] `src/lib/data/realtime.ts` -- extend `invalidateOrgRecords` to also `invalidateQueries({ queryKey:["relation-labels", slug] })`.
- [x] `src/components/dashboard/RelationPicker.tsx` (new) -- combobox from `Popover` + search `Input` + `role="listbox"` results; debounced `searchRelationRecords`; value = target id; shows selected label; clearable; keyboard nav (↑/↓/Enter/Esc); states empty/loading(skeleton)/error/archived; 48px targets; i18n; `aria-expanded`/`aria-controls`/`role="option"`.
- [x] `src/components/dashboard/AddRelationFieldControl.tsx` (new) -- Admin-only popover form: pick target table (visible tables), enter field label; inline POST `/api/schema/fields`; `onSuccess`→`router.refresh()`; `RecordApiError`→translated message. Mirror `ColumnVisibilityControl`.
- [x] `src/components/dashboard/AddRecordForm.tsx` -- add `field.type === "relation"` → `RelationPicker` in the control switch (value from `draft[key]` id; submit passes id, blank omitted).
- [x] `src/components/dashboard/InlineEditCell.tsx` -- relation editor branch → `RelationPicker`; read-mode uses the resolver prop to show label / archived placeholder.
- [x] `src/components/dashboard/RecordsView.tsx` -- call `useRelationLabels`; thread `resolve` into table cells, card cells, and `InlineEditCell`; render `AddRelationFieldControl` in the toolbar when `role === "admin"`.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add SlugDashboard keys (picker: `relationSearchPlaceholder`, `relationNoResults`, `relationSearching`, `relationPickerError`, `relationClear`, `relationArchived`; add-field: `addRelationField`, `addRelationTargetLabel`, `addRelationFieldLabel`, `addRelationSubmit`, `addFieldForbidden`, `addFieldFailed`) in both locales.
- [x] `tests/unit/schema-relation-field.test.ts` + `tests/unit/schema-overrides.test.ts` -- cover `validateRelationField` (accept single-ref; reject unknown target, dup key, blocked/reserved key, empty label) and `addRelationField` transform (append, immutable, cardinality "one"); plus the pure referenced-id-extraction helper for `useRelationLabels`.

**Acceptance Criteria:**
- Given an Admin on a claimed-org table, when they add a relationship field targeting another table in the same org, then a single-reference `relation` field with `relationConfig.targetTable` is created, validated, persisted, and appears in every view after refresh (FR71, NFR-S7, AR14).
- Given a relationship field on an add/edit surface, when the user focuses it, then a server-side typeahead picker lists candidates by the target table's `displayField` label and returns matches quickly (bounded, p95 <500ms up to 50k rows) (FR72, NFR-P9).
- Given saved relationship values on a rendered page, when the table or cards render, then each referenced record's `displayField` label is shown (never the raw id), resolved in a single batched `id IN (...)` lookup per target table (FR73, NFR-P9, AR14).
- Given a referenced record's label later changes, when the referencing view re-renders after invalidation, then it shows the updated label (resolved at read time, never copied) (FR73, AR14).
- Given an unresolvable/soft-deleted target, when its cell renders, then a translated "archived/unavailable" placeholder shows instead of the id, with no error.

## Implementation Notes

- Implemented per the Code Map: focused `validateRelationField` + `overrides.addRelationField` + guarded `schema-mutate.addRelationField`; bounded `searchRelationRecords` + batched `resolveRecordLabels`; `/api/records/search`, `/api/records/labels`, `/api/schema/fields`; `RelationPicker` (radix Popover, no new dep), `AddRelationFieldControl`, `useRelationLabels`; wired into `AddRecordForm` / `InlineEditCell` / `RecordsView`; en+fr i18n. All reads/writes run under the caller's RLS client; the whole-schema generation validator is never re-run on the live schema.
- Review pass 1 (review_loop_iteration 0) patches, applied directly (the `SendMessage` tool was unavailable to re-engage the implementation subagent, so per step-04 the patches were applied here):
  1. `fetchRelationLabels` chunks ids into batches of `LABEL_ID_BATCH` (200, `<= MAX_LABEL_IDS`) so a page referencing >200 distinct targets no longer 400s the whole labels batch (was rendering every cell as "Archived").
  2. `useRelationLabels` resolver + `RelationPicker` trigger now distinguish a fetch **error** from a settled-but-absent id: an errored batch yields the loading state (skeleton / "…"), never the "Archived" placeholder, so a transient failure can't misrepresent a live target as deleted.
  3. `RelationPicker` sets `aria-activedescendant` (input) + stable `id`s on each `role="option"` so screen readers announce the arrow-key-highlighted option (WCAG AA combobox).
  4. Added tests: `records-relations` (search/label filter chain, ILIKE escaping, blank-drop, dedup/empty short-circuit), `relation-route-schemas` (id-cap + defaults), `route-records-search`, `route-records-labels` (401/400/403/empty-state/200), plus the earlier `route-schema-fields`.
- Verified after patches: `npm run type-check` clean, `npm run lint` clean, `npm run test` = 424 passed. Runtime JSONB `data->>key` ILIKE/order and full picker DOM interaction remain confirmed by the post-commit Playwright manual review (per spec Verification).

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **medium -> patch** -- Label batch overflow (blind-hunter, edge-case, verification-gap). `listRecords` is unpaginated; `useRelationLabels` collects ALL distinct target ids on the page and `fetchRelationLabels` sends them in one request, but `labelsQuerySchema` refines `ids.length <= MAX_LABEL_IDS (200)` -> a page with >200 distinct references 400s the whole batch -> every relation cell falls back to "Archived". Reachable for real orgs. Grouped with the error-vs-archived defect below (shared read-path).
- **medium -> patch** -- Error conflated with "archived" (blind-hunter, edge-case). On a transient labels/selected-label fetch error, `useRelationLabels`'s resolver (query settled, no data, not pending) returns `{archived}`, and `RelationPicker`'s trigger shows `relationArchived` -- a LIVE target is mislabeled "Archived" on a network/5xx blip. Verified: `selectedLabelQuery` has no error branch; resolver has no `isError` branch.
- **patch** -- Missing tests (verification-gap pre-verified; blind-hunter). `searchRelationRecords`/`resolveRecordLabels`, the `/api/records/search` + `/api/records/labels` handlers, and `labelsQuerySchema`/`searchQuerySchema` have zero coverage (grep across `tests/` confirms). Locks AC5's `deleted_at IS NULL` + `escapeIlike` contracts, the 401/403/empty-state route contracts, and the 200-id cap.
- **medium -> patch** -- RelationPicker missing `aria-activedescendant` (blind-hunter). Arrow-key nav updates `activeIndex` and styles the active option, but the search input sets no `aria-activedescendant` and options have no ids, so AT users hear no active-option announcement. Spec claims WCAG AA combobox semantics.
- **low -> reject** -- Lexicographic JSONB `data->>key` sort order (blind-hunter). Real but cosmetic; AC only requires "lists candidates by displayField label". Fix (LOWER/locale) adds complexity for negligible harm.
- **low -> reject** -- `displayFieldKey` interpolated into `.ilike/.order` without escaping (blind-hunter, edge-case). Not reachable: the key flows only from `resolvedDisplayFieldKey`, i.e. a `normalizeTableName`-sanitized field key; no path delivers an unsanitized key. Both reviewers graded low likelihood.
- **low -> reject** -- `AddRecordForm` relation submit fires for all relation fields but render requires `relationConfig` (blind-hunter). Unreachable with validated schemas: generation + `validateRelationField` always set `relationConfig`. Fix guards a state never demonstrated reachable.
- **low -> reject** -- Target table with no resolvable `displayField` -> field created but unusable (blind-hunter). Requires an admin to hide every field of the target (default `displayField` is set at provision). Unlikely; the guard adds a branch. Rejected per the low-finding rule.
- **low -> reject** -- Inline clear "writes null" vs `delete data[field.key]` (edge-case, verification-gap). No real bad outcome: the resolver + views treat absent/null/blank identically and no consumer distinguishes an absent JSONB key from explicit null; matches the scalar-clear convention. Fixing the wording would edit the frozen spec (disallowed).
- **low -> reject** -- Dead `if (!key) reject` branch in `validateRelationField` (verification-gap). `normalizeTableName` never returns empty (falls back to `field_<hash>`), so a non-Latin label yields a synthetic key -- consistent with existing 1.8 key derivation, not a new defect.
- **reject (spec-edit)** -- `addRelationTargetPlaceholder` absent from the spec's i18n key list; empty Impl Notes/Change Log (blind-hunter). Fix would edit this build's spec (disallowed); those sections are populated by the workflow itself.

## Design Notes

**Why a focused validator, not the whole-schema validator (AC1 "validated by the Schema Validator").** `validateGeneratedSchema` sanitizes for the *generation* path and drops `hidden` (validator.ts:259-263) and other post-generation metadata; re-running it on a live claimed-org schema would silently un-hide 3.5 columns. So 3.7 adds `validateRelationField` in the same module (same rule set: `normalizeTableName`, `keyIsBlockedVerb`, `RESERVED_KEYS`, target-exists) and applies a pure targeted transform, exactly as 3.5 did for hide/unhide. The existing `uiSourceAllowed = phase === "growth"` gate is intentionally left alone — the deferral note in 1.8 ("editor-driven relation creation → 3.7+") is satisfied by this targeted path, and `cardinality:"many"` stays growth-gated.

**Label resolution is batched + TanStack-owned (not the demo resolver).** `buildRelationResolver` reads an in-session array (≤8 demo rows). For real data, `useRelationLabels` collects the distinct ids referenced on the current page, issues one `id IN (...)` query per target table (key `["relation-labels", slug, targetTable, sortedIds]`), and returns a resolver. AC4 holds because both `useUpdateRecord.onSettled` and 3.6 real-time invalidation clear the labels prefix (via the extended `invalidateOrgRecords`), so an edited target's new label refetches.

**Picker keying against `Draft`.** `Draft` is `Record<string,string>`; a relation draft value is the target id string. The picker shows the *label* for that id (fetch/resolve it) while writing the id. On submit, blank omitted (no `required` concept); on inline edit, clearing writes `null`.

**Perf note (documented, not gated here).** Bounded ILIKE + LIMIT over `data->>displayField` meets p95 <500ms at MVP scale; a per-table `pg_trgm` index for the >10k-row case is a scale follow-up (record in `deferred-work.md`, not this story). The `jsonb_path_ops` containment index called out in the epic is a 3.8/3.9 concern; 3.7 uses only id-equality (`.in`) and label ILIKE.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors.
- `npm run lint` -- expected: clean (no hardcoded-string violations from new components).
- `npm run test` -- expected: new validator/overrides/hook-helper unit tests pass; existing suite green.

**Manual checks:**
- On the authed dashboard (`/[slug]` with the fallback template — Jobs→Clients, Invoices→Jobs): as Admin add a relation field, set it via the picker (verify typeahead + clear + keyboard), confirm the label (not id) renders in table and cards, edit a target's display value and confirm the referencing view updates, and confirm a Member sees no add-field control.
