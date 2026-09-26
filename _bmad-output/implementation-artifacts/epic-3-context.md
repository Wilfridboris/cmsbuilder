# Epic 3 Context: Core Data Management (Daily Driver)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic delivers the everyday working surface where a claimed organization's team manages its real business records — the moment the product stops being a demo and becomes the business's system of record. Team members view records as a responsive data table on desktop and swipeable cards on mobile, add records through schema-typed forms, edit inline with optimistic UI, delete, filter and sort, and (as Admins) hide columns without losing data — while every teammate sees each other's changes in near real time. All writes flow through the guarded mutation layer under row-level tenant isolation. It operates on the claimed org's real data and depends only on the foundation and account/RBAC epics; it has no forward dependency on any later epic.

## Stories

- Story 3.1: Responsive Table & Card Views
- Story 3.2: Add & Delete Records
- Story 3.3: Inline Edit with Optimistic UI
- Story 3.4: Filter & Sort Records
- Story 3.5: Admin Column Hide (Non-Destructive)
- Story 3.6: Real-Time Multi-User Sync

## Requirements & Constraints

- Records render as a desktop data table and, on mobile viewports, as a swipeable card list showing key fields — one responsive data surface, not a horizontally scrolled table. Mobile is the primary use case.
- Add-record forms are auto-generated from the logical schema definition, with input controls matching each field's data type (text, number, date, dropdown, etc.). Every field must have a real, associated label; placeholder-only labelling is not acceptable.
- Inline editing works by clicking a value and typing, auto-saving on blur — no modals, no explicit Save button. Deletes are soft (retain the row, mark it deleted).
- Filtering and sorting operate within the current logical table; filter/sort state must be reflected in both the desktop and mobile presentations. A filter matching nothing shows an accessible, translated empty state, never an error.
- Admin column-hide removes a column from all views for the org while preserving the field definition and all stored values; hidden columns can be unhidden with data intact. The hide/unhide control is Admin-only (Member RBAC hides it).
- Concurrent edits by teammates propagate to other viewers within ~2 seconds. Concurrent writes to the same record must not silently overwrite — stale writes are rejected and rolled back with a refresh.
- Failed writes/deletes roll the optimistic change back and surface a translated, non-technical message; raw errors are never exposed.
- Performance and accessibility targets that gate this epic: authenticated returning-user dashboard interactive within ~2s (p95, mobile LTE); optimistic edits render instantly with server confirmation within ~1s; real-time propagation within ~2s; 48x48px minimum touch targets; schema-derived ARIA labels on interactive/column semantics; real form-field labels.

## Technical Decisions

- **Logical schema, not physical tables.** A "table" is a `table_key` plus a field-definition entry in the org's schema-metadata store; all tenant rows live in one shared JSONB record store. There is no runtime DDL. Views are driven by the schema definition read from the metadata store.
- **Query layer.** A dedicated records query module lists/filters/sorts rows by `(organization_id, table_key)` using JSONB operators and maps rows onto the field definitions. Build filter/sort against this layer, not ad hoc queries.
- **Guarded writes only.** All record writes (add, edit, delete) go through the single guarded mutation layer, running under the caller's RLS-scoped client with `actorId` set and never using the service-role key. Optimistic concurrency is enforced via the record's `version`; soft-delete uses the `deleted_at` field. Identity is passed explicitly to the mutation layer (it must not read cookies).
- **Column hide is metadata-only.** Hiding a column sets a `hidden` flag on the field definition (append-only); it performs no destructive migration and retains the underlying data. The same field-definition entry also carries per-field `reason`, `sensitive`, and label metadata.
- **Optimistic UI pattern (mandatory).** CRUD mutations use the TanStack Query optimistic sequence: cancel in-flight queries → set cache optimistically → roll back on error → invalidate on settle. No loading spinner on CRUD; initial loads use skeletons.
- **Real-time sync pattern (mandatory).** A Supabase Realtime channel is scoped per organization. On a received change event, the handler calls `invalidateQueries` so the cache refetches authoritative state — it must not call `setQueryData` directly in the Realtime handler. On a dropped connection, the client re-subscribes and reconciles without a manual reload.
- **State management.** TanStack Query owns server state; React Context handles stable global state (auth/tenant/i18n). No Redux/Zustand.
- **API contract.** Routes authenticate the session, validate input, run business logic, and return a `{ data, error }` envelope with standard HTTP codes; never expose raw stacks, SQL, or schema/LLM output to the client.
- **i18n.** All user-facing strings resolve through the translation layer; hardcoded strings are disallowed (CI-enforced from the foundation epic).

## UX & Interaction Patterns

- **Responsive data surface:** a single component that renders as a desktop data table and a mobile swipeable card list; do not fall back to a scrolled desktop table on mobile.
- **Inline edit-on-blur:** click-to-edit, auto-save on blur; no edit modals or Save buttons.
- **Optimistic-UI standard:** every CRUD action reflects instantly, then reconciles with the server.
- **Touch ergonomics:** 48x48px minimum touch targets throughout; skeletons for initial load, never spinners.

## Cross-Story Dependencies

- Depends on the foundation epic (shared JSONB data model, membership-based RLS + `auth_org_ids()`, guarded mutation layer, schema-metadata store, query layer) and on the accounts/RBAC epic (a real claimed org, authenticated session, Admin/Member roles). Admin-only controls in Story 3.5 rely on that RBAC enforcement.
- No dependency on any later epic. The pre-account demo's browse-and-basic-edit lives in the foundation epic; this epic owns the full CRUD / filter-sort / column-hide / real-time suite on the claimed org's real data.
- Downstream epics (data import, conversational editor, intake forms) build on this epic's guarded write path and query/real-time layers, but this epic does not depend on them.
