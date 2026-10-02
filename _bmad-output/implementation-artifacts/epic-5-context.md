# Epic 5 Context: Conversational Schema Editor (Append-Only, Guarded)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 5 delivers the product's highest-risk surface: an Admin evolves the app's structure by chatting in plain language instead of touching any configuration screen. From a floating AI Assistant pill, an Admin can add a column, add a table, create or remove a view, and request table removal (safely redirected to a non-destructive hide). Every request is forced through a Schema Validator that enforces an operation allowlist, rejects restricted SQL keywords, preserves all existing rows, and logs every rejection. The guiding rule is Append-Only, Guarded: the editor may only do things that cannot lose data. This matters because it lets non-technical owners grow their system of record with zero migration risk and no exposure to raw JSON, SQL, or error internals.

## Stories

- Story 5.1: Add a Column via Chat
- Story 5.2: Add a Table via Chat
- Story 5.3: Create a View via Chat
- Story 5.4: Schema Validator Guardrails & Rejection Handling
- Story 5.5: Safe Handling of Unsupported Operations
- Story 5.6: Remove a View via Chat
- Story 5.7: Hide a Table via Chat (in place of Delete)

## Requirements & Constraints

- The editor is Admin-only; the chat entry point is hidden from Members per role-based access control.
- Schema mutation is an append-only, non-destructive contract: adding fields or tables never migrates or alters existing rows (the record store is JSONB, so adds are pure metadata edits).
- Permitted operations are restricted to an allowlist: `add_table`, `add_field`, `add_view`, `remove_view`, and `hide_table`. Anything outside it — including any attempt to touch `organization_id`, auth tables, or RLS — is rejected.
- Any field/table name containing a restricted keyword (`DROP`, `GRANT`, `TRUNCATE`, `DELETE`, `EXEC`, `--`, `;`, `/*`) or raw SQL must be rejected 100% of the time, including mixed-case and embedded occurrences. The new op names introduced this epic contain none of these, so the blocklist is unchanged.
- Rejections must surface a single plain-language message ("That change isn't allowed. Try describing what you'd like to add instead.") and never expose raw JSON, SQL, schema objects, or error stacks. Each rejection is logged with the tenant's `organization_id` and the raw LLM output for audit.
- Unsupported destructive requests (delete/rename a column or table) return a reassuring non-technical message and a non-destructive fallback — column requests hide the column via the existing visibility flag; table requests offer a reversible hide.
- Removing a view is the one permitted removal, precisely because a view stores no rows; view deletion is therefore non-destructive and no visibility flag is built for views.
- A hidden table retains all its rows and can be restored unchanged at any time; true table deletion remains unsupported.
- The LLM is never a dependency for data operations: on LLM outage or timeout the editor degrades gracefully with a translated message while core CRUD stays fully available.
- Validator unit tests in CI must cover the allowlist, the full keyword blocklist, reserved-column collisions, and the per-op object-type rules below.

## Technical Decisions

- Reuses the shared Gemini client and Schema Validator from the generation epic, and writes through the guarded `mutate.ts` layer; the overlap with the CSV-import surface is incidental lib-layer sharing only.
- LLM calls go through a timeout-guarded wrapper with a hardened system prompt and strict JSON output (operations are returned as a structured JSON metadata shape, not SQL — no DDL is ever generated).
- Authoritative logical schema lives in `public.org_schemas (organization_id, definition JSONB)`: tables, fields, types, per-item `reason`, `sensitive`, and field-level `hidden` flags. The UI renders from this; a field add/hide is a metadata edit with no migration.
- `org_schemas` tables now also carry a table-level `hidden?: boolean` flag mirroring the field-level one, backing the hide-table operation; rows are always retained.
- The schema operation union is extended with `remove_view` (removes a named view definition) and `hide_table` (sets the table-level hidden flag). (The related select-option operations belong to the separate List-of-Values field-type epic and layer onto this same validated pipeline.)
- Validator rules to enforce: `remove_view` targets only an existing view name, never a table or field; `hide_table` sets only the table-level hidden flag and never drops rows or touches another table. Table-name collisions on add are normalized or disambiguated, never overwriting existing data.
- Target-table inference: if an add request omits a table, infer from the currently-viewed table when unambiguous; otherwise ask a clarifying question and write nothing to `org_schemas` until confirmed. The same clarify-before-write rule applies to remove-view when no existing view is named.
- A pure in-memory `hideTable` transform already exists; Story 5.7 must realize a persisted visibility mutator and route (reserved anchors exist in the editor route), not an in-memory-only transform.

## UX & Interaction Patterns

- Floating AI Assistant chat pill fixed bottom-right, rendered only for Admins, showing a "thinking…" bubble during mutations.
- The view-tab surface exposes a per-view overflow menu with an Admin-only "Remove view" control; removal shows a confirm toast carrying an Undo action.
- Newly applied add-view and add-table results in chat each carry an Undo affordance, routed through `remove_view` and `hide_table` respectively.
- Hidden tables are listed in a restore surface under Settings, where an Admin can unhide them; hide/restore controls are not shown to Members.

## Cross-Story Dependencies

- Stories 5.1–5.3 establish the add-column / add-table / add-view operations that 5.4 hardens; 5.4's validator is the gate all other stories depend on.
- Stories 5.6 and 5.7 (added via sprint-change-proposal-2026-10-02) supersede parts of Story 5.5: 5.6 replaces the earlier "hide a view" framing (a view is removed, not hidden) and picks up the Undo-on-add-view parked there; 5.7 supersedes 5.5's table-delete branch (5.5's column-hide behavior is unchanged) and picks up the Undo-on-add-table. Both pull deferred work recorded against spec-5-5.
- Depends on the generation epic (Gemini + Schema Validator lib), the core-data epic (guarded `mutate.ts`, column-hide visibility mechanism), and the auth/RBAC epic (Admin-only gating). The separate single-select List-of-Values epic layers additional select-option operations onto this same validated pipeline.
