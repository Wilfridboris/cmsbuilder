# Epic 13 Context: List-of-Values (Single-Select) Field Type

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic adds a single-choice "picklist" field type (`select`) so that the dropdowns the product's user journeys already promise (e.g. a Status of Paid / Unpaid / Rejected, a "Type of Issue" picker) finally have a real data type behind them instead of free text. A `select` field is created and managed entirely through the Conversational Editor and renders as a dropdown everywhere data is entered: table and card views, Add/Edit forms, inline edit, public intake forms, and CSV import. The type is deliberately minimal for MVP: plain (no colored pills or per-value styling) and single-select only. Value management is strictly append-only, matching the product's core "the editor may only do things that cannot lose data" promise: you may add a value, rename a value's display label (the stored key stays stable), and archive a value that is already in use, but never delete an in-use value. This keeps every existing record valid with no row migration.

## Stories

- Story 13.1: Single-Select Field in the Data Model & Validator
- Story 13.2: Render & Edit Single-Select Across Views & Forms
- Story 13.3: Create a Single-Select Field (with Values) via Chat
- Story 13.4: Manage Single-Select Values (Chat + Inline, Append-Only)
- Story 13.5: Generation & Fallback Emit Select Fields
- Story 13.6: Single-Select on Intake Forms & CSV Import

## Requirements & Constraints

- A field can be a single-select list of values (picklist). Its value set is created and managed through the Conversational Editor (add a value, rename a value's label, archive a value), plus an Admin-only inline "+ Add value" in the dropdown. Multi-select is out of scope (deferred to Growth).
- Append-only is the governing invariant: removing a value that is already in use archives it non-destructively (existing records keep the value; it is no longer selectable for new records). An unused value may be hard-removed. Renaming a value edits only the display label; the stored key never changes, so existing records are unaffected. No row migration occurs anywhere.
- Plain styling only: no colored pills, no per-value styling (explicit product decision).
- The Schema Validator must continue to reject 100% of requests containing restricted keywords (`DROP`, `GRANT`, `TRUNCATE`, `DELETE`, `EXEC`, `--`, `;`, `/*`). The new operation names contain none of these, so the blocklist is unchanged and its tests must still pass.
- 100% of LLM API calls must include the hardened identity-masking system prompt (reused unchanged from the existing Gemini pipeline).
- Value/option management is Admin-only (per existing RBAC); the inline "+ Add value" affordance and chat-driven management are hidden from Members.
- Success criteria: a select field and its values can be created and managed entirely from chat; dropdowns render on every data-entry surface; archiving an in-use value preserves existing records; Schema Validator CI covers the new ops.

## Technical Decisions

- **Type model.** `FieldType` gains `'select'`. `SchemaField` gains `options?: SelectOption[]` (required when `dataType === 'select'`). `SelectOption` has:
  - `value: string` — stable, normalized stored key written into `records.data`.
  - `label: string` — display text; a rename edits this only, leaving `value` unchanged.
  - `archived?: boolean` — append-only archive flag; archived options are retained for existing rows but not selectable for new records.
  A select field stores exactly one option `value` in `records.data`.
- **New schema operations** (added to `SchemaOperation`), all routed through the existing guarded `mutate.ts` layer and persisted to `org_schemas`:
  - `add_select_option { tableKey, fieldKey, option }`
  - `rename_select_option { tableKey, fieldKey, value, label }` — edits label only.
  - `archive_select_option { tableKey, fieldKey, value }` — sets `archived: true`; never removes the option object, guaranteeing existing `records.data` values stay valid.
  (This epic shares the proposal that also introduced `remove_view` and `hide_table`; those belong to Epic 5 stories, not Epic 13.)
- **Schema Validator allowlist** extends to: `add_field` (including `dataType: 'select'` with `options`), `add_select_option`, `rename_select_option`, `archive_select_option`. Validator rules to add:
  - `add_field` with `dataType: 'select'` is accepted only with a non-empty `options[]` of unique, normalized values; rejected with plain-language messaging otherwise. Option values are normalized and deduped.
  - add/rename/archive option ops target only an existing field whose `dataType === 'select'`.
  - `archive_select_option` must never remove the option object (append-only guarantee).
  - Reserved-key and blocklist rules are unchanged.
- **Storage.** All changes are additive JSONB metadata edits to the `org_schemas` store — no DDL, no row migration, consistent with the append-only record store.
- **Reuse.** Field creation and value management flow through the existing Gemini client + Schema Validator (Epic 1) and the guarded `mutate.ts` layer (Epic 3). AI schema generation may propose a `select` field where a status-like field fits (with a plain-language reason), validated like any other field; the Universal Field Service hard-fallback template includes a generic `select` Status field.
- **CSV import scope.** Mapping a source column onto an *existing* `select` field is in scope; values matching no option are flagged for the user to resolve before import completes (reuses the existing confirm/flag flow). Creating a brand-new `select` field during import is explicitly out of scope (remains with deferred import work).

## UX & Interaction Patterns

- Table/card views render a select value as plain text of its option `label`; archived values still render for existing rows.
- Add/Edit forms and inline edit (reusing the established record-edit control set and optimistic-update + rollback behavior) present a dropdown of non-archived options; the write persists the option `value`.
- When an Admin opens the dropdown, an Admin-only "+ Add value" affordance appears at the bottom (hidden for Members). It calls the same validated `add_select_option` path used by chat; an inline-added value becomes immediately selectable and is persisted to `org_schemas`.
- Creating a field via chat reuses the target-table inference/clarification behavior: if the target table is ambiguous, the editor asks a clarifying question and writes nothing until the target is confirmed.
- When a value is archived in response to a removal request, a plain-language message explains the archive behavior; no raw JSON/SQL/errors are ever surfaced.

## Cross-Story Dependencies

- **Story 13.1 is foundational** — it defines the type model and validator rules that every other story in the epic depends on; implement it first.
- **Story 13.2** depends on 13.1 and references the `add_select_option` path delivered in 13.4 for its inline "+ Add value" affordance.
- **External epics:** Epic 1 (Gemini client, Schema Validator, generation pipeline, hard-fallback template), Epic 2 (Admin-only RBAC), Epic 3 (guarded `mutate.ts`, Add/Edit and inline-edit patterns, optimistic UI), Epic 4 (CSV import confirm/flag flow), Epic 5 (chat target-table inference), and Epic 6 (public intake form rendering). This epic was added by sprint-change-proposal-2026-10-02 and sequenced after the Epic 5 close-out stories.
