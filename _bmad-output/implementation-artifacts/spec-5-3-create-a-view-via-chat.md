---
title: 'Story 5.3: Create a View via Chat'
type: 'feature'
created: '2026-10-01'
status: 'done'
route: 'dispatch'
baseline_commit: 'de2846440746f3a6e5cbcba898ad88d57117c6db'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The conversational editor (Stories 5.1, 5.2) can add a column and a table, but declines "make a view" requests. Epic 5's promise is "grow your app by chatting," and a saved filtered/sorted view is the third and final editor operation (`add_view`); an Admin currently can only filter/sort ephemerally (Story 3.4) with the state lost on every table switch.

**Approach:** Generalize the single hardened Gemini call to classify a third kind, `add_view`, carrying a source table plus filter conditions and an optional sort. The result is validated by a dedicated `validateAddView`, persisted as an append-only `ViewDefinition` in `org_schemas.definition`, and surfaced in the dashboard switcher. Opening a view renders its source table's existing rows through the existing `applyFilterSort` engine — no rows are modified or duplicated (FR15, FR16). Existing tables, fields, and records are never touched.

## Boundaries & Constraints

(Epic-5 invariants in `epic-5-context.md` apply; below is specific to or sharpened for this story.)

**Always:**
- One hardened Gemini call classifies the request (`add_field` | `add_table` | `add_view` | `needs_clarification` | `out_of_scope`); every `add_view` passes `validateAddView` before any write.
- A view is append-only metadata: it references an existing, visible source table by key and never alters that table's definition or any `records` row; a view starts rendering the live rows immediately.
- The view name/key is normalized (`normalizeTableName`) and disambiguated with a numeric suffix on collision with any existing table key or view key — never overwriting. Blocked-keyword/SQL names are rejected (reuse `BLOCKED_KEYWORDS` whole-word match, mixed-case and embedded) with the fixed rejection copy and a `reportRejection` log (org id + raw output).
- Filters target visible scalar fields of the source table only; each operator must be valid for that field's type (`operatorsForType`); `value2` only for `between`. Sort is a single visible scalar field + direction, or none. A view must carry at least one filter or a sort (a view with neither is rejected).
- Source-table inference: when the request names no table, infer from the currently-viewed table only if unambiguous; otherwise ask a clarifying question and write nothing.
- Views are stored top-level as `SchemaDefinition.views[]` (each carrying `sourceTableKey`) and surface as sibling tabs in the dashboard switcher after the tables, visually marked as views (decision 2026-10-01; the nested-under-table alternative was rejected as a heavier `RecordsView` refactor for a relationship already carried in the data).
- On success, `router.refresh()` surfaces the new view in the switcher and the success copy points the Admin to it; opening it applies the saved filters/sort via the existing `applyFilterSort` pipeline. No Undo affordance (consistent with table add; view removal is Story 5.5). All copy translated (en + fr), no em-dash. Prior add-column and add-table paths behave exactly as before.

**Never:**
- No relation-field filters via chat views (scalar-only, consistent with Story 5.2's no-relation stance); a relation-based view request gets a clarifying question or a friendly decline, never a silent partial view.
- No new persisted query, SQL, server-side view, or row copy — a view is pure presentation metadata over the already-cached rows.
- No view edit, rename, hide, delete, or Undo here (Story 5.5 owns view visibility); no server-side chat history; no auto-navigation into the new view.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| View, filter + sort | Admin on Invoices: "show me unpaid invoices sorted by date" | Validated `add_view`: key `unpaid_invoices` + `sourceTableKey` `invoices`, filter(status = unpaid), sort(date desc) persisted; chat confirms in plain language; view appears in the switcher after refresh; opening it shows the filtered/sorted Invoices rows | N/A |
| View, sort only | "a view of jobs sorted by due date" | `add_view` with empty filters + a sort; persisted and openable | N/A |
| Field/table add still works | "add a warranty date to Jobs" / "add a table for timesheets" | Routed to the Story 5.1 / 5.2 path, applied exactly as before | N/A |
| View name collides | Proposed key equals an existing table or view key | Key disambiguated (e.g. `unpaid_invoices_2`); nothing overwritten | N/A |
| Degenerate / unknown target | View with no filter and no sort; or source table / filter field does not exist or is a relation/hidden field | Validator rejects; fixed rejection copy; nothing written; rejection logged (org id + raw output) | Rejection is total |
| Blocked keyword / SQL in name | View name contains `DROP`/`DELETE`/`;`/SQL | Validator rejects; fixed rejection copy; nothing written; logged | Rejection is total |
| Ambiguous source table | "a view of unpaid ones" with no current table context | Inline clarifying question naming candidate tables; nothing written | N/A |
| LLM timeout / unavailable | Gemini times out (15s) or errors | Translated "assistant unavailable" message; no write; Epic 3 CRUD unaffected | Caught; no raw error shown |
| Member calls endpoint | Role is `member` | Chat pill not rendered; direct endpoint call returns 403 | 403 `forbidden` |

</frozen-after-approval>

## Code Map

Reuse (do not change behavior):
- `src/lib/gemini/client.ts` — `callGeminiWithTimeout<T>(userPrompt, responseSchema, timeoutMs=15000)`; injects `HARDENED_SYSTEM_PROMPT`.
- `src/lib/gemini/prompts.ts:30,150,223` — `HARDENED_SYSTEM_PROMPT`; `buildEditorPrompt(message,{tables,currentTableKey,conversation})` (currently marks views out-of-scope ~line 208) and `EDITOR_RESPONSE_SCHEMA` (kind enum line ~228, `add_table` payload shape to mirror).
- `src/lib/schema/validator.ts:55,74,111,479,526,631` — `RESERVED_KEYS`, `BLOCKED_KEYWORDS`, `keyIsBlockedVerb`, `SCALAR_FIELD_TYPES`, `validateAddField`, `validateAddTable` (mirror its normalize/disambiguate/reject/`reportRejection` structure). `reportRejection(detail,{id,rawOutput})` imported at line 10.
- `src/lib/schema/overrides.ts:179,195` — pure `addField`, `addTable` (immutable append); also `visibleTables` (add a `visibleViews` sibling).
- `src/lib/data/schema-mutate.ts:45,198,273` — `SchemaMutateIdentity`, `addField`, `addTable` read-validate-transform-write-under-RLS (`.eq("organization_id", orgId)`); mirror for `addView`.
- `src/lib/data/filter-sort.ts:19,33,46,75,303` — `SortState`, `FilterOperator`, `FilterState`, `operatorsForType`, `applyFilterSort` (the engine a view reuses; relocate the three filter/sort *type* aliases into `types/db.ts` and re-export here to avoid a circular import from `ViewDefinition`).
- `src/components/dashboard/useFilterSortState.ts:20` — ephemeral filter/sort state; resets on `tableKey` change (extend to seed from an active view's config).
- `src/components/dashboard/RecordsView.tsx:100-299` — switcher tablist + `applyFilterSort` usage; receives a new `views` prop; selecting a view drives the source table's rows through `useFilterSortState`/`applyFilterSort`.
- `src/app/[slug]/page.tsx:75-116` — server page; builds `tables = visibleTables(schema)` and passes to `RecordsView`; add `views = visibleViews(schema)`.
- `src/app/api/schema/edit/{route.ts:65,174,233,schemas.ts:18}` — route branch flow + `EditorChatResult` envelope `{kind,tableKey?,fieldKey?,label?,assistantText}` (add `viewKey?`); zod body.
- `src/lib/data/schema-chat-client.ts:36` — `postEditorChat`; client envelope. `src/components/chat/ChatPanel.tsx:88-241` — bubble mapping + Undo gating; `src/components/chat/ChatAssistant.tsx:69` — `router.refresh()` on schema change.
- `src/types/db.ts:11,53,80` — `FieldDefinition`, `TableDefinition`, `SchemaDefinition` (`tables` is an array; add optional `views`).
- `src/lib/i18n/{en.json:476,fr.json:476}` — `ChatAssistant` namespace.
- Tests to mirror: `tests/unit/schema-add-table.test.ts`, `tests/unit/schema-mutate.test.ts`, `tests/unit/route-schema-edit.test.ts`, `tests/unit/schema-chat-client.test.ts` (Vitest node env, no jsdom; `npm run test -- <pattern>`).

New file: `tests/unit/schema-add-view.test.ts`.

## Tasks & Acceptance

**Execution:**
- [x] `src/types/db.ts` -- add `ViewDefinition` (`key`, `label`, `sourceTableKey`, `filters: FilterState[]`, `sort: SortState`, optional `hidden`) and an optional `views?: ViewDefinition[]` on `SchemaDefinition`; relocate `FilterOperator`/`FilterState`/`SortState` type aliases here from `filter-sort.ts`.
- [x] `src/lib/data/filter-sort.ts` -- re-export the three relocated type aliases so existing importers are unaffected; no behavior change.
- [x] `src/lib/schema/validator.ts` -- add `validateAddView(schema, input, context?): { valid: true; view: ViewDefinition } | { valid: false; reason: "addViewFailed" }` -- resolve/require an existing visible source table; normalize + disambiguate the view key against existing table and view keys; blocked-keyword/SQL reject on key+label; validate each filter field is a visible scalar field of the source with a type-valid operator (`operatorsForType`) and required value(s); validate the sort field likewise; require ≥1 filter or a sort; `reportRejection` with org id + raw output on reject.
- [x] `src/lib/schema/overrides.ts` -- add pure `addView(schema, view)` returning a new `SchemaDefinition` with the view appended to `views` (input never mutated); add `visibleViews(schema)` filtering out `hidden` views.
- [x] `src/lib/data/schema-mutate.ts` -- add `addView(identity, input, context?): Promise<ApiResponse<{ viewKey }>>` -- `getSchema` → `validateAddView` → `overrides.addView` → write full `definition` under the RLS client scoped by `organization_id`.
- [x] `src/lib/gemini/prompts.ts` -- extend `EDITOR_RESPONSE_SCHEMA` with `kind: "add_view"` + payload `{ label, sourceTableKey, filters: [{ field, operator, value, value2? }], sort: { field, direction } | null }`; update `buildEditorPrompt` to describe views (remove from out-of-scope), instruct scalar-field-only filters and source-table inference, keeping add_field/add_table behavior.
- [x] `src/app/api/schema/edit/{route.ts,schemas.ts}` -- add an `add_view` branch after `add_table`: shape-guard (label + sourceTableKey present, filters array) → `schema-mutate.addView` → success `{ kind: "applied", viewKey, label, assistantText }` (no `fieldKey`); validator rejection → `{ kind: "rejected" }`; add `viewKey?` to `EditorChatResult`.
- [x] `src/lib/data/schema-chat-client.ts` -- carry `viewKey` through `postEditorChat`'s typed result; no new endpoint.
- [x] `src/components/chat/ChatPanel.tsx` -- map an applied result with `viewKey` to a view-success bubble (no Undo), keeping thinking/clarify/decline/degraded/field/table states.
- [x] `src/app/[slug]/page.tsx` + `src/components/dashboard/RecordsView.tsx` + `src/components/dashboard/useFilterSortState.ts` -- pass `views = visibleViews(schema)` into `RecordsView`; render views as sibling tabs (Option A); when a view is active, seed `useFilterSortState` from the view's filters/sort and render the source table's rows through `applyFilterSort`. (UI/UX treatment via the `/web-uiux-architect` skill, consistent with 5.1/5.2.)
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- update `ChatAssistant` greeting/placeholder/decline to mention views; add a view-success string (e.g. "Done. I created the {view} view."). No em-dash.
- [x] `tests/unit/schema-add-view.test.ts` -- validator rows: happy filter+sort, sort-only, reserved/existing/view-key collision → disambiguated, each blocked keyword (incl. mixed-case/embedded) → reject, unknown/relation/hidden filter field → reject, operator invalid for type → reject, degenerate (no filter + no sort) → reject; plus pure `overrides.addView` (append + immutability) and `visibleViews`.
- [x] `tests/unit/schema-mutate.test.ts` + `tests/unit/route-schema-edit.test.ts` -- add an `addView` write-contract block (success writes definition scoped by `.eq("organization_id", orgId)`; rejection → no write; DB error → `writeFailed`, message not leaked) and route cases (`add_view` applied with `viewKey` and no `fieldKey`; shapeless `add_view` → rejected, `addView` not called; add_field/add_table still applied; 401/403; clarify/declined/degraded).

**Acceptance Criteria:**
- Given an Admin submits "show me unpaid invoices sorted by date", when processed, then the request passes `callGeminiWithTimeout` with `HARDENED_SYSTEM_PROMPT`, yields a classified `add_view`, is validated before persistence, and a `ViewDefinition` (normalized key + `sourceTableKey` + filters + sort) is written to `org_schemas.definition`.
- Given a created view, when it is opened, then it presents the source table's live rows filtered/sorted as described, and no `records` row and no existing table/field definition changes.
- Given a prior add-column or add-table request, when processed through the generalized editor, then it still routes to its Story 5.1 / 5.2 path and behaves exactly as before.
- Given a proposed view name colliding with a reserved key, an existing table, or an existing view, when validated, then it is disambiguated and nothing is overwritten.
- Given a Member, then no chat pill renders and a direct call to `/api/schema/edit` with an `add_view` returns 403.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (review_loop_iteration 0) — blind-hunter (10), edge-case-hunter (1), verification-gap (1 + 2 other):

- [blind] Tablist `aria-label` still "Your tables" (`switcherLabel`) though it now also contains view tabs — **low → patch**. Real a11y inaccuracy caused by this change; SR users get a label that no longer describes the contents. Trivial copy fix.
- [blind] On a view tab the records caption / card-list label use the SOURCE table label, not the view label (`RecordsView.tsx` caption ~471, card-list ~508) — **low → patch**. The view is the active surface; the caption should name it. Contained label-source fix (the add-record modal keeps the table label — a record is added to the table, not the view).
- [blind] `successViewAdded` copy ("in your switcher") diverges from `successTableAdded` ("in your table switcher") — **low → patch**. Trivial copy alignment.
- [blind] Add-entry/write surface stays active on a view tab; a row added while filtered may not appear — **low → reject**. Non-destructive and identical to existing Story 3.4 filter behavior (the row is written to the source table and simply filtered out, not lost); the proposed fix adds an out-of-scope behavioral surface (suppress/explain editing on views).
- [blind] `viewTabLabel` double-encodes the marker (ListFilter glyph + "(view)" suffix) — **low → reject**. The glyph is `aria-hidden`, so the "(view)" text is what serves screen-reader users; carrying both is a defensible intended design, not a defect.
- [blind] No render-time handling if a view's filter/sort field is later hidden/removed — **low → reject**. A hidden field still exists in the definition and still filters the live rows (data intact); field removal is unsupported (append-only). The bad outcome is not reachable from this story's demonstrated behavior.
- [blind] `activeIndex` not reset when a view disappears / new view not auto-selected — **low → reject**. `safeIndex` already clamps to `selections.length - 1` (no out-of-bounds); auto-selecting the new view directly contradicts the frozen "no auto-navigation into the new view" boundary.
- [blind] No cap on the number of view tabs / long labels overflowing the switcher — **low → reject**. Speculative; no table-count cap exists either (same reject as Story 5.2's "no maximum-tables guard"); out of scope.
- [blind] Route `sort` projection edge (sort object present but `field` blank → coerced to null) untested — **low → reject**. The branch is correct defensive behavior and the degenerate-view rejection it can lead to is already covered at the validator level (`schema-add-view.test.ts` + `schema-mutate` degenerate rows); negligible.
- [blind] Prompt lists "contains/equals" for text/email/phone but `operatorsForType` may not return those for email/phone — **false**. Verified: `operatorsForType("email")`/`("phone")` both return `["contains","equals"]` (`filter-sort.ts:66-69`), exactly matching the prompt.
- [edge-case] Route passes a filter `value` through raw (not coerced like `field`/`operator`); a numeric `value` from the model → validator rejects a semantically valid filter — **low → reject**. `EDITOR_RESPONSE_SCHEMA` declares `value` as `Type.STRING`, so Gemini returns a string; the bad outcome requires the model to violate its own response schema, and rejecting a non-conforming output is acceptable. Fix adds a coercion branch for undemonstrated state.
- [verification-gap] The view-selection → seed → `applyFilterSort` runtime wiring (AC2's core promise) has no automated test — **medium (unverified-UI) → defer** (pre-verified by the layer). The pure engine (`applyFilterSort`) is pinned by `filter-sort.test.ts`; the new seeding plumbing in `useFilterSortState`/`RecordsView` needs an interaction-capable harness (jsdom/Playwright) the repo has not adopted. Routed to the spec's Manual check, consistent with how 5.1/5.2 handled their surfaces.
- [verification-gap-other] `ChatPanel`/`MessageBubble` `appliedView` variant untested — **low → defer**. Presentational glyph/variant selection; the repo has no chat-component tests (same disposition as Story 5.2's deferred ChatPanel variant test). Data contract (`viewKey` without `fieldKey`) is pinned by `route-schema-edit` and `schema-chat-client` tests.
- [verification-gap-other] Duplicated view-source-visibility filter (page.tsx + RecordsView) — **low → reject**. Both guards are harmless and defensive; neither removing one nor testing the overlap improves correctness.

Routing: no intent_gap or bad_spec, so no loopback. Three entries route to **patch** (distinct root causes: inaccurate tablist a11y label; view-tab caption/label using the table label; success-copy divergence). Two **defer** (AC2 UI runtime pin; ChatPanel appliedView render). All others rejected.

## Design Notes

A view is presentation metadata, not data: `ViewDefinition` reuses the exact `FilterState`/`SortState` shapes the ephemeral filter UI already produces, and opening a view feeds them straight into the existing `applyFilterSort` engine — so a view is literally "the same filter/sort the Admin could set by hand, saved and named." This is why no new query, SQL, or row copy exists (FR16). The type aliases move to `types/db.ts` only to let `ViewDefinition` reference them without a circular import; `filter-sort.ts` re-exports them so no existing call site changes.

Editor result contract (model → route → client): `{ kind: 'applied' | 'clarify' | 'declined' | 'rejected' | 'degraded', tableKey?, fieldKey?, viewKey?, label?, assistantText }`. For a view add, `viewKey` is set and `fieldKey` is absent (so the client shows no Undo); `assistantText` is always a translated human string.

## Verification

**Commands:**
- `npm run test -- schema-add-view` -- expected: all new validator/transform tests pass.
- `npm run test -- schema-mutate` and `npm run test -- route-schema-edit` -- expected: write-contract and route branches pass.
- `npm run type-check` -- expected: no type errors.
- `npm run lint` -- expected: clean.

**Manual checks:**
- As an Admin on the dashboard, open the pill, send "show me unpaid invoices sorted by date", confirm a new view appears in the switcher and opening it shows the filtered/sorted Invoices rows while the Invoices table itself is unchanged. Confirm "add a column to Jobs" and "add a table for timesheets" still work. As a Member, confirm no pill renders.

**Manual review (Playwright, post-commit) — verified.** On the authed Admin fixture `/session-1f4fa453` against the running dev app on `localhost:3000` with a live Gemini key:
- **Create a view (filter + sort):** the pill greeting + placeholder now mention creating a saved view. "show me unpaid invoices sorted by due date" returned "Done. I created the Unpaid Invoices view. You'll find it in your table switcher at the top of the dashboard." (no Undo, as designed). A new **Unpaid Invoices (view)** tab appeared via soft refresh with a filter glyph. Opening it rendered the Invoices rows narrowed from **5 → 3** (unpaid only) with an active filter chip + "Clear filters", and **sorted by Due Date ascending** (both the sort control and the Due Date column header reflected it). The panel caption read **"Records for Unpaid Invoices."** (the view label), while the add-record form still targeted **Invoices** (CRUD targets the source table).
- **Source table intact:** switching back to the Invoices tab showed all **5 rows** unchanged and the caption back to "Records for Invoices." — the view modified/duplicated nothing (FR16).
- **Add-column regression:** "add a warranty date to Customers" routed to the field path — "Done. I added Warranty Date to Customers." **with an Undo button**; Undo worked ("Undone. That column is hidden again, and your data is safe."). This confirms the generalized three-way classifier still routes field adds correctly (Undo for a field, none for a view).
- **Review-patch confirmations:** the tablist `aria-label` flipped from "Your tables" to **"Your tables and views"** once a view tab existed (B8); the view-tab caption used the view label (B2); the success copy said "in your table switcher" matching the table-add copy (B7).
- **Zero console errors or warnings** across the entire session. French copy (`successViewAdded`, `switcherLabelWithViews`, `viewTabLabel`) is present and i18n-parity-tested but was not re-exercised in-browser this pass. The test view persists in the fixture by the append-only, no-view-removal design of this story (view removal is Story 5.5).
