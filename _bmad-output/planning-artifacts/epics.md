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

# SnapBusy - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for SnapBusy, decomposing the requirements from the PRD, UX Design (`docs/design.md`), and Architecture requirements into implementable stories.

> **Scope note:** SnapBusy is delivered in phases. **MVP (Phase 1)** = FR1–FR55 + all non-Forward-Compatibility NFRs, with the Forward-Compatibility NFRs (NFR-FC1–FC4) constraining *how* MVP is built. **Growth** = FR56–FR61. **Vision / Phase 3** = FR62–FR69 (gated, traceability only). Epic and story creation focuses on MVP + the Growth/Phase-3 seams that must not be foreclosed.

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
- **FR30:** Admin can start a usage-based paid subscription (monthly base fee plus metered overage on active records) via a Stripe-hosted checkout page
- **FR31:** Admin can manage their subscription (update payment method, view invoices with usage breakdown, cancel) via the Stripe Customer Portal
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

**Billing — Usage Metering (MVP)**

- **FR53:** The system meters the count of active records managed per billing cycle and reports it to the billing provider for overage calculation
- **FR54:** Admin can view current active-record usage against the included allotment at any time
- **FR55:** Admin can set an optional monthly spend cap; when the cap is reached, the system pauses new-record creation instead of accruing further charges

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

**Security**

- **NFR-S1:** All data in transit must be encrypted using TLS 1.2 or higher
- **NFR-S2:** All data at rest must be encrypted at the infrastructure level (AES-256 or equivalent via Supabase/AWS)
- **NFR-S3:** Row-Level Security policies must be active on 100% of tenant data — verified by automated test before any table/data is exposed to the frontend
- **NFR-S4:** The Schema Validator must reject 100% of requests containing restricted keywords (`DROP`, `GRANT`, `TRUNCATE`, `DELETE`, `EXEC`, `--`, `;`, `/*`)
- **NFR-S5:** 100% of LLM API calls must include the hardened identity-masking system prompt
- **NFR-S6:** The Supabase service role key must never appear in client-side code — enforced by a CI lint rule that fails the build if the key is detected in frontend bundles

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
- **NFR-R5:** Active-record usage counts reported to the billing provider must reconcile with the database record count within a 1% tolerance per cycle, verified by an automated reconciliation job

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

- **AR7:** All Gemini calls go through `callGeminiWithTimeout()` (`src/lib/gemini/client.ts`) with `HARDENED_SYSTEM_PROMPT` on every call; model `gemini-3.8-flash` (superseded the original `gemini-2.0-flash` pin in Story 1.4 — see Epic 1 retro 2026-09-24); 15s timeout via `Promise.race` + `AbortController`; retry once, then deploy `UNIVERSAL_FIELD_SERVICE_TEMPLATE`. Generation is ONE structured call returning `{ schema, seedRows }`; `responseMimeType: "application/json"` + `responseSchema`. The `relation` field type is excluded from MVP.
- **AR8:** The Schema Validator (`src/lib/schema/validator.ts`) runs synchronously on every LLM-proposed schema-metadata operation before persistence to `org_schemas`. Permitted ops MVP: `add_table`, `add_field`, `add_view` (append-only). Rejects reserved column collisions and blocked keywords; logs all rejections to Sentry with `organization_id` + raw output.

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
- FR30: Epic 7 — Start usage-based subscription via Stripe Checkout
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
- FR53: Epic 7 — Meter active records per cycle, report to billing provider
- FR54: Epic 7 — Admin views current usage vs included allotment
- FR55: Epic 7 — Optional monthly spend cap pauses new-record creation

**Growth (post-$1K MRR)**

- FR56: Epic 9 — Append-only per-tenant activity log
- FR57: Epic 9 — Plain-language workflow suggestions from usage patterns
- FR58: Epic 9 — Accept/edit/dismiss suggestions; dismissals remembered
- FR59: Epic 9 — Execute accepted workflows (trigger/action rules)
- FR60: Epic 9 — Per-tenant learned-patterns record informs suggestions
- FR61: Epic 9 — Business Snapshot export

**Vision — Phase 3 (gated; traceability only)**

- FR62: Epic 10 — Propose real-world operational action
- FR63: Epic 10 — Approve/edit/reject proposed action
- FR64: Epic 10 — Execute approved action end-to-end + audit log
- FR65: Epic 10 — Autonomous execution per action-type trust threshold
- FR66: Epic 10 — Review/pause/revoke autonomy per action-type
- FR67: Epic 10 — Report autonomous work via chosen channel
- FR68: Epic 10 — Named-role management (bookkeeping/sales/operations)
- FR69: Epic 10 — Actions via connected external tools (allowlisted, gated)

## Epic List

### Epic 1: Foundation & the Generative "Aha" Moment
Stand up the platform and deliver SnapBusy's core value proposition end-to-end: an anonymous visitor describes their business with a guided prompt and, in under 45 seconds, lands in a fully interactive, Ontario-localized, data-populated dashboard — with a plain-language reason on every generated field and a one-tap override — before ever creating an account. This epic establishes the foundational architecture that every later epic builds on: `create-next-app` scaffolding + pinned deps (AR1, AR2), the shared-JSONB data model (`records` + `org_schemas`, no runtime DDL — AR3), the single static membership-based RLS policy and `auth_org_ids()` (AR4, FR44), the guarded `mutate.ts` write layer (AR5, NFR-FC1), the Gemini pipeline with `HARDENED_SYSTEM_PROMPT` + timeout + fallback (AR7), the Schema Validator gate (AR8), and the CI safety gates (AR11, AR12). It stands alone as a public, shareable demo.
**FRs covered:** FR1, FR2, FR3, FR4, FR5, FR35, FR44, FR46, FR47
**NFRs woven in:** NFR-P1, NFR-P2, NFR-S3, NFR-S5, NFR-S6, NFR-R1, NFR-R3, NFR-SC1/2/3, NFR-FC1–FC4 (seams)

> **Story-ordering guidance (Step 3):** The first story is a **thin vertical slice** — a hardcoded schema provisioned into `records` → `org_schemas` and rendered as a live read-only table — to prove the full data pipeline before the LLM exists. Layer the Gemini generation, Schema Validator, synthetic-data injection, hard fallback, and explainability affordances (UX-DR2, UX-DR13) as later stories on that proven spine.
>
> **Boundary vs Epic 3:** FR5 in this epic = **browse + basic in-place edit of the *demo* (pre-account) data only**, self-contained. Full CRUD, real-time multi-user sync, filter/sort, and column-hide on the *claimed org's real* data live in Epic 3. Epic 1 therefore has **no forward dependency** on Epic 3.
>
> **Cheap-now seams landed here (retrofit-avoidance, mirroring the NFR-FC philosophy):**
> - **i18n seam:** wire `next-intl` and enforce the no-hardcoded-strings rule from the very first component. **FR35 (French synthetic data at generation) lives in this epic** — the generation pipeline detects the prompt's language so Sarah's French-prompt aha moment is French from second one. Epic 8 then adds the EN/FR *UI toggle* (FR34) and the translation catalog.
> - **Metering seam:** bake the **"active record" billable-unit definition** into the `records` data model now. Epic 7 then adds only the Stripe integration, the Vercel Cron reporting/reconciliation jobs, and the live meter UI.

### Epic 2: Claim, Accounts & Team Access
Turn a demo into a committed customer. A visitor claims their generated app via passwordless magic link, agrees to a mandatory privacy consent (PIPEDA), and gets a live, isolated organization at `scheza.com/{slug}` with synthetic data cleared. The account creator becomes Admin; they can invite teammates by email and assign the Admin or Member role, with Member permissions enforced both in the UI and independently at the API. Delivers the complete authentication, org-provisioning, and RBAC domain.
**FRs covered:** FR18, FR19, FR20, FR21, FR22, FR23, FR24, FR36
**NFRs woven in:** NFR-S1, NFR-S2, NFR-S3

### Epic 3: Core Data Management (Daily Driver)
The everyday surface: team members manage their real business records. Responsive DataTable on desktop and swipeable cards on mobile, add via schema-typed forms, inline edit-on-blur with optimistic UI, delete, filter/sort, Admin column-hide (no data loss), and real-time multi-user sync — all through the guarded `mutate.ts` layer under RLS. This is where the tool stops being a demo and becomes the business's system of record.
**FRs covered:** FR6, FR7, FR8, FR9, FR10, FR11, FR12
**NFRs woven in:** NFR-P3, NFR-P4, NFR-P5, NFR-A2, NFR-A3, NFR-A4, NFR-FC1

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
**FRs covered:** FR25, FR26, FR27, FR28
**NFRs woven in:** NFR-A2, NFR-A4, NFR-P5

### Epic 7: Billing, Trials & Usage Metering
Monetization on Stripe-hosted surfaces only. A 14-day no-card trial, usage-based subscription (base + metered overage) via Stripe Checkout, self-serve management via Customer Portal, and read-only gating on lapse driven by `subscription_status` as the cached source of truth. Includes the Vercel Cron usage-reporting + reconciliation jobs (AR10, NFR-R5), the live in-app usage meter, and the optional spend cap.
**FRs covered:** FR29, FR30, FR31, FR32, FR33, FR53, FR54, FR55
**NFRs woven in:** NFR-R4, NFR-R5

### Epic 8: Localization, PWA & Compliance/Offboarding
The Ontario-specific trust and reach layer, plus PIPEDA lifecycle obligations. Instant EN/FR UI toggle (labels + column names + already-generated data, no reload), PWA "Add to Home Screen," field-level sensitivity indicators, "Download My Data" (CSV/JSON), and self-service offboarding (30-day read-only grace → cascade delete) with staged email warnings. *(French synthetic-data generation, FR35, was moved to Epic 1 — it belongs to the generation pipeline and to Sarah's French-prompt aha moment.)*
**FRs covered:** FR34, FR37, FR38, FR39, FR40, FR41
**NFRs woven in:** NFR-P6, NFR-A1, NFR-S2

> **Pull-forward candidates (focus-group flag):** **FR40 (field-level sensitivity/PIPEDA indicator)** and **FR41 (PWA "Add to Home Screen")** are small-surface-area FRs with outsized *conversion-trust* and *day-1-habit* payoff (Sarah's deal-closer; Tim's home-screen bookmark). If capacity allows, deliver them earlier than this epic — they have no hard dependency on the rest of Epic 8.

### Epic 9: Growth Substrate — Activity Log, Workflows, Learned Patterns *(Growth — deferred)*
*Post-$1K MRR. Listed for FR completeness; story breakdown deferred until Growth is opened.* The nervous system for later intelligence: append-only per-tenant activity log (the prerequisite substrate — AR/NFR-FC2), the workflow execution engine, the plain-language Workflow Suggestion Layer, the per-tenant learned-patterns record, and the Business Snapshot export (a report over the activity log).
**FRs covered:** FR56, FR57, FR58, FR59, FR60, FR61
**NFRs woven in:** NFR-P8, NFR-FC2, NFR-R2 (99.9%)

### Epic 10: Autonomous Operations — The Digital Employee *(Vision / Phase 3 — gated, traceability only)*
*Gated on proven week-4 retention ≥30% and month-over-month records-under-management growth across ≥2 cohorts. Documented direction, not a build.* A per-tenant operator that proposes → executes-on-approval → graduates to autonomy per action-type, reports on the owner's channel, is organized as named roles, and acts through allowlisted connected external tools — all on the Epic 9 substrate via the NFR-FC seams.
**FRs covered:** FR62, FR63, FR64, FR65, FR66, FR67, FR68, FR69
**NFRs woven in:** NFR-FC1–FC4 (fully realized)

---

## Epic 1: Foundation & the Generative "Aha" Moment

Stand up the platform and deliver SnapBusy's core value proposition end-to-end: an anonymous visitor describes their business with a guided prompt and, in under 45 seconds, lands in a fully interactive, Ontario-localized, data-populated dashboard — with a plain-language reason on every generated field and a one-tap override — before ever creating an account. This epic establishes the shared-JSONB data model, membership-based RLS isolation, the guarded write layer, the Gemini generation pipeline, the Schema Validator, the CI safety gates, and the i18n + metering seams that every later epic builds on. Stories are ordered as a **walking skeleton**: prove the data pipeline with a hardcoded schema first, then layer the LLM, fallback, dashboard, and explainability on that proven spine.

*(Covers FR1, FR2, FR3, FR4, FR5, FR35, FR44, FR46, FR47. NFRs woven in: NFR-P1, NFR-P2, NFR-S3, NFR-S4, NFR-S5, NFR-S6, NFR-R1, NFR-R3, NFR-SC3, NFR-FC1–FC4. UX: UX-DR1, UX-DR2, UX-DR3, UX-DR13.)*

### Story 1.1: Project Scaffold & Toolchain

As a developer,
I want the SnapBusy repository scaffolded with the mandated stack, dependencies, i18n wiring, and CI safety gates,
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
**And** an "active record" is explicitly defined in the model (the billable unit — non-deleted rows counted per cycle) so metering can be computed without a later migration (metering seam)

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
**Then** they are shown an email field and a **mandatory, unchecked** privacy consent checkbox ("I agree to the SnapBusy Privacy Policy and Terms of Service") (FR36, UX-DR9)

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

*(Covers FR6, FR7, FR8, FR9, FR10, FR11, FR12. NFRs woven in: NFR-P3, NFR-P4, NFR-P5, NFR-A2, NFR-A3, NFR-A4, NFR-FC1. UX: UX-DR5, UX-DR6, UX-DR7, UX-DR8.)*

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

*(Covers FR13, FR14, FR15, FR16, FR17, FR42, FR43, FR45. NFRs woven in: NFR-S4, NFR-S5, NFR-R1. UX: UX-DR4.)*

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

## Epic 7: Billing, Trials & Usage Metering

Monetization on Stripe-hosted surfaces only. A 14-day no-card trial, usage-based subscription (base + metered overage) via Stripe Checkout, self-serve management via Customer Portal, and read-only gating on lapse driven by `subscription_status` as the cached source of truth. Includes the Vercel Cron usage-reporting + reconciliation jobs, the live in-app usage meter, and the optional spend cap. Depends only on Epics 1–3.

*(Covers FR29, FR30, FR31, FR32, FR33, FR53, FR54, FR55. NFRs woven in: NFR-R4, NFR-R5. AR: AR10.)*

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

### Story 7.2: Start a Usage-Based Subscription via Stripe Checkout

As an Admin,
I want to add billing through a secure hosted checkout,
So that my business keeps running after the trial.

**Acceptance Criteria:**

**Given** an Admin
**When** they tap "Add Billing"
**Then** they are redirected to a Stripe Checkout session for a subscription with a flat base price plus a metered usage component (`STRIPE_METERED_PRICE_ID`), with no custom billing UI built (FR30)
**And** the redirect button shows a disabled "Redirecting…" state during the handoff

**Given** a completed checkout
**When** Stripe fires `checkout.session.completed`
**Then** a signature-verified webhook (`stripe.webhooks.constructEvent`) updates `subscription_status` to `active` on the org's Supabase record (FR30)

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
**Then** they are redirected to the Stripe Customer Portal where they can update payment method, view invoice history with usage breakdown, and cancel — all on Stripe-hosted surfaces (FR31)

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

### Story 7.5: Active-Record Usage Metering & Reporting

As the platform,
I want to meter each org's active records per cycle and report them to Stripe accurately,
So that usage-based billing is correct and trustworthy.

**Acceptance Criteria:**

**Given** a scheduled Vercel Cron job (declared in `vercel.json`, hitting a `CRON_SECRET`-protected `/api/cron/*` route)
**When** it runs each cycle
**Then** it computes the active-record count per organization (non-deleted rows, per the billable-unit definition from Story 1.2) and posts it to Stripe as usage against the metered price (FR53, AR10)

**Given** a separate reconciliation Cron job
**When** it runs
**Then** the usage counts reported to Stripe reconcile with the database record count within a 1% tolerance per cycle, and any drift beyond tolerance is flagged (NFR-R5)

**Given** an unauthenticated request to a cron route
**When** it arrives without the valid `CRON_SECRET`
**Then** it is rejected

### Story 7.6: Live Usage Meter & Optional Spend Cap

As an Admin,
I want to see my usage in real time and optionally cap my spend,
So that I never get a surprise bill.

**Acceptance Criteria:**

**Given** an Admin
**When** they view billing/usage
**Then** they see their current active-record usage against the included allotment at any time (the live meter) (FR54)

**Given** an Admin who sets an optional monthly spend cap
**When** usage would exceed the cap
**Then** new-record creation is paused (rather than silently accruing further charges), with a clear translated message, until the next cycle or the cap is raised (FR55)

**Given** an account within its allotment and cap
**When** records are created
**Then** normal creation proceeds with the live meter reflecting current usage

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
I want to install SnapBusy as an app icon on my phone,
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
