---
title: 'Story 5.2: Add a Table via Chat'
type: 'feature'
created: '2026-10-01'
status: 'done'
route: 'dispatch'
baseline_commit: '148a349f679f8a30034f8c0fb460fabb343a2f0f'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-5-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The conversational editor (Story 5.1) can add a column but declines "add a table" requests. An Admin whose business grows a new area to track has no way to add a whole table without re-running the one-shot generation pipeline. Epic 5's promise is "grow your app by chatting," and adding a table is the next increment after adding a column.

**Approach:** Generalize the existing single-call conversational editor so one hardened Gemini call classifies the request as `add_field` or `add_table` (or clarify / out-of-scope). An `add_table` result is turned into a new `TableDefinition` (normalized `key` + a starter set of scalar fields), passed through a dedicated `validateAddTable`, and persisted as an append-only edit to `org_schemas.definition`. Existing tables and record rows are never touched. The new table surfaces in the dashboard table switcher via the existing `router.refresh()` path.

## Boundaries & Constraints

(Epic-5 invariants in `epic-5-context.md` apply; below is what is specific to or sharpened for this story.)

**Always:**
- One hardened Gemini call classifies the request; a new table and each of its fields pass `validateAddTable` before any write.
- A new table is append-only to `org_schemas.definition.tables`: existing tables and all `records` rows are untouched, and the new table starts with zero rows.
- Names are normalized via `normalizeTableName`. A table key colliding with a reserved key or an existing table (visible or hidden) is disambiguated with a numeric suffix, never overwriting; duplicate field keys within the new table are likewise disambiguated.
- Blocked-keyword/SQL names are rejected (reuse `BLOCKED_KEYWORDS` whole-word match; mixed-case and embedded), with the fixed rejection copy and a `reportRejection` log (org id + raw output).
- Fields are scalar only (`text|number|date|datetime|boolean|currency|email|phone`); `displayField` is derived via `displayFieldKey` when omitted.
- New table is usable (table/card views, add/edit) after the existing `router.refresh()`; copy, degraded, and decline states follow Story 5.1. All copy translated (en + fr), no em-dash.
- On success, surface the new table only: `router.refresh()` makes it appear in the table switcher and the success copy points the Admin to it. Do not auto-navigate and do not refactor `RecordsView` (decision: surface-only, lowest risk; `RecordsView` receives the new table via its server-rendered `tables` prop and the existing selection is preserved).

**Never:**
- No `add_view`, delete, or rename (Stories 5.3 / 5.5); no relation-type fields via chat (Story 3.7) — such requests get a friendly decline.
- No table hide/removal or Undo-of-table here (Story 5.5 owns table visibility); field Undo from 5.1 is unchanged.
- No seed rows for the new table; no server-side chat history.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Add table, happy path | Admin: "add a table for employee timesheets" | Validated `add_table`: key `employee_timesheets` + starter scalar fields persisted to `org_schemas`; chat confirms in plain language; table appears in the switcher after refresh; existing tables unchanged | N/A |
| Field-add still works | Admin: "add a warranty date to Jobs" | Routed to `add_field` (Story 5.1 path), applied as before | N/A |
| Table name collides | Proposed key equals an existing table (visible or hidden) or a reserved key | Key disambiguated (e.g. `jobs_2`); nothing overwritten | N/A |
| Blocked keyword / SQL in name | Table or field name contains `DROP`/`DELETE`/`;`/SQL | Validator rejects; fixed rejection copy; nothing written; rejection logged with org id + raw output | Rejection is total |
| Out-of-scope request | Admin: "delete the Customers table" / "make a view of unpaid invoices" | Friendly non-technical decline naming what the chat can do now (add a column or a table); nothing written | N/A |
| LLM timeout / unavailable | Gemini times out (15s) or errors | Translated "assistant unavailable" message; no write; Epic 3 CRUD unaffected | Caught; no raw error shown |
| Member calls endpoint | Role is `member` | Chat pill not rendered; direct endpoint call returns 403 | 403 `forbidden` |

</frozen-after-approval>

## Code Map

Reuse (do not change behavior):
- `src/lib/gemini/client.ts:45` — `callGeminiWithTimeout<T>(userPrompt, responseSchema, timeoutMs=15000)`; injects `HARDENED_SYSTEM_PROMPT` on every call.
- `src/lib/gemini/prompts.ts:30,147,214` — `HARDENED_SYSTEM_PROMPT`; `buildAddFieldPrompt` + `ADD_FIELD_RESPONSE_SCHEMA` (discriminated by `kind`) to generalize.
- `src/lib/schema/validator.ts:54,73,478,525` — `RESERVED_KEYS`, `BLOCKED_KEYWORDS`, `SCALAR_FIELD_TYPES`, `validateAddField` (mirror its rules per-field).
- `src/lib/schema/overrides.ts:179` — pure `addField` (immutable append); mirror for `addTable`.
- `src/lib/data/schema-mutate.ts:195` — `addField(identity, tableKey, input)` read-validate-transform-write-under-RLS (`.eq("organization_id", orgId)`); mirror for `addTable`.
- `src/lib/schema/relations.ts` — `displayFieldKey(table)` to default `displayField`.
- `src/lib/utils.ts` — `normalizeTableName`. `src/types/db.ts:52,79` — `TableDefinition`, `SchemaDefinition` (`tables` is an array).
- `src/app/api/schema/add-field/{route.ts:87,schemas.ts:18}` — route flow (getCurrentUser → requireAdmin → cross-org slug check → `resolveWritableOrgIdentity` → getSchema → gemini → branch on `kind`), zod body, `EditorChatResult` envelope `{kind, tableKey?, fieldKey?, label?, assistantText}`. This is the file to generalize.
- `src/lib/data/schema-chat-client.ts:1` — `postAddFieldChat`; client envelope. `src/components/chat/{ChatPanel.tsx,MessageBubble.tsx}` — bubble mapping; `applied` shows Undo only when `fieldKey` present.
- `src/components/chat/ChatAssistant.tsx:70` — calls `router.refresh()` on `onSchemaChanged` (new table surfaces here).
- `src/components/dashboard/RecordsView.tsx:123` — table switcher; receives the new table via its server-rendered `tables` prop after `router.refresh()`. Do NOT modify (surface-only navigation).
- `src/lib/i18n/{en.json:476,fr.json:476}` — `ChatAssistant` namespace.
- Tests to mirror: `tests/unit/schema-add-field.test.ts`, `tests/unit/schema-mutate.test.ts`, `tests/unit/route-schema-add-field.test.ts` (Vitest; `npm run test -- <pattern>`).

New files: `tests/unit/schema-add-table.test.ts`. (Route folder renamed — see Tasks.)

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/schema/validator.ts` -- add `validateAddTable(schema, input, context?): { valid: true; table: TableDefinition } | { valid: false; reason: "addTableFailed" }` -- normalize key via `normalizeTableName`; reject blocked keywords/SQL in table and field names; disambiguate key on reserved-key or existing-table collision (suffix); validate each field as scalar (reuse `SCALAR_FIELD_TYPES`, reserved-key and blocked checks), disambiguate duplicate field keys; derive `displayField` via `displayFieldKey`; log rejection with org id + raw output.
- [x] `src/lib/schema/overrides.ts` -- add pure `addTable(schema, table)` returning a new `SchemaDefinition` with the table appended to `tables`; input never mutated.
- [x] `src/lib/data/schema-mutate.ts` -- add `addTable(identity, input, context?)` -- read schema (`getSchema`), run `validateAddTable`, apply `overrides.addTable`, write full `definition` back under the RLS client scoped by `organization_id`; return `ApiResponse<{ tableKey }>`.
- [x] `src/lib/gemini/prompts.ts` -- generalize the editor prompt/schema: `buildEditorPrompt(message, { tables, currentTableKey, conversation })` + `EDITOR_RESPONSE_SCHEMA` returning `kind: "add_field" | "add_table" | "needs_clarification" | "out_of_scope"`; `add_table` carries `{ label, fields: [{ label, type }] }` (scalar types; small sensible starter set). Keep `buildAddFieldPrompt` behavior for the field branch.
- [x] `src/app/api/schema/edit/{route.ts,schemas.ts}` -- rename `add-field` route folder to `edit`; branch the single model result: `add_field` → existing `schema-mutate.addField`; `add_table` → `schema-mutate.addTable`; clarify/out-of-scope unchanged; validator rejection → `reportRejection` + fixed rejection copy; LLM failure → degraded. Export `EditorChatResult`. `export const dynamic = "force-dynamic"`.
- [x] `src/lib/data/schema-chat-client.ts` -- rename/generalize to `postEditorChat` posting to `/api/schema/edit`, returning `EditorChatResult`; keep `postUndoHideColumn` unchanged.
- [x] `src/components/chat/ChatPanel.tsx` -- call the generalized client; map an `applied` result to a success bubble; show the Undo affordance only when `fieldKey` is present (field add), none for a table add; keep thinking/clarify/decline/degraded states.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- update `ChatAssistant` greeting/placeholder to mention adding a table; add a table-success string (e.g. "Done. I created {table}.") and widen the decline copy to name both column and table. No em-dash.
- [x] `tests/unit/schema-add-table.test.ts` -- validator rows: happy multi-field add, reserved/existing collision → disambiguated, each blocked keyword (incl. mixed-case/embedded) in table and field names → reject, non-scalar/relation field → reject, duplicate field keys → disambiguated, `displayField` defaulting; plus pure `overrides.addTable` (append + immutability).
- [x] `tests/unit/schema-mutate.test.ts` -- add an `addTable` write-contract block: success writes definition scoped by `.eq("organization_id", orgId)`; validator rejection → no write; DB error → `writeFailed`, message not leaked.
- [x] `tests/unit/route-schema-edit.test.ts` -- rename/extend the add-field route test: `add_table` applied; `add_field` still applied; 401/403 (member, cross-org); clarify/declined/rejected/degraded branches.

**Acceptance Criteria:**
- Given an Admin submits "add a table for employee timesheets", when processed, then the request passes through `callGeminiWithTimeout` with `HARDENED_SYSTEM_PROMPT`, yields a classified `add_table`, is validated before persistence, and a new logical table (normalized `table_key` + field definitions) is written to `org_schemas.definition`.
- Given the new table is created, when the dashboard refreshes, then the table appears in the switcher and is usable (table/card views, add/edit), and no existing table's definition or `records` rows change.
- Given a prior "add a column" request, when processed through the generalized editor, then it still routes to the field path and behaves exactly as in Story 5.1.
- Given a proposed table name colliding with a reserved key or an existing table, when validated, then it is disambiguated and nothing is overwritten.
- Given a Member, then no chat pill renders and a direct call to `/api/schema/edit` returns 403.

## Implementation Notes

- Scrollbar-flash fix (user-reported, follow-up to the modeless change): opening the panel flashed the window scrollbar and shifted content sideways. Root cause: the vestigial Framer Motion wrapper in `ChatAssistant.tsx` was a full-width, in-flow element whose real content is portaled away, and its spring (`bounce: 0.2`) overshot `scale` past 1.0, so for a few frames it was wider than the viewport → transient horizontal scrollbar. Fix: removed the Framer Motion wrapper entirely (and `AnimatePresence`/`useReducedMotion`); the portaled, position:fixed Radix content animates itself in with its existing CSS `animate-in` zoom/fade (composited, bounded 22rem width, no document reflow). Verified frame-by-frame: no scrollbar-width toggle, no content shift, no overflow during open; `aria-modal` absent (modeless), composer focused, ring cue present, zero console errors.
- Post-review UX follow-up (user-requested): the chat panel was a Radix dialog left at `modal={true}` with no overlay and `onInteractOutside` prevented — so it blocked the dashboard with no visual cue and no click-to-dismiss (confusing). Changed to a true modeless co-pilot (`modal={false}` in `ChatPanel.tsx`): the dashboard stays interactive (switch tables, add records, watch the new column/table appear live), the panel persists until Esc or the X (outside clicks never dismiss it), a soft `ring-primary/15` marks it as the active surface in place of a dimming scrim, the composer auto-focuses on open, and focus returns to the pill on close (handled in `ChatAssistant.tsx` since the pill unmounts while open). Responsive width added for narrow viewports (`left-4 right-4` → `sm:w-[22rem]`). Verified in-browser (both the interactive-while-open path and Esc→focus-return) with zero console errors.

## Spec Change Log

## Review Triage Log

Pass 1 (review_loop_iteration 0) — blind-hunter (10), edge-case-hunter (0), verification-gap (1 + 1 other):

- [verification-gap] `reportRejection` call (org id + raw output) unasserted — the frozen matrix "rejection logged" behavior is untested — **medium → patch**. Verified: `schema-add-table.test.ts:18` mocks `reportRejection` but no `expect(...)` asserts it fired or with what args. Add an assertion.
- [blind] Route "shapeless `add_table`" guard (missing label / non-array `fields` → `rejected`, `addTable` NOT called) untested — **low → patch**. Verified absent from `route-schema-edit.test.ts` (it covers only a validator rejection via `mockRejectedValue`). Add one route case.
- [verification-gap-other] Dead code `buildAddFieldPrompt` + `ADD_FIELD_RESPONSE_SCHEMA` in `prompts.ts` — **low → patch**. Verified no importers in `src`/`tests`; orphaned by the fold into `buildEditorPrompt`. Delete both.
- [blind] `handleMutateError(stage: string)` loosely typed — **low → patch**. A typo'd stage compiles silently; narrow to `"mutate" | "mutate-table"` (direct 1-line correction, makes the two values load-bearing).
- [verification-gap] `ChatPanel` `appliedTable` variant / Undo-gating untested — **low → defer** (pre-verified). Repo convention: no ChatPanel component tests (vitest `node` env, no jsdom), established by Story 5.1; the data contract (no `fieldKey` on table add) is pinned by both `schema-chat-client.test.ts` and `route-schema-edit.test.ts`; the spec's manual-check verifies the render.
- [blind] Stale Code Map path: `displayFieldKey` listed at `src/lib/generation/relations.ts`; actual is `src/lib/schema/relations.ts` — **low, reject** (fix edits this build's spec). True; Code Map corrected out-of-band for future-story accuracy.
- [blind] No column-vs-table intent-ambiguity clarification path — **low, reject**. The `needs_clarification` branch exists; a clear "add a table" request classifies fine; the fix adds a whole new clarification dimension (complexity/public surface) and leans into Story 5.4's validator-hardening scope.
- [blind] No cap on `add_table` field count — **low, reject**. A defensive guard on undemonstrated state; the model's input is bounded by the 2000-char `message` cap, so a 50-field return is near-unreachable; fix adds a guard.
- [blind] No maximum-tables guard — **low, reject**. No product table ceiling exists in the spec/epic; speculative; applies equally to repeated `add_field`; fix adds a guard/config for undemonstrated state.
- [blind] Table/field label length unbounded in the validator — **low, reject**. Consistent with the existing `validateAddField` (no label-length cap); input bounded by the 2000-char `message` cap; fix adds a guard matching no established pattern.
- [blind] Field-projection `map` coerces bad entries to `""`, making the validator's "a field is not an object" branch unreachable from the route — **low, reject**. Both paths reject malformed input; the reject detail strings are log-only (never user-facing); the validator branch stays reachable via direct calls (harmless defensive code). Fix adds complexity or deletes a safe guard.
- [blind] `successTableAdded` copy hard-codes the switcher's location — **low, reject**. The copy is accurate; its specificity is the intended UX of the surface-only navigation decision; switcher placement is stable, and the French text describes the switcher generically (no label mismatch). Rewording would reduce helpfulness.
- [edge-case] No findings — exhaustive path trace confirmed every malformed/collision/blocked/read-fail/write-fail path is handled.

Routing: no intent_gap or bad_spec, so no loopback. Four entries route to **patch** (distinct root causes: missing logging assertion; missing route shape-guard test; dead prompt exports; loosely-typed stage param). One **defer** (ChatPanel render convention). All others rejected.

Patches applied (no loopback, SendMessage unavailable so applied in-session): added a `reportRejection` org-id + raw-output assertion to `schema-add-table.test.ts`; added a shapeless-`add_table` route case to `route-schema-edit.test.ts`; deleted dead `buildAddFieldPrompt` + `ADD_FIELD_RESPONSE_SCHEMA` from `prompts.ts`; narrowed `handleMutateError` `stage` to `"mutate" | "mutate-table"`. Deferred: ChatPanel variant test (deferred-work.md). Re-verified: 87 targeted tests pass, type-check clean, lint clean.

## Design Notes

Reuses the Story 5.1 chat surface and design language (glass pill, iMessage-style Radix dialog, Framer Motion open/close, CSS microstates). The 5.2 UI delta is small: updated greeting/placeholder/decline copy and a table-success bubble whose copy points the Admin to the switcher (surface-only navigation). Per the user's directive, run the `/web-uiux-architect` skill during implementation for the table-success bubble treatment, keeping it consistent with 5.1.

Editor result contract (model → route → client): `{ kind: 'applied' | 'clarify' | 'declined' | 'rejected' | 'degraded', tableKey?, fieldKey?, label?, assistantText }`. For a table add, `tableKey` is set and `fieldKey` is absent (so the client shows no Undo); `assistantText` is always a translated human string.

## Verification

**Commands:**
- `npm run test -- schema-add-table` -- expected: all new validator/transform tests pass.
- `npm run test -- schema-mutate` and `npm run test -- route-schema-edit` -- expected: write-contract and route branches pass.
- `npm run type-check` -- expected: no type errors.
- `npm run lint` -- expected: clean.

**Manual checks:**
- As an Admin on the dashboard, open the pill, send "add a table for employee timesheets", confirm the new table appears in the switcher and is usable, and existing tables are intact. Confirm "add a column to Jobs" still works. As a Member, confirm no pill renders.

**Manual review (Playwright, post-commit) — verified.** On the authed Admin fixture `/session-1f4fa453` against the running dev app on `localhost:3000`, with a live Gemini key, across both locales:
- **Add table (en):** the pill greeting + placeholder now mention adding a table. "add a table for employee timesheets" returned "Done. I created Employee Timesheets. You'll find it in your table switcher at the top of the dashboard." A new **Employee Timesheets** tab appeared via soft refresh (no full reload); opening it rendered its own add-record form with the model's scalar starter fields (Employee Name/text, Date/date, Hours Worked/number, Notes/text, Approved/boolean rendered as Yes/No radios) and "No records yet." Existing tables (Customers, Quotes & Jobs, Invoices) and their rows were unchanged. The success bubble correctly showed **no Undo** (table visibility is Story 5.5).
- **Add-column regression (en):** "add a warranty date to Quotes & Jobs" routed to the field path — "Done. I added Warranty Date to Quotes & Jobs." **with an Undo button**; tapping Undo hid the column ("Undone. That column is hidden again, and your data is safe."). This confirms the generalized editor preserves Story 5.1 and the ChatPanel Undo-gating (Undo for a field add, none for a table add).
- **Add table (fr):** `NEXT_LOCALE=fr` rendered all copy in real French (pill "Ouvrir l'assistant IA", greeting with guillemets including "ou ajouter une toute nouvelle table", placeholder "Décrivez la colonne ou la table à ajouter…"). "ajoute une table pour le suivi des dépenses" returned "C'est fait. J'ai créé Dépenses. Vous la trouverez dans le sélecteur de tables en haut du tableau de bord." A new **Dépenses** tab appeared; no Undo. All French copy used straight apostrophes/guillemets with no em-dash.
- **Zero console errors** across the entire session (both locales, all paths). Member-hidden pill + endpoint 403 are covered by `route-schema-edit.test.ts` and the layout admin gate (fixture is an Admin; not re-exercised in-browser). Note: by the append-only, no-table-hide design of this story, the two empty test tables (Employee Timesheets, Dépenses) remain in the fixture — table removal is Story 5.5's domain.
