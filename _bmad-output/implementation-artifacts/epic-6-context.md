# Epic 6 Context: Public Intake Forms

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give every claimed dashboard a free lead-capture channel with zero extra tooling. Each account auto-generates a public, no-auth, mobile-optimized intake form at `scheza.com/forms/{slug}` whose fields are derived from the org's schema. An external visitor (a potential customer) can submit from their phone in under a minute with no account; the submission persists as a normal record, pushes into the owner's data table in real time, and triggers an email notification to the Admin. This is one of only two deliberately narrow unauthenticated surfaces in the product (the other is the token-gated invoice PDF read), so correctness and scoping matter. Depends only on Epics 1-3; reuses their schema/`org_schemas`, guarded `mutate.ts`, and Realtime infrastructure.

## Stories

- Story 6.1: Auto-Generated Public Intake Form
- Story 6.2: No-Auth External Submission
- Story 6.3: Real-Time Push to Owner's Dashboard
- Story 6.4: Email Notification on New Submission
- Story 6.5: Exclude Relationship Fields from Public Intake Forms

## Requirements & Constraints

- The public form must exist automatically once an account goes live, with no setup step; the URL is shareable (e.g., from a Google Business bio) and opens with no login.
- Form fields are derived from the schema-designated intake target table (e.g., a Jobs/Leads table), with labels and input types matching the field definitions. Keep it a clean, single-page, no-navigation form (target ~5 fields max).
- Mobile/accessibility: every interactive element has a minimum 48x48px touch target; every field has a real associated label (no placeholder-only labelling); validation is accessible, translated, and inline before submission.
- On submit (no account, no login), show a confirmation message naming the owner (e.g., "Thanks - [owner] will be in touch shortly").
- The new record must appear in the owner's table in real time (within 2 seconds) and behave as a normal record: viewable, editable, filterable, sortable like any other row.
- The Admin receives an email notification summarizing each submission. Email (Resend) is the only MVP channel; web push is explicitly deferred to Growth. Email-send failure must never block data capture - the record is still saved and visible.
- Privacy (PIPEDA): relationship/lookup fields are excluded from the public form by default; an anonymous submitter must never be able to browse or pick from another table (e.g., the client list). No target-table record ids, labels, or counts may appear in the form markup or any network payload. If a relationship field is required on the target table, the record is created with the relationship unset and the Admin links it from the dashboard afterward.
- Scope: single auto-generated form per dashboard mapped to one target table. Multiple named forms (`/forms/{slug}/{formKey}`) are deferred to Growth.

## Technical Decisions

- Routes: public page at `src/app/forms/[slug]/page.tsx` (no auth, schema-derived fields); submission handler at `src/app/api/intake/[slug]/route.ts` (POST -> insert row -> email notification). UI in `src/components/intake/IntakeForm.tsx`.
- `{slug}` resolves to the owning `organization_id` server-side; the write is scoped to that org and writes only to the designated intake target table - never an arbitrary write.
- Intake writes go through the single guarded mutation layer `src/lib/data/mutate.ts` with a system/anonymous `actorId` (identity passed as an explicit parameter; `mutate.ts` never reads request cookies). This keeps the narrow intake path consistent with NFR-FC1 rather than being an ad-hoc service-role backdoor. (Note: planning docs describe the no-session intake insert as one of the few narrow platform-bootstrap paths; implement it as the designated narrow intake write path, org-scoped to the slug, and confirm whether it runs under a system identity through `mutate.ts` or a scoped bootstrap client.)
- Real-time delivery reuses the exact Epic 3 path: Supabase Realtime (Postgres Changes) channel scoped per `organization_id` -> TanStack Query `invalidateQueries`. See `src/hooks/useRealtimeSync.ts`. No new real-time mechanism.
- Email via Resend (already in the stack; v6). Resend client lives under `src/lib/resend/`. Treat notification as best-effort/non-blocking relative to the DB write.
- Data model: tenant rows live in the single logical `records` store keyed by `org_schemas` field definitions (no runtime DDL, no per-tenant tables). Field metadata carries input type and labels; relationship fields are expressed via `relationConfig` on the schema field and are the fields to filter out when rendering the public form.
- Data residency: Supabase ca-central-1 (PIPEDA).

## UX & Interaction Patterns

- Customer-facing, mobile-first, single screen: no sign-up, no navigation, no app download. Header shows the business name and a clear call to action. Large touch targets; sub-60-second completion is the target.
- Confirmation copy is warm and names the owner. Avoid em-dashes in any user-facing copy.
- Inline, accessible, translated validation errors shown before submission.

## Cross-Story Dependencies

- All stories depend on Epic 1 (schema generation / `org_schemas`, slug), Epic 2 (claimed account + Admin identity for notifications), and Epic 3 (guarded `mutate.ts`, Realtime -> `invalidateQueries` path, relationship fields and later linking per FR71).
- Within the epic: 6.1 (form generation from schema) underpins 6.2 (submission write); 6.3 (real-time push) and 6.4 (email) both consume a successful 6.2 write; 6.5 (relationship exclusion) constrains how 6.1 renders fields and how 6.2 saves records with unset required relationships.
