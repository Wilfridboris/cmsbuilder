# Epic 3 Context: Core Data Management (Daily Driver)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 3 delivers the everyday working surface where a claimed organization manages its real business records, turning the product from a demo into the business's system of record. It provides a single responsive data surface (desktop table / mobile swipeable cards), schema-typed add forms, frictionless inline edit-on-blur with optimistic UI, delete, filter/sort, non-destructive Admin column-hide, and real-time multi-user sync. It also delivers the MVP's core relationship (lookup) capabilities: single-reference fields with a searchable picker, label resolution in views, filter/sort by relationship, a safe delete guard for referenced records, and a reverse "related list." All writes flow through the guarded mutation layer under row-level security. This epic operates on the claimed org's real data and depends only on Epics 1-2 (data model, mutation layer, authenticated accounts); it has no forward dependency on later epics.

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
- Story 3.10: Non-Empty Validation on Add/Edit

## Requirements & Constraints

- Records render as a desktop data table and, on mobile viewports, as a swipeable card list showing key fields — a single data surface, not a horizontally scrolled table. Mobile is the primary use case.
- Add forms are auto-generated from the schema definition with input controls matching each field's data type; every field needs a real associated label (no placeholder-only labelling).
- Inline edit: click a value and type, auto-save on blur; no edit modals or save buttons.
- Deletes are soft (set a deleted timestamp), never hard; the row leaves the user's views but data is retained.
- Admin column-hide removes a column from all org views while preserving the field definition and all stored values (append-only hide flag, reversible); the control is Admin-only.
- Filter/sort apply within a logical table and stay consistent across both desktop and mobile views; an empty match shows an accessible, translated empty state, never an error.
- Non-empty validation rejects a fully-blank record before any mutation call; per-field required enforcement is explicitly out of scope (deferred to keep mobile entry fast).
- Relationship (lookup) fields are single-reference in this epic; multi-select is deferred to Growth. Each target table has one canonical display label field. Referencing views show the target's label (never the raw id), resolved at read time so a later label change is reflected on re-render.
- Performance targets: returning-user dashboard interactive within 2s at p95 on mobile LTE; inline edits optimistic with server confirmation within 1s; teammate changes visible within 2s; relationship typeahead returns matches within 500ms at p95 for tables up to 50k rows; label/related-list resolution adds no more than 300ms to page render.
- Accessibility: minimum 48x48px touch targets; ARIA labels derived from schema field names; real (non-placeholder) form labels; WCAG AA.
- Failed writes/deletes roll back the optimistic change and show a translated, non-technical message; never expose raw errors. User-facing copy must avoid em-dashes.

## Technical Decisions

- Tenant data lives in a single shared JSONB record store, not per-tenant physical tables. A "table" is logical: a table key plus a field-definition entry in the org schema. There is no runtime DDL. Reads go through the JSONB records query layer.
- All tenant writes flow through the single guarded mutation layer under the caller's RLS-scoped client. It takes identity as an explicit parameter (never reads cookies), requires an actor id, accepts an optional idempotency key, and enforces optimistic concurrency via a per-record version. No code path writes tenant rows with the raw service-role key. A stale version write is rejected and rolled back with a refresh, never silently overwritten.
- Isolation is a single static membership-based RLS policy on the records table; relationships need no new policy because both sides share that table.
- Optimistic UI uses the TanStack Query pattern: cancel queries, set query data, roll back on error, invalidate on settle. Real-time handlers must trigger query invalidation (refetch authoritative state), never a direct cache write.
- Real-time uses Supabase Realtime as a wake-up signal only; on a dropped connection the client re-subscribes and reconciles without a manual reload.
- Relationship model: a relation field stores the target record's id in the JSONB data; field-level config carries the target table, while the display label field is table-level on the org-schema table entry (one canonical label field shared by every relation pointing at it). The display field defaults to the first non-hidden text field and cannot be hidden or removed while any relation targets its table (rename is safe since the key is stable).
- Referential integrity is app-layer, enforced in the mutation layer: every relation write verifies each referenced id exists under the same org and target table, rejecting foreign or dangling ids. There is no database foreign key.
- Query conventions for relationships: forward labels and the picker use a single batched id-IN lookup per rendered page (never per-row / N+1); the reverse related list, filter/sort-by-relationship, and the delete-guard count use JSONB containment over the GIN(jsonb_path_ops) index — never text-extraction operators (they cannot use the index and seq-scan at scale).
- Delete guard: before deleting a referenced record, enumerate referencing (table, field) pairs from the org schema, count references via containment (capped, e.g. "500+"), warn, then soft-delete; referencing rows keep the id and render the target as "archived" (no orphan cleanup).
- Non-empty validation should be built on a shared server-side validator seam (the first slice of broader data-vs-schema conformance validation intended to be shared with the Epic 5 conversational-editor guardrails), not a throwaway check.
- Relationship scale escalation is pre-decided (generated column + btree index, then edge table, then materialized view) but applied only on evidence when performance thresholds are breached, not preemptively.

## UX & Interaction Patterns

- Inline edit-on-blur: click-to-edit in place, auto-save, no modals or explicit save buttons.
- Optimistic-UI standard: every CRUD action reflects instantly then reconciles with the server; no loading state on CRUD. Use skeletons (not spinners) for initial load.
- Responsive data surface: one component renders as a desktop data table and a swipeable mobile card list.
- All interactive elements sized for thumbs (48x48px minimum touch targets).
- Relationship picker is a searchable server-side typeahead over the target table, showing candidates by their display label.

## Cross-Story Dependencies

- Depends on Epic 1 (shared JSONB data model, schema definitions, Schema Validator, mutation layer foundations) and Epic 2 (real claimed accounts and Admin/Member RBAC — Admin-only controls here are enforced per that RBAC). No dependency on any later epic.
- Within the epic, relationship stories build in sequence: the lookup field and picker (3.7) precede filter/sort and the safe delete guard (3.8) and the reverse related list (3.9).
- Relationship fields are excluded from public intake forms by default — that enforcement is owned by Epic 6, not this epic.
- Multi-select relationships, conversational-editor relation creation, and relation-aware CSV import are deferred to Growth (Epic 9).
