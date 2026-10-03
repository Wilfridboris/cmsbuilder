# Epic 6 Context: Public Intake Forms

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Give every claimed dashboard zero-setup lead capture. On going live, the system auto-generates one public, no-auth, mobile-optimized intake form at `scheza.com/forms/{slug}` whose fields derive from the org's schema (from a designated target table such as Jobs/Leads). An external visitor can submit from their phone in under a minute with no account; the submission lands as a normal record in the owner's table in real time, and the Admin gets an email notification. This matters because it turns the generated workspace into an inbound-lead channel with no separate form tool, while upholding the platform's tenant-isolation and privacy guarantees. (Note: this epic is MVP's single-form delivery; owner-managed, multiple named forms were pulled into a separate later epic and are explicitly out of scope here.)

## Stories

- Story 6.1: Auto-Generated Public Intake Form
- Story 6.2: No-Auth External Submission
- Story 6.3: Real-Time Push to Owner's Dashboard
- Story 6.4: Email Notification on New Submission
- Story 6.5: Exclude Relationship Fields from Public Intake Forms

## Requirements & Constraints

- The form is auto-created per dashboard with no setup, publicly reachable at `/forms/{slug}`, shareable, and openable without login.
- Form fields are derived from the schema-designated intake target table; labels and input types match the field definitions. Keep the form small (clean single page; roughly five fields).
- Submission requires no account; show a warm confirmation message on success (e.g. "Thanks, [owner] will be in touch shortly").
- New submissions appear in the owner's data table within 2 seconds and behave as ordinary records (viewable, editable, filterable).
- Admin receives a Resend email summarizing each submission. Email is the sole MVP channel; web push is deferred to Growth.
- Notification failure must never block data capture: the record is always saved and visible even if the email fails.
- Relationship/lookup fields are excluded from the public form by default: no picker, and no target-table record ids, labels, or counts may appear in the markup or any network payload (privacy / no client-list leak to anonymous submitters). A required relationship is simply left unset on intake and linked later from the dashboard.
- Accessibility: 48x48px touch targets; real associated labels on every field (no placeholder-only labels); accessible, translated inline validation before submit.

## Technical Decisions

- The public intake page (`src/app/forms/[slug]/page.tsx`) resolves `organization_id` from `{slug}` server-side; the client never chooses the table or fields.
- Submissions POST to `src/app/api/intake/[slug]/route.ts`, which writes through the single guarded mutation layer (`src/lib/data/mutate.ts`) using a system/anonymous actor id, scoped to the resolved org, writing only to the designated intake target. No arbitrary service-role tenant writes; this is one of only two deliberately narrow unauthenticated surfaces in the system.
- Tenant data lives in the shared JSONB record store (one `records` table keyed by `organization_id` + logical `table_key`), under the single static membership-based RLS policy. An intake row is just another `records` row.
- Real-time push reuses Epic 3's existing path: Supabase Realtime wake-up to `invalidateQueries`, not a new mechanism.
- Email is sent via Resend; treat the send as best-effort and decoupled from the write.
- Field eligibility (which schema fields render) and the relation-field exclusion must be enforced server-side, in both the rendered form and the accepted payload, not just hidden in the UI.

## UX & Interaction Patterns

- Mobile-first, single-page, no-navigation, no-auth form with large touch targets and accessible labels/validation; it is a focused submission surface, not a dashboard view.
- Success state is a reassuring, owner-named confirmation message (avoid em-dashes in user-facing copy).

## Cross-Story Dependencies

- Depends only on Epics 1-3: the shared data model and RLS (Epic 1), real claimed accounts with `{slug}` (Epic 2), and the guarded `mutate.ts` write layer plus the Realtime-to-`invalidateQueries` sync path (Epic 3). No dependency on any later epic.
- Story 6.5 (relation-field exclusion) couples to the relationship-field model introduced in Epics 1/3 (display fields and lookup fields).
- Out of scope / downstream: owner-managed multiple named forms, target-table choice, per-field customization, branding, publish toggle, and abuse protection are a separate later epic that migrates (not rewrites) this epic's public page and submission handler. Do not build those here.
