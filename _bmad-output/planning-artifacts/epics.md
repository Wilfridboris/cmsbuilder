---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/architecture.md
  - docs/design.md
---

# Scheza - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for Scheza, decomposing the requirements from the PRD, UX Design (`docs/design.md`), and Architecture requirements into implementable stories.

> **Scope note:** Scheza is delivered in phases. **MVP (Phase 1)** = FR1–FR55, the MVP relationship FRs (FR70–FR78), **the Invoicing, Payments & Delivery module (FR82–FR95, Epic 12)**, and all non-Forward-Compatibility NFRs, with the Forward-Compatibility NFRs (NFR-FC1–FC4) constraining *how* MVP is built. **Growth** = FR56–FR61 + FR79–FR81. **Vision / Phase 3** = FR62–FR69 (gated, traceability only). Epic and story creation focuses on MVP + the Growth/Phase-3 seams that must not be foreclosed.
>
> **Reconciliation note (2026-09-27 invoice-to-cash pivot):** Epic 12 (Invoicing, Payments & Delivery) was added for FR82–FR95, and **Epic 7 (Billing) was reconciled from usage-based metering to flat all-inclusive tiers** (Solo/Crew/Shop) along with its FR30/FR53–FR55 stories and the Epic 1 signals note. Predictability is the product promise for this buyer; the tier signal is invoicing volume (invoices issued per cycle, counted from the fixed Invoicing module — uniform across tenants, unlike the per-tenant generated "jobs"), which drives only a tier-change prompt, never a meter or spend cap.

## Requirements Inventory

### Functional Requirements

**App Generation**

- **FR1:** Visitor can describe their business using a guided structured prompt (trade type, city, and what they track) without creating an account
- **FR2:** The system generates a relational database schema from the user's prompt input within 45 seconds
- **FR3:** The system populates generated tables with hyper-contextual, Ontario-localized synthetic data at generation time
- **FR4:** The system automatically deploys a hardcoded Universal Field Service Template when LLM generation fails twice consecutively, without displaying an error screen
- **FR5:** Visitor can browse, interact with, and edit the generated dashboard before creating an account

**Data Management**

- **FR6:** User can view records in a table as a data table (desktop) or swipeable card list (mobile)
- **FR7:** User can add new records to any table via an auto-generated form with input types matching the column data types
- **FR8:** User can edit existing records inline without navigating to a separate screen
- **FR9:** User can delete individual records from any table
- **FR10:** User can filter and sort records within any table view
- **FR11:** Admin can hide a column from all views without deleting the column or its stored data
- **FR12:** Multiple team members can view and edit records concurrently with changes reflected in real time

**Conversational Editor**

- **FR13:** Admin can add a new column to an existing table by describing the change in natural language
- **FR14:** Admin can add a new table by describing it in natural language
- **FR15:** Admin can request a new filtered or sorted view of an existing table in natural language
- **FR16:** The system preserves all existing row data when schema changes are executed via the Conversational Editor
- **FR17:** The system responds with a safe, non-technical message when a user requests an unsupported operation (column delete, table delete, rename), and applies a frontend visibility change where applicable

**User Access & Permissions**

- **FR18:** Visitor can claim a generated app by providing their email address and authenticating via a magic link
- **FR19:** User can authenticate to an existing account via magic link without a password
- **FR20:** Admin can invite team members to their dashboard by email address
- **FR21:** Admin can assign a role (Admin or Member) to each invited team member before the invitation is sent
- **FR22:** The system automatically assigns the Admin role to the account creator
- **FR23:** Member can view, add, and edit records
- **FR24:** Member cannot access the Conversational Editor, Settings, Invite, or Billing features

**Intake Forms**

- **FR25:** The system automatically generates a public intake form URL for every claimed dashboard
- **FR26:** External visitors can submit records via the public intake form without creating an account
- **FR27:** Intake form submissions appear in the dashboard owner's data table in real time
- **FR28:** Admin receives an email notification when a new intake form submission is received (web push notifications are deferred to Growth phase; MVP fulfillment is email via Resend)

**Billing & Subscriptions**

- **FR29:** User can begin a 14-day free trial without providing payment information
- **FR30:** Admin can start a flat-fee monthly subscription (tiered by business size, all-inclusive) via a Stripe-hosted checkout page
- **FR31:** Admin can manage their subscription (update payment method, view invoices, cancel anytime with no contract) via the Stripe Customer Portal
- **FR32:** The system transitions an account to read-only mode when the trial period expires or the subscription lapses
- **FR33:** Admin receives email notifications at Day 12 and Day 14 of the trial period prompting them to add billing

**Localization & Compliance**

- **FR34:** User can switch the dashboard UI language between English and French without a page reload
- **FR35:** The system generates French-language synthetic data when the user's prompt is submitted in French
- **FR36:** The system displays a mandatory, unchecked privacy consent checkbox at account claim that must be checked before the account is created
- **FR37:** Admin can export all their organization's data as a CSV or JSON file
- **FR38:** The system places an account in a 30-day read-only grace period upon cancellation, then performs a hard cascade delete of all organization data
- **FR39:** Admin receives email notifications at Days 1, 7, and 25 of the offboarding grace period
- **FR40:** The system displays a field-level indicator on columns flagged as storing sensitive or personally identifiable data

**Platform & Security**

- **FR41:** The system prompts mobile users to install the dashboard as a PWA on their home screen
- **FR42:** All schema modification requests from the Conversational Editor are validated against a permitted-operations allowlist before being executed
- **FR43:** The system rejects schema change requests containing restricted keywords and returns a user-facing plain-language error message
- **FR44:** Each organization's data is strictly isolated such that no authenticated user can read or write another organization's records
- **FR45:** All Schema Validator rejections are logged with the user's organization ID and raw LLM output for platform monitoring

**Schema Explainability (MVP)**

- **FR46:** The system displays a one-line, plain-language reason for each AI-generated table and field at generation time
- **FR47:** User can remove or rename any AI-generated field or table with a single action at generation time, without opening a settings screen (removal uses the append-only hide mechanism; no destructive migration)

**Data Import (MVP — Tier 1)**

- **FR48:** User can upload a CSV or Excel file to import records into their dashboard
- **FR49:** The system proposes an AI-generated column-to-field mapping for an uploaded file and displays it for review before any data is written
- **FR50:** User can edit any proposed column mapping before confirming the import
- **FR51:** The system flags columns it cannot confidently map rather than silently guessing, and requires the user to resolve them before import proceeds
- **FR52:** The system replaces synthetic demo data with imported real data without data loss upon the user confirming the import

**Billing — Flat Tiers (MVP)**

- **FR53:** The system assigns each account a flat subscription tier and bills a fixed monthly fee for that tier via the billing provider
- **FR54:** Admin can view their current tier, what it includes, and their next billing date at any time
- **FR55:** The system surfaces a tier-change prompt when an account's invoicing volume (invoices issued per cycle) sustainably exceeds its current tier band, rather than silently metering overage

**Invoicing, Payments & Delivery (MVP)** *(a fixed, compliant module — its own Invoices tab, not an AI-generated table)*

- **FR82:** Admin can create an invoice, from an existing work record (pulling customer and line items) or standalone, in a fixed, compliant Invoices module
- **FR83:** The system captures a reusable Business Profile (legal name, operating name, entity type, jurisdiction, GST/HST number, logo, addresses, payment terms, default invoice language) and renders one clean, full-detail invoice template from it (identity capture, not a template designer)
- **FR84:** The system calculates and shows Ontario HST as a separate tax line at the place-of-supply rate, and does not label or calculate tax when the business is not GST/HST-registered
- **FR85:** The system shows the supplier legal name together with the operating name, and the GST/HST registration number, on every invoice that charges tax
- **FR86:** The system assigns each invoice a unique number, snapshots supplier and customer identity onto the finalized invoice, and makes an issued invoice immutable
- **FR87:** The system blocks issuance when required compliance fields are missing (for example tax charged without a valid registration, HST split into components, totals not reconciling, or missing legal identity), returning a plain-language reason
- **FR88:** Admin can correct an issued invoice only via a linked credit note in its own number sequence, never by editing the sent invoice
- **FR89:** The system stores each invoice as structured records and freezes a rendered PDF copy on send, retaining structured data and each rendered PDF for at least six years
- **FR90:** Every invoice carries a structured Payment Instructions block (e-transfer email, cheque payable-to and mailing address, and an owner-provided card-payment link as free text)
- **FR91:** Admin can mark an invoice as paid, recording method, date, amount, and reference (no payment is processed or held by Scheza in MVP)
- **FR92:** The Invoices tab defaults to an Unpaid / Overdue view derived from invoice status and due date, working uniformly across all tenants regardless of generated schema
- **FR93:** Admin can send an invoice as a PDF from their own device via the native share sheet (WhatsApp, SMS, or email) so it is delivered from the owner's own number or account; the SMS path sends an unguessable secure link to the same PDF
- **FR94:** On desktop, the system can send the invoice email with the PDF attached via Resend using reply-to the owner's address, and offers Download PDF and Copy Link as alternatives
- **FR95:** The system determines invoice language and tax from the customer's province (place of supply); MVP supports Ontario (English, HST) and stores customer province so Quebec (French, GST + QST, QST number) can be enabled later without re-architecture

**Growth-Phase Requirements** *(post-$1K MRR; listed for traceability)*

- **FR56:** The system records material per-tenant data events (record create, edit, delete; schema change; member invite; status change) to an append-only activity log scoped by organization
- **FR57:** The system proposes workflows to the Admin in plain language based on per-tenant usage patterns
- **FR58:** Admin can accept, edit, or dismiss each proposed workflow, and dismissed suggestions are not proposed again
- **FR59:** The system executes accepted workflows via trigger/action rules on database events with conditional logic
- **FR60:** The system maintains a per-tenant record of repeated manual actions, edited workflows, dismissed suggestions, and terminology, and uses it to inform future suggestions and schema refinements
- **FR61:** Admin can export a Business Snapshot summarizing customer and job records, revenue history, and activity timeline

**Autonomous Operations (Vision — Phase 3)** *(gated; traceability only — neither MVP nor Growth scope)*

- **FR62:** The system proposes a real-world operational action (e.g., send a follow-up, flag a reorder, update a status) to the Admin based on per-tenant patterns and pending work
- **FR63:** Admin can approve, edit, or reject each proposed action before it executes
- **FR64:** The system executes an approved action end-to-end and records it — before and after execution — to the tenant activity log
- **FR65:** The system executes an action-type autonomously once a per-type trust threshold is met (default: 5 consecutive Admin approvals of that action-type with no edit or rejection), while keeping money-spending and customer-facing action-types approval-gated by default
- **FR66:** Admin can review, pause, or revoke the autonomy granted to any action-type at any time
- **FR67:** The system reports completed and pending autonomous work to the Admin via a chosen channel (SMS, messaging app, email, or dashboard)
- **FR68:** Admin can view and manage the operator's work organized as named roles (e.g., bookkeeping, sales follow-up, operations), each with autonomy granted or revoked independently
- **FR69:** The operator can perform actions through connected external tools via a standard tool-connection protocol; each connected tool is an allowlisted, approval-gated action class subject to activity-log audit and per-type trust threshold, with money-spending tools additionally requiring an Admin-set spend cap and explicit opt-in

**Relationships & Lookups** *(added 2026-09-26; MVP core FR70–FR78, Growth advanced FR79–FR81. IDs continue the global sequence; phase tagged inline.)*

- **FR70:** *[MVP]* The generated schema links related core tables using relationship fields (e.g., Job→Client, Invoice→Job) rather than duplicating identifying data as free text
- **FR71:** *[MVP]* User can add a relationship (lookup) field pointing to records in another table in the same organization (single reference)
- **FR72:** *[MVP]* Add/edit forms present a searchable, server-side-typeahead picker over the referenced table, showing each record by its display label
- **FR73:** *[MVP]* Table and card views display the referenced record's label, not an internal id
- **FR74:** *[MVP]* User can filter and sort a table by a relationship field (by selecting a referenced record)
- **FR75:** *[MVP]* Each table has a designated display field used to represent its records wherever they appear as a reference
- **FR76:** *[MVP]* Deleting a referenced record warns with the referencing count, then soft-deletes; referencing rows keep the id and show the target as archived
- **FR77:** *[MVP]* From a record, the user sees a related list of the records that reference it (e.g., all invoices for a client), with the referencing table's filter/sort
- **FR78:** *[MVP]* Relationship fields are excluded from public intake forms by default (no client-list leak to anonymous submitters)
- **FR79:** *[Growth]* A relationship field can reference multiple records (multi-select)
- **FR80:** *[Growth]* Admin can create or adjust a relationship field via the Conversational Editor in natural language, subject to Schema Validator approval
- **FR81:** *[Growth]* CSV/Excel import can map a column onto a relationship field by matching values to existing referenced records, flagging unmatched values to resolve (link or create) before import

### NonFunctional Requirements

**Performance**

- **NFR-P1:** Prompt submission to interactive, populated dashboard: < 45 seconds at p95
- **NFR-P2:** Supabase DB provisioning from validated JSON schema: < 5 seconds
- **NFR-P3:** Dashboard page load for an authenticated returning user: < 2 seconds at p95 on mobile LTE
- **NFR-P4:** Inline record edits appear in the UI immediately (optimistic rendering); server confirmation within 1 second
- **NFR-P5:** Real-time record updates sync to all active shared dashboard members within 2 seconds
- **NFR-P6:** EN/FR language toggle applies in < 300ms with no page reload
- **NFR-P7:** CSV/Excel import of up to 5,000 rows completes in < 60 seconds; the column-mapping preview renders in < 5 seconds of file upload
- **NFR-P8:** (Growth) Workflow suggestions are computed asynchronously and never block CRUD operations; a computed suggestion surfaces within one dashboard session refresh
- **NFR-P9:** A relationship picker returns typeahead matches within 500ms at p95 for referenced tables up to 50,000 rows; resolving reference labels and related-list rows for a rendered page adds no more than 300ms to render time

**Security**

- **NFR-S1:** All data in transit must be encrypted using TLS 1.2 or higher
- **NFR-S2:** All data at rest must be encrypted at the infrastructure level (AES-256 or equivalent via Supabase/AWS)
- **NFR-S3:** Row-Level Security policies must be active on 100% of tenant data — verified by automated test before any table/data is exposed to the frontend
- **NFR-S4:** The Schema Validator must reject 100% of requests containing restricted keywords (`DROP`, `GRANT`, `TRUNCATE`, `DELETE`, `EXEC`, `--`, `;`, `/*`)
- **NFR-S5:** 100% of LLM API calls must include the hardened identity-masking system prompt
- **NFR-S6:** The Supabase service role key must never appear in client-side code — enforced by a CI lint rule that fails the build if the key is detected in frontend bundles
- **NFR-S7:** The Schema Validator accepts a relationship operation only when the referenced table exists in the org schema and the relationship configuration validates; it continues to reject 100% of restricted keywords (NFR-S4) and never emits raw DDL

**Scalability**

- **NFR-SC1:** The architecture must support 200 concurrent active organizations without manual infrastructure changes
- **NFR-SC2:** Vercel serverless functions must auto-scale to handle traffic spikes without manual intervention
- **NFR-SC3:** Each organization's generated schema may contain up to 20 tables and 50,000 rows within the MVP infrastructure tier; growth beyond this triggers an upgrade prompt to the Admin

**Accessibility**

- **NFR-A1:** All UI text and interactive elements must meet WCAG AA color contrast ratios at minimum; WCAG AAA where achievable (per AODA obligations for Ontario-serving products)
- **NFR-A2:** All interactive elements (buttons, row selectors, form fields, toggles) must have a minimum touch target of 48×48px
- **NFR-A3:** AI-generated UI components must include ARIA role labels derived from schema context (e.g., a column named "Invoice Status" generates `aria-label="Invoice Status"`)
- **NFR-A4:** All form fields must have associated visible or screen-reader-accessible labels — no placeholder-only labelling

**Reliability**

- **NFR-R1:** Core dashboard operations (view, add, edit, delete records) must remain available during LLM API outages — LLM is not a dependency for CRUD, only for schema generation and the Conversational Editor
- **NFR-R2:** Platform uptime target: 99.5% monthly for MVP; 99.9% monthly for Growth phase
- **NFR-R3:** LLM API timeout threshold: 15 seconds; the Hard Fallback Schema must be triggered automatically at this threshold — no user-facing timeout or error screen
- **NFR-R4:** Stripe webhook processing failures must not affect a user's ability to access their dashboard — subscription status is cached in Supabase and serves as the fallback source of truth
- **NFR-R5:** Flat-tier subscription state in the billing provider must reconcile with the account's tier in Supabase every cycle, verified by an automated job; any drift pages before it can affect access. Billing accuracy is a trust requirement

**Forward-Compatibility (Autonomous Operations — Phase 3)** *(constrain HOW the MVP is built; nothing agentic ships in MVP)*

- **NFR-FC1:** All tenant-data mutations — from the app today and any future automated actor — must flow through a single guarded action layer under a per-actor, org-scoped identity subject to RLS; no code path may write tenant data using the raw Supabase service-role key
- **NFR-FC2:** The tenant activity log (Growth) must be an authoritative, append-only event stream consumable via a replayable cursor; Supabase Realtime / Postgres NOTIFY may serve only as a wake-up optimization, never as the system of record for events
- **NFR-FC3:** The MVP must not assume request-scoped compute is the only compute; a documented seam must exist for a persistent or scheduled worker to read the event stream and invoke the guarded action layer out-of-band
- **NFR-FC4:** Any future autonomous action must be expressible as an entry on an action allowlist (the Schema Validator model generalized from schema-ops to real-world actions) and must be recorded to the activity log before and after execution

### Additional Requirements

*Technical requirements extracted from `architecture.md` and `project-context.md` that shape epic/story implementation. **Where the PRD's literal wording and the Architecture conflict, the Architecture is authoritative** (see the critical note below).*

**Starter Template (impacts Epic 1, Story 1)**

- **AR1:** Initialize the repo with `create-next-app@latest` using flags: `--typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack`. This is the mandated greenfield starter (T3 Stack, Supabase starter, and custom-from-scratch were explicitly rejected).
- **AR2:** Post-init, initialize shadcn/ui (`npx shadcn@latest init --style new-york --base-color zinc --css-variables`) and install pinned core dependencies: `@supabase/supabase-js@2.105.4`, `@supabase/ssr@0.10.3`, `@google/genai@2.4.0`, `stripe@22.1.1`, `@stripe/stripe-js@9.5.0`, `resend@6.12.3`, `next-intl@4.12.0`, `framer-motion@12.38.0`, `react-hook-form@7.76.0`, `zod@4.4.3`, `@hookform/resolvers@5.2.2`, `react-swipeable@7.0.2`, `@tanstack/react-query@5.100.10`; data-import parsers `papaparse@5.4.1` + `xlsx@0.18.5`; and Sentry (`@sentry/nextjs@10.53.1` via wizard).

**Data Architecture (authoritative — supersedes PRD's "generated tables per tenant" language)**

- **AR3:** Tenant data uses a **shared JSONB record store**, NOT physical tables per tenant. All tenant rows live in ONE static `public.records (id, organization_id, table_key, data JSONB, actor_id, version, created_at, updated_at, deleted_at)` table. A generated "table" is *logical* — a `table_key` + a field definition row in `public.org_schemas`. **There is NO runtime DDL**; provisioning = insert an `org_schemas` row + seed `records`.
- **AR4:** RLS is a **single static, membership-based policy** on `records`, created once in a platform migration. `organization_id` is a real FK to `organizations.id` (**never a user UID**). Isolation via `USING (organization_id IN (SELECT auth_org_ids()))` where `auth_org_ids()` is a `SECURITY DEFINER` function reading the caller's org ids from `org_members`. `org_members` carries `principal_type` (`human | agent`).
- **AR5:** All tenant writes flow through a single guarded mutation layer `src/lib/data/mutate.ts` under the caller's RLS-scoped client (NFR-FC1). `mutate.ts` takes identity as an explicit parameter (never reads `cookies()`), accepts `actorId` + optional `idempotencyKey`, and uses `version` for optimistic concurrency. Service-role key is bootstrap-only (anonymous generation, claim, cross-org cron, offboarding).
- **AR6:** The entire schema (platform + `records` + `org_schemas`) is Supabase CLI-migrated. `normalizeTableName()` must be applied to all user-provided table/field names before persistence as `table_key`/field `key`.

**AI / LLM Pipeline (Architecture uses Google Gemini, not the OpenAI/Groq named in the PRD Integration List)**

- **AR7:** All Gemini calls go through `callGeminiWithTimeout()` (`src/lib/gemini/client.ts`) with `HARDENED_SYSTEM_PROMPT` on every call; model `gemini-3.8-flash` (superseded the original `gemini-2.0-flash` pin in Story 1.4 — see Epic 1 retro 2026-09-24); 15s timeout via `Promise.race` + `AbortController`; retry once, then deploy `UNIVERSAL_FIELD_SERVICE_TEMPLATE`. Generation is ONE structured call returning `{ schema, seedRows }`; `responseMimeType: "application/json"` + `responseSchema`. Gemini MAY propose `relation` (lookup) fields — the hardened prompt permits describing relationships between tables (never SQL); see AR14 and architecture §Relationships.
- **AR8:** The Schema Validator (`src/lib/schema/validator.ts`) runs synchronously on every LLM-proposed schema-metadata operation before persistence to `org_schemas`. Permitted ops MVP: `add_table`, `add_field`, `add_view` (append-only). Rejects reserved column collisions and blocked keywords; logs all rejections to Sentry with `organization_id` + raw output. Signature is `validate(op, { phase, source })`: it accepts a `relation` field only when `relationConfig.targetTable` resolves to an existing logical table (**two-pass** over the generation batch — self-reference and cycles are allowed), and gates `cardinality:'many'` and the editor `source` relation path to `phase === 'growth'` (NFR-S7).
- **AR14:** *(Relationships — added 2026-09-26)* A `relation` field stores the target record's id (single) or an id array (multi-select, Growth) in `records.data`; `SchemaField` gains `relationConfig { targetTable, cardinality }` and each `org_schemas` table gains a **table-level** `displayField` (FR75; defaults to first non-hidden text field; cannot be hidden/removed while targeted). Referential integrity is app-layer via `mutate.ts`: the FR76 delete guard enumerates referencing `(table_key, field)` from `org_schemas` and counts via JSONB **containment** over `GIN(data jsonb_path_ops)` (capped, e.g. "500+"), warns, then soft-deletes; every relation write verifies each id exists under the same org + `targetTable`. Reverse related list (FR77) and label resolution use containment (**never** `->>`); forward labels batch via `id IN (...)`. No DB FK; RLS needs no new policy (both sides share `records`). Scale escalation (generated column → edge table → materialized view) per architecture *§Relations at scale*.

**Infrastructure, Deployment & CI/CD**

- **AR9:** Hosting on **Vercel**; database on **Supabase ca-central-1** (PIPEDA — never change region). CI/CD via GitHub Actions → Vercel preview deploy per PR, production deploy on merge to main. Env vars: `.env.local` (dev), Vercel project env vars (staging/prod); `.env.example` committed with placeholders only.
- **AR10:** Scheduled jobs run on **Vercel Cron** (declared in `vercel.json`) hitting `CRON_SECRET`-protected `/api/cron/*` routes: Stripe usage reporting + usage reconciliation (NFR-R5). No extra runtime dependency.
- **AR11:** CI must run: lint (including a custom ESLint rule that **fails the build if `SUPABASE_SERVICE_ROLE_KEY` appears in the client bundle**, NFR-S6) + type-check + the RLS isolation test.
- **AR12:** `tests/integration/rls-isolation.test.ts` is a **hard CI gate** — must verify BOTH an invited *member* of Org A CAN read Org A's records AND a *stranger* CANNOT (membership-based RLS). Do not mock the Supabase DB in integration tests.

**Standard Response & Error Contracts**

- **AR13:** Every API route follows: authenticate session → validate input with Zod → business logic → return the `{ data: T | null, error: string | null }` envelope. HTTP codes: 200/201, 400, 401, 403, 422, 500. Throw `AppError` (statusCode + userMessage); never expose raw stacks, SQL, schema JSON, or LLM output to the client.

### UX Design Requirements

*Extracted from `docs/design.md`. **Note:** `docs/design.md` uses the older "DashForge" brand and proposes a bespoke visual system (Geist/Inter, custom palette). The Architecture's off-the-shelf mandate constrains MVP to **shadcn/ui New York / zinc defaults** — so bespoke-token UX-DRs below are reconciled to shadcn tokens for MVP and flagged where they diverge.*

- **UX-DR1:** **Landing "conversation" screen** — a hyper-minimalist, single-input landing (guided "Mad Libs" structured prompt per FR1) with no pricing tiers or feature lists; the primary and only above-the-fold action is describing the business. (Supports FR1)
- **UX-DR2:** **Skeleton "grow-into-dashboard" transition** — during generation, skeleton screens organically animate into the real dashboard layout (no loading bar/spinner); implement with shadcn `Skeleton` + Framer Motion. (Supports FR2, NFR-P1; loading-state hierarchy item 2)
- **UX-DR3:** **No blank states** — every generated view is pre-populated with synthetic data so the user never sees an empty canvas. (Supports FR3, FR5)
- **UX-DR4:** **Floating AI Assistant (chat pill/orb)** — a fixed, always-available conversational entry point (bottom-right) for schema edits, rendered only for Admins; shows a "thinking…" bubble during mutations. (Supports FR13–FR15, FR24; loading-state hierarchy item 4)
- **UX-DR5:** **Inline edit-on-blur pattern** — click a value and type; auto-saves on blur with optimistic UI; no Edit modals or Save buttons. (Supports FR8, NFR-P4)
- **UX-DR6:** **Optimistic-UI interaction standard** — every CRUD action reflects instantly, then reconciles with the server (TanStack Query optimistic pattern; no loading state on CRUD). (Supports FR7–FR9, NFR-P4; loading-state hierarchy item 3)
- **UX-DR7:** **Responsive DataTable ⇄ Swipeable Card component** — a single data surface that renders as a shadcn DataTable on desktop and a `react-swipeable` card list on mobile (mobile is the primary use-case). (Supports FR6)
- **UX-DR8:** **48×48px minimum touch targets** — all interactive elements sized for thumbs on mobile. (Supports NFR-A2)
- **UX-DR9:** **"Make it Real" claim handoff** — a prominent, high-contrast claim CTA that triggers the magic-link claim, clears synthetic data, and locks in the live app. Consent checkbox (FR36) is a hard blocker at this step. (Supports FR18, FR36)
- **UX-DR10:** **PWA "Add to Home Screen" prompt** — surfaced to mobile users to install a native-feeling icon, bypassing app stores. (Supports FR41)
- **UX-DR11:** **Seamless EN/FR language toggle** (top-right) that flips UI labels, column names, and synthetic/dummy data with no reload, in < 300ms. (Supports FR34, FR35, NFR-P6)
- **UX-DR12:** **Field-level sensitivity indicator** — a padlock/lock affordance with a plain-language, PIPEDA-reassuring tooltip on columns flagged as sensitive/PII. (Supports FR40)
- **UX-DR13:** **Schema explainability affordance** — an inline info icon on each AI-generated table/field showing its one-line reason, with a one-tap Remove/Rename beside it, at generation time. (Supports FR46, FR47)
- **UX-DR14:** **Visible, editable import mapping UI** — the CSV/Excel import "shows its work": a mapping table of source-column → target-field, each editable, with unmappable columns flagged for resolution before any commit. (Supports FR49–FR51)
- **UX-DR15:** **AODA/WCAG contrast + AI-generated ARIA** — meet WCAG AA (AAA where achievable); no light-grey-on-white; AI-generated components emit context-derived ARIA labels; form fields have real (non-placeholder-only) labels. (Supports NFR-A1, NFR-A3, NFR-A4)
- **UX-DR16:** **Mobile-optimized single-page intake form** — the public intake form is a clean, no-nav, no-auth, large-touch-target single page. (Supports FR25, FR26)
- **UX-DR17:** **"Spatial Clean" visual language (MVP-constrained)** — depth-over-borders aesthetic (subtle shadows/blur). **MVP uses shadcn New York / zinc CSS-variable theme** per the off-the-shelf mandate; the bespoke palette (`#FAFAFA`/`#111111`/`#34C759`) and Geist/Inter typography from `docs/design.md` are a Growth-phase polish investment, not MVP work. (Design-system baseline; reconciles design.md with architecture)

### FR Coverage Map

**MVP (Phase 1)**

- FR1: Epic 1 — Guided structured (Mad Libs) prompt, no account
- FR2: Epic 1 — LLM schema generation < 45s
- FR3: Epic 1 — Ontario-localized synthetic data injection at generation
- FR4: Epic 1 — Universal Field Service Template fallback after 2 failures
- FR5: Epic 1 — Browse/interact/edit demo dashboard pre-account
- FR6: Epic 3 — DataTable (desktop) / swipeable card (mobile) views
- FR7: Epic 3 — Add records via schema-typed auto-generated form
- FR8: Epic 3 — Inline edit without leaving the screen
- FR9: Epic 3 — Delete individual records
- FR10: Epic 3 — Filter and sort within a table view
- FR11: Epic 3 — Admin hides a column without deleting data
- FR12: Epic 3 — Concurrent multi-user edits reflected in real time
- FR13: Epic 5 — Add column via natural language
- FR14: Epic 5 — Add table via natural language
- FR15: Epic 5 — Add filtered/sorted view via natural language
- FR16: Epic 5 — Preserve all row data on schema change
- FR17: Epic 5 — Safe non-technical response + visibility change for unsupported ops
- FR18: Epic 2 — Claim app via email + magic link
- FR19: Epic 2 — Authenticate to existing account via magic link
- FR20: Epic 2 — Invite team members by email
- FR21: Epic 2 — Assign Admin/Member role before invite
- FR22: Epic 2 — Auto-assign Admin to account creator
- FR23: Epic 2 — Member can view/add/edit records
- FR24: Epic 2 — Member cannot access Editor/Settings/Invite/Billing
- FR25: Epic 6 — Auto-generated public intake form URL per dashboard
- FR26: Epic 6 — No-auth external intake submission
- FR27: Epic 6 — Intake submissions appear in owner's table in real time
- FR28: Epic 6 — Admin email notification on new intake (Resend)
- FR29: Epic 7 — 14-day free trial, no payment info
- FR30: Epic 7 — Start flat-tier subscription (fixed price per tier) via Stripe Checkout
- FR31: Epic 7 — Manage subscription via Stripe Customer Portal
- FR32: Epic 7 — Read-only mode on trial expiry / subscription lapse
- FR33: Epic 7 — Trial billing email reminders (Day 12, 14)
- FR34: Epic 8 — EN/FR UI toggle without reload
- FR35: Epic 1 — French synthetic data when prompt is French *(moved from Epic 8 — belongs to the generation pipeline)*
- FR36: Epic 2 — Mandatory unchecked privacy consent checkbox at claim
- FR37: Epic 8 — Export all org data as CSV/JSON
- FR38: Epic 8 — 30-day read-only grace + cascade delete on cancellation
- FR39: Epic 8 — Offboarding email notifications (Days 1, 7, 25)
- FR40: Epic 8 — Field-level sensitivity/PII indicator
- FR41: Epic 8 — PWA "Add to Home Screen" prompt
- FR42: Epic 5 — Editor requests validated against permitted-operations allowlist
- FR43: Epic 5 — Reject restricted-keyword requests with plain-language error
- FR44: Epic 1 — Strict per-organization data isolation (membership RLS)
- FR45: Epic 5 — Log Schema Validator rejections (org ID + raw LLM output)
- FR46: Epic 1 — Plain-language reason per generated table/field at generation
- FR47: Epic 1 — One-action remove/rename of generated field/table at generation
- FR48: Epic 4 — Upload CSV/Excel to import records
- FR49: Epic 4 — AI-proposed column→field mapping shown before any write
- FR50: Epic 4 — Edit proposed mapping before confirming
- FR51: Epic 4 — Flag unmappable columns; require resolution before import
- FR52: Epic 4 — Replace synthetic data with imported data, no data loss
- FR53: Epic 7 — Assign a flat subscription tier; bill a fixed monthly fee via Stripe
- FR54: Epic 7 — Admin views current tier, what it includes, and next billing date
- FR55: Epic 7 — Tier-change prompt when invoicing volume (invoices/cycle) sustainably exceeds the tier band (no overage metering)
- FR70: Epic 1 — Generation links core tables (Job→Client, Invoice→Job)
- FR71: Epic 3 — Add relationship (lookup) field, single reference
- FR72: Epic 3 — Searchable server-side picker over the referenced table
- FR73: Epic 3 — Referenced record's label shown in table/card views
- FR74: Epic 3 — Filter and sort by a relationship field
- FR75: Epic 1 — Table display field designated at generation (editable in Epic 3)
- FR76: Epic 3 — Delete guard: warn with count, soft-delete, archived display
- FR77: Epic 3 — Reverse related list on a record
- FR78: Epic 6 — Relationship fields excluded from public intake forms
- FR82: Epic 12 — Create invoice from a work record or standalone (fixed compliant module)
- FR83: Epic 12 — Reusable Business Profile; one clean template rendered from it
- FR84: Epic 12 — Ontario HST as a separate line at place-of-supply rate; no tax when unregistered
- FR85: Epic 12 — Legal + operating name and GST/HST number on every taxed invoice
- FR86: Epic 12 — Unique per-org number, identity snapshot, immutable once issued
- FR87: Epic 12 — Issuance-blocking `assertIssuable` compliance gate (plain-language reasons)
- FR88: Epic 12 — Corrections only via a linked credit note in its own sequence
- FR89: Epic 12 — Invoice stored as data; PDF frozen to storage; six-year retention
- FR90: Epic 12 — Structured Payment Instructions block on every invoice
- FR91: Epic 12 — Mark as Paid (method/date/amount/reference); no money processed
- FR92: Epic 12 — Invoices tab defaults to a schema-independent Unpaid/Overdue view
- FR93: Epic 12 — Send PDF from the owner's own device via native share; SMS unguessable link
- FR94: Epic 12 — Desktop send via Resend (reply-to owner) + Download PDF + Copy Link
- FR95: Epic 12 — Language/tax from customer province; Ontario now, Quebec-ready seam
- FR96: Epic 13 — Single-select list-of-values field; values managed via chat + inline add; archive-not-delete
- FR97: Epic 5 — Remove a view (non-destructive; view stores no rows)
- FR98: Epic 5 — Hide (not delete) a table; append-only, restorable
- FR99: Epic 3 — Reject a fully-empty record on add/edit (required enforcement deferred)

**Growth (post-$1K MRR)**

- FR56: Epic 10 — Append-only per-tenant activity log
- FR57: Epic 10 — Plain-language workflow suggestions from usage patterns
- FR58: Epic 10 — Accept/edit/dismiss suggestions; dismissals remembered
- FR59: Epic 10 — Execute accepted workflows (trigger/action rules)
- FR60: Epic 10 — Per-tenant learned-patterns record informs suggestions
- FR61: Epic 10 — Business Snapshot export
- FR79: Epic 9 — Multi-select relationships
- FR80: Epic 9 — Conversational-Editor relation creation
- FR81: Epic 9 — CSV import matching to relationship fields

**Vision — Phase 3 (gated; traceability only)**

- FR62: Epic 11 — Propose real-world operational action
- FR63: Epic 11 — Approve/edit/reject proposed action
- FR64: Epic 11 — Execute approved action end-to-end + audit log
- FR65: Epic 11 — Autonomous execution per action-type trust threshold
- FR66: Epic 11 — Review/pause/revoke autonomy per action-type
- FR67: Epic 11 — Report autonomous work via chosen channel
- FR68: Epic 11 — Named-role management (bookkeeping/sales/operations)
- FR69: Epic 11 — Actions via connected external tools (allowlisted, gated)

## Epic List

### Epic 1: Foundation & the Generative "Aha" Moment
Stand up the platform and deliver Scheza's core value proposition end-to-end: an anonymous visitor describes their business with a guided prompt and, in under 45 seconds, lands in a fully interactive, Ontario-localized, data-populated dashboard — with a plain-language reason on every generated field and a one-tap override — before ever creating an account. This epic establishes the foundational architecture that every later epic builds on: `create-next-app` scaffolding + pinned deps (AR1, AR2), the shared-JSONB data model (`records` + `org_schemas`, no runtime DDL — AR3), the single static membership-based RLS policy and `auth_org_ids()` (AR4, FR44), the guarded `mutate.ts` write layer (AR5, NFR-FC1), the Gemini pipeline with `HARDENED_SYSTEM_PROMPT` + timeout + fallback (AR7), the Schema Validator gate (AR8), and the CI safety gates (AR11, AR12). It stands alone as a public, shareable demo.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR35, FR44, FR46, FR47, FR70, FR75
**NFRs woven in:** NFR-P1, NFR-P2, NFR-S3, NFR-S5, NFR-S6, NFR-S7, NFR-R1, NFR-R3, NFR-SC1/2/3, NFR-FC1–FC4 (seams)

> **Story-ordering guidance (Step 3):** The first story is a **thin vertical slice** — a hardcoded schema provisioned into `records` → `org_schemas` and rendered as a live read-only table — to prove the full data pipeline before the LLM exists. Layer the Gemini generation, Schema Validator, synthetic-data injection, hard fallback, and explainability affordances (UX-DR2, UX-DR13) as later stories on that proven spine.
>
> **Boundary vs Epic 3:** FR5 in this epic = **browse + basic in-place edit of the *demo* (pre-account) data only**, self-contained. Full CRUD, real-time multi-user sync, filter/sort, and column-hide on the *claimed org's real* data live in Epic 3. Epic 1 therefore has **no forward dependency** on Epic 3.
>
> **Cheap-now seams landed here (retrofit-avoidance, mirroring the NFR-FC philosophy):**
> - **i18n seam:** wire `next-intl` and enforce the no-hardcoded-strings rule from the very first component. **FR35 (French synthetic data at generation) lives in this epic** — the generation pipeline detects the prompt's language so Sarah's French-prompt aha moment is French from second one. Epic 8 then adds the EN/FR *UI toggle* (FR34) and the translation catalog.
> - **Value/usage signals (not a billing meter):** the data model supports two internal, non-billed signals. **(a) Tier signal** = invoicing volume (invoices issued per cycle), counted from the *fixed* Invoicing module so it is uniform across tenants — it drives only the tier-change prompt (FR55, Epic 7). **(b) Value/retention metric** = records under management (live rows the business keeps in Scheza). Neither is billed — flat tiers bill a fixed price per plan. Rich per-event usage tracking is the Growth activity log (FR56, Epic 10), not MVP.

### Epic 2: Claim, Accounts & Team Access
Turn a demo into a committed customer. A visitor claims their generated app via passwordless magic link, agrees to a mandatory privacy consent (PIPEDA), and gets a live, isolated organization at `scheza.com/{slug}` with synthetic data cleared. The account creator becomes Admin; they can invite teammates by email and assign the Admin or Member role, with Member permissions enforced both in the UI and independently at the API. Delivers the complete authentication, org-provisioning, and RBAC domain.
**FRs covered:** FR18, FR19, FR20, FR21, FR22, FR23, FR24, FR36
**NFRs woven in:** NFR-S1, NFR-S2, NFR-S3

### Epic 3: Core Data Management (Daily Driver)
The everyday surface: team members manage their real business records. Responsive DataTable on desktop and swipeable cards on mobile, add via schema-typed forms, inline edit-on-blur with optimistic UI, delete, filter/sort, Admin column-hide (no data loss), and real-time multi-user sync — all through the guarded `mutate.ts` layer under RLS. This is where the tool stops being a demo and becomes the business's system of record.
**FRs covered:** FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR71, FR72, FR73, FR74, FR76, FR77, FR99
**NFRs woven in:** NFR-P3, NFR-P4, NFR-P5, NFR-P9, NFR-A2, NFR-A3, NFR-A4, NFR-FC1

> **Boundary vs Epic 1:** this epic owns the **full CRUD/real-time/filter-sort/column-hide suite on the claimed org's real data**; the pre-account demo's browse + basic edit lives in Epic 1. Depends only on Epics 1–2 (data model, `mutate.ts`, real account) — never a future epic.

### Epic 4: Data Import — CSV/Excel with AI Column Mapping
> **⚠️ Activation-critical — do not defer past Epic 3.** Import is the PRD's *primary activation metric*. Because Claim (Epic 2) clears synthetic data, a user who claims but cannot yet import lands on empty tables — the exact "now re-type everything" bounce the PRD warns against. This epic must ship in immediate sequence after Core Data (Epic 3), not be pushed behind Editor/Intake/Billing.

The primary activation event. Nobody starts from zero: users import their real history from spreadsheets. Upload CSV/Excel, get an AI-proposed column→field mapping that "shows its work," edit any mapping, resolve flagged unmappable columns, and confirm — replacing synthetic data with real records, no data loss. Reuses the generation intelligence (Gemini) and the guarded write layer from Epics 1 and 3.
**FRs covered:** FR48, FR49, FR50, FR51, FR52
**NFRs woven in:** NFR-P7, NFR-FC1

> **Dependency note:** reuses the **shared Gemini + Schema Validator + mapping-to-`org_schemas` lib built in Epic 1** and writes through **Epic 3's guarded `mutate.ts` layer**. The overlap with Epic 5 (Conversational Editor) is incidental *lib-layer* sharing, not same-component churn — the surfaces (one-time import wizard vs ongoing chat pill) are distinct. Depends on **no future epic** (Epic 5 is not required).

### Epic 5: Conversational Schema Editor (Append-Only, Guarded)
The product's highest-risk surface, isolated as its own epic. An Admin evolves the app's structure by chatting — add a column, add a table, add a view — with every request forced through the Schema Validator allowlist, restricted-keyword rejection, non-destructive row preservation, and Sentry logging of rejections. Unsupported operations (delete/rename) get a safe, non-technical response and a frontend visibility change. Reuses the Gemini client and Validator established in Epic 1; Admin-only per Epic 2 RBAC.
**FRs covered:** FR13, FR14, FR15, FR16, FR17, FR42, FR43, FR45
**NFRs woven in:** NFR-S4, NFR-S5, NFR-R1

### Epic 6: Public Intake Forms
Lead capture with zero extra tooling. Every claimed dashboard auto-generates a public, no-auth, mobile-optimized intake form at `scheza.com/forms/{slug}` whose fields derive from the schema. External submissions push into the owner's data table in real time, and the Admin gets an email notification (Resend; web push deferred to Growth).
**FRs covered:** FR25, FR26, FR27, FR28, FR78
**NFRs woven in:** NFR-A2, NFR-A4, NFR-P5

### Epic 7: Billing, Trials & Flat Tiers
Monetization on Stripe-hosted surfaces only. A 14-day no-card trial, a **flat all-inclusive subscription** (fixed monthly price per tier: Solo/Crew/Shop) via Stripe Checkout, self-serve management via Customer Portal, and read-only gating on lapse driven by `subscription_status` as the cached source of truth. `subscription_tier` is the billed plan; **no metering, no usage reporting, no spend cap** — invoicing volume (invoices issued per cycle) only drives a tier-change prompt. A per-cycle Vercel Cron reconciles the Stripe tier against `subscription_tier` (NFR-R5). *(Reconciled 2026-09-27: flat tiers replaced usage-based metering.)*
**FRs covered:** FR29, FR30, FR31, FR32, FR33, FR53, FR54, FR55
**NFRs woven in:** NFR-R4, NFR-R5

### Epic 8: Localization, PWA & Compliance/Offboarding
The Ontario-specific trust and reach layer, plus PIPEDA lifecycle obligations. Instant EN/FR UI toggle (labels + column names + already-generated data, no reload), PWA "Add to Home Screen," field-level sensitivity indicators, "Download My Data" (CSV/JSON), and self-service offboarding (30-day read-only grace → cascade delete) with staged email warnings. *(French synthetic-data generation, FR35, was moved to Epic 1 — it belongs to the generation pipeline and to Sarah's French-prompt aha moment.)*
**FRs covered:** FR34, FR37, FR38, FR39, FR40, FR41
**NFRs woven in:** NFR-P6, NFR-A1, NFR-S2

> **Pull-forward candidates (focus-group flag):** **FR40 (field-level sensitivity/PIPEDA indicator)** and **FR41 (PWA "Add to Home Screen")** are small-surface-area FRs with outsized *conversion-trust* and *day-1-habit* payoff (Sarah's deal-closer; Tim's home-screen bookmark). If capacity allows, deliver them earlier than this epic — they have no hard dependency on the rest of Epic 8.

### Epic 9: Relationships — Advanced *(Growth — deferred)*
*Post-$1K MRR. Extends the MVP's core relationships (FR70–FR78, delivered in Epics 1/3/6) with the higher-cost, higher-surface pieces.* Multi-select relationship fields (a record linking several targets), natural-language relationship creation through the Conversational Editor (widening the Schema Validator's accepted surface under the `validate(op,{phase,source})` gate), and relationship-aware CSV import that matches source values to existing referenced records. Depends on Epics 1, 3, 5 and AR14.
**FRs covered:** FR79, FR80, FR81
**NFRs woven in:** NFR-P9, NFR-S7

### Epic 10: Growth Substrate — Activity Log, Workflows, Learned Patterns *(Growth — deferred)*
*Post-$1K MRR. Listed for FR completeness; story breakdown deferred until Growth is opened.* The nervous system for later intelligence: append-only per-tenant activity log (the prerequisite substrate — AR/NFR-FC2), the workflow execution engine, the plain-language Workflow Suggestion Layer, the per-tenant learned-patterns record, and the Business Snapshot export (a report over the activity log).
**FRs covered:** FR56, FR57, FR58, FR59, FR60, FR61
**NFRs woven in:** NFR-P8, NFR-FC2, NFR-R2 (99.9%)

### Epic 11: Autonomous Operations — The Digital Employee *(Vision / Phase 3 — gated, traceability only)*
*Gated on proven week-4 retention ≥30% and month-over-month records-under-management growth across ≥2 cohorts. Documented direction, not a build.* A per-tenant operator that proposes → executes-on-approval → graduates to autonomy per action-type, reports on the owner's channel, is organized as named roles, and acts through allowlisted connected external tools — all on the Epic 10 substrate via the NFR-FC seams.
**FRs covered:** FR62, FR63, FR64, FR65, FR66, FR67, FR68, FR69
**NFRs woven in:** NFR-FC1–FC4 (fully realized)

### Epic 12: Invoicing, Payments & Delivery *(MVP — the revenue heart; PRD Build Priority 4b)*
> **Numbered 12 to preserve existing epic IDs, but it is MVP and sequenced in build order right after Epic 4 (Core Data + Import).** It depends only on Epics 1–3 (the `records`/`org_schemas` model, the guarded `mutate.ts` layer, real claimed accounts) and the Resend integration from infra — never on Epics 5–11.

The product's revenue heart: turn finished work into a sent, compliant invoice and a tracked payment. Unlike the AI-generated operational workspace, invoicing is a **fixed, compliant module identical for every tenant**, living in **dedicated typed platform tables** (`business_profiles`, `invoices`, `invoice_line_items`, `invoice_tax_lines`, `credit_notes` + child tables, `invoice_payments`) — not the JSONB record store — because compliance (correct HST, mandatory legal identity, immutable issued documents, per-org numbering) needs real constraints. Capture a reusable Business Profile, draft an invoice from a work record or standalone, compute Ontario HST as a separate line, issue it through a validation gate that mints a gap-free per-org number and freezes an in-house-rendered PDF (`@react-pdf/renderer`) to private storage, deliver it PDF-first from the owner's own phone/inbox, track payment out-of-band, and correct only via credit notes. Payment *processing* (Stripe Connect), Interac auto-reconcile, WhatsApp Business API, and owner-inbox integration are Phase 3. Binds the architecture's Consistency Invariants I1–I8.
**FRs covered:** FR82, FR83, FR84, FR85, FR86, FR87, FR88, FR89, FR90, FR91, FR92, FR93, FR94, FR95
**NFRs woven in:** NFR-FC1 (guarded writes), NFR-S1/S2 (TLS/at-rest for the public PDF surface), NFR-A2/A4 (accessible invoice UI), plus the PIPEDA six-year-retention override on offboarding
**Architecture refs:** §Invoicing, Payments & Delivery — Consistency Invariants I1 (numbering), I2 (totals), I3 (HST/registration date), I4 (share_token), I5 (storage/proxy), I6 (snapshots), I7 (immutability trigger), I8 (one render path)

> **🚦 Hard release gate:** an Ontario lawyer and a CPA must review the invoice templates, HST logic, and terms **before invoicing is enabled in production**. Product copy must never claim every invoice is legally compliant — only that it carries the configured compliance information. All invoice email is strictly transactional (CASL).

### Epic 13: List-of-Values (Single-Select) Field Type *(MVP — added via sprint-change-proposal-2026-10-02)*
> A single-choice "picklist" field (e.g. Status: Paid / Unpaid / Rejected), created and managed through the Conversational Editor and rendered as a dropdown everywhere data is entered. Backs the dropdowns the PRD journeys already assume. Reuses the Gemini client + Schema Validator (Epic 1) and the guarded `mutate.ts` layer (Epic 3). Plain (no colors), single-select only; value management is append-only (add / rename / archive-not-delete). Multi-select and colored pills are deferred to Growth.
**FRs covered:** FR96
**Depends on:** Epics 1, 3, 5 (no later epic).

---

## Epic 1: Foundation & the Generative "Aha" Moment

Stand up the platform and deliver Scheza's core value proposition end-to-end: an anonymous visitor describes their business with a guided prompt and, in under 45 seconds, lands in a fully interactive, Ontario-localized, data-populated dashboard — with a plain-language reason on every generated field and a one-tap override — before ever creating an account. This epic establishes the shared-JSONB data model, membership-based RLS isolation, the guarded write layer, the Gemini generation pipeline, the Schema Validator, the CI safety gates, and the i18n + metering seams that every later epic builds on. Stories are ordered as a **walking skeleton**: prove the data pipeline with a hardcoded schema first, then layer the LLM, fallback, dashboard, and explainability on that proven spine.

*(Covers FR1, FR2, FR3, FR4, FR5, FR35, FR44, FR46, FR47. NFRs woven in: NFR-P1, NFR-P2, NFR-S3, NFR-S4, NFR-S5, NFR-S6, NFR-R1, NFR-R3, NFR-SC3, NFR-FC1–FC4. UX: UX-DR1, UX-DR2, UX-DR3, UX-DR13.)*

### Story 1.1: Project Scaffold & Toolchain

As a developer,
I want the Scheza repository scaffolded with the mandated stack, dependencies, i18n wiring, and CI safety gates,
So that every subsequent story is built on a consistent, deployable, secure-by-default foundation.

**Acceptance Criteria:**

**Given** an empty repository
**When** the project is initialized
**Then** it is created with `create-next-app@latest` using `--typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack` (AR1)
**And** shadcn/ui is initialized with `--style new-york --base-color zinc --css-variables` and the pinned core dependencies from AR2 (Supabase, `@google/genai`, Stripe, Resend, next-intl, Framer Motion, React Hook Form, Zod, react-swipeable, TanStack Query, papaparse, xlsx, Sentry) are installed at their specified versions

**Given** the scaffolded app
**When** any UI component renders user-facing text
**Then** all strings resolve through `next-intl` `useTranslations()` with an EN catalog present (i18n seam)
**And** the ESLint config fails the build if a hardcoded user-facing string bypasses the translation layer in `src/` components

**Given** a pull request to the repository
**When** CI runs
**Then** it executes lint (including a custom rule that fails the build if `SUPABASE_SERVICE_ROLE_KEY` appears in a client bundle, NFR-S6) and type-check, and a Vercel preview deploy is produced (AR9, AR11)
**And** `.env.example` is committed with placeholder values only, and no real secret or `.env.production` is committed

### Story 1.2: Platform Data Model & Tenant Isolation (Walking Skeleton)

As a developer,
I want the shared-JSONB tenant data model, membership-based RLS, and the guarded write layer proven end-to-end with a hardcoded schema,
So that the full provisioning-and-isolation pipeline is validated before any LLM code exists.

**Acceptance Criteria:**

**Given** a Supabase CLI migration
**When** the platform schema is applied
**Then** it creates `organizations`, `org_members` (with `principal_type` `human | agent`), `records (id, organization_id, table_key, data JSONB, actor_id, version, created_at, updated_at, deleted_at)`, and `org_schemas (organization_id, definition JSONB)` — with **no per-tenant physical tables and no runtime DDL** (AR3, AR6)
**And** invoicing volume (invoices issued per cycle) is countable from the fixed Invoicing module as the internal signal for flat-tier placement / the tier-change prompt (FR55), and records-under-management is countable as the value/retention metric — **neither** is a billing meter (flat tiers carry no metered overage)

**Given** the `records` table
**When** the RLS policy is created
**Then** it is a **single static membership-based policy** using `USING (organization_id IN (SELECT auth_org_ids()))`, where `auth_org_ids()` is a `SECURITY DEFINER` function returning the caller's org ids from `org_members`, and `organization_id` is a real FK to `organizations.id` (never a user UID) (AR4, FR44)

**Given** the guarded mutation layer `src/lib/data/mutate.ts`
**When** any tenant row is written
**Then** the write runs under the caller's RLS-scoped client, takes identity as an explicit parameter (never reading `cookies()`), accepts `actorId` and an optional `idempotencyKey`, and enforces optimistic concurrency via `version` (AR5, NFR-FC1)
**And** no code path writes tenant rows using the raw service-role key

**Given** a hardcoded seed schema written to `org_schemas` plus seed rows in `records`
**When** the demo dashboard route is loaded
**Then** the seeded logical table renders as a live read-only data table sourced through the JSONB query layer (`src/lib/data/records.ts`), proving the pipeline

**Given** the RLS isolation integration test (`tests/integration/rls-isolation.test.ts`) run against a real Supabase instance (not mocked)
**When** CI runs
**Then** it is a hard gate verifying BOTH that an invited *member* of Org A CAN read Org A's records AND that a *stranger* CANNOT (AR12, NFR-S3)

### Story 1.3: Guided "Mad Libs" Prompt Intake

As an anonymous visitor,
I want to describe my business through a simple guided prompt without signing up,
So that I can start generating my app with zero friction.

**Acceptance Criteria:**

**Given** the landing page
**When** it loads
**Then** it presents a hyper-minimalist single-focus structured prompt — a trade-type dropdown (HVAC, Plumbing, Roofing, Snow Removal, Landscaping, Electrical, General Contracting, Other), a city/town text field, and a "what you track" text field — with no pricing tiers or feature lists above the fold (FR1, UX-DR1)

**Given** a visitor filling the guided prompt
**When** they submit
**Then** no account, email, or credit card is requested, and the raw input is captured for backend prompt inflation
**And** the trade-type and city selections are preserved to seed downstream Ontario localization

**Given** a visitor who leaves a required field empty
**When** they attempt to submit
**Then** submission is blocked with an accessible, translated inline validation message (validation on submit, not per keystroke)

### Story 1.4: AI Schema + Synthetic Data Generation (Ontario & French Localized)

As an anonymous visitor,
I want the system to turn my prompt into a relational schema pre-filled with realistic, locally relevant data,
So that I immediately see my own business, already organized.

**Acceptance Criteria:**

**Given** a submitted prompt
**When** the generation API route runs
**Then** it wraps the input in the opinionated inflation system prompt and issues exactly ONE structured Gemini call (`gemini-3.8-flash` — superseded `gemini-2.0-flash` in Story 1.4, `responseMimeType: "application/json"` + `responseSchema`) via `callGeminiWithTimeout()` with `HARDENED_SYSTEM_PROMPT`, returning `{ schema, seedRows }` together (AR7, NFR-S5)
**And** the returned schema and seed rows are passed through the Schema Validator (allowlist: `add_table`, `add_field`, `add_view`; reject reserved-column collisions and blocked keywords `DROP GRANT TRUNCATE DELETE EXEC -- ; /*`; the `relation` field type is never accepted) before anything is persisted (AR8, NFR-S4)

**Given** validated generation output
**When** it is provisioned
**Then** an `org_schemas` definition row and seeded `records` are inserted (a metadata insert + seed rows, no DDL), with `normalizeTableName()` applied to all table/field keys (AR3, AR6)
**And** the seed data is trade-specific and Ontario/GTA-Ottawa localized (real street names, standard Ontario pricing, trade terminology) with 5–8 rows per table (FR3)

**Given** a prompt submitted in French
**When** generation runs
**Then** the synthetic data and column names are generated in French (language detected from the prompt at submission time, independent of UI locale) (FR35)

**Given** a valid prompt
**When** generation completes
**Then** the schema is produced within 45 seconds at p95 (NFR-P1) and DB provisioning from the validated JSON completes in under 5 seconds (NFR-P2)
**And** a malformed `seedRows` section does not invalidate an otherwise-valid schema

### Story 1.5: Hard Fallback Template (No Error Screens)

As an anonymous visitor,
I want to always land on a working dashboard even if AI generation fails,
So that I never see an error and my first impression is never broken.

**Acceptance Criteria:**

**Given** a Gemini call
**When** it exceeds the 15-second timeout or returns output that fails validation
**Then** the system retries exactly once (NFR-R3)

**Given** two consecutive generation failures (timeout, invalid JSON, or Schema Validator rejection)
**When** the second attempt fails
**Then** the system automatically provisions the hardcoded `UNIVERSAL_FIELD_SERVICE_TEMPLATE` (Clients, Jobs, Invoices) pre-seeded with generic Ontario data, sets `isFallback: true`, and shows a subtle banner ("We used a starter template — you can customize it using the chat") — never an error screen (FR4)

**Given** any generation path (success or fallback)
**When** the user reaches their dashboard
**Then** it appears within the 30–45 second window regardless of LLM performance

### Story 1.6: Interactive Demo Dashboard (Pre-Account Browse & Basic Edit)

As an anonymous visitor,
I want to browse and touch my generated dashboard before committing,
So that I experience the full value before being asked to create an account.

**Acceptance Criteria:**

**Given** a freshly generated (or fallback) schema
**When** the dashboard renders
**Then** skeleton screens animate ("grow") into the populated dashboard layout with no loading spinner (UX-DR2), and no table is ever shown empty (UX-DR3)

**Given** the demo dashboard
**When** the visitor interacts with it
**Then** they can browse tables and open a record, and make a basic in-place edit to demo data that reflects optimistically — scoped to the pre-account demo session only (FR5)

**Given** the demo (pre-account) state
**When** the visitor edits demo data
**Then** the change is confined to the anonymous demo session and does not require or create an account
**And** full CRUD, delete, filter/sort, column-hide, and real-time sync are explicitly out of this story's scope (they belong to Epic 3 on real data)

### Story 1.7: Schema Explainability & One-Tap Override

As an anonymous visitor,
I want each AI-generated table and field to explain itself and let me remove or rename it instantly,
So that I trust what the AI built and feel in control from the first moment.

**Acceptance Criteria:**

**Given** a generated schema
**When** the dashboard renders
**Then** each AI-generated table and field shows a one-line, plain-language reason (produced by the same generation call) via an inline info affordance at generation time — not buried in settings (FR46, UX-DR13)

**Given** a visible generated field or table
**When** the visitor taps its override control
**Then** they can remove or rename it in a single action without opening a settings screen (FR47)
**And** a removal uses the append-only hide mechanism (a frontend display flag) — no destructive migration is executed and the underlying data is preserved

**Given** a field the visitor removed
**When** the dashboard re-renders
**Then** the field is hidden from all demo views while its definition and any data remain intact

### Story 1.8: Generated Relationships & Display Fields

As an anonymous visitor,
I want the generated schema to link the tables that clearly belong together — jobs to their client, invoices to their job — instead of making me retype names,
So that my dashboard behaves like one connected business, not disconnected spreadsheets.

**Acceptance Criteria:**

**Given** a prompt that implies related entities (e.g. clients, jobs, invoices)
**When** the schema is generated
**Then** Gemini emits single-reference `relation` fields linking the core tables (e.g. Job→Client, Invoice→Job), each carrying a one-line plain-language reason (FR70, FR46, AR14)

**Given** a generated table
**When** the schema is persisted to `org_schemas`
**Then** the table definition records a table-level `displayField` (defaulting to the first non-hidden text field) used to represent its rows wherever they appear as a reference (FR75, AR14)

**Given** an LLM-proposed `relation` field
**When** the Schema Validator runs `validate(op, { phase, source })`
**Then** it accepts the field only if `relationConfig.targetTable` resolves to a table in the same generation batch (two-pass; self-reference and cycles allowed), rejects `cardinality:'many'` at MVP phase, and keeps all restricted-keyword rejections (NFR-S4) and the hardened prompt (NFR-S5) intact with no DDL emitted (FR70, NFR-S7, AR8, AR14)

**Given** a relation value
**When** a record is written
**Then** `records.data` stores the target record's id (single reference), never its label (AR14)

---

## Epic 2: Claim, Accounts & Team Access

Turn a demo into a committed customer. A visitor claims their generated app via passwordless magic link, agrees to a mandatory privacy consent (PIPEDA), and gets a live, isolated organization at `scheza.com/{slug}` with synthetic data cleared. The account creator becomes Admin; they can invite teammates by email and assign Admin or Member roles, with Member permissions enforced both in the UI and independently at the API. Delivers the complete authentication, org-provisioning, and RBAC domain.

*(Covers FR18, FR19, FR20, FR21, FR22, FR36, FR23, FR24. NFRs woven in: NFR-S1, NFR-S2, NFR-S3. UX: UX-DR9.)*

### Story 2.1: Claim App via Magic Link ("Make it Real")

As an anonymous visitor with a generated demo,
I want to claim my app by verifying my email and accepting the privacy terms,
So that I get a live, private account that holds my real business data.

**Acceptance Criteria:**

**Given** a demo dashboard
**When** the visitor taps the prominent "Make it Real" claim CTA
**Then** they are shown an email field and a **mandatory, unchecked** privacy consent checkbox ("I agree to the Scheza Privacy Policy and Terms of Service") (FR36, UX-DR9)

**Given** the claim form
**When** the visitor submits without checking the consent box
**Then** the claim is hard-blocked and cannot proceed (FR36)

**Given** a submitted email with consent checked
**When** the visitor completes magic-link authentication (link delivered via Resend, all traffic over TLS 1.2+, NFR-S1)
**Then** an `organizations` row and an `org_members` row are bootstrapped, the authenticated user is assigned the **Admin** role (`{"role":"admin"}` in Supabase Auth user metadata), and the consent timestamp is stored against the user record (FR18, FR22, FR36)
**And** org bootstrap is the only claim-time use of the service-role key; all subsequent tenant writes go through `mutate.ts` under the user's RLS-scoped client

**Given** a successful claim
**When** the account goes live
**Then** the synthetic demo data is cleared, a unique `{slug}` is provisioned, and the dashboard is reachable at `scheza.com/{slug}` under the org's RLS isolation
**And** the visitor's pre-account schema overrides (removed/renamed fields from Story 1.7) are carried into the live schema

### Story 2.2: Passwordless Login for Returning Users

As a returning user,
I want to log in with just a magic link,
So that I never have to remember a password.

**Acceptance Criteria:**

**Given** an existing account
**When** the user requests access with their email
**Then** a magic link is sent via Resend and authenticating through it establishes a session — no password is ever required (FR19)

**Given** an authenticated session
**When** the user navigates the app
**Then** the session is maintained via `@supabase/ssr` cookie-based refresh in `src/middleware.ts`, and protected routes redirect unauthenticated users to the login entry point

**Given** an expired or invalid magic link
**When** the user clicks it
**Then** they see a clear, translated message and can request a fresh link without an error screen

### Story 2.3: Invite Team Members with Roles

As an Admin,
I want to invite teammates by email and choose their role,
So that my crew can use the dashboard with appropriate access.

**Acceptance Criteria:**

**Given** an Admin in Settings
**When** they invite a teammate by email address
**Then** they can assign either **Admin** or **Member** before the invitation is sent, with Member preselected by default (FR20, FR21)

**Given** an invitation
**When** it is sent
**Then** an `org_members` row is created for the invitee scoped to the Admin's `organization_id` with the chosen role, and an invite email is delivered via Resend

**Given** an invited teammate
**When** they accept via magic link
**Then** they join the same organization and — because RLS is membership-based via `auth_org_ids()` — they can immediately read that org's records (verifying the invited-member path)

### Story 2.4: Role-Based Access Enforcement

As an Admin,
I want Member accounts restricted from sensitive controls,
So that a field worker cannot accidentally change structure, billing, or team access.

**Acceptance Criteria:**

**Given** a user with the Member role
**When** they use the dashboard
**Then** they can view, add, and edit records, but the Conversational Editor, Settings, Invite, and Billing surfaces are hidden from the UI (FR23, FR24)

**Given** a Member
**When** a request hits any schema-mutation, invite, billing, or settings API route
**Then** the route independently verifies the caller's role from the JWT and rejects the request with a 403 — frontend hiding is never the sole enforcement (FR24)

**Given** an Admin
**When** they use the dashboard
**Then** all Admin-only surfaces are available, and the account creator retains Admin per Story 2.1

---

> **Carried-over hardening (from the Epic 1 retrospective, 2026-09-24).** Stories 2.5–2.6 are generation-pipeline fixes surfaced by the Epic 1 retro (findings F7/F8) and scheduled into this sprint. They touch Epic 1 code (`schema/validator.ts`, `utils.ts`) but ride Epic 2's delivery. Full specs: `spec-2-5-schema-validator-keyword-false-reject.md`, `spec-2-6-non-ascii-key-normalization.md`.

### Story 2.5: Schema Validator — Stop False-Rejecting Legitimate Labels

As a tradesperson generating my app,
I want the safety filter to accept ordinary business names,
So that a table like "Grants" or a column like "Deleted?" or "Drop-off time" gives me my real custom dashboard instead of the generic fallback.

**Acceptance Criteria:**

**Given** a generated schema whose only issue is a label containing a blocked keyword as a substring ("Grants", "Deleted?", "Drop-off time")
**When** it is validated
**Then** it passes and provisions as a real (non-fallback) generation

**Given** a schema with a reserved-key collision, an unsupported/`relation` type, or an empty label/key
**When** it is validated
**Then** it still rejects with the generic client error and a Sentry rejection log — the real protections are unchanged (retro F7).

### Story 2.6: Key Normalization — Preserve Accented / Non-ASCII Names (French Path)

As a francophone owner,
I want my French, accented column names to survive generation,
So that "numéro" and "coût" become usable fields instead of collapsing and dumping me into the English fallback.

**Acceptance Criteria:**

**Given** an accented French field/table name ("numéro", "coût", "Réf. client")
**When** it is normalized
**Then** it yields a readable ASCII key ("numero", "cout", "ref_client") and the schema validates as a real generation; two distinct accented names never collapse into a false duplicate-key rejection

**Given** an ASCII input, or a purely non-Latin key
**When** it is normalized
**Then** the ASCII key is byte-identical to today (no regression), and a non-Latin key yields a deterministic non-empty `[a-z0-9_]` key rather than rejecting on emptiness (retro F8).

---

## Epic 3: Core Data Management (Daily Driver)

The everyday surface: team members manage their real business records. Responsive DataTable on desktop and swipeable cards on mobile, add via schema-typed forms, inline edit-on-blur with optimistic UI, delete, filter/sort, Admin column-hide (no data loss), and real-time multi-user sync — all through the guarded `mutate.ts` layer under RLS. This is where the tool stops being a demo and becomes the business's system of record. Operates on the claimed org's real data; depends only on Epics 1–2.

*(Covers FR6, FR7, FR8, FR9, FR10, FR11, FR12, FR99. NFRs woven in: NFR-P3, NFR-P4, NFR-P5, NFR-A2, NFR-A3, NFR-A4, NFR-FC1. UX: UX-DR5, UX-DR6, UX-DR7, UX-DR8.)*

### Story 3.1: Responsive Table & Card Views

As a team member,
I want to see my records as a table on desktop and swipeable cards on mobile,
So that I can work comfortably from the office or from a truck.

**Acceptance Criteria:**

**Given** a claimed org with records
**When** a logical table is viewed on desktop
**Then** it renders as a shadcn/ui DataTable driven by the `org_schemas` definition and the JSONB records query layer (FR6, UX-DR7)

**Given** the same table on a mobile viewport
**When** it is viewed
**Then** it renders as a `react-swipeable` card list (not a horizontally-scrolled desktop table), with each card showing the key fields (FR6, UX-DR7)

**Given** either view
**When** it renders
**Then** all interactive elements have a minimum 48×48px touch target (NFR-A2), form/column semantics expose ARIA labels derived from schema field names (NFR-A3), and initial load uses shadcn `Skeleton` (not spinners)
**And** for an authenticated returning user the dashboard is interactive within 2 seconds at p95 on mobile LTE (NFR-P3)

### Story 3.2: Add & Delete Records

As a team member,
I want to add new records through a form that matches each field's type and delete records I no longer need,
So that I can keep my business data current.

**Acceptance Criteria:**

**Given** a logical table
**When** the user opens "Add Entry"
**Then** an auto-generated form is produced from the `org_schemas` definition with input controls matching each field's data type (text, number, date, dropdown, etc.), and every field has a real associated label (no placeholder-only labels, NFR-A4) (FR7)

**Given** a completed add form
**When** the user saves
**Then** the record is written through `mutate.ts` under the caller's RLS-scoped client with `actorId` set, appears optimistically in the view, and reconciles on server confirmation (FR7, NFR-FC1)

**Given** an existing record
**When** the user deletes it
**Then** the row is removed from the user's views (soft-delete via `deleted_at`) through `mutate.ts`, reflected optimistically (FR9)

**Given** a failed write or delete
**When** the server rejects it
**Then** the optimistic change rolls back and a translated, non-technical message is shown (never a raw error)

### Story 3.3: Inline Edit with Optimistic UI

As a team member,
I want to edit a value by clicking it and typing, with no modal or save button,
So that updating data feels instant and effortless.

**Acceptance Criteria:**

**Given** a record value in a table or card
**When** the user clicks it and types
**Then** the field becomes editable in place (no separate screen or modal) and saves automatically on blur (FR8, UX-DR5)

**Given** an inline edit
**When** the user commits it
**Then** the change renders immediately (optimistic) and server confirmation returns within 1 second; the mutation uses the TanStack Query pattern `cancelQueries → setQueryData → onError rollback → onSettled invalidate` (NFR-P4, UX-DR6)

**Given** a concurrent edit to the same record
**When** the write is applied
**Then** `records.version` optimistic concurrency is enforced and a stale write is rejected and rolled back with a refresh, not silently overwritten

### Story 3.4: Filter & Sort Records

As a team member,
I want to filter and sort a table,
So that I can quickly find the records I care about.

**Acceptance Criteria:**

**Given** a table view
**When** the user applies a sort on a column
**Then** the records reorder by that column (ascending/descending) within the current logical table (FR10)

**Given** a table view
**When** the user applies one or more filters
**Then** only matching records are shown, and filter/sort state is reflected in both the desktop table and the mobile card view (FR10)

**Given** an active filter that matches nothing
**When** it is applied
**Then** an accessible, translated empty state ("No records found") is shown — not an error

### Story 3.5: Admin Column Hide (Non-Destructive)

As an Admin,
I want to hide a column from all views without deleting its data,
So that I can declutter the dashboard without risking data loss.

**Acceptance Criteria:**

**Given** an Admin viewing a table
**When** they hide a column
**Then** the column disappears from all table and card views for the org, while the underlying field definition and all stored values remain intact (append-only hide flag — no destructive migration) (FR11)

**Given** a hidden column
**When** an Admin chooses to unhide it
**Then** the column and its previously stored data reappear unchanged

**Given** a Member
**When** they view the dashboard
**Then** the hide/unhide control is not available to them (per Epic 2 RBAC)

### Story 3.6: Real-Time Multi-User Sync

As a team member,
I want changes made by teammates to appear on my screen automatically,
So that the whole crew works from the same live picture.

**Acceptance Criteria:**

**Given** two members of the same org viewing the same table
**When** one adds, edits, or deletes a record
**Then** the change appears for the other member within 2 seconds (FR12, NFR-P5)

**Given** a Supabase Realtime event
**When** it is received on the client
**Then** it triggers TanStack Query `invalidateQueries` (never a direct `setQueryData` in the Realtime handler) so the cache refetches authoritative state

**Given** a dropped Realtime connection
**When** connectivity resumes
**Then** the client re-subscribes and reconciles without a manual page reload

---

### Story 3.7: Relationship Lookup Field & Record Picker

As a team member,
I want a field that lets me pick a record from another table instead of typing its name,
So that every bill points to the one real client, with no misspellings.

**Acceptance Criteria:**

**Given** a table in the claimed org
**When** an Admin adds a relationship (lookup) field targeting another table in the same org
**Then** it is created as a single-reference `relation` with `relationConfig.targetTable` set, validated by the Schema Validator (FR71, NFR-S7, AR14)

**Given** a relationship field on an add/edit form
**When** the user focuses it
**Then** it presents a searchable, server-side-typeahead picker over the referenced table, showing each candidate by the target table's `displayField` label, returning matches within 500ms at p95 for tables up to 50k rows (FR72, NFR-P9)

**Given** a saved relationship value
**When** the record appears in a DataTable or swipeable card
**Then** the referenced record's `displayField` label is shown — never the raw id — resolved for the rendered page in a single batched `id IN (...)` lookup, not a per-row query (FR73, NFR-P9, AR14)

**Given** the referenced record's label later changes
**When** the referencing view re-renders
**Then** it shows the updated label (labels resolved at read time, never copied into the referencing row) (FR73, AR14)

---

### Story 3.8: Filter/Sort by Relationship & Safe Delete of Referenced Records

As a team member,
I want to filter a table by a linked record and be warned before deleting something other records depend on,
So that I can pull up "all of this client's jobs" and never silently orphan data.

**Acceptance Criteria:**

**Given** a table with a relationship field
**When** the user filters or sorts by that field
**Then** they select a referenced record by label and the table filters/sorts by the stored reference, using JSONB containment over the `GIN(data jsonb_path_ops)` index — never `->>` text extraction (FR74, AR14)

**Given** a record referenced by other records
**When** a user attempts to delete it
**Then** the system first warns with the count of referencing records (enumerated from the referencing `(table_key, field)` pairs in `org_schemas`, counted via containment, capped e.g. "500+") before proceeding (FR76, AR14)

**Given** the user confirms the delete
**When** it executes
**Then** the record is soft-deleted (`deleted_at`) and referencing rows keep the id and render the target as "archived" — no hard delete, no orphan cleanup (FR76, AR14)

**Given** any relationship create or edit
**When** it passes through `mutate.ts`
**Then** the layer verifies each referenced id exists under the same org and `targetTable` before persisting, rejecting a planted foreign or dangling id (FR76, NFR-S7, AR14)

---

### Story 3.9: Reverse Related List

As a team member,
I want to open a client and see all their invoices in one place,
So that I get the full picture of an account without hunting across tables.

**Acceptance Criteria:**

**Given** a record that other records reference
**When** the user opens it
**Then** a related list shows the referencing records (e.g. all invoices for this client), retrieved via a JSONB-containment query over the `GIN(data jsonb_path_ops)` index (FR77, NFR-P9, AR14)

**Given** a related list
**When** it renders
**Then** the referencing table's filter and sort are available on it, and resolving its rows for the rendered page adds no more than 300ms (FR77, NFR-P9)

**Given** MVP scope (single-reference relations only)
**When** the related list runs
**Then** it handles single-reference relations correctly; multi-select reverse lookups are deferred to Epic 9 (FR77 scope boundary)

### Story 3.10: Non-Empty Validation on Add/Edit

As a team member,
I want the form to stop me saving a completely blank record,
So that my data stays usable.

*(Added via sprint-change-proposal-2026-10-02. Covers FR99. Build the server-side empty-check on a shared validator seam, not a throwaway: it is the first slice of the broader server-side `data`-vs-schema conformance validation deferred for both the add and edit paths (`deferred-work.md`, spec-3-2 and spec-3-3), which those entries note should be shared with the Epic 5 conversational-editor guardrails.)*

**Acceptance Criteria:**

**Given** the Add Entry form or an inline edit
**When** the user attempts to save a record in which every field is blank
**Then** the write is rejected before any call to `mutate.ts`, and a translated, non-technical message is shown (never a raw error) (FR99)

**Given** a save with at least one field populated
**When** the user saves
**Then** the record is written normally through the guarded `mutate.ts` layer (no change to existing Story 3.2 behavior)

**Given** this story's scope
**When** validation runs
**Then** per-field required (`nullable:false`) enforcement is explicitly **out of scope** here (deferred), to keep fast mobile entry frictionless

---

## Epic 4: Data Import — CSV/Excel with AI Column Mapping

The primary activation event. Nobody starts from zero: users import their real history from spreadsheets. Upload CSV/Excel, get an AI-proposed column→field mapping that "shows its work," edit any mapping, resolve flagged unmappable columns, and confirm — replacing any remaining synthetic data with real records, no data loss. Reuses the Gemini + Schema Validator lib from Epic 1 and writes through Epic 3's guarded `mutate.ts` layer. **Activation-critical — sequenced immediately after Epic 3.**

*(Covers FR48, FR49, FR50, FR51, FR52. NFRs woven in: NFR-P7, NFR-FC1. UX: UX-DR14.)*

### Story 4.1: Upload & Parse a Spreadsheet

As an Admin,
I want to upload my CSV or Excel file and see its columns,
So that I can begin importing my real business data.

**Acceptance Criteria:**

**Given** an Admin on the import surface
**When** they drag-drop or select a `.csv`, `.xls`, or `.xlsx` file
**Then** the file is parsed server-side (papaparse for CSV, xlsx for Excel) into columns and rows, and a preview of detected columns with sample values is displayed (FR48)

**Given** a parsed file
**When** the preview renders
**Then** it appears within 5 seconds of upload (NFR-P7) and no data has been written to `records` yet

**Given** an unreadable, empty, or non-spreadsheet file
**When** it is uploaded
**Then** a translated, non-technical error is shown and the user can retry — no partial state is created

### Story 4.2: AI-Proposed Column Mapping (Shown Before Any Write)

As an Admin,
I want the system to propose how my spreadsheet columns map to my dashboard fields and show me its reasoning,
So that I trust the import before committing.

**Acceptance Criteria:**

**Given** a parsed file and the org's `org_schemas` definition
**When** mapping is requested
**Then** a Gemini call (via `callGeminiWithTimeout()` + `HARDENED_SYSTEM_PROMPT`, reusing the generation lib) proposes a source-column → target-field mapping, and any newly proposed fields pass through the Schema Validator before being offered (FR49)

**Given** a proposed mapping
**When** it is displayed
**Then** it renders as a visible mapping table (e.g., "Your column 'Customer' → Clients.Name") with each proposed match shown for review, and explicitly nothing is written to the database at this stage (FR49, UX-DR14)

### Story 4.3: Edit Mapping & Resolve Flagged Columns

As an Admin,
I want to correct any mapping and be forced to resolve the ones the AI wasn't sure about,
So that my data lands in the right fields and nothing is silently mis-imported.

**Acceptance Criteria:**

**Given** a proposed mapping
**When** the Admin reviews it
**Then** they can change any source-column → target-field assignment, including mapping to a new field or choosing to skip a column, before confirming (FR50)

**Given** columns the AI could not confidently map
**When** the mapping is displayed
**Then** those columns are visibly flagged (not silently guessed) and the Admin must resolve each one (map or skip) before the Import action becomes available (FR51)

**Given** an unresolved flagged column
**When** the Admin attempts to proceed
**Then** the import is blocked with a clear indication of which columns still need resolution

### Story 4.4: Confirm Import (Non-Destructive Replace)

As an Admin,
I want to confirm the import and have my real data replace the demo data without losing anything,
So that my dashboard becomes my actual system of record.

**Acceptance Criteria:**

**Given** a fully resolved mapping
**When** the Admin taps Import
**Then** rows are written through `mutate.ts` under the caller's RLS-scoped client with an `idempotencyKey` (retry-safe), and a progress indicator is shown (FR52, NFR-FC1)

**Given** the import completes
**When** it finishes
**Then** any remaining synthetic/demo rows are cleared and replaced by the imported real records, and no previously-imported or manually-entered real data is lost (FR52)

**Given** a file of up to 5,000 rows
**When** it is imported
**Then** the import completes in under 60 seconds (NFR-P7)

**Given** a mid-import failure
**When** it occurs
**Then** the operation is retry-safe via the `idempotencyKey` (no duplicate rows on retry) and the user sees a translated status, never a raw error or a half-corrupted table

---

## Epic 5: Conversational Schema Editor (Append-Only, Guarded)

The product's highest-risk surface, isolated as its own epic. An Admin evolves the app's structure by chatting — add a column, add a table, add a view — with every request forced through the Schema Validator allowlist, restricted-keyword rejection, non-destructive row preservation, and Sentry logging of rejections. Unsupported operations (delete/rename) get a safe, non-technical response and a frontend visibility change. Reuses the Gemini client and Schema Validator established in Epic 1; Admin-only per Epic 2 RBAC.

*(Covers FR13, FR14, FR15, FR16, FR17, FR42, FR43, FR45, FR97, FR98. NFRs woven in: NFR-S4, NFR-S5, NFR-R1. UX: UX-DR4.)*

### Story 5.1: Add a Column via Chat

As an Admin,
I want to add a column to a table by describing it in plain language,
So that I can extend my app without any configuration screen.

**Acceptance Criteria:**

**Given** an Admin on the dashboard
**When** the page renders
**Then** a floating AI Assistant chat pill is fixed to the bottom-right, available only to Admins (hidden for Members per Epic 2 RBAC) (UX-DR4)

**Given** an Admin types a request to add a field (e.g., "add a warranty date to Jobs")
**When** they submit
**Then** the request goes through `callGeminiWithTimeout()` with `HARDENED_SYSTEM_PROMPT` (NFR-S5), returns a structured `add_field` operation, and is passed through the Schema Validator before persistence (FR13, FR42)
**And** a "thinking…" bubble is shown during processing (loading-state hierarchy item 4)

**Given** a validated `add_field` operation
**When** it is applied
**Then** the `org_schemas` definition is updated with the new field and all existing rows in `records` are preserved unchanged (append-only on a JSONB store — no row migration) (FR13, FR16)

**Given** an Admin requests a field without naming a target table (e.g., "add a price field")
**When** the request is processed
**Then** the editor infers the target from the currently-viewed table if unambiguous, otherwise asks a clarifying question in chat ("Which table should Price go on — Jobs, Invoices, or Clients?"), and writes nothing to `org_schemas` until the target is confirmed — it never silently guesses (FR13)

**Given** the LLM is unavailable or times out
**When** an Admin uses the editor
**Then** the editor degrades gracefully with a translated message, and core CRUD (Epic 3) remains fully available — the LLM is never a dependency for data operations (NFR-R1)

### Story 5.2: Add a Table via Chat

As an Admin,
I want to add a whole new table by describing it,
So that I can grow my app as my business adds new areas to track.

**Acceptance Criteria:**

**Given** an Admin in the chat editor
**When** they describe a new table (e.g., "add a table for employee timesheets")
**Then** the request produces a validated `add_table` operation (Schema Validator allowlisted), and a new logical table (`table_key` via `normalizeTableName()` + field definitions) is written to `org_schemas` (FR14)

**Given** a new table is added
**When** it appears
**Then** it is immediately usable in the dashboard (table/card views, add/edit) and no existing table's data is altered (FR14, FR16)

**Given** a proposed table name that collides with a reserved key or an existing table
**When** it is validated
**Then** it is normalized or safely disambiguated, never overwriting existing data

### Story 5.3: Create a View via Chat

As an Admin,
I want to ask for a filtered or sorted view of a table,
So that I can see my data organized for a specific purpose without altering it.

**Acceptance Criteria:**

**Given** an Admin in the chat editor
**When** they request a view (e.g., "show me unpaid invoices sorted by date")
**Then** the request produces a validated `add_view` operation defining a filtered/sorted presentation over an existing table's data (FR15)

**Given** a created view
**When** it is opened
**Then** it presents the underlying records filtered/sorted as described, without modifying or duplicating the stored rows (FR15, FR16)

### Story 5.4: Schema Validator Guardrails & Rejection Handling

As the platform owner,
I want every editor request hardened against malicious or malformed operations and all rejections logged,
So that the AI can never damage a tenant's data or cross tenant boundaries.

**Acceptance Criteria:**

**Given** any Conversational Editor request
**When** it is processed
**Then** it is validated against the permitted-operations allowlist (`add_table`, `add_field`, `add_view` only) and any operation outside the allowlist (including attempts to touch `organization_id`, auth tables, or RLS) is rejected (FR42)

**Given** a request whose field/table names contain restricted keywords (`DROP`, `GRANT`, `TRUNCATE`, `DELETE`, `EXEC`, `--`, `;`, `/*`) or any raw SQL
**When** it is validated
**Then** it is rejected 100% of the time and the user sees the plain-language message "That change isn't allowed. Try describing what you'd like to add instead." (FR43, NFR-S4)

**Given** any Schema Validator rejection
**When** it occurs
**Then** it is logged to Sentry with the user's `organization_id` and the raw LLM output for audit review (FR45)

**Given** the Schema Validator
**When** its unit tests run in CI
**Then** they cover the allowlist (permitted ops only), the full blocklist (all 8 keywords, including mixed-case and embedded), and reserved-column collisions

### Story 5.5: Safe Handling of Unsupported Operations

As an Admin,
I want a reassuring, non-technical response when I ask for something the editor can't safely do yet,
So that I stay confident in the tool instead of hitting an error.

**Acceptance Criteria:**

**Given** an Admin requests an unsupported operation (delete a column, delete a table, or rename)
**When** the request is processed
**Then** no destructive migration is executed and the AI responds with a safe, non-technical message (e.g., "To keep your data safe, I can't delete columns yet — but I've hidden [column] from your view. Your data is still protected.") (FR17)

**Given** a "delete/hide column" style request
**When** it is handled
**Then** the column is hidden via the append-only frontend visibility flag (the same mechanism as Story 1.7 / Story 3.5), and the underlying field definition and data remain intact (FR17)

**Given** any unsupported request
**When** it is handled
**Then** no raw JSON, SQL, schema object, or error stack is ever exposed to the user

### Story 5.6: Remove a View via Chat

As an Admin,
I want to remove a view I no longer need,
So that my view list stays tidy.

*(Added via sprint-change-proposal-2026-10-02. Covers FR97. **Supersedes the "hide a view / `setViewVisibility`" framing deferred from Story 5.5** (`deferred-work.md`, spec-5-5): a view is **removed**, not hidden — it stores no rows, so deletion is non-destructive and no visibility flag is built for views. Picks up the parked **Undo on add-view** from that same deferral.)*

**Acceptance Criteria:**

**Given** an Admin in the chat editor
**When** they ask to remove an existing view (e.g., "remove the Unpaid view")
**Then** the request produces a validated `remove_view` operation (allowlisted), the view definition is removed from `org_schemas`, and no rows in `records` are affected — a view stores no data (FR97, aligns FR16)

**Given** the view-tab surface (RecordsView)
**When** an Admin opens a view's overflow menu
**Then** a "Remove view" control is available (Admins only, per Epic 2 RBAC) and removal shows a confirm toast with an Undo action

**Given** a newly applied `add_view` result in chat (the Undo deferred from Story 5.5)
**When** it is shown
**Then** it carries an Undo affordance that removes the just-added view via the same `remove_view` path

**Given** a remove-view request that names no existing view
**When** it is processed
**Then** the editor asks a clarifying question and removes nothing until the target is confirmed; no raw JSON/SQL/error is ever exposed

### Story 5.7: Hide a Table via Chat (in place of Delete)

As an Admin,
I want a mistaken or unused table out of my way without losing its data,
So that I can declutter safely.

*(Added via sprint-change-proposal-2026-10-02. Covers FR98. Supersedes the table-delete branch of Story 5.5 — its column-hide behavior is unchanged. **Realizes the "hide a whole table via chat + persisted `setTableVisibility` mutator/route" deferred from Story 5.5** (`deferred-work.md`, spec-5-5); a pure `hideTable` transform already exists and the `route.ts` anchors (L324–326, L412–414) reserve this work. Picks up the parked **Undo on add-table** from that same deferral.)*

**Acceptance Criteria:**

**Given** an Admin requests deletion of a table
**When** the request is processed
**Then** no table or rows are deleted; the AI responds with a safe message and offers to hide it, and on confirmation a validated `hide_table` operation sets the table-level `hidden` flag in `org_schemas` (append-only) while all rows in `records` are preserved, via a persisted visibility mutator (not an in-memory transform only) (FR98, aligns FR16/FR17)

**Given** a hidden table
**When** an Admin opens the Hidden tables area (Settings)
**Then** the table is listed and can be restored (unhidden) unchanged; true deletion remains unsupported

**Given** a newly applied `add_table` result in chat (the Undo deferred from Story 5.5)
**When** it is shown
**Then** it carries an Undo affordance that hides the just-added table via the same `hide_table` path

**Given** a Member
**When** they use the dashboard
**Then** the hide/restore controls are not available to them (per Epic 2 RBAC)

---

## Epic 6: Public Intake Forms

Lead capture with zero extra tooling. Every claimed dashboard auto-generates a public, no-auth, mobile-optimized intake form at `scheza.com/forms/{slug}` whose fields derive from the schema. External submissions push into the owner's data table in real time, and the Admin gets an email notification (Resend; web push deferred to Growth). Depends only on Epics 1–3.

> **Scope: single form for MVP.** One auto-generated, customer-facing lead-capture form per dashboard, mapped to one designated target table. **Multiple use-case forms** (e.g., an employee-leave form, a separate new-client form, each with its own URL like `/forms/{slug}/{formKey}`) are a **Growth enhancement** — purely additive on the existing data model (a form = a `table_key` + a public route), so deferring boxes nothing in. Revisit when a paying customer requests a second form.

*(Covers FR25, FR26, FR27, FR28. NFRs woven in: NFR-A2, NFR-A4, NFR-P5. UX: UX-DR16.)*

### Story 6.1: Auto-Generated Public Intake Form

As an Admin,
I want a public intake form created automatically for my dashboard,
So that I can capture leads without building or paying for a separate form tool.

**Acceptance Criteria:**

**Given** a claimed dashboard with a `{slug}`
**When** the account goes live
**Then** a public intake form is automatically available at `scheza.com/forms/{slug}` with no additional setup (FR25)

**Given** the org's schema
**When** the intake form renders its fields
**Then** the form fields are derived from the schema-designated intake target (e.g., a Jobs/Leads table), with labels and input types matching the field definitions (FR25)

**Given** an Admin
**When** they view the intake form's public URL
**Then** it is shareable (e.g., from a Google Business profile bio) and requires no login to open

### Story 6.2: No-Auth External Submission

As an external visitor (a potential customer),
I want to submit the form from my phone without creating an account,
So that I can request service in under a minute.

**Acceptance Criteria:**

**Given** the public intake form
**When** an external visitor opens it
**Then** it is a clean, single-page, no-navigation, mobile-optimized form with 48×48px touch targets (NFR-A2) and real associated labels on every field (no placeholder-only labels, NFR-A4) (UX-DR16)

**Given** a completed form
**When** the visitor submits (no account, no login)
**Then** a confirmation message is shown (e.g., "Thanks — [owner] will be in touch shortly") (FR26)

**Given** a submission
**When** it is written
**Then** it is persisted through a narrow, server-side intake write path via `mutate.ts` with a system/anonymous `actorId`, scoped to the `organization_id` resolved from `{slug}` and writing only to the designated intake target — never an arbitrary service-role write (FR26, NFR-FC1)
**And** invalid or missing required fields are caught with accessible, translated inline validation before submission

### Story 6.3: Real-Time Push to Owner's Dashboard

As an Admin,
I want new form submissions to appear in my dashboard instantly,
So that I can respond to leads while they're hot.

**Acceptance Criteria:**

**Given** an Admin viewing the relevant table
**When** an external visitor submits the intake form
**Then** the new record appears in the owner's data table in real time (within 2 seconds), using the same Realtime → `invalidateQueries` path as Epic 3 (FR27, NFR-P5)

**Given** a submitted intake record
**When** it lands in the dashboard
**Then** it is a normal record — viewable, editable, and filterable like any other row

### Story 6.4: Email Notification on New Submission

As an Admin,
I want an email when a new submission arrives,
So that I'm alerted even when I'm not looking at the dashboard.

**Acceptance Criteria:**

**Given** a new intake submission
**When** it is received
**Then** an email notification is sent to the Admin via Resend summarizing the submission (FR28)

**Given** the MVP scope
**When** notifications are delivered
**Then** email (Resend) is the sole channel — web push notifications are explicitly deferred to the Growth phase (FR28)

**Given** an email delivery failure
**When** it occurs
**Then** the submission is still saved and visible in the dashboard (notification failure never blocks data capture)

---

### Story 6.5: Exclude Relationship Fields from Public Intake Forms

As an Admin,
I want lookup fields left off my public intake form,
So that an anonymous submitter can never browse or pick from my client list (PIPEDA).

**Acceptance Criteria:**

**Given** a schema containing one or more relationship fields
**When** the public intake form is auto-generated
**Then** relationship fields are excluded by default — no picker over another table is rendered to unauthenticated submitters (FR78)

**Given** a relationship field that is required on the target table
**When** an external submission is saved
**Then** the record is created with the relationship unset, and the Admin can link it from the dashboard afterward (FR78, FR71)

**Given** the exclusion
**When** the form is rendered
**Then** no target-table record ids, labels, or counts appear in the form markup or any network payload (FR78)

---

## Epic 7: Billing, Trials & Flat Tiers

Monetization on Stripe-hosted surfaces only. A 14-day no-card trial, a **flat all-inclusive subscription** (a fixed monthly price per tier: Solo/Crew/Shop) via Stripe Checkout, self-serve management via Customer Portal, and read-only gating on lapse driven by `subscription_status` as the cached source of truth. `subscription_tier` on the org record is the billed plan; there is **no metering, no usage reporting, and no spend cap** — invoicing volume (invoices issued per cycle, counted from the fixed Invoicing module) only drives a *tier-change prompt*. A per-cycle Vercel Cron reconciles the Stripe tier against `subscription_tier` (NFR-R5). Depends only on Epics 1–3.

*(Reconciled 2026-09-27: flat tiers replaced the earlier usage-based metering — predictability is the product promise for this buyer, and metering perversely penalized the import-everything behaviour Scheza wants.)*

*(Covers FR29, FR30, FR31, FR32, FR33, FR53, FR54, FR55. NFRs woven in: NFR-R4, NFR-R5.)*

### Story 7.1: 14-Day Free Trial (No Card)

As a new Admin,
I want a 14-day trial without entering payment details,
So that I can migrate my whole operation before deciding to pay.

**Acceptance Criteria:**

**Given** a newly claimed account
**When** the trial begins
**Then** `subscription_status` is set to `trial` with a 14-day expiry, and no payment information is requested (FR29)

**Given** an account in trial
**When** the user works in it
**Then** records and team members are unlimited during the trial (to maximize import and switching cost), and the trial state is the single source of truth for access

### Story 7.2: Start a Flat-Tier Subscription via Stripe Checkout

As an Admin,
I want to add billing through a secure hosted checkout at a predictable flat price,
So that my business keeps running after the trial with no surprise bill.

**Acceptance Criteria:**

**Given** an Admin
**When** they tap "Add Billing"
**Then** they are redirected to a Stripe Checkout session for a subscription at a **fixed monthly price for their tier** (Solo/Crew/Shop via `STRIPE_PRICE_SOLO`/`_CREW`/`_SHOP`) with **no metered usage component**, and no custom billing UI is built (FR30, FR53)
**And** the redirect button shows a disabled "Redirecting…" state during the handoff

**Given** a completed checkout
**When** Stripe fires `checkout.session.completed`
**Then** a signature-verified webhook (`stripe.webhooks.constructEvent`) sets `subscription_status = active` and records the purchased `subscription_tier` on the org's Supabase record (FR30, FR53)

**Given** a webhook with an invalid signature
**When** it is received
**Then** it is rejected and not processed

### Story 7.3: Manage Subscription via Stripe Customer Portal

As an Admin,
I want to manage my billing myself,
So that I can update my card, see invoices, or cancel without contacting support.

**Acceptance Criteria:**

**Given** an Admin with an active subscription
**When** they open "Billing" in Settings
**Then** they are redirected to the Stripe Customer Portal where they can update payment method, view invoice history, and cancel anytime (no contract) — all on Stripe-hosted surfaces (FR31)

**Given** a change made in the Portal (e.g., cancellation)
**When** Stripe fires the corresponding webhook (`customer.subscription.deleted`, `invoice.payment_failed`, `invoice.paid`)
**Then** the signature-verified handler updates the cached `subscription_status` accordingly

### Story 7.4: Read-Only Gating & Trial Reminders

As the platform,
I want access to reflect billing state and to warn users before their trial ends,
So that lapses are graceful and users are prompted to convert.

**Acceptance Criteria:**

**Given** an account whose trial expires or whose subscription lapses
**When** the state changes
**Then** the account transitions to read-only mode — data remains visible but no new entries can be added — with `subscription_status` (cached in Supabase) as the single source of truth (FR32)

**Given** an account in trial
**When** it reaches Day 12 and Day 14
**Then** the Admin receives billing-prompt email notifications via Resend, and a persistent in-app banner appears from Day 12 (FR33)

**Given** Stripe is unreachable or a webhook fails
**When** a user accesses their dashboard
**Then** access is governed by the cached `subscription_status` in Supabase (fallback source of truth), so billing-provider downtime never locks a paying user out (NFR-R4)

### Story 7.5: Tier View, Tier-Change Prompt & Tier Reconciliation

As an Admin,
I want to see exactly what my flat plan includes and be prompted (not auto-charged) when I outgrow it,
So that my bill is always predictable and I stay on the right plan.

**Acceptance Criteria:**

**Given** an Admin
**When** they view billing
**Then** they see their current tier, everything it includes (unlimited team members, customers, historical records, and import — no per-seat or per-record charge), and their next billing date — with **no usage meter and no spend cap** (FR54)

**Given** an account whose invoicing volume (invoices issued per cycle) sustainably exceeds its current tier band
**When** the platform evaluates tier placement
**Then** the Admin is shown a **tier-change prompt** to move up a plan, rather than any overage being silently metered or charged (FR55)

**Given** a per-cycle Vercel Cron reconciliation job (declared in `vercel.json`, hitting a `CRON_SECRET`-protected `/api/cron/reconcile-tier` route)
**When** it runs
**Then** the subscription tier held in Stripe is compared against `subscription_tier` in Supabase, and any drift is paged (Sentry) before it can affect access (NFR-R5)

**Given** an unauthenticated request to the cron route
**When** it arrives without the valid `CRON_SECRET`
**Then** it is rejected

---

## Epic 8: Localization, PWA & Compliance/Offboarding

The Ontario-specific trust and reach layer, plus PIPEDA lifecycle obligations. Instant EN/FR UI toggle (labels + column names + already-generated data, no reload), PWA "Add to Home Screen," field-level sensitivity indicators, "Download My Data" (CSV/JSON), and self-service offboarding (30-day read-only grace → cascade delete) with staged email warnings. *(French synthetic-data generation, FR35, lives in Epic 1.)* Depends only on Epics 1–2.

> **UX-DR17 note:** the "Spatial Clean" visual language is satisfied for MVP by the shadcn/ui New York / zinc CSS-variable theme applied throughout (off-the-shelf mandate). The bespoke palette/typography from `docs/design.md` is a Growth-phase polish investment — no dedicated MVP story.
>
> **Pull-forward candidates:** FR40 (sensitivity indicator) and FR41 (PWA install) have outsized trust/habit payoff and no hard dependency on the rest of this epic — deliver earlier if capacity allows.

*(Covers FR34, FR37, FR38, FR39, FR40, FR41. NFRs woven in: NFR-P6, NFR-A1, NFR-S2. UX: UX-DR10, UX-DR11, UX-DR12, UX-DR15, UX-DR17.)*

### Story 8.1: Instant EN/FR UI Toggle (No Reload)

As a bilingual user,
I want to flip the whole interface between English and French instantly,
So that my team and my clients can each work in their own language.

**Acceptance Criteria:**

**Given** any dashboard screen
**When** the user taps the top-right language toggle
**Then** all UI labels, navigation, and column/field names switch between EN and FR with no page reload, applying in under 300ms via `next-intl` `setLocale()` (FR34, NFR-P6, UX-DR11)

**Given** a language selection
**When** it is made
**Then** the choice is persisted in `localStorage` and restored on the user's next visit — no API call is required to switch

**Given** already-generated synthetic or real data with localized column names
**When** the language is toggled
**Then** the displayed labels/column headers reflect the selected locale (data values are not re-translated; language of stored content follows how it was entered/generated)

**Given** the UI in either language
**When** it renders
**Then** all text meets WCAG AA color-contrast minimums (AAA where achievable), with no light-grey-on-white text (NFR-A1, UX-DR15)

### Story 8.2: PWA Install ("Add to Home Screen")

As a mobile user,
I want to install Scheza as an app icon on my phone,
So that it opens like a native app without an app store.

**Acceptance Criteria:**

**Given** the app
**When** it is built
**Then** it ships an auto-generated web app manifest and service worker enabling PWA installability (FR41)

**Given** a mobile user on a supported browser
**When** they use the dashboard
**Then** they are prompted to "Add to Home Screen," and once installed it launches in a standalone, native-feeling window (FR41, UX-DR10)

**Given** an installed PWA
**When** it is opened from the home screen
**Then** it loads the user's dashboard directly (respecting their existing session)

### Story 8.3: Field-Level Sensitivity Indicator

As a user handling sensitive information,
I want a clear signal on fields that store private data,
So that I trust the platform with things like gate codes and personal details.

**Acceptance Criteria:**

**Given** a column flagged as storing sensitive or personally identifiable data
**When** it is displayed
**Then** it shows a field-level indicator (e.g., a padlock icon) in both table and card views (FR40, UX-DR12)

**Given** a sensitivity indicator
**When** the user taps/hovers it
**Then** a plain-language, PIPEDA-reassuring tooltip is shown (e.g., "Stored encrypted. Canadian servers only (PIPEDA).") — reinforced by encryption-at-rest at the infrastructure level (NFR-S2)

### Story 8.4: Download My Data (CSV / JSON)

As an Admin,
I want to export all my organization's data,
So that I own my data and can meet my own record-keeping needs (PIPEDA portability).

**Acceptance Criteria:**

**Given** an Admin in account settings
**When** they choose "Download My Data"
**Then** all of the organization's records are exported as both CSV and JSON, scoped strictly to their `organization_id` under RLS (FR37)

**Given** an export request
**When** it runs
**Then** it includes all logical tables' records and completes without exposing any other organization's data

### Story 8.5: Self-Service Offboarding (Grace + Cascade Delete)

As an Admin who has cancelled,
I want a clear grace period and warnings before my data is deleted,
So that I can recover or export before anything is lost.

**Acceptance Criteria:**

**Given** an account cancellation
**When** it takes effect
**Then** the account enters a 30-day read-only grace period — data is visible but no new entries can be added — and the "Download My Data" export is prominently surfaced throughout (FR38)

**Given** an account in the grace period
**When** it reaches Day 1, Day 7, and Day 25
**Then** the Admin receives an email warning via Resend at each milestone (FR39)

**Given** an account that reaches Day 30 of the grace period
**When** the offboarding job runs
**Then** a hard cascade delete removes all of the organization's records and schema (a narrow, allowlisted offboarding operation — the only such use of elevated privileges), and the deletion is irreversible after completion (FR38)

---

## Epic 12: Invoicing, Payments & Delivery

Turn finished work into money. Invoicing is the one **fixed, compliant module** in an otherwise AI-generated product: it lives in **dedicated typed platform tables** (not the JSONB record store) so it can guarantee correct HST, mandatory legal identity, gap-free per-org numbering, and true immutability. Capture a Business Profile once, draft an invoice from a work record or standalone, compute Ontario HST as a separate line, issue it through a validation gate that mints a gap-free number and freezes an in-house-rendered PDF to private storage, deliver it PDF-first from the owner's own phone/inbox, track payment out-of-band, and correct only via credit notes. Depends only on Epics 1–3 (the `records`/`org_schemas` model, the guarded `mutate.ts` layer, real claimed accounts) and Resend — sequenced in build order right after Epic 4. Payment *processing* (Stripe Connect), Interac auto-reconcile, WhatsApp Business API, and owner-inbox integration are Phase 3.

*(Covers FR82–FR95. NFRs woven in: NFR-FC1 (guarded writes), NFR-S1/S2 (TLS + at-rest on the public PDF surface), NFR-A2/A4 (accessible invoice UI), and the PIPEDA six-year-retention override on offboarding. Architecture: §Invoicing, Payments & Delivery, binding Consistency Invariants I1–I8.)*

> **🚦 Hard release gate:** an Ontario lawyer and a CPA must review the invoice templates, HST logic, and terms **before invoicing is enabled in production**. Product copy must never claim every invoice is legally compliant — only that it carries the configured compliance information.

### Story 12.1: Business Profile — Capture Company Identity Once

As an Admin,
I want to enter my business identity and payment details once,
So that every invoice is compliant and shows how to pay me, without re-typing it each time.

**Acceptance Criteria:**

**Given** an Admin in Settings
**When** they open Business Profile
**Then** they can capture legal name, operating name, entity type, jurisdiction, GST/HST number and registration effective date, logo, addresses, payment terms, and default invoice language, stored in `business_profiles` keyed by `organization_id` (FR83)

**Given** a saved Business Profile
**When** an invoice that charges tax renders
**Then** it shows the legal name together with the operating name and the GST/HST registration number (FR85)

**Given** the Business Profile
**When** the Admin enters payment details
**Then** a structured Payment Instructions block is captured — e-transfer email, cheque payable-to and mailing address, and an optional owner-provided card-payment link as free text (FR90)

**Given** identity capture
**When** it drives rendering
**Then** it produces one clean, full-detail template — this is identity capture, not a template designer (FR83)

### Story 12.2: Draft an Invoice (from a Work Record or Standalone)

As an Admin,
I want to create an invoice from a completed job or from scratch,
So that I can bill a customer for labour and parts.

**Acceptance Criteria:**

**Given** an Admin
**When** they create an invoice from an existing work record
**Then** customer and line items are pre-filled via a loose link (`customer_record_id` into `records`), and the invoice can equally be created standalone (FR82)

**Given** a draft invoice
**When** line items are added
**Then** each carries description, quantity, and unit price in `invoice_line_items`, and the invoice is stored with `status = draft` (FR82)

**Given** a draft created from a record
**When** it is saved
**Then** the customer's province is stored on the invoice as `place_of_supply_province`, and **no supplier/customer snapshot is frozen yet** — snapshots are populated only at issue (FR95, Invariant I6)

**Given** the loose customer link
**When** a tenant's generated schema differs from another's
**Then** invoice creation still works regardless of how that workspace was generated (FR82)

### Story 12.3: Totals & Ontario HST (Place of Supply)

As an Admin,
I want HST calculated correctly and shown as its own line,
So that my invoices are tax-compliant.

**Acceptance Criteria:**

**Given** a draft with line items
**When** totals are computed
**Then** a single canonical function (`lib/invoicing/tax.ts`) computes line `amount = round(quantity × unit_price, 2)`, `subtotal = Σ line amounts`, and `total = subtotal + tax_total`, and the stored `invoices` columns are written only from that function's output (Invariant I2)

**Given** a GST/HST-registered business supplying in Ontario
**When** tax is applied
**Then** HST is `round(subtotal × rate, 2)` computed once on the subtotal and shown as **one separate** tax line in `invoice_tax_lines` — never split into federal/provincial components (FR84, Invariant I3)

**Given** a business not GST/HST-registered, or whose `gst_hst_effective_date` is after the invoice `issue_date`
**When** an invoice is prepared
**Then** no tax is labelled or calculated, using the single shared predicate `gst_hst_effective_date <= issue_date` that both `tax.ts` and `validate.ts` import (FR84, Invariant I3)

**Given** a customer in Quebec
**When** the province seam is considered
**Then** province and language are already stored so a Quebec invoice (French, GST + QST on separate lines, QST number) can be enabled later with no re-architecture — Ontario/English is the only active path in MVP (FR95)

### Story 12.4: Issue an Invoice — Validate, Number, Freeze Identity, Lock

As an Admin,
I want issuing an invoice to be a deliberate, validated, irreversible step,
So that what I send is compliant and can never be quietly altered.

**Acceptance Criteria:**

**Given** a draft invoice
**When** the Admin issues it
**Then** `assertIssuable()` runs first and **blocks** issuance with a plain-language reason if legal identity is missing, tax is charged without a valid registration, HST is split into components, or totals do not reconcile (reusing the same tax function as Invariant I2) (FR87)

**Given** a validated invoice
**When** it is issued
**Then** a gap-free `invoice_number` is allocated from a **per-org sequence inside the same transaction** that flips status to `issued`; numbers are never reused and a later void leaves a permanent gap (FR86, Invariant I1)

**Given** the issue transaction
**When** it commits
**Then** `supplier_snapshot` and `customer_snapshot` are frozen onto the invoice, so the finalized document is stable even if the live business/customer records later change (FR86, Invariant I6)

**Given** an issued invoice
**When** any actor attempts to modify it
**Then** a Postgres trigger permits only the whitelisted transitions (`issued→paid`, `issued→void`, `issued/paid→overdue`), freezes every other column plus the child line/tax rows, and corrections are possible only via a credit note (FR86, FR88, Invariant I7)

### Story 12.5: Render & Freeze the Invoice PDF

As an Admin,
I want a clean PDF of each issued invoice stored permanently,
So that I have an exact record of what the customer received for the legally required retention period.

**Acceptance Criteria:**

**Given** an invoice being issued
**When** the PDF is produced
**Then** it is rendered in-house with `@react-pdf/renderer` from the invoice data (one render path shared with credit notes) and a copy is frozen to a private Supabase Storage bucket, with the bucket-relative object key stored in `pdf_path` (FR89, Invariants I5, I8)

**Given** a frozen PDF
**When** it is stored
**Then** a high-entropy `share_token` (128-bit, base62url) is minted once and stored on the invoice, never rotated on re-send (Invariant I4)

**Given** issued invoices and their PDFs
**When** retention is considered
**Then** structured invoice data and every rendered PDF are retained for at least six years (FR89)

**Given** account offboarding
**When** the cascade delete runs
**Then** invoices, credit notes, payments, and their frozen PDFs under the six-year obligation are **excluded** from deletion — statutory retention overrides the 30-day PIPEDA cascade

### Story 12.6: Deliver the Invoice (Owner's Own Channels)

As an Admin,
I want to send the invoice PDF from my own phone or email,
So that it arrives from a number or address my customer recognizes.

**Acceptance Criteria:**

**Given** an issued invoice on mobile
**When** the Admin taps Share
**Then** the phone's native Web Share sheet sends the frozen PDF through the owner's own WhatsApp / Messages / email — no WhatsApp Business API, no cost, no customer login (FR93)

**Given** the SMS path, which cannot attach a PDF
**When** the Admin shares by text
**Then** the message carries an unguessable link `GET /i/[token]` that streams the same PDF via a server proxy (never a redirect to a signed storage URL), is non-enumerable, and returns 404/410 once the invoice is void (FR93, Invariants I4, I5)

**Given** an issued invoice on desktop
**When** the Admin sends it
**Then** Scheza emails the invoice with the PDF attached via Resend with **reply-to the owner's address**, and also offers Download PDF and Copy Link (FR94)

**Given** any invoice email
**When** it is sent
**Then** it is strictly transactional (CASL) — no marketing content on the send path

### Story 12.7: Track Payment Out-of-Band (No Processing)

As an Admin,
I want to see who owes me and mark invoices paid,
So that I manage cash flow without Scheza touching the money.

**Acceptance Criteria:**

**Given** an issued invoice
**When** it is viewed or delivered
**Then** it carries the structured Payment Instructions block from the Business Profile — e-transfer, cheque, and the owner's optional card link (FR90)

**Given** a payment received outside Scheza
**When** the Admin marks the invoice paid
**Then** method, date, amount, and reference are recorded in `invoice_payments` and status becomes `paid`; **no money is processed or held by Scheza** (FR91)

**Given** the Invoices tab
**When** it loads
**Then** it defaults to an Unpaid / Overdue view derived from `status` + `due_date`, working uniformly across all tenants regardless of generated schema (FR92)

**Given** `invoice_payments`
**When** a payment record is added or corrected
**Then** it remains freely mutable even though the parent invoice is immutable (Invariant I7)

### Story 12.8: Correct an Issued Invoice via Credit Note

As an Admin,
I want to correct a mistake on a sent invoice without editing it,
So that my records stay audit-clean and compliant.

**Acceptance Criteria:**

**Given** an issued invoice that needs correcting
**When** the Admin creates a credit note
**Then** it is stored in `credit_notes` with a credit-note number from its **own independent per-org sequence** (disjoint from invoice numbers), linked to the original invoice (FR88, Invariant I1)

**Given** a credit note
**When** its lines are captured
**Then** they use the same child-table shape as invoices (`credit_note_line_items` / `credit_note_tax_lines`) so the one PDF render path serves both (Invariant I8)

**Given** a credit note is finalized
**When** it is issued
**Then** it renders and freezes a PDF like an invoice and is itself immutable; the original issued invoice is never edited (FR88)

---

## Epic 13: List-of-Values (Single-Select) Field Type

A single-choice "picklist" field (e.g. Status: Paid / Unpaid / Rejected), created and managed entirely through the Conversational Editor and rendered as a dropdown everywhere data is entered. This backs the dropdowns the PRD's user journeys already assume ("selects Service Complete from a dropdown"; "Type of Issue dropdown") but which had no field type behind them. Plain (no colors), single-select only. Value management is append-only: add a value, rename a value's label (stored value stays stable), and archive — never delete — a value that is in use. Reuses the Gemini client + Schema Validator (Epic 1) and the guarded `mutate.ts` layer (Epic 3); Admin-only management per Epic 2 RBAC.

*(Added via sprint-change-proposal-2026-10-02. Covers FR96. NFRs woven in: NFR-S4, NFR-S5. Depends on Epics 1, 3, 5.)*

### Story 13.1: Single-Select Field in the Data Model & Validator

As the platform owner,
I want the schema model and validator to understand a single-select field,
So that every other surface can rely on a well-formed list-of-values type.

**Acceptance Criteria:**

**Given** the schema types
**When** a `select` field is defined
**Then** `FieldType` includes `'select'`, `SchemaField` carries `options: SelectOption[]`, and each `SelectOption` has a stable normalized `value`, a display `label`, and an optional `archived` flag (FR96)

**Given** a proposed `add_field` with `dataType: 'select'`
**When** the Schema Validator runs
**Then** it is accepted only with a non-empty `options[]` of unique, normalized values, and rejected (plain-language) otherwise; reserved-key and blocklist rules are unchanged

**Given** the Schema Validator unit tests
**When** they run in CI
**Then** they cover select acceptance, empty/duplicate-option rejection, the new allowlisted ops, and confirm the blocklist is unchanged

### Story 13.2: Render & Edit Single-Select Across Views & Forms

As a team member,
I want single-select fields to show and edit as a dropdown,
So that I pick a consistent value instead of free-typing.

**Acceptance Criteria:**

**Given** a `select` field in a table or card view
**When** records render
**Then** the field shows its option `label` as plain text (archived values still render for existing rows) (FR96)

**Given** the Add/Edit form or an inline edit (Story 3.2 / 3.3 patterns)
**When** the user edits a `select` field
**Then** a dropdown of non-archived options is presented, and the write persists the option `value`; optimistic update + rollback are preserved

**Given** an Admin viewing the dropdown
**When** it is open
**Then** an Admin-only "+ Add value" affordance appears at the bottom (hidden for Members per Epic 2 RBAC), calling the same validated `add_select_option` path (Story 13.4)

### Story 13.3: Create a Single-Select Field (with Values) via Chat

As an Admin,
I want to create a status-style field and its values in one sentence,
So that I can set up a picklist without any configuration screen.

**Acceptance Criteria:**

**Given** an Admin in the chat editor
**When** they describe a single-select field with its values (e.g., "add a status field with Paid, Unpaid, Rejected")
**Then** the request produces a single validated `add_field` operation with `dataType: 'select'` and the three options, persisted to `org_schemas`; all existing rows are preserved (FR96, aligns FR16)

**Given** a create request that does not name a target table
**When** it is processed
**Then** the editor infers the target from the current table if unambiguous, otherwise asks a clarifying question, and writes nothing until the target is confirmed (reuses Story 5.1 behavior)

### Story 13.4: Manage Single-Select Values (Chat + Inline, Append-Only)

As an Admin,
I want to add, rename, and retire values on a list field,
So that the field keeps up with my business without risking existing data.

**Acceptance Criteria:**

**Given** an existing `select` field
**When** the Admin adds a value via chat ("add a value Partially Paid") or the inline "+ Add value"
**Then** a validated `add_select_option` is applied and the value becomes immediately selectable (FR96)

**Given** an existing value
**When** the Admin renames it
**Then** `rename_select_option` edits the `label` only; the stored `value` key is unchanged, so existing records are unaffected (FR96, aligns FR16)

**Given** a request to remove a value
**When** it is handled
**Then** if the value is in use it is archived (`archive_select_option` sets `archived: true`) — existing records keep it and it is not selectable for new records; an unused value may be hard-removed; a plain-language message explains the archive behavior and no row migration occurs (FR96)

### Story 13.5: Generation & Fallback Emit Select Fields

As an Admin,
I want generated schemas to use real dropdowns where they make sense,
So that my dashboard looks right from the first second.

**Acceptance Criteria:**

**Given** AI schema generation (Epic 1 pipeline)
**When** a status-like field is appropriate (e.g. a Status on Jobs or Invoices)
**Then** it may be proposed as a `select` field with sensible options and a plain-language reason (FR46), validated by the Schema Validator like any other field

**Given** the Universal Field Service hard-fallback template
**When** it is deployed
**Then** it includes a `select` Status field with generic options, so the fallback path also demonstrates the dropdown

### Story 13.6: Single-Select on Intake Forms & CSV Import

As an Admin,
I want list fields to behave correctly on the public form and during import,
So that picklists are consistent across every entry point.

**Acceptance Criteria:**

**Given** a public intake form (Epic 6) that includes a `select` field
**When** it renders
**Then** the field is a dropdown of non-archived options, and a submission persists a valid option `value` (FR96)

**Given** a CSV/Excel import (Epic 4) mapping a source column onto a `select` field
**When** the mapping is applied
**Then** values matching an existing option are accepted and values matching no option are flagged for the user to resolve before import completes (reuses the FR49–FR51 confirm/flag flow)

**Given** this story's scope
**When** import mapping runs
**Then** mapping onto an *existing* `select` field is in scope; **creating a new `select` field during import is out of scope** and remains with the deferred "map an import column to a brand-NEW field" work (`deferred-work.md`, spec-4-3 and spec-4-4)
