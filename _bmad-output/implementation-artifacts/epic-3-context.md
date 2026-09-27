# Epic 3 Context: Core Data Management (Daily Driver)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic delivers the everyday working surface where a claimed organization's team manages its real business records — the moment the product stops being a demo and becomes the business's system of record. Team members view records as a responsive data table on desktop and swipeable cards on mobile, add records through schema-typed forms, edit inline with optimistic UI, delete, filter and sort, and (as Admins) hide columns without losing data — while every teammate sees each other's changes in near real time. It also delivers single-reference relationship (lookup) fields end to end: a searchable record picker, label resolution in views, filter/sort by a relationship, safe delete of referenced records, and a reverse related list. All writes flow through the guarded mutation layer under row-level tenant isolation. It operates on the claimed org's real data and depends only on the foundation and account/RBAC epics; it has no forward dependency on any later epic.

## Stories

- Story 3.1: Responsive Table & Card Views
- Story 3.2: Add & Delete Records
- Story 3.3: Inline Edit with Optimistic UI
- Story 3.4: Filter & Sort Records
- Story 3.5: Admin Column Hide (Non-Destructive)
- Story 3.6: Real-Time Multi-User Sync
- Story 3.7: Relationship Lookup Field & Record Picker
- Story 3.8: Filter/Sort by Relationship & Safe Delete of Referenced Records
- Story 3.9: Reverse Related List

## Requirements & Constraints

- Records render as a desktop data table and, on mobile viewports, as a swipeable card list showing key fields — one responsive data surface, not a horizontally scrolled table. Mobile is the primary use case.
- Add-record forms are auto-generated from the logical schema definition, with input controls matching each field's data type (text, number, date, dropdown, etc.). Every field must have a real, associated label; placeholder-only labelling is not acceptable.
- Inline editing works by clicking a value and typing, auto-saving on blur — no modals, no explicit Save button. Deletes are soft (retain the row, mark it deleted).
- Filtering and sorting operate within the current logical table; filter/sort state must be reflected in both the desktop and mobile presentations. A filter matching nothing shows an accessible, translated empty state, never an error.
- Admin column-hide removes a column from all views for the org while preserving the field definition and all stored values; hidden columns can be unhidden with data intact. The hide/unhide control is Admin-only (Member RBAC hides it).
- Concurrent edits by teammates propagate to other viewers within ~2 seconds. Concurrent writes to the same record must not silently overwrite — stale writes are rejected and rolled back with a refresh.
- Failed writes/deletes roll the optimistic change back and surface a translated, non-technical message; raw errors are never exposed.
- Single-reference relationship fields: an Admin adds a lookup field targeting another table in the same org; add/edit forms present a searchable server-side typeahead picker over the referenced table shown by its display label; table/card views show the referenced record's label (never the raw id); users can filter and sort by a relationship; deleting a referenced record warns with a reference count then soft-deletes (referencing rows keep the id and show the target as archived); and from a record the user can see a reverse list of the records that reference it, with that table's filter/sort. Multi-select relationships and reverse lookups over multi-select are out of scope (deferred to the advanced-relationships Growth epic).
- Performance and accessibility targets that gate this epic: authenticated returning-user dashboard interactive within ~2s (p95, mobile LTE); optimistic edits render instantly with server confirmation within ~1s; real-time propagation within ~2s; relationship typeahead returns within ~500ms (p95) for referenced tables up to 50k rows and label/related-list resolution adds no more than ~300ms to page render; 48x48px minimum touch targets; schema-derived ARIA labels on interactive/column semantics; real form-field labels.
- CRUD must not depend on the LLM (LLM is only for schema generation and the conversational editor).

## Technical Decisions

- **Logical schema, not physical tables.** A "table" is a `table_key` plus a field-definition entry in the org's schema-metadata store; all tenant rows live in one shared JSONB record store (`records` with `id, organization_id, table_key, data JSONB, actor_id, version, created_at, updated_at, deleted_at`). There is no runtime DDL. Views are driven by the schema definition read from the metadata store.
- **Query layer.** A dedicated records query module lists/filters/sorts rows by `(organization_id, table_key)` using JSONB operators and maps rows onto the field definitions. Build filter/sort against this layer, not ad hoc queries.
- **Guarded writes only.** All record writes (add, edit, delete) go through the single guarded mutation layer, running under the caller's RLS-scoped client with `actorId` set and never using the service-role key. Optimistic concurrency is enforced via the record's `version`; soft-delete uses the `deleted_at` field. Identity is passed explicitly to the mutation layer (it must not read cookies).
- **Column hide is metadata-only.** Hiding a column sets a `hidden` flag on the field definition (append-only); it performs no destructive migration and retains the underlying data. The same field-definition entry also carries per-field metadata (reason, sensitivity, labels).
- **Optimistic UI pattern (mandatory).** CRUD mutations use the TanStack Query optimistic sequence: cancel in-flight queries → set cache optimistically → roll back on error → invalidate on settle. No loading spinner on CRUD; initial loads use skeletons.
- **Real-time sync pattern (mandatory).** A Supabase Realtime channel is scoped per organization. On a received change event, the handler calls `invalidateQueries` so the cache refetches authoritative state — it must not call `setQueryData` directly in the Realtime handler. On a dropped connection, the client re-subscribes and reconciles without a manual reload.
- **Relationships (single-reference).** A relation field stores the target record's id inside the JSONB `data`; the field carries `relationConfig.targetTable`. Each logical table has a table-level `displayField` used to represent its records wherever referenced (defaults to the first non-hidden text field; cannot be hidden or removed while targeted). Relation fields are validated by the schema validator, which accepts a relation only when the target table exists in the org schema; multi-select cardinality and editor-driven relation creation are gated to the Growth phase.
- **Referential integrity is app-layer, no DB foreign key.** The guarded mutation layer verifies each referenced id exists under the same org and target table before persisting, rejecting foreign or dangling ids. Both sides of a relation share the `records` table, so no new RLS policy is needed.
- **Reference reads use containment, not text extraction.** Forward labels are resolved at read time in a single batched `id IN (...)` lookup per rendered page (never per-row, never copied into the referencing row); labels reflect the current target value on re-render. Filter/sort-by-relationship, the delete-guard reference count (enumerated from referencing table/field pairs in the schema, capped e.g. "500+"), and the reverse related list all use JSONB containment over the `GIN(data jsonb_path_ops)` index — never `->>`. The **one deliberate exception** is the relation typeahead's label *substring* search (`searchRelationRecords`), which containment cannot express and so uses `data->>displayField ILIKE '%q%'` + `ORDER BY`; this meets the p95 budget at MVP scale and its per-table `pg_trgm` index for larger referenced tables is tracked in deferred-work (see the `searchRelationRecords ILIKE` entry).
- **State management.** TanStack Query owns server state; React Context handles stable global state (auth/tenant/i18n). No Redux/Zustand.
- **API contract.** Routes authenticate the session, validate input, run business logic, and return a `{ data, error }` envelope with standard HTTP codes; never expose raw stacks, SQL, or schema/LLM output to the client.
- **i18n.** All user-facing strings resolve through the translation layer; hardcoded strings are disallowed (CI-enforced from the foundation epic).

## UX & Interaction Patterns

- **Responsive data surface:** a single component that renders as a desktop data table and a mobile swipeable card list; do not fall back to a scrolled desktop table on mobile.
- **Inline edit-on-blur:** click-to-edit, auto-save on blur; no edit modals or Save buttons.
- **Optimistic-UI standard:** every CRUD action reflects instantly, then reconciles with the server.
- **Relationship affordances:** pickers and views show records by their display label, never a raw id; archived (soft-deleted) targets render as archived rather than broken; reverse related lists carry the referencing table's filter/sort.
- **Touch ergonomics:** 48x48px minimum touch targets throughout; skeletons for initial load, never spinners.

## Cross-Story Dependencies

- Depends on the foundation epic (shared JSONB data model, membership-based RLS + `auth_org_ids()`, guarded mutation layer, schema-metadata store, query layer, the relationship data-model additions — relation config and table display field) and on the accounts/RBAC epic (a real claimed org, authenticated session, Admin/Member roles). Admin-only controls in Stories 3.5 and 3.7 rely on that RBAC enforcement.
- No dependency on any later epic. The pre-account demo's browse-and-basic-edit lives in the foundation epic; this epic owns the full CRUD / filter-sort / column-hide / real-time / single-reference-relationship suite on the claimed org's real data.
- Relationship stories build on each other: the lookup field and picker (3.7) precede filter/sort and safe-delete (3.8) and the reverse related list (3.9).
- Downstream epics (data import, conversational editor, intake forms, advanced relationships) build on this epic's guarded write path, query/real-time layers, and relationship libraries, but this epic does not depend on them.
