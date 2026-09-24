---
stepsCompleted:
  - 1
  - 2
  - 3
  - 4
  - 5
  - 6
  - 7
  - 8
inputDocuments:
  - _bmad-output/planning-artifacts/prd.md
  - _bmad-output/planning-artifacts/ux-design-specification.md
  - docs/research.md
  - docs/stack.md
  - docs/prd.md
  - docs/design.md
workflowType: 'architecture'
project_name: 'SnapBusy'
user_name: 'Boris'
date: '2026-05-17'
lastStep: 8
status: 'complete'
completedAt: '2026-05-17'
revisedAt: '2026-09-23'
revisionHistory:
  - date: '2026-09-19'
    changes: 'Re-aligned to PRD update of 2026-09-19. Added three MVP concerns: usage-based metering (base + metered overage, usage-reporting cron, live meter, hard spend cap, reconciliation), CSV/Excel import with AI column mapping, and schema explainability + override. Regenerated FR/NFR coverage from 45 to 61 FRs. Noted Growth-phase substrate (tenant activity logging, workflow execution engine, suggestion layer, learned patterns, Business Snapshot) and its data-model implications. Confirmed Gemini remains the LLM (PRD OpenAI/Groq mention superseded — boundary is LLM-agnostic via Schema Validator).'
  - date: '2026-09-23c'
    changes: 'Phase 3 (team-of-agents / Hermes) readiness pass (Winston). Fixed an internal inconsistency between NFR-FC1 and NFR-FC3: the guarded mutation layer was described as request/cookie-bound (user JWT via @supabase/ssr cookies), but FC3 requires an out-of-band worker with no cookie to call the same layer. Resolved: mutate.ts now takes IDENTITY as an explicit parameter (a scoped principal/token), never reads request cookies — a human route passes the user identity, a future agent passes its own. Added two cheap MVP micro-seams: (A) principal-agnostic actor model — org_members carries principal_type (human|agent) and auth_org_ids() is principal-agnostic, so a non-human actor can be an org-scoped RLS identity without retrofit; (B) attribution + idempotency — records/activity carry actor_id (+ action_type on actions), a version column for optimistic concurrency, and mutate.ts accepts an idempotency key so a crashed-and-resumed agent loop cannot double-execute. Added a new "Phase 3 — Open Architectural Questions" subsection documenting the genuinely-unsolved pieces (shared crew memory contract incl. pgvector recall; per-tenant external-tool credential vault + PIPEDA egress boundary for MCP; trust-threshold state machine keyed by (org, role, action_type)) and two judgment calls (lean to a managed agent runner over a bespoke persistent droplet; agent spend budgets reuse the assertUnderCap metering shape). Each open question now carries a "Recommended direction (not committed)": (1) shared memory as a projection over the event stream — a versioned/superseded `tenant_facts` store + pgvector recall, roles scope actions not memory, reject role-local memories; (2) OAuth-first per-tenant creds in Supabase Vault, egress-as-allowlist + CASL/PIPEDA consent ledger; (3) autonomy counters derived from the event stream into a thin `action_autonomy` read model, edit/reject resets the counter, action-types classed by reversibility × blast radius. Added a "unifying pattern" note: event stream = one durable source, memory/autonomy/audit are rebuildable projections — one event-sourced architecture, not three subsystems; plus a Phase-3 sequencing recommendation. No MVP feature scope added — these are seams, documented questions, and recommended (uncommitted) directions.'
  - date: '2026-09-23b'
    changes: 'Architectural review (Winston). TWO structural changes made before any code exists (src/ empty, stories still ready-for-dev). (1) FIXED an RLS correctness defect: the prior policy USING (organization_id = auth.uid()) with organization_id populated from the creator UID breaks all multi-user orgs (invited members see zero rows) — team dashboards are MVP (FR20–24, Journeys 2–3). Now organization_id is a real FK to organizations.id and isolation is membership-based via a SECURITY DEFINER auth_org_ids() helper. (2) REPLACED the runtime-physical-DDL-per-tenant data model with a shared JSONB record store: one public.records (organization_id, table_key, data JSONB, soft-delete) table + logical schema in org_schemas metadata. This dissolves the LLM-generates-DDL security surface (Schema Validator now validates a JSON shape, never SQL), eliminates migration engineering (add/rename/hide = metadata; delete = soft-delete — the append-only constraint is now a product choice, not an engineering necessity), makes NFR-FC1 natural (all writes are RLS-scoped row inserts; service role no longer touches tenant data), collapses 4,000 potential tables + policies to one table + one policy (single total isolation guarantee, one Realtime publication), and makes provisioning sub-second (metadata insert, no DDL). Trade-offs accepted: app-layer type/query handling via Zod (already mandated) + JSONB GIN index (+ optional generated columns for hot fields). Also folded in the single-call generation arc optimization (schema + seed rows in one structured Gemini response).'
  - date: '2026-09-23'
    changes: 'Re-aligned to PRD 2026-09-22 edits (Hermes/autonomous-agent thesis + digital-crew/external-tools capture). MVP scope unchanged; changes are about HOW the MVP is built. Added a new "Forward-Compatibility Seams (Phase 3 readiness)" decision subsection implementing NFR-FC1–FC4: a single guarded tenant-mutation layer under a per-actor org-scoped RLS identity (service-role key never writes tenant rows — only DDL/provisioning/platform ops); activity log as authoritative append-only event stream via replayable cursor; documented out-of-band worker seam; action-allowlist generalization of the Schema Validator. Split the Supabase client decision (user-scoped RLS client vs service-role). Added the security forward-note. Traced Phase 3 FR62–69 (autonomous operator, per-type trust threshold, digital-crew roles, connected external tools via MCP) as neither-MVP-nor-Growth. Added the Phase 3 runtime decision (serverless-cron+durable-queue vs managed agent runner vs persistent worker; Hermes-style harness named as candidate, not committed) to Deferred Decisions and Areas for Future Enhancement. Updated FR/NFR coverage.'
---

# Architecture Decision Document — SnapBusy

**Author:** Boris
**Date:** 2026-05-17

---

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

61 FRs across 11 capability areas: App Generation (FR1–5), Data Management (FR6–12),
Conversational Editor (FR13–17), User Access & Permissions (FR18–24), Intake Forms
(FR25–28), Billing & Subscriptions (FR29–33), Localization & Compliance (FR34–40),
Platform & Security (FR41–45), Schema Explainability (FR46–47), Data Import (FR48–52),
Billing — Usage Metering (FR53–55), plus Growth-phase traceability FRs (FR56–61).

Architecturally, these resolve to 14 MVP systems (12 original + Data Import + Usage
Metering; Schema Explainability folds into the Generative pipeline rather than standing
alone):

| # | System | Primary FRs |
|---|---|---|
| 1 | Generative pipeline (Gemini → Schema Validator → Supabase provisioner), now emitting per-field explainability reasons | FR1–FR4, FR46–FR47 |
| 2 | Ontario-localized synthetic data injector | FR3, FR35 |
| 3 | Dynamic UI renderer (schema-driven DataTable + Card views) | FR6–FR11 |
| 4 | Conversational editor (append-only, chat interface) | FR13–FR17 |
| 5 | Auth & session manager (anonymous → magic link → authenticated) | FR18–FR19 |
| 6 | Multi-tenant data layer (shared JSONB `records` store + membership-based RLS; `organization_id` is an org FK) | FR44 |
| 7 | Real-time sync layer (Supabase Realtime subscriptions) | FR12, FR27 |
| 8 | Intake form generator (auto-generated public URL, no-auth submission) | FR25–FR28 |
| 9 | Billing & subscription state machine — now **usage-based metered** (Stripe metered subscription + usage-reporting cron + live meter + hard spend cap + reconciliation) | FR29–FR33, FR53–FR55 |
| 10 | Internationalization layer (EN/FR, client-side, no reload) | FR34–FR35 |
| 11 | PIPEDA compliance layer (consent, export, offboarding cascade) | FR36–FR40 |
| 12 | PWA layer (manifest, service workers, install prompt) | FR41 |
| 13 | **Data Import pipeline** (CSV/Excel parse → AI column mapping → editable preview → non-destructive replace) | FR48–FR52 |
| 14 | **Usage metering & spend-cap enforcement** (active-record counting, cross-cuts the record-create path) | FR53–FR55 |

**Growth-phase systems (out of MVP scope, but the MVP data model must not preclude them):**
tenant activity logging (FR56, append-only per-tenant event log), workflow execution
engine (FR59), workflow suggestion layer (FR57–58), learned patterns per tenant (FR60),
and Business Snapshot export (FR61). Activity logging is the shared substrate — the data
architecture below is designed so it can be added additively without retrofitting tenant
tables.

**Phase 3 systems — Autonomous Operations (FR62–FR69, "the digital employee"):** an
always-on per-tenant operator that proposes and, once a per-action-type trust threshold
is met, autonomously executes real-world operational work (FR62–FR67), organized as
independently-governed digital-crew roles (FR68), acting beyond owned data through
connected external tools via a standard protocol such as MCP (FR69). These are **neither
MVP nor Growth scope** — they are gated on proven week-4 retention and month-over-month
records-under-management growth (see PRD *Project Scoping — Phase 3*). They build entirely
on the Growth substrate (activity log = senses, execution engine = hands, learned patterns
= memory) and add no new data assets. **They are traced here, not built.** Their only claim
on the MVP is a set of cheap-now/expensive-later *seams* (see
§Forward-Compatibility Seams), captured because the PRD's new NFR-FC1–FC4 make them
**MVP build constraints**, not future work — the same "start metered on Day 1" logic that
justified usage pricing early.

**Non-Functional Requirements:**

- **Performance-critical:** Sub-45s TTV (p95), <5s DB provisioning, <2s page load, <300ms EN/FR toggle, <2s real-time sync propagation, optimistic UI (instant render before server confirmation); **CSV/Excel import of ≤5,000 rows <60s with mapping preview <5s (NFR-P7)**
- **Security-critical:** RLS on 100% of tenant tables (automated test gate), Schema Validator blocks all restricted keywords, service role key never in client bundle (CI lint gate), hardened Gemini system prompt on every API call
- **Reliability:** LLM outages must not affect CRUD; 15s Gemini timeout triggers hard fallback schema automatically; Stripe webhook failures must not block dashboard access; **active-record usage reported to Stripe must reconcile with DB counts within 1% per cycle via an automated job (NFR-R5)**
- **Compliance:** PIPEDA — Canadian data residency (ca-central-1), consent timestamp at claim, data portability (CSV/JSON), cascade delete on offboarding (30-day grace)
- **Accessibility:** WCAG AA minimum (AODA obligation), 48×48px touch targets, schema-derived ARIA labels, no placeholder-only form labels
- **Forward-Compatibility (MVP constraints, Phase 3 readiness):** every tenant-data mutation flows through a single guarded action layer under a per-actor, org-scoped RLS identity — the raw service-role key never writes tenant rows (NFR-FC1); the Growth activity log is an authoritative append-only event stream consumable via a replayable cursor, with Realtime/NOTIFY as a wake-up hint only (NFR-FC2); a documented seam exists for a persistent/scheduled worker to read the stream and invoke the action layer out-of-band (NFR-FC3); any future autonomous action is expressible as an action-allowlist entry (Schema Validator generalized) logged before/after execution (NFR-FC4). *Nothing agentic ships in MVP — these constrain how MVP code is written.*

**Scale & Complexity:**

- Primary domain: Full-stack web + PWA + serverless (Next.js + Supabase + Vercel)
- Complexity level: **High**
- Estimated architectural components: 14 MVP systems (+ 5 Growth-phase and Phase-3 Autonomous Operations, traced not built)
- Target scale: 200 concurrent active organizations (MVP ceiling per NFR-SC1)

### Technical Constraints & Dependencies

- **LLM:** Google Gemini (`@google/genai` v2.4.0) — model `gemini-2.0-flash` for speed/cost profile; strict JSON output via `responseMimeType: "application/json"` + `responseSchema`
- **Database:** Supabase PostgreSQL + Auth + RLS + Realtime — ca-central-1 region (PIPEDA)
- **Frontend:** Next.js 16 + shadcn/ui (New York theme) + Tailwind CSS
- **Hosting:** Vercel (serverless functions, edge middleware, auto-scaling)
- **Email:** Resend v6 (magic links, trial/offboarding notifications)
- **Billing:** Stripe v22 server + v9 client (Checkout + Customer Portal + webhooks)
- **Monitoring:** Sentry v10 (`@sentry/nextjs`)
- **Conversational Editor:** Append-only at MVP — add table, add column, generate view only
- **Schema Validator:** Hard blocking dependency before Conversational Editor can ship
- **RLS isolation test:** Hard blocking gate before any tenant table is exposed to the frontend
- **Spreadsheet parsing:** `papaparse` (CSV) + `xlsx`/SheetJS (Excel) for the Data Import pipeline — parse server-side, never trust client-parsed rows
- **Scheduled jobs:** Vercel Cron for periodic usage reporting to Stripe and the usage-reconciliation job (NFR-R5)
- **LLM provider (confirmed):** Google Gemini remains the choice. The PRD Integration List names OpenAI GPT-4o-mini / Groq, but the architecture is LLM-agnostic at the Schema Validator boundary; the Gemini decision stands and the PRD's provider mention is treated as superseded here

### Cross-Cutting Concerns Identified

1. **Auth & tenant context** — anonymous session (pre-claim) via localStorage vs authenticated session (post-claim) via Supabase JWT; `organization_id` propagated through every API route and RLS policy
2. **Schema mutation pipeline** — synchronous Gemini → Validator → Supabase chain; retry once on failure; hard fallback at second failure or 15s timeout; non-destructive (rows preserved on schema update)
3. **Real-time subscriptions** — Supabase Realtime channel per organization; TanStack Query cache updated on events; subscription lifecycle tied to org context
4. **Internationalization** — EN/FR client-side with pre-loaded bundles via next-intl; language detected at prompt submission for synthetic data generation; toggle stored in `localStorage`
5. **LLM resilience** — silent retry once on Gemini failure; Universal Field Service Template (hardcoded fallback) on second failure or 15s timeout; CRUD operations never depend on LLM
6. **Security boundary** — service role key in server-only files; CI lint rule fails build if key detected in client bundle; Schema Validator runs synchronously in API route; RLS verified by automated cross-tenant test
7. **Subscription state machine** — trial → active → read-only → grace → deleted; `subscription_status` in Supabase user record is source of truth (Stripe status cached, not authoritative). Now **usage-metered:** a periodic cron counts active records per org per cycle and reports them to Stripe's metered price; a live in-app meter reflects the same count
8. **PWA lifecycle** — manifest + service workers generated at claim; install prompt deferred until post-aha intent signal; field worker surface always dark (bypasses theme token)
9. **Usage metering & spend cap** — active-record count (jobs + invoices + customers per cycle) is the billable unit; the count is surfaced live and reported to Stripe on a cron. An admin-set **hard spend cap** gates the record-create path: when the cap is reached, INSERTs into tenant tables are paused (server-enforced in the create API path, not just UI) — this cross-cuts every table's add-record flow
10. **Data import** — CSV/Excel parsed server-side → Gemini-proposed column→field mapping → user-editable preview (ambiguous columns flagged, nothing written pre-confirm) → non-destructive replacement of synthetic rows with imported rows on confirm; reuses the generation pipeline's "understand messy input, map to structure" capability
11. **Explainability propagation** — the generation call emits a plain-language `reason` alongside every proposed table/field; reasons flow through `SchemaDefinition` to the UI at generation time, with one-click override (removal reuses the append-only hide mechanism — no destructive migration)
12. **Activity-logging readiness (Growth)** — no MVP code, but tenant tables and the metering counter are designed so an append-only per-tenant event log (FR56) can be added additively as the substrate for workflow suggestions, learned patterns, and Business Snapshot
13. **Guarded tenant-mutation layer (MVP constraint, Phase 3 seam)** — all tenant-data writes (record CRUD, import commit) flow through one shared mutation path that runs under an org-scoped, RLS-enforced identity **passed as an explicit parameter (never read from request cookies, so an out-of-band worker can call the identical path — FC3), carrying `actor_id` + an optional idempotency key** so a retried agent loop cannot double-execute; the service-role key is reserved for narrow platform-bootstrap operations (anonymous pre-claim generation, claim-time org bootstrap, cross-org cron, offboarding cascade — never runtime DDL) and **never** writes tenant rows on an authenticated user's behalf. This is the single point a future autonomous actor (Phase 3) plugs into — as another org-scoped identity subject to the same RLS and action allowlist, not a service-role backdoor (NFR-FC1, NFR-FC4)

---

## Starter Template Evaluation

### Primary Technology Domain

Full-stack web application with PWA requirements, serverless API routes, and real-time data features — maps directly to **Next.js App Router** as the monorepo foundation.

### Starter Options Considered

| Option | Verdict | Reason |
|---|---|---|
| `create-next-app@latest` (official) | ✅ **Selected** | Canonical, always current, configurable, zero assumptions beyond framework |
| T3 Stack (`create-t3-app`) | ❌ Rejected | Includes tRPC + Prisma — both wrong for dynamic schemas; tRPC adds unnecessary complexity |
| Supabase Next.js starter | ❌ Rejected | Opinionated auth scaffolding conflicts with our custom deferred-auth flow |
| Custom from scratch | ❌ Rejected | No benefit over `create-next-app`; wastes implementation budget |

### Selected Starter: `create-next-app@latest`

**Rationale:** Official starter, always ships current stable Next.js, configures TypeScript + Tailwind + ESLint + App Router in one command with no conflicting opinions. All additional libraries (Supabase, shadcn/ui, Gemini, etc.) are added as explicit dependencies with documented versions — no hidden assumptions.

**Initialization Command:**

```bash
npx create-next-app@latest snapbusy \
  --typescript \
  --tailwind \
  --eslint \
  --app \
  --src-dir \
  --import-alias "@/*" \
  --no-turbopack
```

> **Note:** `--no-turbopack` ensures stable builds on Vercel until Turbopack reaches full production parity.

**Architectural Decisions Provided by Starter:**

| Area | Decision |
|---|---|
| **Language** | TypeScript (strict mode enabled) |
| **Styling** | Tailwind CSS v4 via PostCSS |
| **Routing** | Next.js App Router (file-based, `src/app/`) |
| **Source layout** | `src/` directory (separates source from config) |
| **Import alias** | `@/*` maps to `src/*` |
| **Linting** | ESLint with Next.js recommended config |
| **Build tooling** | Next.js native (Webpack under the hood, `--no-turbopack`) |
| **Dev server** | `next dev` with Fast Refresh |

**Post-init additions (first implementation story):**

```bash
# shadcn/ui
npx shadcn@latest init --style new-york --base-color zinc --css-variables

# Core dependencies
npm install @supabase/supabase-js@2.105.4 \
  @supabase/ssr@0.10.3 \
  @google/genai@2.4.0 \
  stripe@22.1.1 \
  @stripe/stripe-js@9.5.0 \
  resend@6.12.3 \
  next-intl@4.12.0 \
  framer-motion@12.38.0 \
  react-hook-form@7.76.0 \
  zod@4.4.3 \
  @hookform/resolvers@5.2.2 \
  react-swipeable@7.0.2 \
  @tanstack/react-query@5.100.10 \
  @tanstack/react-query-devtools@5.100.10

# Data import (CSV/Excel parsing — server-side)
npm install papaparse@5.4.1 xlsx@0.18.5
npm install -D @types/papaparse@5.3.14

# Sentry
npm install @sentry/nextjs@10.53.1
npx @sentry/wizard@latest -i nextjs
```

> **Scheduled jobs:** Usage reporting to Stripe and the usage-reconciliation job (NFR-R5)
> run on **Vercel Cron** (declared in `vercel.json`) — no extra dependency; Cron invokes
> a protected API route on a schedule. No new runtime library is required beyond the
> Stripe SDK already listed.

---

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- **Tenant data model: shared JSONB `records` store (logical schemas in metadata), NOT runtime physical DDL per tenant** — the decision the rest of the data layer hinges on (see §Data Architecture)
- LLM provider and JSON output strategy (Gemini + strict JSON schema)
- Multi-tenant isolation mechanism (RLS on `records`, **membership-based** via `auth_org_ids()`; `organization_id` is an org FK, never a user UID)
- Schema Validator as synchronous **metadata-shape** gate (no SQL is generated)
- Service role key narrowed to platform-bootstrap ops (server-only, CI lint gate)
- Anonymous session strategy (localStorage pre-claim + `anonymous_sessions`, re-keyed to org on claim)

**Important Decisions (Shape Architecture):**
- No ORM — Supabase JS client directly (dynamic schemas make Prisma impractical)
- TanStack Query for server state (no Redux/Zustand)
- next-intl for i18n (client-side bundle swap, no page reload)
- Append-only Conversational Editor at MVP
- Stripe-hosted surfaces only, but now with a **metered usage component** (base + overage)
- Usage metering: active-record count via a Vercel Cron reporting job; hard spend cap enforced server-side in the record-create path
- Data Import: reuse the generation pipeline (Gemini) for column→field mapping; parse spreadsheets server-side; non-destructive synthetic→real replacement
- Schema explainability: `reason` emitted per table/field by the same generation call (no separate model round-trip)

**Deferred Decisions (Post-MVP):**
- Custom RBAC beyond Admin/Member
- Full schema mutation in the editor (delete, rename, restructure) — kept append-only in MVP as a **product** choice per PRD, but now cheap: under the record store these are metadata edits (rename = label; delete = soft-delete/hide), not a migration pipeline
- GraphQL API layer
- Offline PWA support (service worker caching strategy)
- Multi-region Supabase (growth phase)
- **Phase 3 operator runtime** — the always-on compute for the autonomous operator: (a) serverless-cron + durable-queue, (b) a managed agent runner (e.g. Inngest, Trigger.dev), or (c) a persistent worker/droplet. A **Hermes-style harness** (persistent memory, loop engineering, model-agnostic tool use) is the reference pattern — *named, not committed*, and separable from the deployment (it runs on top of any of the three). **Current lean: (b) a managed agent runner**, as the boring/low-ops fit for a solo founder (see §Phase 3 — Open Architectural Questions). Decided only when the Phase 3 entry gate is met; the MVP seams (§Forward-Compatibility) keep every option open
- **Connected external tools (Phase 3)** — standard tool-connection protocol (e.g. MCP) for email/search/messaging; each tool a distinct allowlisted, approval-gated action class with its own trust threshold and (for paid tools) a spend cap + Admin opt-in
- **Digital-crew role model (Phase 3)** — presenting the operator as independently-governed named roles (bookkeeping / sales / operations) over one shared per-tenant memory

---

### Data Architecture

| Decision | Choice | Version | Rationale |
|---|---|---|---|
| Database | Supabase PostgreSQL | 2.105.4 (JS client) | RLS, Realtime, Auth — all in one; ca-central-1 for PIPEDA. **No runtime DDL** — the schema is fixed platform schema; tenant "tables" are logical (see below) |
| **Tenant data model** | **Shared JSONB record store** — one `public.records` table for ALL tenant rows | — | **Chosen over runtime physical DDL per tenant.** A generated "table" is *logical* (a `table_key` + a metadata definition), not a physical Postgres table. This dissolves the LLM-generates-DDL security surface, eliminates migration engineering, makes NFR-FC1 natural, and collapses ~4,000 potential tables+policies to one table + one policy. Trade-offs (native types/constraints/indexes) handled in the app layer (Zod, already mandated) + JSONB GIN index. See rationale block below |
| Query layer | Supabase JS client (direct) on `records` | 2.105.4 | Reads/writes target `records` filtered by `organization_id` + `table_key`; filter/sort (FR10) via JSONB operators. No ORM — dynamic logical schemas make Prisma/Drizzle impractical |
| Tenant record storage | `public.records (id UUID, organization_id UUID NOT NULL, table_key TEXT NOT NULL, data JSONB NOT NULL, actor_id UUID, version INT NOT NULL DEFAULT 1, created_at, updated_at, deleted_at)` | — | Every tenant row across every logical table. `table_key` is the normalized logical-table name; `data` holds the row per the field definitions in `org_schemas`. Soft-delete via `deleted_at` (non-destructive by default). `actor_id` records who last wrote the row (human today, agent role in Phase 3 — attribution seam B); `version` gives optimistic concurrency so a human edit and an agent write don't silently clobber. GIN index on `data`; btree on `(organization_id, table_key)` |
| Schema metadata storage | `public.org_schemas (organization_id, definition JSONB)` | — | The **authoritative logical schema**: tables, fields, types, `reason` per table/field (FR46), `sensitive` flag (FR40), and `hidden` flag (FR11/append-only hide). The UI renders from this; a field add/rename/hide is a metadata edit — **no migration** |
| Usage metering storage | `public.org_usage` table (org_id, cycle_start, active_record_count, reported_at, stripe_usage_record_id) | — | Per-org, per-cycle active-record count; source for the live meter and the Stripe usage report; reconciled against live DB counts within 1% (NFR-R5) |
| Spend-cap storage | `public.org_billing_settings` (org_id, monthly_spend_cap, cap_reached_at) | — | Admin-set optional hard cap (FR55); read on the record-create path to pause INSERTs when reached |
| Activity log (Growth-ready) | `public.org_activity_log` (incl. `actor_id`, `action_type`, before/after diff) — **not built at MVP** | — | Append-only per-tenant event log (FR56). `actor_id` + `action_type` are the dimensions the Phase-3 trust threshold (FR65: "N clean approvals of *that action-type*") and per-role autonomy (FR66/FR68) are accounted against — carried in the schema shape now so they aren't retrofitted. **NFR-FC2:** when built, it is the *authoritative* event stream — a monotonic per-org sequence (e.g. `seq BIGSERIAL` / append-only insert-only table) consumable via a **replayable cursor**, so an out-of-band worker can resume from a last-seen position. Supabase Realtime / Postgres `NOTIFY` is a wake-up optimization only, never the system of record. Documented now so tenant tables and metering are designed to feed it additively without retrofit |
| Data validation | Zod | 4.4.3 | TypeScript-first, composable, used at all API boundaries and form resolvers |
| Client-side cache | TanStack Query | 5.100.10 | Server state management, optimistic updates, background refetch, Supabase Realtime cache sync |
| Caching layer | None at MVP | — | Supabase connection pooling sufficient at 200 org scale; Redis deferred to Growth |
| Migrations | Supabase CLI (platform schema) only — **no runtime DDL** | — | The entire schema (`organizations`, `org_members`, `org_schemas`, `records`, `org_usage`, `org_billing_settings`, `anonymous_sessions`, and Growth's `org_activity_log`) is fixed platform schema created by Supabase CLI migrations. Provisioning a tenant "app" = inserting an `org_schemas` metadata row + seeding `records` — never DDL |
| Query indexing | GIN on `records.data` + btree `(organization_id, table_key)`; optional Postgres **generated columns** for hot filter/sort fields | — | JSONB filter/sort (FR10) at 50K rows/org is comfortable on a GIN index; promote a hot field (status, date) to a generated column only if a query pattern demands it (Rule of Three) |

**Tenant Data Isolation (non-negotiable) — membership-based, single policy:**

`organization_id` is a real organization identity (FK to `organizations.id`), **never a user
UID**. Isolation is by *membership*, so invited members (FR20–24, Journeys 2–3) correctly
see their org's rows. RLS lives on the static `records` table — created **once** in a
platform migration, not at runtime:

```sql
-- Membership resolver — SECURITY DEFINER so it isn't re-evaluated per row as a correlated subquery
CREATE FUNCTION auth_org_ids() RETURNS SETOF uuid
  LANGUAGE sql SECURITY DEFINER STABLE AS $$
    SELECT organization_id FROM org_members WHERE user_id = auth.uid()
$$;

ALTER TABLE records ENABLE ROW LEVEL SECURITY;
CREATE POLICY "records_tenant_isolation" ON records
  USING      (organization_id IN (SELECT auth_org_ids()))   -- read
  WITH CHECK (organization_id IN (SELECT auth_org_ids()));   -- write
```

**Actor model is principal-agnostic (Phase-3 seam A).** `org_members` carries a
`principal_type` (`human | agent`), and `auth_org_ids()` resolves membership for *whatever*
principal `auth.uid()` denotes — a human's magic-link identity today, a scoped agent identity
in Phase 3. A future autonomous actor is therefore *another org-scoped member row subject to
the same RLS*, minted a scoped token, never a service-role backdoor. Costs nothing to admit
the column now; expensive to retrofit an identity model after RLS is written.

> **Why this is stronger than the prior per-table model:** one table, one policy, one
> total isolation guarantee — there is no "did we remember to enable RLS / add the table to
> the Realtime publication on this runtime-created table?" failure mode. The membership
> resolver can later be replaced by an `org_ids` JWT claim for zero per-query cost without
> changing the policy shape.

**Anonymous (pre-claim) rows** are keyed by `session_id` in `anonymous_sessions` (24h TTL);
on claim they are re-keyed to the new `organization_id` and copied into `records`. No tenant
rows ever exist without a resolvable owning identity.

The automated cross-tenant isolation test MUST cover **both a single-user org and a
multi-user org** (User B is a *member* of Org A and must see its rows; User C is a stranger
and must see none) — it is a blocking CI gate before any tenant data is exposed to the
frontend.

**Decision rationale — JSONB record store vs runtime physical DDL:**

The generative engine turns a prompt into a *logical* schema (metadata) and *rows*, not
into `CREATE TABLE` statements. This is a deliberate reversal of the earlier design, made
while no code exists. What it buys:

| Concern | Runtime physical DDL (rejected) | JSONB record store (chosen) |
|---|---|---|
| LLM → database attack surface | LLM output becomes **DDL** — Schema Validator must prevent SQL injection into live `CREATE`/`ALTER` | LLM output becomes a **JSON metadata shape** — Validator checks structure only; **no SQL is ever generated** |
| Schema change (add/rename/hide/delete) | Migration engineering; destructive ops risky → forced **append-only** editor | Metadata edit; delete = soft-delete (`deleted_at`). Append-only becomes a *product* choice, not an engineering limit |
| NFR-FC1 (no service role on tenant writes) | In tension — DDL needs the service role | Natural — every write is an RLS-scoped row insert; service role never touches tenant data |
| Scale footprint | ≤20 tables × 200 orgs ≈ 4,000 tables + 4,000 policies + per-table Realtime publication management | 1 table, 1 policy, 1 publication |
| Provisioning latency (NFR-P2 <5s) | DDL + RLS per table on the hot path | Metadata insert + bulk `records` insert — sub-second |

**Trade-offs accepted (honestly):** we forgo native column types, FK constraints, and
per-column indexes. Types/required-ness are enforced in the app layer with **Zod** (already
mandated at every boundary); `'relation'`/FK is already out of MVP scope so that loss is
near-zero today; filter/sort uses JSONB operators over a GIN index, with a **generated
column** escape hatch for any field that later proves hot. This is the Airtable/Notion/Retool
data model — boring, proven, and a better fit for *user-defined* schemas than physical DDL.
If a concrete need for SQL-native per-tenant analytics appears later, a specific logical
table can be **projected** into a materialized typed view without changing the write path.

---

### Authentication & Security

| Decision | Choice | Rationale |
|---|---|---|
| Auth provider | Supabase Auth (magic links) | Passwordless, included in Supabase free tier, PKCE flow for security |
| Pre-claim session | `localStorage` + `sessionStorage` for generation state | Anonymous users get a temporary session ID; schema + synthetic data stored in Supabase under `anonymous_sessions` table with 24h TTL |
| Post-claim session | Supabase JWT session (cookie-based via `@supabase/ssr`) | Server-side session refresh via Next.js middleware |
| RBAC | Two hardcoded roles: `admin` \| `member` on Supabase Auth user metadata | PRD requirement; custom RBAC deferred post-MVP |
| Role storage | `{ role: "admin" | "member" }` in `auth.users.user_metadata` | Set at invite time; account creator always `admin` |
| Server-side role check | Every schema-mutation API route reads role from JWT; rejects `member` requests | Frontend role hiding is NOT sufficient — API must independently verify |
| **Tenant-data writes** | User-scoped server client (anon key + user JWT via `@supabase/ssr` cookies) — **RLS-enforced** | **NFR-FC1:** all tenant row CRUD (record add/edit/delete, import commit, authenticated intake) runs under the acting user's org-scoped identity against `records`, subject to RLS. This is the guarded mutation layer; see §Forward-Compatibility Seams |
| **Service role key** | `SUPABASE_SERVICE_ROLE_KEY` — **narrow platform-bootstrap ops ONLY**: anonymous pre-claim generation (no user identity yet), the claim-time bootstrap (create org + first `org_members` row + copy anonymous rows into `records`), cross-org cron (usage report/reconcile), offboarding hard-delete cascade, public intake insert (no session). **There is no runtime DDL** — platform schema is CLI-migrated, so the service role never runs `CREATE`/`ALTER TABLE`. | **Never** writes tenant rows on an *authenticated* user's behalf (that path is RLS-scoped, above), and never imported in any `src/app/` component or client-side hook. Narrowing it to bootstrap/platform ops is what lets a future autonomous actor be *another RLS-scoped identity*, not a service-role backdoor (NFR-FC1) |
| CI lint gate | Custom ESLint rule: fail build if `SUPABASE_SERVICE_ROLE_KEY` appears in client bundle | Enforced via `eslint-plugin-no-secrets` or custom rule in `.eslintrc.json` |
| LLM system prompt | Hardened identity-masking prompt on every Gemini call (see `src/lib/gemini/prompts.ts`) | NFR-S5 |
| Schema Validator | Synchronous API route gate (`src/lib/schema/validator.ts`) — validates every LLM-proposed **schema-metadata operation** before it is persisted to `org_schemas` | FR42–FR45, blocking ship gate. Its job is now **structural**: no SQL is ever generated, so this is shape/allowlist validation, not SQL-injection defense — a categorically smaller surface |
| Transport security | TLS 1.2+ enforced by Vercel + Supabase (infrastructure level) | NFR-S1 |
| Data at rest | AES-256 via Supabase/AWS infrastructure | NFR-S2 |
| Sentry logging | All Schema Validator rejections logged with `organization_id` + raw LLM output | FR45 |

> **Auth email branding:** Supabase Auth is configured with **Resend as custom SMTP** so magic-link emails are sent from the `snapbusy.ca` domain (branded sender) rather than Supabase's shared SMTP. Supabase still generates and verifies the token — Resend only delivers the email. No additional cost (Resend is already in the stack).

**Schema Validator — Allowlist & Blocklist:**

```typescript
// src/lib/schema/validator.ts
// Validates schema-METADATA operations (never DDL — no SQL is generated in this architecture).
const PERMITTED_OPERATIONS = ['add_table', 'add_field', 'add_view'] as const; // MVP append-only set
const RESERVED_KEYS = ['id', 'organization_id', 'table_key', 'data', 'created_at', 'updated_at', 'deleted_at'];
const BLOCKED_KEYWORDS = ['DROP', 'GRANT', 'TRUNCATE', 'DELETE', 'EXEC', '--', ';', '/*']; // defense-in-depth on names

// Reject: operations outside PERMITTED_OPERATIONS
// Reject: table_key / field names that collide with RESERVED_KEYS (would shadow record columns)
// Reject: any name containing a blocked keyword (belt-and-suspenders — no DDL path exists to exploit)
// Normalize: every table_key / field name via normalizeTableName() before persisting to org_schemas
// Return: { valid: boolean, error?: string, sanitized?: SchemaOperation }
```

**Hardened Gemini System Prompt (constant — never overridable by user input):**

```
You are a database structure assistant for Ontario small businesses.
You may ONLY describe the structure of database tables (column names and data types).
You are NOT permitted to view, modify, or delete user data.
You are NOT permitted to generate SQL under any circumstances.
You MUST output only valid JSON conforming to the provided schema definition format.
Any request outside these boundaries must be refused with the message:
"I can only help with database structure. Please describe what columns or tables you'd like to add."
```

**Forward note — the fence generalizes from schema-actions to real-world actions.**
The four layers above (system prompt → Schema Validator → RLS → Sentry) guard *schema*
actions: the only thing the MVP's AI can do is propose structure. A future autonomous
operator (Phase 3) will propose *real-world* actions — send an email, change an invoice
status, order parts. The same fence generalizes and is why the MVP seams below exist: an
**action allowlist** plays the role the Schema Validator plays today (NFR-FC4); every
agent action runs under a per-actor, org-scoped identity subject to RLS — never the raw
service-role key (NFR-FC1); and every action is written to the tenant activity log before
and after execution. No autonomous action is designed to reach a customer, a dollar, or
the database except through this fence. Recorded now so the MVP does not foreclose it;
built later.

---

### API & Communication Patterns

| Decision | Choice | Rationale |
|---|---|---|
| API style | REST via Next.js Route Handlers (`src/app/api/`) | Sufficient for this use case; GraphQL adds complexity with no benefit at MVP scale |
| Response envelope | `{ data: T \| null, error: string \| null }` | Consistent, typed, allows frontend to always check error before consuming data |
| HTTP status codes | Standard: 200/201 success, 400 bad request, 401 unauthorized, 403 forbidden, 422 validation error, 500 server error | No custom codes |
| Error class | `AppError extends Error { statusCode: number; userMessage: string }` | Separates technical error from user-facing message |
| Rate limiting | Vercel Edge Middleware (IP-based, 30 req/min for generation endpoints) | Simple, zero infrastructure; Redis-backed rate limiting deferred to Growth |
| Real-time | Supabase Realtime subscriptions (Postgres Changes) | Built into Supabase, no additional infrastructure; channels scoped per `organization_id` |
| Webhook verification | Stripe webhook signature verification (`stripe.webhooks.constructEvent`) | Required to prevent spoofed webhook events |
| LLM timeout | 15s `AbortController` on every Gemini call | NFR-R3; hard fallback triggered at 15s |

**Standard API Response Type:**

```typescript
// src/types/api.ts
export type ApiResponse<T> = {
  data: T | null;
  error: string | null;
};
```

---

### Frontend Architecture

| Decision | Choice | Version | Rationale |
|---|---|---|---|
| Component library | shadcn/ui (New York theme) | latest | PRD mandate; copy-paste ownership; Radix UI a11y primitives |
| State management | TanStack Query (server state) + React Context (auth/tenant/i18n) | 5.100.10 | No Redux/Zustand; TanStack Query handles 90% of state; Context for stable global state |
| i18n | next-intl | 4.12.0 | Client-side bundle swap, no page reload, supports dynamic message loading |
| Form handling | React Hook Form + Zod resolver | 7.76.0 / 4.4.3 | Uncontrolled forms for performance, Zod for schema-derived validation |
| Animation | Framer Motion | 12.38.0 | Generation arc skeleton, bottom sheet transitions, swipe card physics |
| Swipe gestures | react-swipeable | 7.0.2 | Field worker swipe-to-complete; no native touch API wrangling |
| Routing | Next.js App Router (file-based) | 16.2.6 | Layouts, Server Components, streaming — all required |
| Rendering strategy | Server Components for static/layout; Client Components for interactive | — | Minimize client bundle; dashboard data tables are Client Components for real-time |
| Theme system | CSS custom properties on `[data-theme]` at `<html>` root | — | Tailwind `darkMode: 'class'`; field worker surface hardcoded dark |
| PWA | `next-pwa` or manual `public/manifest.json` + `public/sw.js` | — | Auto-generated manifest at claim; service worker for home screen icon |

**Optimistic Updates Pattern (mandatory for all CRUD):**

```typescript
// All mutations use TanStack Query optimistic pattern
const mutation = useMutation({
  mutationFn: updateRecord,
  onMutate: async (newData) => {
    await queryClient.cancelQueries({ queryKey: ['records', tableId] });
    const previous = queryClient.getQueryData(['records', tableId]);
    queryClient.setQueryData(['records', tableId], (old) => optimisticUpdate(old, newData));
    return { previous };
  },
  onError: (err, newData, context) => {
    queryClient.setQueryData(['records', tableId], context?.previous);
  },
  onSettled: () => queryClient.invalidateQueries({ queryKey: ['records', tableId] }),
});
```

**Generation Arc State Machine:**

```typescript
// src/hooks/useGenerationState.ts
type GenerationPhase =
  | 'idle'
  | 'generating'    // ONE structured Gemini call → { schema, seedRows } (~4–6s, single failure point)
  | 'persisting'    // Insert org_schemas metadata + bulk-insert seed rows into records (sub-second — NO DDL)
  | 'revealing'     // Progressive UI reveal (~5s)
  | 'ready'         // Dashboard interactive
  | 'failed';       // Hard fallback deployed

// OPTIMIZATION (2026-09-23): schema + seed data are produced by a SINGLE Gemini call with a
// responseSchema carrying both as separable fields — one round trip, one 15s timeout, one
// failure point (was two sequential calls). A malformed seedRows section does not invalidate a
// valid schema: persist the schema, skip bad rows, proceed. 'persisting' replaces the old
// 'provisioning' + 'injecting' phases because there is no DDL and data write is a bulk insert.
```

---

### Data Import Architecture (MVP — Tier 1)

Import is the **primary activation event** (PRD Success Criteria + Journey 6), not a
secondary feature. The pipeline deliberately reuses the generative capability: mapping
messy spreadsheet columns to a target schema is the same "understand unstructured input,
propose structure" problem as generation, pointed at a different input.

| Decision | Choice | Rationale |
|---|---|---|
| File parsing | `papaparse` (CSV) + `xlsx`/SheetJS (Excel), **server-side only** | Never trust client-parsed rows; a malformed/oversized file must be bounded server-side (NFR-P7: ≤5,000 rows < 60s) |
| Upload transport | Multipart to `POST /api/import/analyze` (parse + propose mapping), then `POST /api/import/commit` (write) | Two-phase: nothing is written until the user confirms the mapping (FR49, FR52) |
| Column mapping | Gemini via `callGeminiWithTimeout()` — proposes `column → {table, field}` against the org's existing `org_schemas` definition | Reuses the generation pipeline; mapping output is itself validated (structure only, no DDL) |
| Ambiguity handling | Columns below a confidence threshold are returned as `unmapped` and **must be resolved by the user** before commit (FR51) | Explainability principle — show the work, never silently guess |
| Preview UI | Editable mapping table rendered before any write; user can override every proposed match (FR50) | Same "show your work" trust surface as schema generation |
| Write strategy | On confirm (via `lib/data/mutate.ts`): soft-delete synthetic `records` for the affected `table_key`s, then bulk-insert mapped rows in one transaction (FR52) | Non-destructive to real data; synthetic data is the only thing replaced; all under the user's RLS identity |
| Row count gate | Import counts toward active-record usage and is checked against the spend cap at commit | Keeps metering accurate; an import that would exceed a hard cap warns before committing |

**Import flow:** `upload → parse (server) → Gemini column mapping → editable preview
(ambiguous flagged) → user confirms → clear synthetic + bulk insert → invalidate
TanStack Query cache`. No raw file content or unmapped guesses ever reach the tenant
tables.

---

### Usage-Based Metering Architecture (MVP)

Pricing meters the **active record managed** (jobs + invoices + customers tracked per
cycle), not seats (Product Principle 4). This replaces the earlier flat-fee model and is
a Day-1 requirement — retrofitting metering onto customers sitting on legacy flat plans
is far harder than starting metered.

| Decision | Choice | Rationale |
|---|---|---|
| Billable unit | Active-record count per org per cycle | PRD Pricing & Metering; the single number that proxies both value and revenue |
| Stripe model | Metered subscription: flat base price **+** metered usage price | Stripe-hosted Checkout/Portal still; the metered price is reported via usage records |
| Usage reporting | Vercel Cron → `POST /api/cron/report-usage` (protected by a cron secret) computes each org's active-record count and posts a Stripe usage record | Scheduled, idempotent per cycle; writes `org_usage.stripe_usage_record_id` |
| Live meter | `useUsage()` reads `org_usage` (current cycle) + live DB count; surfaced in Settings and as a header indicator | FR54 — admin sees usage vs. allotment at all times; no surprise bills |
| Hard spend cap | `org_billing_settings.monthly_spend_cap`; checked in the record-create API path — when reached, INSERT is refused with a plain-language message and `cap_reached_at` is set | FR55 — pause new-record creation instead of accruing charges; **server-enforced**, not UI-only |
| Reconciliation | A second cron job compares reported usage to live DB counts; discrepancy > 1% logs to Sentry and blocks the next report until resolved | NFR-R5 — billing accuracy is a trust requirement under usage pricing |
| Source of truth | `subscription_status` on the Supabase user record stays authoritative for access state; Stripe status remains cached | Unchanged from prior decision (NFR-R4) |

**Cross-cutting note:** the spend-cap check is the one place metering reaches into every
table's create flow. It lives in a single shared guard (`assertUnderCap(orgId)`) called
at the top of any record-insert route, so no table's add path can bypass it.

---

### Schema Explainability & Override (MVP)

Every AI-generated table and field carries a one-line, plain-language reason surfaced at
generation time (FR46), with a one-click remove/rename (FR47). This is the
Explainable-by-Default principle applied to the first-impression moment where trust is
won or lost.

| Decision | Choice | Rationale |
|---|---|---|
| Reason source | The same generation call emits `reason` per table/field — no separate model round-trip | Keeps TTV within the <45s budget; one call, richer output |
| Storage | `reason` is a field on each table/column in the `org_schemas` JSON definition | Renders directly from schema metadata; survives reloads |
| Surface | Info icon + tooltip next to generated columns (see `RecordForm`/`DataTable` header); shown at generation, not buried in settings | PRD explicitly requires it at the first-impression moment |
| Override — remove | Reuses the append-only **hide** mechanism (frontend visibility flag; no destructive migration) | Consistent with the Conversational Editor append-only constraint |
| Override — rename | Edits the `label` on the field's `org_schemas` metadata — the JSONB `key` in `records.data` is unchanged, so **no migration and no data movement** | Rename is now trivially non-destructive; the physical-column-rename problem no longer exists under the record store |

---

### Forward-Compatibility Seams (Phase 3 readiness)

The PRD's autonomous operator ("digital employee," FR62–FR69) is **Phase 3 — neither MVP
nor Growth** — and nothing agentic is built here. But four new NFRs (NFR-FC1–FC4) are
explicit **MVP build constraints**: they govern *how* MVP code is written so the operator
can be added later without re-architecture or tearing a hole in the security fence. These
are the cheap-now/expensive-later seams — the same reasoning that put usage metering on
Day 1. Each is a limit on MVP code, **not** MVP feature work.

| Seam | MVP requirement | Why it must be an MVP constraint |
|---|---|---|
| **Guarded mutation layer** (NFR-FC1) | Every tenant-data write — record CRUD, import commit — goes through one shared path (`src/lib/data/mutate.ts`) under an **org-scoped, RLS-enforced** identity. **Critically, `mutate.ts` receives identity as an explicit parameter — it never reads request cookies** — so an out-of-band worker (no cookie) can call the identical layer (this is what makes FC3 actually usable, not just aspirational). It also carries `actorId`, an optional `idempotencyKey`, and `expectedVersion`. No code path writes tenant rows with the raw service-role key; service role is reserved for narrow platform-bootstrap ops (anonymous pre-claim generation, claim-time org bootstrap, cross-org cron, offboarding cascade). No runtime DDL. | Retrofitting "route all writes through one guarded, identity-scoped layer" after CRUD is scattered across routes is a large, error-prone refactor — and a cookie-bound layer would have to be rewritten the day a worker needs it. A Phase 3 agent becomes *another* org-scoped identity through the same layer — auditable and RLS-bound — not a service-role backdoor. |
| **Authoritative event stream** (NFR-FC2) | The Growth activity log (`org_activity_log`), when built, is a monotonic, append-only, per-org sequence read via a **replayable cursor**. Realtime/`NOTIFY` is a wake-up hint only, never the system of record. | An operator resumes work from a durable position across restarts; an ephemeral pub/sub channel cannot be replayed and would drop events on any worker downtime. |
| **Out-of-band compute seam** (NFR-FC3) | MVP must not assume request-scoped compute is the only compute. A documented seam lets a persistent or scheduled worker read the event stream and invoke the guarded mutation layer out-of-band. MVP already exercises this shape with **Vercel Cron** (usage report + reconcile) hitting `CRON_SECRET`-protected routes that call shared `lib/` logic — the same logic a future worker calls. | The operator needs always-on compute; if MVP business logic is welded to the HTTP request lifecycle, none of it is reusable out-of-band. Keeping logic in `lib/` (callable by a route *or* a worker) is the seam. |
| **Action allowlist generalization** (NFR-FC4) | The Schema Validator's allowlist model (permitted-operations + blocklist + Sentry audit) is the reference pattern for a future **action allowlist**: any autonomous real-world action must be an allowlisted, validated entry, recorded to the activity log before and after execution. | The security fence is already an allowlist over *schema* ops; generalizing the same shape to *real-world* ops (send email, update status, order parts) means the fence extends rather than being rebuilt when the AI graduates from proposing structure to taking action. |

**What this does NOT add to MVP scope:** no operator, no event log (Growth), no worker, no
action allowlist are *built*. FC1 is the only one that shapes MVP code the developer
writes today (the guarded mutation layer + service-role discipline); FC2–FC4 are design
commitments honoured when the Growth/Phase-3 pieces land. The **runtime** for the eventual
operator (serverless-cron + durable-queue, a managed agent runner such as Inngest or
Trigger.dev, or a persistent worker; with a Hermes-style persistent-memory harness named
as a *candidate, not a committed deployment*) is an explicit **deferred decision** — see
§Deferred Decisions and §Areas for Future Enhancement. Whatever the runtime, it couples to
the app only through the Supabase spine (durable event stream + guarded mutation layer),
never a private backdoor.

---

### Phase 3 — Open Architectural Questions

The seams above prove Phase 3 can be built *without re-architecture*. They do **not** claim
the team-of-agents / Hermes design is fully solved. These are genuinely unresolved and are
recorded here as open questions — **not** MVP work, and deliberately not hand-waved as done.
Each carries a **recommended direction (not committed)** to bias the design without locking
it; each must still be confirmed when Phase 3 is committed, not during it. They share one
answer shape — see *The unifying pattern* below.

1. **Shared crew memory contract (the hard part of "one shared memory").** The PRD's
   digital crew (bookkeeper / sales / operations) shares *one* per-tenant memory. The
   activity log (senses) and learned-patterns record (memory) are not sufficient on their
   own: a Hermes-style harness needs a **memory contract** — what is written, how it is
   read, how staleness and conflicts are resolved when multiple roles update overlapping
   beliefs about the same customer. Likely shape: a structured per-tenant facts store **plus
   a `pgvector` index for semantic recall** (Supabase supports pgvector — the boring option).
   Open: the write/read/eviction rules and whether roles share one memory or hold role-local
   views over a shared base. **This is the primary architectural risk of a *team* of agents.**

   > **Recommended direction (not committed):** one shared memory as a **projection over the
   > event stream**, never a parallel source of truth. Keep `org_activity_log` (FC2) as the raw
   > source; derive a per-tenant **`tenant_facts`** projection of typed beliefs with provenance
   > (which events produced it), confidence, and last-updated. **Conflict rule:** facts are
   > *versioned and superseded, never mutated in place* — the newer/higher-confidence fact wins,
   > the old is retained for audit, so no role silently clobbers another's belief (this is what
   > makes a *shared* brain safe under concurrent writers). Add a **`pgvector`** index over
   > free-text observations for semantic recall (in-stack, ca-central-1, no new infra). **Roles
   > are scopes on *actions*, not on *memory*** — shared brain, separate hands. The projection is
   > deterministically rebuildable from the log (FC2 replayable cursor), so it is a cache, not a
   > second source of truth. **Reject** role-local memories: they destroy the moat.

2. **External-tool credential vault + PIPEDA egress boundary (MCP).** Connected tools
   (Gmail, DataForSEO, messaging) need per-tenant credentials stored encrypted, and a
   defined data-egress boundary: which tenant data may leave to which tool, under what
   consent (CASL for customer messaging, PIPEDA for any tenant data shared externally). No
   MVP seam exists for a secret vault or egress policy; the MCP client runs in the *runtime*,
   not the app. Open: vault location, per-tool scope grants, and the egress-consent record.

   > **Recommended direction (not committed):** **OAuth-first** — prefer per-tenant, least-scope
   > OAuth grants with a revocable refresh token (e.g. Gmail) over stored API keys wherever the
   > tool supports it, so the blast radius is "revoke one tenant," not "rotate a master key
   > affecting everyone." Store secrets in **Supabase Vault (pgsodium)** for Phase-3 scale
   > (boring, in-stack, PIPEDA residency preserved); graduate to a dedicated secrets manager only
   > when outgrown. Model the **egress boundary as a per-tool allowlist** (same shape as the
   > Schema Validator / action allowlist): each tool declares the fields/tables it may read and
   > send; anything outside is rejected and logged. Add a **consent ledger** — CASL consent
   > checked per recipient before any commercial send, PIPEDA transparency for externally-shared
   > data — and log every tool call (before/after) with *what data crossed the boundary*. The
   > MCP client runs in the runtime, so the Next app never holds live tool sessions.

3. **Trust-threshold state machine.** FR65's "N consecutive clean approvals of *that
   action-type*" is a small per-`(organization_id, role, action_type)` state machine
   (proposed → approved-n-times → autonomous → paused/revoked). It is unbuilt, but the
   MVP action-allowlist entries must carry a stable `action_type` key so this can attach
   later without reclassifying every action. Open: the action-type taxonomy and where the
   threshold counters live (candidate: derived from `org_activity_log` `actor_id`/`action_type`).

   > **Recommended direction (not committed):** derive it from the event stream too — counters
   > are a projection over `org_activity_log` filtered by `(org, role, action_type, outcome)`, so
   > "why did this become autonomous?" is answerable by replaying approvals. Materialize a thin
   > **`action_autonomy (org, role, action_type, state, consecutive_clean_count, granted_at,
   > paused)`** read model. Machine: `proposing → (N clean) → autonomous → paused/revoked`; **any
   > edit or rejection resets the counter to zero** (the safety property behind "N *consecutive*
   > clean"). Classify each action-type on **reversibility × blast radius** to set its default
   > threshold: `draft_invoice` (reversible/internal) → low, autonomy early; `send_customer_email`
   > (irreversible/external/reputational) → high + explicit opt-in + never autonomous-by-default;
   > `spend_money` → highest + hard cap. Revocation (FR66) is one flag flip, checked by the runner
   > before every autonomous action.

**The unifying pattern.** All three recommendations resolve to the *same* shape: the **event
stream (FC2) is the one durable source; memory (`tenant_facts`), autonomy state
(`action_autonomy`), and audit are cheap materialized projections over it, all
deterministically rebuildable.** This is the tell that Phase 3 is *one* coherent
event-sourced architecture with read models — not three bespoke subsystems. **Sequencing when
Phase 3 opens:** memory contract first (hardest, and the moat) → autonomy state second (nearly
free once events carry `actor_id`/`action_type`) → credential vault + egress last, but **before
any customer-facing tool ships** (it is the compliance gate).

**Two judgment calls recorded (not yet decided):**

- **Runtime — lean managed runner over bespoke droplet.** For a solo founder, I lean toward
  a **managed agent runner (Inngest / Trigger.dev)** rather than standing up and operating a
  persistent Hermes droplet: durable scheduling, retries, and observability come for free,
  and *Hermes is a pattern (persistent memory + loop + model-agnostic tool use) that runs on
  top of a runner* — the pattern and the deployment are separable. Boring wins; revisit only
  if a managed runner's execution-time or statefulness limits bite.
- **Agent spend budgets reuse the metering seam.** An autonomous loop spends money (LLM
  tokens + paid APIs like DataForSEO). The same `assertUnderCap` guard shape that gates
  record creation should gate agent action budgets — one budget primitive, two uses.

---

### Infrastructure & Deployment

| Decision | Choice | Rationale |
|---|---|---|
| Hosting | Vercel | PRD mandate; auto-scaling serverless; edge middleware; zero-config Next.js deployment |
| Database region | Supabase ca-central-1 (AWS Canada Central) | PIPEDA — 100% Canadian data residency |
| CI/CD | GitHub Actions → Vercel preview + production deploys | Standard Next.js workflow; preview URLs per PR |
| Environment management | `.env.local` (dev), Vercel project env vars (staging/production) | No `.env.production` committed to repo |
| Monitoring | Sentry (`@sentry/nextjs` v10) | Error tracking + Schema Validator rejection logging + LLM failure tracking |
| Email delivery | Resend v6 | Magic links, trial expiry (Day 12, 14), offboarding (Day 1, 7, 25) |
| Scheduled jobs | Vercel Cron (declared in `vercel.json`) | Usage reporting to Stripe + usage reconciliation (NFR-R5); each hits a cron-secret-protected API route |
| Scaling ceiling | Vercel auto-scales; Supabase free tier → Pro at 500MB or 50K MAU | NFR-SC1/SC2; explicit upgrade prompt at 20 tables or 50K rows per org |

**Environment Variables (server-side only — never NEXT_PUBLIC_ prefixed):**

```
SUPABASE_SERVICE_ROLE_KEY          # Server API routes only
GEMINI_API_KEY                     # Server API routes only
STRIPE_SECRET_KEY                  # Server API routes only
STRIPE_WEBHOOK_SECRET              # Webhook handler only
STRIPE_METERED_PRICE_ID            # Metered usage price for usage reporting (server only)
CRON_SECRET                        # Guards /api/cron/* routes (usage report + reconciliation)
RESEND_API_KEY                     # Server API routes only
SENTRY_AUTH_TOKEN                  # Build time only
```

**Environment Variables (client-safe — NEXT_PUBLIC_ prefixed):**

```
NEXT_PUBLIC_SUPABASE_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY
NEXT_PUBLIC_SENTRY_DSN
```

---

## Implementation Patterns & Consistency Rules

### Naming Patterns

**Database Naming Conventions:**

| Element | Convention | Example |
|---|---|---|
| Platform tables | `snake_case`, plural | `organizations`, `org_members`, `anonymous_sessions` |
| Tenant-generated tables | `snake_case`, plural, normalized from user input | User says "Job Tracking" → `job_tracking` |
| Column names | `snake_case` | `organization_id`, `created_at`, `invoice_status` |
| Foreign keys | `{table_singular}_id` | `organization_id`, `user_id` |
| Indexes | `idx_{table}_{column}` | `idx_organizations_slug` |
| RLS policies | `"{table}_tenant_isolation"` | `"jobs_tenant_isolation"` |

**API Naming Conventions:**

| Element | Convention | Example |
|---|---|---|
| Route paths | `kebab-case`, plural nouns | `/api/schema-mutations`, `/api/organizations` |
| Route parameters | `[paramName]` camelCase | `[slug]`, `[tableId]` |
| Query parameters | `camelCase` | `?orgId=`, `?includeHidden=` |
| HTTP methods | Standard REST verbs | `POST /api/generate`, `GET /api/export` |

**TypeScript Naming Conventions:**

| Element | Convention | Example |
|---|---|---|
| Interfaces & Types | PascalCase | `SchemaDefinition`, `ApiResponse<T>`, `OrgMember` |
| Components | PascalCase files + default export | `JobCard.tsx`, `DataTable.tsx` |
| Hooks | camelCase, `use` prefix | `useOrganization`, `useTableData` |
| Context | PascalCase + `Context` suffix | `AuthContext`, `TenantContext` |
| API route files | always `route.ts` | `src/app/api/generate/route.ts` |
| Utility functions | camelCase | `normalizeTableName`, `buildSystemPrompt` |
| Constants | `SCREAMING_SNAKE_CASE` | `FALLBACK_SCHEMA`, `BLOCKED_KEYWORDS` |
| Zod schemas | camelCase + `Schema` suffix | `schemaDefinitionSchema`, `orgMemberSchema` |

**Table Name Normalization (mandatory for user-defined names):**

```typescript
// src/lib/schema/types.ts
export function normalizeTableName(input: string): string {
  return input
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/^_+|_+$/g, '');
}
// "Job Tracking!" → "job_tracking"
// "HVAC Jobs" → "hvac_jobs"
```

---

### Structure Patterns

**API Route Pattern (mandatory structure for all Route Handlers):**

```typescript
// src/app/api/{feature}/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';
import { AppError } from '@/types/api';

export async function POST(req: NextRequest) {
  try {
    const supabase = createSupabaseServerClient();
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return NextResponse.json({ data: null, error: 'Unauthorized' }, { status: 401 });

    // Feature logic here

    return NextResponse.json({ data: result, error: null });
  } catch (err) {
    if (err instanceof AppError) {
      return NextResponse.json({ data: null, error: err.userMessage }, { status: err.statusCode });
    }
    return NextResponse.json({ data: null, error: 'Internal server error' }, { status: 500 });
  }
}
```

**Component Pattern (mandatory for all feature components):**

```typescript
// src/components/{feature}/{ComponentName}.tsx
'use client'; // Only when using hooks/events — omit for Server Components

interface ComponentNameProps {
  // Props typed with TypeScript interfaces, never `any`
}

export function ComponentName({ ...props }: ComponentNameProps) {
  // Implementation
}
```

**Hook Pattern:**

```typescript
// src/hooks/use{FeatureName}.ts
export function useFeatureName(param: string) {
  // Always return typed object, never positional array (except simple useState)
  return { data, isLoading, error, mutate };
}
```

---

### Format Patterns

**API Response Format (every route handler MUST use this):**

```typescript
// Success
NextResponse.json({ data: T, error: null }, { status: 200 })
// Error
NextResponse.json({ data: null, error: "User-facing message" }, { status: 4xx | 5xx })
```

**Schema Operation Format (LLM output — validated by Schema Validator):**

```typescript
// src/types/schema.ts
// Operations mutate the LOGICAL schema in org_schemas — they are metadata edits, NOT DDL.
type SchemaOperation =
  | { type: 'add_field'; tableKey: string; field: SchemaField }
  | { type: 'add_table'; tableKey: string; fields: SchemaField[]; reason?: string }
  | { type: 'add_view'; name: string; sourceTableKey: string; filters?: Filter[] };

// Explainability (FR46): every generated table/field carries a plain-language reason.
type SchemaField = {
  key: string;          // JSONB key inside records.data; normalized, must not collide with RESERVED_KEYS
  label: string;        // display label (rename = edit this; no migration)
  dataType: FieldType;
  nullable?: boolean;
  reason?: string;      // one-line, plain-language justification shown at generation time
  sensitive?: boolean;  // drives the PIPEDA SensitivityBadge (FR40)
  hidden?: boolean;     // append-only "hide"/soft-remove (FR11, FR47) — data retained in records.data
};

type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'email' | 'phone' | 'currency';
// NOTE: 'relation' type (cross-table lookups) is explicitly excluded from MVP scope.
// Gemini's system prompt must not generate relation fields. 'relation' support is deferred to Growth phase.

// A tenant row as stored:
type TenantRecord = {
  id: string;
  organizationId: string;
  tableKey: string;
  data: Record<string, unknown>;  // shape governed by the org_schemas field definitions, validated via Zod
  createdAt: string; updatedAt: string; deletedAt: string | null;
};
```

**Import Column-Mapping Format (LLM output — structure only, never DDL):**

```typescript
// src/types/import.ts
type ColumnMapping = {
  sourceColumn: string;                     // header from the uploaded file
  target: { table: string; field: string } | null; // null ⇒ unmapped, must be resolved
  confidence: number;                       // 0–1; below threshold ⇒ surfaced as ambiguous
  reason?: string;                          // why this match was proposed (show-your-work)
};

type ImportProposal = {
  fileId: string;
  rowCount: number;
  mappings: ColumnMapping[];                // editable before commit (FR50)
  unmapped: string[];                       // FR51 — blocks commit until resolved
};
```

**Date/Time format:** ISO 8601 strings in all API responses and database storage (`2026-05-17T19:00:00Z`). Never Unix timestamps in user-facing APIs.

**JSON field naming:** `camelCase` in TypeScript interfaces, `snake_case` in database columns and API request/response bodies. `@supabase/supabase-js` handles the conversion automatically via `data` returned from Supabase queries.

---

### Communication Patterns

**Supabase Realtime Subscription (mandatory pattern):**

```typescript
// src/hooks/useRealtimeSync.ts
// One channel per organization — set up in dashboard layout, cleaned up on unmount
useEffect(() => {
  const channel = supabase
    .channel(`org-${organizationId}`)
    .on('postgres_changes', {
      event: '*',
      schema: 'public',
      filter: `organization_id=eq.${organizationId}`
    }, (payload) => {
      // Update TanStack Query cache — do NOT call setQueryData directly in complex cases
      queryClient.invalidateQueries({ queryKey: ['records', payload.table] });
    })
    .subscribe();
  return () => { supabase.removeChannel(channel); };
}, [organizationId]);
```

**i18n Pattern (next-intl):**

```typescript
// Client component language toggle
const { locale, setLocale } = useLocale(); // from next-intl
// Toggle: setLocale(locale === 'en' ? 'fr' : 'en')
// Translations: useTranslations('Dashboard')
// t('jobs') → "Jobs" | "Emplois"
```

**Gemini API Call Pattern (mandatory — every call):**

```typescript
// src/lib/gemini/client.ts
import { GoogleGenAI } from '@google/genai';
import { HARDENED_SYSTEM_PROMPT } from './prompts';

// Single shared instance — instantiated once per server process
const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

export async function callGeminiWithTimeout<T>(
  userPrompt: string,
  responseSchema: object,
  timeoutMs = 15000
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('Gemini timeout')), timeoutMs)
  );
  const generatePromise = ai.models.generateContent({
    model: 'gemini-2.0-flash',
    contents: userPrompt,
    config: {
      systemInstruction: HARDENED_SYSTEM_PROMPT,
      responseMimeType: 'application/json',
      responseSchema,
    },
  });
  const result = await Promise.race([generatePromise, timeoutPromise]);
  return JSON.parse(result.text ?? '') as T;
}
```

---

### Process Patterns

**Error Handling (all layers):**

```
Server API route   → try/catch → AppError → { data: null, error: userMessage }
Client TanStack    → mutation.onError → Sentry.captureException + toast notification
LLM failure        → silent retry once → hard fallback schema (no error screen ever)
Schema Validator   → rejection → Sentry log + user-friendly plain-language message
RLS violation      → Supabase returns empty array (not 403) → UI shows "No records found"
```

**Loading State Pattern:**

```
Initial page load  → shadcn Skeleton components (not spinners)
Generation arc     → useGenerationState phases with custom skeleton animation
CRUD operations    → Optimistic UI (instant render) — no loading state shown
Schema mutations   → Chat interface shows "thinking..." bubble (iMessage style)
Stripe redirect    → Button shows disabled state + "Redirecting..." text
```

**Validation Timing:**

```
Form fields        → on blur (not on every keystroke)
Form submission    → Zod schema validation before API call
API route input    → Zod parse at top of handler before any business logic
LLM output         → Schema Validator before any org_schemas metadata write (no DDL exists)
```

**Enforcement Guidelines:**

All AI agents MUST:
- Use `ApiResponse<T>` envelope for every route handler response
- Run Schema Validator on every LLM-proposed schema-metadata operation before persisting to `org_schemas` (no DDL is generated in this architecture)
- Write tenant rows ONLY through the guarded mutation layer (`src/lib/data/mutate.ts`) under the acting user's org-scoped, RLS-enforced Supabase client — NEVER write tenant data with the service-role key (NFR-FC1); service role is for narrow platform-bootstrap ops only (anonymous generation, claim-time org bootstrap, cross-org cron, offboarding cascade — never runtime DDL)
- Keep tenant business logic in `lib/` (callable by a route today or an out-of-band worker later) rather than welded to the HTTP request lifecycle (NFR-FC3). In particular, `mutate.ts` must accept identity as an explicit parameter — never read `cookies()`/request state inside it — and accept `actorId` + an optional `idempotencyKey` so a retried caller (or agent loop) cannot double-write
- Never import `SUPABASE_SERVICE_ROLE_KEY` outside `src/lib/supabase/server.ts` and API routes
- Use `normalizeTableName()` on all user-provided table/field names before persisting them as a `table_key` or field `key`
- Rely on the single static RLS policy on `records` (membership-based via `auth_org_ids()`) — never create per-table or runtime RLS; there are no tenant DDL tables to police
- Use optimistic updates for all CRUD mutations (TanStack Query pattern above)
- Never expose raw JSON schema, SQL, or error stack traces to end users
- Include the hardened `HARDENED_SYSTEM_PROMPT` constant on every Gemini call
- Call the shared `assertUnderCap(orgId)` guard at the top of every record-insert route (including import commit) before writing — never let a table's add path bypass the spend cap (FR55)
- Never write imported rows before the user confirms the mapping; resolve all `unmapped` columns first (FR51–FR52)
- Emit and persist a `reason` for every AI-generated table/field; surface it at generation time, not in settings (FR46)

---

## Project Structure & Boundaries

### Complete Project Directory Structure

```
snapbusy/
├── README.md
├── package.json
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
├── components.json                    # shadcn/ui configuration
├── vercel.json                        # Vercel Cron schedules (usage report + reconciliation)
├── .eslintrc.json                     # includes CI lint gate for service role key
├── .env.local                         # local dev (gitignored)
├── .env.example                       # committed, no real values
├── .gitignore
├── .github/
│   └── workflows/
│       ├── ci.yml                     # lint + type-check + RLS isolation test
│       └── deploy.yml                 # Vercel preview + production
├── public/
│   ├── icons/
│   │   ├── icon-192.png               # PWA icon
│   │   └── icon-512.png               # PWA icon
│   └── sw.js                          # Service worker (generated at build)
├── src/
│   ├── middleware.ts                  # Supabase session refresh + rate limiting
│   ├── app/
│   │   ├── layout.tsx                 # Root layout (providers: auth, tenant, i18n, query)
│   │   ├── page.tsx                   # Landing page (Mad Libs prompt + "Build my dashboard")
│   │   ├── globals.css                # Tailwind directives + CSS custom properties (tokens)
│   │   ├── dashboard/
│   │   │   ├── layout.tsx             # Dashboard shell (Sidebar | BottomTabBar, TopNav, ChatBubble)
│   │   │   ├── page.tsx               # Admin home (MetricCards)
│   │   │   └── [tableSlug]/
│   │   │       └── page.tsx           # Dynamic table view (DataTable | CardList)
│   │   ├── claim/
│   │   │   └── page.tsx               # Magic link landing → PIPEDA consent → demo-to-live
│   │   ├── forms/
│   │   │   └── [slug]/
│   │   │       └── page.tsx           # Public intake form (no auth, schema-derived fields)
│   │   ├── settings/
│   │   │   └── page.tsx               # Admin settings (billing, invite, data export, offboarding)
│   │   └── api/
│   │       ├── generate/
│   │       │   └── route.ts           # POST: prompt → Gemini → Validator → provision → inject
│   │       ├── provision/
│   │       │   └── route.ts           # POST: validated schema metadata → upsert org_schemas + seed records (NO DDL)
│   │       ├── schema-mutate/
│   │       │   └── route.ts           # POST: NL instruction → Gemini diff → Validator → org_schemas metadata edit
│   │       ├── claim/
│   │       │   └── route.ts           # POST: email → magic link → demo-to-live transition
│   │       ├── invite/
│   │       │   └── route.ts           # POST: admin invites team member (sets role metadata)
│   │       ├── intake/
│   │       │   └── [slug]/
│   │       │       └── route.ts       # POST: public intake → insert row → email notification (FR28; web push deferred to Growth)
│   │       ├── export/
│   │       │   └── route.ts           # GET: CSV/JSON data export (PIPEDA FR37)
│   │       ├── import/
│   │       │   ├── analyze/
│   │       │   │   └── route.ts       # POST: parse file + Gemini column mapping → ImportProposal (FR48–51)
│   │       │   └── commit/
│   │       │       └── route.ts       # POST: confirmed mapping → clear synthetic + bulk insert (FR52; assertUnderCap)
│   │       ├── usage/
│   │       │   └── route.ts           # GET: current-cycle active-record usage vs. allotment (FR54)
│   │       ├── cron/
│   │       │   ├── report-usage/
│   │       │   │   └── route.ts       # POST (cron): count active records → Stripe usage record (FR53)
│   │       │   └── reconcile-usage/
│   │       │       └── route.ts       # POST (cron): reconcile reported vs. live count, ±1% (NFR-R5)
│   │       └── webhooks/
│   │           └── stripe/
│   │               └── route.ts       # POST: Stripe webhook (subscription lifecycle, metered invoices)
│   ├── components/
│   │   ├── ui/                        # shadcn/ui components (CLI-generated, do not hand-edit)
│   │   ├── generation/
│   │   │   ├── PromptBuilder.tsx      # Mad Libs UI (trade dropdown + city + "I track...")
│   │   │   ├── GenerationSkeleton.tsx # 3-phase progressive reveal skeleton
│   │   │   ├── ReasonBadge.tsx        # Explainability info icon + tooltip + remove/rename (FR46–47)
│   │   │   └── FallbackBanner.tsx     # "Used starter template — customize via chat" banner
│   │   ├── import/
│   │   │   ├── ImportDropzone.tsx     # CSV/Excel drag-drop upload (FR48)
│   │   │   ├── MappingPreview.tsx     # Editable column→field table; ambiguous flagged (FR49–51)
│   │   │   └── ImportProgress.tsx     # Commit progress: synthetic cleared → real rows inserted (FR52)
│   │   ├── dashboard/
│   │   │   ├── DataTable.tsx          # Desktop: shadcn Table + sorting + filtering
│   │   │   ├── CardList.tsx           # Mobile: swipeable card list container
│   │   │   ├── SwipeCard.tsx          # Individual job card with swipe-to-complete gesture
│   │   │   ├── MetricCard.tsx         # Admin home hero metric (open jobs, pending invoices)
│   │   │   ├── RecordForm.tsx         # Auto-generated add/edit form (schema-derived fields)
│   │   │   ├── JobDetailSheet.tsx     # Bottom sheet (Google Maps style, 3 snap points)
│   │   │   ├── ColumnHideToggle.tsx   # Admin column visibility (stores in user settings)
│   │   │   └── SensitivityBadge.tsx   # PIPEDA padlock icon + tooltip
│   │   ├── editor/
│   │   │   ├── ChatBubble.tsx         # Floating trigger (56px, bottom-right, admin only)
│   │   │   ├── ChatInterface.tsx      # iMessage-style panel (Radix popover base)
│   │   │   └── SchemaDiffPreview.tsx  # "Here's what I'll build" confirmation step
│   │   ├── auth/
│   │   │   ├── MagicLinkForm.tsx      # Email input → magic link send
│   │   │   ├── ClaimFlow.tsx          # PIPEDA consent checkbox + "Make it Real" transition
│   │   │   └── InviteForm.tsx         # Admin: invite by email + role assignment
│   │   ├── intake/
│   │   │   └── IntakeForm.tsx         # Public form (schema-derived, no auth, 5 fields max)
│   │   ├── billing/
│   │   │   ├── UpgradeButton.tsx      # → Stripe Checkout (base + metered price; server action redirect)
│   │   │   ├── TrialBanner.tsx        # Day 12+ persistent banner
│   │   │   ├── UsageMeter.tsx         # Live active-record usage vs. allotment (FR54)
│   │   │   ├── SpendCapSettings.tsx   # Admin sets optional monthly hard cap (FR55)
│   │   │   └── GracePeriodBanner.tsx  # Offboarding grace period warnings (Day 1/7/25)
│   │   ├── layout/
│   │   │   ├── Sidebar.tsx            # Desktop left nav (240px, collapsible to 64px)
│   │   │   ├── BottomTabBar.tsx       # Mobile persistent tab bar (64px)
│   │   │   ├── TopNav.tsx             # Language toggle + theme toggle + user menu
│   │   │   └── PWAInstallPrompt.tsx   # "Add to Home Screen" (fires post-aha, not on load)
│   │   └── shared/
│   │       ├── LanguageToggle.tsx     # EN ↔ FR instant toggle
│   │       ├── ThemeToggle.tsx        # Light/dark (persisted localStorage)
│   │       └── ErrorBoundary.tsx      # React error boundary (plain-language fallback)
│   ├── lib/
│   │   ├── supabase/
│   │   │   ├── client.ts              # Browser Supabase client (anon key — client-safe)
│   │   │   ├── server.ts              # Server Supabase client (service role — server only)
│   │   │   └── middleware.ts          # Session cookie refresh for Next.js middleware
│   │   ├── gemini/
│   │   │   ├── client.ts              # callGeminiWithTimeout() (15s Promise.race timeout)
│   │   │   ├── schema-generator.ts    # prompt → SchemaDefinition (with 1x retry)
│   │   │   ├── data-injector.ts       # SchemaDefinition → synthetic Ontario data rows
│   │   │   ├── schema-mutator.ts      # NL instruction → SchemaOperation diff
│   │   │   └── prompts.ts             # HARDENED_SYSTEM_PROMPT (const, never interpolated)
│   │   ├── schema/
│   │   │   ├── validator.ts           # Schema Validator (metadata-shape allowlist + reserved-key + keyword defense)
│   │   │   ├── provisioner.ts         # SchemaDefinition → upsert org_schemas metadata + seed records (NO DDL)
│   │   │   ├── types.ts               # SchemaDefinition, SchemaField, SchemaOperation, FieldType, TenantRecord
│   │   │   ├── fallback.ts            # UNIVERSAL_FIELD_SERVICE_TEMPLATE (hardcoded const)
│   │   │   └── mutate-schema.ts       # Apply add_table/add_field/add_view + hide/rename to org_schemas metadata
│   │   ├── import/
│   │   │   ├── parser.ts              # papaparse/xlsx server-side parse → normalized rows (NFR-P7)
│   │   │   ├── mapper.ts              # Gemini column→field mapping vs. org_schemas → ImportProposal
│   │   │   └── commit.ts             # clear synthetic + transactional bulk insert (assertUnderCap)
│   │   ├── billing/
│   │   │   ├── metering.ts            # count active records per org/cycle; post Stripe usage record (FR53)
│   │   │   ├── cap.ts                 # assertUnderCap(orgId) — shared guard for all insert paths (FR55)
│   │   │   └── reconcile.ts           # reported-vs-live reconciliation, ±1% tolerance (NFR-R5)
│   │   ├── stripe/
│   │   │   ├── client.ts              # Stripe server client init
│   │   │   └── webhooks.ts            # checkout.session.completed, subscription.deleted, invoice.paid handlers
│   │   ├── resend/
│   │   │   ├── client.ts              # Resend client init
│   │   │   └── templates.ts           # Magic link, trial day 12/14, offboarding day 1/7/25
│   │   ├── i18n/
│   │   │   ├── en.json                # English translations (all UI strings)
│   │   │   ├── fr.json                # French translations (all UI strings)
│   │   │   └── config.ts              # next-intl routing + locale detection config
│   │   ├── auth/
│   │   │   └── session.ts             # getSession(), getRole(), requireAdmin() helpers
│   │   ├── data/
│   │   │   ├── mutate.ts              # GUARDED tenant-mutation layer. Signature takes IDENTITY as an explicit param (scoped principal + client), NEVER reads request cookies — so an out-of-band worker with no cookie can call it (resolves FC1↔FC3). Also takes actorId + optional idempotencyKey + expectedVersion. Single path for all `records` writes; composes assertUnderCap; never uses service role (NFR-FC1). Routes call it today; a Phase 3 agent role calls it too (NFR-FC3)
│   │   │   └── records.ts             # Query layer over `records`: list/filter/sort by (organization_id, table_key) via JSONB operators (FR6, FR10); maps rows to the org_schemas field definitions
│   │   └── utils.ts                   # normalizeTableName(), cn() classnames, formatCurrency()
│   ├── hooks/
│   │   ├── useGenerationState.ts      # Generation arc state machine (idle→ready|failed)
│   │   ├── useOrganization.ts         # Current org + schema metadata from TenantContext
│   │   ├── useTableData.ts            # TanStack Query: records for a given table
│   │   ├── useRealtimeSync.ts         # Supabase Realtime channel setup per org
│   │   ├── useSchemaFields.ts         # Field definitions for a logical table_key (from org_schemas) — drives form + column generation
│   │   ├── usePWAInstall.ts           # beforeinstallprompt event capture + deferred prompt
│   │   ├── useLanguage.ts             # EN/FR toggle (wraps next-intl setLocale)
│   │   ├── useImport.ts               # Import flow state: upload → proposal → edit → commit
│   │   ├── useUsage.ts                # Live active-record usage vs. allotment (FR54)
│   │   └── useSubscription.ts         # Stripe subscription status from Supabase user record
│   ├── context/
│   │   ├── AuthContext.tsx            # Supabase auth session + user + role
│   │   ├── TenantContext.tsx          # Organization record + org_schema metadata
│   │   └── GenerationContext.tsx      # Pre-claim anonymous session state (sessionId, phase)
│   └── types/
│       ├── schema.ts                  # SchemaDefinition, SchemaField (+reason/label/hidden), SchemaOperation, FieldType, TenantRecord
│       ├── auth.ts                    # User, Organization, OrgMember, Role
│       ├── billing.ts                 # SubscriptionStatus, TrialState, GracePeriodState, UsageCycle, SpendCap
│       ├── import.ts                  # ColumnMapping, ImportProposal
│       └── api.ts                     # ApiResponse<T>, AppError
├── tests/
│   ├── unit/
│   │   ├── schema/
│   │   │   ├── validator.test.ts      # Schema Validator: allowlist, reserved-key collision, keyword defense, edge cases
│   │   │   ├── provisioner.test.ts    # Metadata upsert + seed-records correctness (no DDL)
│   │   │   └── mutate-schema.test.ts  # add_field/add_table/hide/rename metadata edits preserve records
│   │   ├── import/
│   │   │   └── mapper.test.ts         # Column mapping: confidence threshold, unmapped flagging (FR51)
│   │   ├── billing/
│   │   │   ├── metering.test.ts       # active-record count correctness per cycle (FR53)
│   │   │   └── cap.test.ts            # assertUnderCap pauses inserts at the cap (FR55)
│   │   └── lib/
│   │       └── utils.test.ts          # normalizeTableName, formatCurrency
│   ├── integration/
│   │   ├── rls-isolation.test.ts      # CRITICAL GATE: member of Org A sees its records; stranger sees none (membership-based RLS on `records`)
│   │   ├── import-commit.test.ts      # Non-destructive synthetic→real replacement, no data loss (FR52)
│   │   ├── usage-reconciliation.test.ts # Reported vs. live count within 1% (NFR-R5)
│   │   └── generation-pipeline.test.ts # Full prompt → schema → provision smoke test
│   └── e2e/
│       ├── generation-arc.spec.ts     # Landing → prompt → aha → claim
│       └── claim-flow.spec.ts         # Magic link → PIPEDA consent → live account
└── docs/
    └── api.md                         # API route reference (generated)
```

---

### Architectural Boundaries

**API Boundaries:**

| Boundary | What crosses it | What does NOT cross it |
|---|---|---|
| Client → API route | `ApiResponse<T>` JSON envelope | Raw SQL, Supabase internals, service role key |
| API route → Supabase | Validated SchemaOperation objects, typed row inserts | Raw LLM output (always Validator-gated first) |
| API route → Gemini | Hardened system prompt + user prompt | User session data, organization records |
| Client → Supabase | Anon key reads (RLS-protected) | Service role operations |
| Stripe → App | Webhook events (signature-verified) | Direct database access |

**Component Boundaries:**

- `ui/` — pure shadcn/ui primitives, no business logic
- `generation/` — owns the prompt → aha experience, no auth logic
- `dashboard/` — owns all data views, delegates mutations to API routes
- `editor/` — owns AI chat interface, admin-only (enforced in parent layout)
- `auth/` — owns all claim/invite/magic-link flows
- `billing/` — owns all Stripe redirect and trial state UI
- `layout/` — owns navigation shell, no data fetching
- `shared/` — cross-cutting UI primitives (language, theme, errors)

**Service Boundaries:**

| System | Owned by | Depends on |
|---|---|---|
| Generation pipeline | `src/app/api/generate/route.ts` | Gemini, Schema Validator, Supabase provisioner, Resend |
| Schema mutations | `src/app/api/schema-mutate/route.ts` | Gemini, Schema Validator, `org_schemas` metadata edit (`lib/schema/mutate-schema.ts`) |
| Auth + claim | `src/app/api/claim/route.ts` | Supabase Auth, Resend |
| Billing | `src/app/api/webhooks/stripe/route.ts` | Stripe SDK, Supabase user record |
| Data import | `src/app/api/import/{analyze,commit}/route.ts` | `lib/import/*`, Gemini, Schema Validator (structure only), `assertUnderCap` |
| Usage metering | `src/app/api/cron/{report-usage,reconcile-usage}/route.ts` | `lib/billing/*`, Stripe metered price, `org_usage` |
| Realtime | `src/hooks/useRealtimeSync.ts` | Supabase Realtime, TanStack Query |

**Data Flow — Generation Pipeline:**

```
User prompt (browser)
  → POST /api/generate
    → Prompt inflation (add Ontario/trade context)
    → callGeminiWithTimeout() [15s timeout] — SINGLE call → { schema, seedRows }
      → [Success] Schema Validator (metadata-shape allowlist; no SQL)
        → persist: insert org_schemas metadata + bulk-insert seedRows into records
                   (anonymous_sessions/session_id pre-claim — NO DDL, service role bootstrap only)
            → Return { sessionId, schemaDefinition }
      → [Fail once] Retry Gemini call
      → [Fail twice / timeout] Deploy UNIVERSAL_FIELD_SERVICE_TEMPLATE (metadata + seed rows)
        → Return { sessionId, schemaDefinition, isFallback: true }
  ← Dashboard renders (GenerationContext drives UI phases)
```

**Data Flow — Conversational Editor:**

```
User message (admin only)
  → POST /api/schema-mutate (role: admin check)
    → callGeminiWithTimeout() [schema-mutator prompt]
      → Schema Validator (append-only metadata allowlist)
        → [Valid] SchemaDiffPreview shown to user
          → User confirms → update org_schemas metadata (add_table/add_field/add_view)
            → Invalidate TanStack Query cache → UI re-renders (existing records untouched)
        → [Delete/hide request] set field.hidden=true in metadata (data retained in records.data)
        → [Invalid] Plain-language error response
    → Sentry log on Validator rejection

> Note: schema changes are metadata edits — no DDL, no migration, no data movement.
> Delete/rename are now non-destructive by construction (hide flag / label edit); the
> append-only MVP posture is a product choice (per PRD), not an engineering limit.
```

**Data Flow — Data Import (CSV/Excel, Tier 1):**

```
File upload (browser)
  → POST /api/import/analyze
    → parser.ts (papaparse/xlsx, server-side) → normalized rows + headers
    → mapper.ts → callGeminiWithTimeout() → propose column → {table, field} vs org_schemas
      → Return ImportProposal { mappings, unmapped, rowCount }
  ← MappingPreview.tsx (editable; ambiguous/unmapped flagged — commit blocked until resolved)
User confirms mapping
  → POST /api/import/commit
    → lib/data/mutate.ts (guarded, user's RLS client — NFR-FC1)
      → assertUnderCap(orgId)  [import counts toward usage]
      → transaction: soft-delete synthetic records for affected table_keys → bulk insert mapped rows into records
        → Invalidate TanStack Query cache → dashboard shows real data
```

**Data Flow — Usage Metering & Spend Cap:**

```
Record create (any table)
  → insert route → lib/data/mutate.ts (guarded layer, user's org-scoped RLS client — NFR-FC1)
    → assertUnderCap(orgId)
      → [under cap] insert row (RLS-enforced; never service role)
      → [cap reached] refuse with plain-language message, set cap_reached_at (FR55)

Vercel Cron (per cycle)
  → POST /api/cron/report-usage  [CRON_SECRET]
    → metering.ts: count active records (jobs+invoices+customers) per org
      → post Stripe usage record → write org_usage.stripe_usage_record_id
  → POST /api/cron/reconcile-usage  [CRON_SECRET]
    → reconcile.ts: reported vs live count → >1% drift ⇒ Sentry + block next report (NFR-R5)
```

---

### Requirements to Structure Mapping

**FR Category → Primary Location:**

| FR Category | Primary Implementation Location |
|---|---|
| App Generation (FR1–5) | `src/app/api/generate/`, `src/lib/gemini/`, `src/lib/schema/`, `src/components/generation/` |
| Data Management (FR6–12) | `src/app/dashboard/[tableSlug]/`, `src/components/dashboard/`, `src/hooks/useTableData.ts` |
| Conversational Editor (FR13–17) | `src/app/api/schema-mutate/`, `src/lib/gemini/schema-mutator.ts`, `src/components/editor/` |
| User Access & Permissions (FR18–24) | `src/app/api/claim/`, `src/app/api/invite/`, `src/lib/auth/`, `src/context/AuthContext.tsx` |
| Intake Forms (FR25–28) | `src/app/api/intake/`, `src/app/forms/[slug]/`, `src/components/intake/` |
| Billing & Subscriptions (FR29–33) | `src/app/api/webhooks/stripe/`, `src/lib/stripe/`, `src/components/billing/` |
| Localization & Compliance (FR34–40) | `src/lib/i18n/`, `src/app/api/export/`, `src/components/shared/LanguageToggle.tsx` |
| Platform & Security (FR41–45) | `src/lib/schema/validator.ts`, `src/middleware.ts`, `public/manifest.json`, `tests/integration/rls-isolation.test.ts` |
| Schema Explainability (FR46–47) | `src/lib/gemini/schema-generator.ts` (emits `reason`), `src/components/generation/ReasonBadge.tsx`, `org_schemas` JSON |
| Data Import (FR48–52) | `src/app/api/import/`, `src/lib/import/`, `src/components/import/`, `src/hooks/useImport.ts` |
| Billing — Usage Metering (FR53–55) | `src/app/api/cron/`, `src/app/api/usage/`, `src/lib/billing/`, `src/components/billing/UsageMeter.tsx` + `SpendCapSettings.tsx` |
| Growth traceability (FR56–61) | Not built at MVP; substrate reserved: `public.org_activity_log`, `src/lib/billing/metering.ts` counts feed it — see §Data Architecture |
| Phase-3 traceability (FR62–69) | Neither MVP nor Growth; only the MVP seams exist: `src/lib/data/mutate.ts` (guarded RLS-scoped writes), `lib/` logic callable out-of-band, action-allowlist model from `src/lib/schema/validator.ts` — see §Forward-Compatibility Seams |

**Cross-Cutting Concern Locations:**

| Concern | Locations |
|---|---|
| Auth context | `src/context/AuthContext.tsx`, `src/lib/auth/session.ts`, `src/middleware.ts` |
| Tenant isolation | Platform migration (`records` RLS + `auth_org_ids()` — created once, not at runtime), `src/lib/data/mutate.ts` (RLS-scoped writes), `tests/integration/rls-isolation.test.ts` (gate) |
| i18n | `src/lib/i18n/`, `src/hooks/useLanguage.ts`, `src/components/shared/LanguageToggle.tsx` |
| Error handling | `src/types/api.ts` (AppError), `src/components/shared/ErrorBoundary.tsx` |
| Optimistic UI | All `src/components/dashboard/` mutations via TanStack Query pattern |

---

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:**
All technology choices are version-compatible. Next.js 16 + Supabase JS 2.105.4 + TanStack Query 5 + next-intl 4 + Framer Motion 12 + shadcn/ui (New York) are known-good combinations in 2026. Gemini `@google/genai` 2.4.0 (unified Google AI SDK, ships Node CJS fallback — no ESM-only interop issue with Next.js webpack) is server-only, with no client-side import risk. Stripe server (v22) and client (v9) are version-matched to the current SDK split.

**Pattern Consistency:**
All patterns align with the Next.js App Router model. Server Components for static layout; Client Components for real-time/interactive surfaces. TanStack Query handles server state consistently. The `ApiResponse<T>` envelope is used uniformly. Naming conventions are internally consistent across DB, API, and TypeScript layers.

**Structure Alignment:**
The feature-based directory structure maps directly to FR categories. Every cross-cutting concern has a single canonical location. The `lib/` layer cleanly separates third-party integrations from application logic. Test categories (unit/integration/e2e) map to the three validation gates (unit logic, RLS isolation, full flow).

### Requirements Coverage Validation

**Functional Requirements Coverage:**

All 55 MVP FRs are architecturally supported; the 6 Growth-phase FRs (FR56–61) are traced
with a reserved substrate (activity logging) but intentionally not built at MVP; and the 8
Phase-3 FRs (FR62–69) are traced to the Forward-Compatibility seams but are neither MVP
nor Growth scope:
- FR1–FR5 (App Generation): `api/generate/` pipeline + Gemini + Schema Validator + fallback
- FR6–FR12 (Data Management): DataTable/CardList + RecordForm + Supabase Realtime
- FR13–FR17 (Conversational Editor): `api/schema-mutate/` + append-only Validator + SchemaDiffPreview
- FR18–FR24 (Auth/Permissions): Supabase Auth magic links + role metadata + admin gate in all schema routes
- FR25–FR28 (Intake Forms): `api/intake/[slug]/` + public `forms/[slug]/page.tsx` + Realtime push + Resend email (FR28 email-only MVP; no VAPID/web push infrastructure)
- FR29–FR33 (Billing): Stripe Checkout + Customer Portal (base + metered price) + webhook handler + subscription_status cache
- FR34–FR40 (Localization/Compliance): next-intl + `api/export/` + PIPEDA consent in ClaimFlow + cascade delete via Stripe webhook
- FR41–FR45 (Platform/Security): PWA manifest + Schema Validator + RLS isolation test + Sentry logging
- **FR46–FR47 (Schema Explainability):** `reason` emitted by `schema-generator.ts`, surfaced via `ReasonBadge.tsx` at generation; override reuses append-only hide
- **FR48–FR52 (Data Import):** `api/import/{analyze,commit}` + `lib/import/*` + `MappingPreview` + Gemini mapping + non-destructive replace
- **FR53–FR55 (Usage Metering):** `lib/billing/metering.ts` + `api/cron/report-usage` + `UsageMeter` + `assertUnderCap` spend-cap guard
- **FR56–FR61 (Growth, traced not built):** reserved `org_activity_log` substrate; workflow execution engine, suggestion layer, learned patterns, and Business Snapshot are Growth-phase (see §Data Architecture and Areas for Future Enhancement)
- **FR62–FR69 (Phase 3 — Autonomous Operations, traced not built):** the autonomous operator, per-action-type trust threshold, digital-crew roles (FR68), and connected external tools via MCP (FR69) are gated on proven retention + records-growth; the MVP claims only the Forward-Compatibility seams (guarded mutation layer, authoritative event stream, out-of-band worker seam, action-allowlist generalization) — see §Forward-Compatibility Seams

**Non-Functional Requirements Coverage:**

- NFR-P1 (< 45s TTV): Gemini timeout 15s + provisioning < 5s + skeleton reveal = within budget
- NFR-P4/P5 (optimistic UI, real-time < 2s): TanStack Query optimistic updates + Supabase Realtime
- NFR-P6 (< 300ms language toggle): next-intl client-side bundle swap (no network call)
- **NFR-P7 (import ≤5,000 rows < 60s, preview < 5s):** server-side parse + bounded Gemini mapping + bulk transactional insert
- **NFR-P8 (Growth — async suggestions never block CRUD):** workflow suggestions computed off the request path; not built at MVP, noted for Growth
- NFR-S1–S6 (security): TLS via Vercel, AES-256 via Supabase, RLS + CI test, Validator, system prompt, CI lint gate
- NFR-SC1–SC3 (scalability): Vercel auto-scaling + explicit 20-table/50K-row upgrade prompt
- NFR-A1–A4 (accessibility): shadcn/ui Radix primitives, 48×48px targets, schema-derived ARIA labels, visible form labels
- NFR-R1–R4 (reliability): CRUD independent of LLM, fallback schema at timeout, subscription_status cached
- **NFR-R5 (usage reconciliation ±1%):** `reconcile-usage` cron compares reported vs. live counts, Sentry-alerts and blocks the next report on drift
- **NFR-FC1 (guarded, RLS-scoped mutation layer):** all tenant writes route through `src/lib/data/mutate.ts` under the user's org-scoped RLS client; service role never writes tenant rows (see §Forward-Compatibility Seams, §Authentication & Security)
- **NFR-FC2 (authoritative append-only event stream):** `org_activity_log` (Growth) is a monotonic per-org sequence read via a replayable cursor; Realtime/`NOTIFY` is a wake-up hint only (see §Data Architecture)
- **NFR-FC3 (out-of-band compute seam):** tenant logic lives in `lib/` callable by a route or a future worker; MVP already exercises the shape via `CRON_SECRET`-protected Vercel Cron routes
- **NFR-FC4 (action-allowlist generalization):** the Schema Validator allowlist model is the reference pattern for a future real-world action allowlist, logged before/after execution

**Decision Completeness:** All 14 MVP systems have documented technology choices with verified package versions. LLM integration, Schema Validator, RLS strategy, auth flows, data import, and usage metering are fully specified with code patterns.

**Structure Completeness:** Complete project tree with 80+ named files/directories. All integration points documented. API boundaries explicit. Requirements mapped to specific file locations.

**Pattern Completeness:** Naming conventions for DB, API, and TypeScript are comprehensive with examples. All major patterns (CRUD, auth, real-time, LLM call, Validator) have mandatory code templates.

### Gap Analysis Results

**No Critical Gaps** — all blocking implementation decisions are documented.

**Minor Gaps (non-blocking, addressable in implementation):**
- PWA service worker caching strategy deferred — install prompt works without a SW caching strategy at MVP
- `next-pwa` vs manual service worker not specified — implementation story can decide; both are acceptable
- Specific Stripe webhook event handling for `invoice.payment_failed` needs implementation detail (retry logic)
- Exact usage-report cron cadence (per-cycle vs. daily incremental) and the Stripe metered-price tiering (included allotment size, overage rate) are open PRD questions — the architecture supports either; values are configuration, not structure
- Import of very large files (near the 5,000-row ceiling) may need streamed parsing; `parser.ts` should stream rather than buffer the whole file to hold NFR-P7
- Confidence threshold for flagging a column as `unmapped` (FR51) is a tunable — start conservative (flag more) to protect real data

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed
- [x] Technical constraints identified
- [x] Cross-cutting concerns mapped

**Architectural Decisions**
- [x] Critical decisions documented with versions
- [x] Technology stack fully specified
- [x] Integration patterns defined
- [x] Performance considerations addressed

**Implementation Patterns**
- [x] Naming conventions established
- [x] Structure patterns defined
- [x] Communication patterns specified
- [x] Process patterns documented

**Project Structure**
- [x] Complete directory structure defined
- [x] Component boundaries established
- [x] Integration points mapped
- [x] Requirements to structure mapping complete

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High

**Key Strengths:**
- Security architecture is layered and non-negotiable: system prompt → Schema Validator → RLS → Sentry
- Generative pipeline is well-bounded with explicit fallback at two failure modes
- Multi-tenancy is foundational and total: one static, membership-based RLS policy on one `records` table — no per-table policy to forget, no runtime RLS creation, one isolation guarantee to prove
- The generative engine produces *metadata + rows*, never SQL/DDL — collapsing the largest security surface (LLM→DDL), the migration-engineering burden, and provisioning latency in a single decision
- All 55 MVP FRs map to specific files and API routes; the 6 Growth FRs are traced to a reserved substrate
- Import and metering reuse existing seams (Gemini generation for column mapping; a single `assertUnderCap` guard on every insert) rather than adding parallel systems
- Gemini remains the LLM (PRD's OpenAI/Groq mention superseded) — architecture is LLM-agnostic at the boundary, Schema Validator is the contract
- Off-the-shelf mandate honored: Stripe Portal, Supabase Auth, shadcn/ui defaults throughout
- Forward-compatible without over-building: the Phase-3 operator is kept alive as four cheap MVP seams (guarded RLS-scoped mutation layer, authoritative event stream, out-of-band worker seam, action-allowlist generalization) rather than premature agent infrastructure — the security fence extends to real-world actions instead of being rebuilt

**Areas for Future Enhancement (Growth phase):**
- **Tenant activity logging** (FR56) — append-only per-tenant event log; the sequenced-first substrate for the three features below
- **Workflow execution engine** (FR59) — trigger/action rules on DB events; prerequisite for the suggestion layer
- **Workflow suggestion layer** (FR57–58) — per-tenant pattern watcher proposing workflows in plain language
- **Learned patterns per tenant** (FR60) — the compounding moat; feeds future suggestions and schema refinements
- **Business Snapshot export** (FR61) — owner-facing report over the activity log
- **Data Import Tier 2** — pre-built export mappings (Jobber, Housecall Pro, ServiceTitan, QuickBooks)
- Full schema mutation in the editor (delete, rename, restructure) — now a low-cost metadata feature under the record store, not a migration-pipeline build; gated to Growth only to hold MVP UX scope
- Redis-backed rate limiting and caching layer
- Multi-region Supabase for international expansion
- Custom RBAC beyond Admin/Member
- Offline PWA service worker caching strategy
- GraphQL layer for complex frontend data fetching
- **Phase 2:** retail/hospitality POS integration + live two-way API sync (Tier 3) — reuses the CSV/mapping engine; new connectors, not new architecture
- **Phase 3 — Autonomous Operations ("the digital employee," FR62–69):** an always-on per-tenant operator that graduates per-action-type from propose→approve→autonomous (money-spending and customer-facing actions gated longest), presented as independently-governed digital-crew roles (bookkeeping / sales / operations) over one shared per-tenant memory, acting beyond owned data through connected external tools (email, search/SEO, messaging) via a standard protocol such as **MCP**. Governed by CASL (commercial-message consent) + PIPEDA (transparency for automated actions and external data sharing). Builds on the Growth substrate (activity log = senses, execution engine = hands, learned patterns = memory) and the MVP Forward-Compatibility seams — **no new data assets, only a new use of existing ones.** Runtime is a deferred decision (cron+durable-queue / managed agent runner / persistent worker; Hermes-style harness a candidate). Gated on proven week-4 retention ≥30% and month-over-month records-under-management growth across ≥2 consecutive cohorts — a documented direction until then, not a build

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use `ApiResponse<T>` envelope for every route handler
- Run Schema Validator on every schema-metadata operation before persisting to `org_schemas` — no exceptions (no DDL is generated)
- Never import `SUPABASE_SERVICE_ROLE_KEY` outside `src/lib/supabase/server.ts`
- Use `normalizeTableName()` on all user-provided names
- Rely on the single static RLS policy on `records` (membership-based) — never create per-table or runtime RLS
- Use the optimistic update TanStack Query pattern for all CRUD mutations
- Use `callGeminiWithTimeout()` with `HARDENED_SYSTEM_PROMPT` on every Gemini call

**First Implementation Priority:**

```bash
# Story 1: Project initialization
npx create-next-app@latest snapbusy \
  --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack

npx shadcn@latest init --style new-york --base-color zinc --css-variables
```

Subsequent implementation order:
1. Supabase project setup + platform schema migrations (incl. `records`, `org_schemas`, `org_members`, `auth_org_ids()`, single `records` RLS policy) + membership-based RLS isolation test (blocking gate)
2. Auth flow (anonymous session → magic link → claim → PIPEDA consent)
3. Generation pipeline — single Gemini call → { schema, seedRows } → Validator (metadata) → provisioner (org_schemas upsert + seed `records`), emitting explainability `reason` (FR46–47)
4. Dynamic UI renderer (DataTable + CardList + RecordForm from schema) + `ReasonBadge`
5. **Data import (CSV/Excel + AI column mapping)** — primary activation event; `assertUnderCap` guard lands here alongside the insert path
6. **Usage metering** — `org_usage`/`org_billing_settings` tables, cron report + reconcile, live meter, spend cap (cheap now, expensive to retrofit)
7. Conversational Editor (append-only, Schema Validator gate)
8. Real-time sync (Supabase Realtime + TanStack Query cache)
9. EN/FR toggle (next-intl)
10. Intake form generator
11. Stripe billing integration (base + metered price; Checkout + Portal + webhooks)
12. PWA setup + PIPEDA compliance (export, offboarding cascade)

> **Build-priority note:** the PRD ranks usage metering and schema explainability as
> low-effort MVP items to land early (cheap now, expensive to retrofit once customers sit
> on legacy plans); import is the medium-effort primary-activation gate. Items 5–6 are
> pulled forward accordingly.
