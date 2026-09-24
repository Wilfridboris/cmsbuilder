# Epic 1 Context: Foundation & the Generative "Aha" Moment

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Stand up the platform and deliver the product's core value end-to-end: an anonymous visitor describes their business through a guided prompt and, in under 45 seconds, lands in a fully interactive, Ontario-localized, data-populated dashboard — with a plain-language reason on every generated field and a one-tap override — before ever creating an account. This epic establishes the foundational architecture every later epic builds on: the app scaffold and pinned toolchain, the shared-JSONB tenant data model, membership-based row-level isolation, the guarded write layer, the LLM generation pipeline with hardened prompting and hard fallback, the schema validation gate, CI safety gates, and the i18n and metering seams. The finished epic stands alone as a public, shareable demo.

## Stories

- Story 1.1: Project Scaffold & Toolchain
- Story 1.2: Platform Data Model & Tenant Isolation (Walking Skeleton)
- Story 1.3: Guided "Mad Libs" Prompt Intake
- Story 1.4: AI Schema + Synthetic Data Generation (Ontario & French Localized)
- Story 1.5: Hard Fallback Template (No Error Screens)
- Story 1.6: Interactive Demo Dashboard (Pre-Account Browse & Basic Edit)
- Story 1.7: Schema Explainability & One-Tap Override

## Requirements & Constraints

- Prompt-to-interactive-dashboard must complete in under 45 seconds at p95; DB provisioning from a validated JSON schema in under 5 seconds.
- Generation is anonymous: no account, email, or payment is requested before the demo dashboard is shown and edited.
- Every generated view is pre-populated — the user never sees an empty/blank state.
- Synthetic seed data must be trade-specific and Ontario-localized (real street names, standard Ontario pricing, trade terminology), 5–8 rows per table. When the prompt is submitted in French, synthetic data and column names generate in French (language detected from the prompt, independent of UI locale).
- Generation must never surface an error screen. On failure the system retries once, then deploys a hardcoded universal fallback template; the user always lands on a working dashboard within the 30–45s window.
- Strict per-organization data isolation: no authenticated user may read or write another org's records. Row-level security must be verified by an automated test before any data is exposed to the frontend.
- 100% of LLM calls must include the hardened identity-masking system prompt. The service-role key must never appear in client-side bundles (enforced by CI).
- Core CRUD must not depend on the LLM — the LLM is only for schema generation and the conversational editor.
- Accessibility from the first component: WCAG AA contrast minimum, real (non-placeholder) form labels, ARIA labels derived from schema field names, 48×48px minimum touch targets.
- All user-facing strings must resolve through the i18n layer from the very first component (no hardcoded strings).
- Success criteria: the walking-skeleton pipeline (seed schema → records → live table) is proven before any LLM code exists; each generated table/field carries a one-line plain-language reason and a one-tap remove/rename at generation time.

## Technical Decisions

- **Scaffold (Story 1.1):** Initialize with `create-next-app@latest` using `--typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack`. Then initialize shadcn/ui (`--style new-york --base-color zinc --css-variables`) and install the pinned core dependency set (Supabase JS + SSR, `@google/genai`, Stripe, Resend, next-intl, Framer Motion, React Hook Form, Zod + resolvers, react-swipeable, TanStack Query, papaparse, xlsx, Sentry) at their specified versions. T3 Stack, Supabase starter, and custom-from-scratch were explicitly rejected.
- **Data model (authoritative — supersedes any "tables per tenant" language):** Tenant data uses a shared JSONB record store, NOT physical tables per tenant. All tenant rows live in one static `public.records (id, organization_id, table_key, data JSONB, actor_id, version, created_at, updated_at, deleted_at)`. A generated "table" is logical — a `table_key` plus a field-definition row in `public.org_schemas (organization_id, definition JSONB)`. There is NO runtime DDL: provisioning = insert an `org_schemas` row + seed `records`.
- **Isolation:** A single static, membership-based RLS policy on `records`, created once in a platform migration: `USING (organization_id IN (SELECT auth_org_ids()))`, where `auth_org_ids()` is a `SECURITY DEFINER` function reading the caller's org ids from `org_members`. `organization_id` is a real FK to `organizations.id` — never a user UID. `org_members` carries `principal_type` (`human | agent`).
- **Guarded write layer:** All tenant writes flow through a single mutation layer (`src/lib/data/mutate.ts`) under the caller's RLS-scoped client. It takes identity as an explicit parameter (never reads `cookies()`), accepts `actorId` + optional `idempotencyKey`, and uses `version` for optimistic concurrency. The service-role key is bootstrap-only (anonymous generation, claim, cross-org cron, offboarding); no code path writes tenant data with the raw service-role key.
- **Migrations & naming:** Entire schema (platform + `records` + `org_schemas`) is Supabase CLI-migrated. `normalizeTableName()` must be applied to all user-provided table/field names before persistence as `table_key`/field `key`.
- **LLM pipeline:** All calls go through `callGeminiWithTimeout()` (`src/lib/gemini/client.ts`) with the hardened system prompt on every call; model `gemini-2.0-flash`; 15s timeout via `Promise.race` + `AbortController`; retry once, then deploy the universal field-service template. Generation is ONE structured call returning `{ schema, seedRows }` using `responseMimeType: "application/json"` + `responseSchema`. The `relation` field type is excluded from MVP. A malformed `seedRows` section must not invalidate an otherwise-valid schema.
- **Schema Validator (`src/lib/schema/validator.ts`):** Runs synchronously on every LLM-proposed schema-metadata operation before persistence. Permitted ops (append-only): `add_table`, `add_field`, `add_view`. Rejects reserved-column collisions and blocked keywords (`DROP`, `GRANT`, `TRUNCATE`, `DELETE`, `EXEC`, `--`, `;`, `/*`); logs rejections to Sentry with `organization_id` + raw output.
- **Fallback:** On two consecutive failures (timeout, invalid JSON, or validator rejection), provision the hardcoded universal field-service template (Clients, Jobs, Invoices) pre-seeded with generic Ontario data, set `isFallback: true`, and show a subtle banner — never an error screen.
- **Response/error contract:** API routes follow authenticate → validate input with Zod → business logic → return `{ data, error }`. Use HTTP codes 200/201/400/401/403/422/500; throw `AppError` (statusCode + userMessage). Never expose raw stacks, SQL, schema JSON, or LLM output to the client.
- **CI gates:** Lint (including a custom rule that fails the build if the service-role key appears in a client bundle) + type-check + the RLS isolation test. `tests/integration/rls-isolation.test.ts` is a hard gate that must verify BOTH that an invited member of Org A CAN read Org A's records AND that a stranger CANNOT — run against a real Supabase instance, not mocked. Hosting on Vercel; database on Supabase ca-central-1 (PIPEDA — never change region); `.env.example` committed with placeholders only.
- **Forward-compatibility seams (build now, no agentic behavior ships):** All mutations flow through the single guarded action layer under a per-actor, org-scoped identity; a documented seam must exist for a future persistent/scheduled worker to invoke that layer out-of-band; future autonomous actions must be expressible as allowlist entries recorded before/after execution. Also bake the "active record" billable-unit definition (non-deleted rows counted per cycle) into the data model now so metering needs no later migration.

## UX & Interaction Patterns

- **Landing "conversation" screen:** Hyper-minimalist single-focus structured prompt — trade-type dropdown (HVAC, Plumbing, Roofing, Snow Removal, Landscaping, Electrical, General Contracting, Other), a city/town field, and a "what you track" field. No pricing tiers or feature lists above the fold. Validation runs on submit (not per keystroke) with accessible, translated inline messages.
- **Skeleton "grow-into-dashboard" transition:** During generation, skeleton screens organically animate into the real dashboard layout — no loading bar or spinner (shadcn `Skeleton` + Framer Motion).
- **No blank states:** Every generated view is pre-populated with synthetic data.
- **Demo edit scope:** Pre-account interaction is browse + open a record + basic in-place optimistic edit of demo data only, confined to the anonymous session. Full CRUD, delete, filter/sort, column-hide, and real-time sync are explicitly out of scope for this epic.
- **Schema explainability affordance:** An inline info icon on each AI-generated table/field shows its one-line reason (produced by the same generation call), with a one-tap Remove/Rename beside it — at generation time, not buried in settings. Removal uses the append-only hide mechanism (a frontend display flag); no destructive migration, and the field's definition and data remain intact.
- **Visual baseline:** MVP uses the shadcn New York / zinc CSS-variable theme. The bespoke palette and typography from the design doc are deferred to a later polish phase.

## Cross-Story Dependencies

- Story 1.2 (data model, RLS, `mutate.ts`, walking-skeleton pipeline) is the foundation for Stories 1.4–1.7 and must land before the LLM stories.
- Stories 1.4 (generation) and 1.5 (fallback) both provision into the `org_schemas` + `records` model and share the Gemini client and Schema Validator introduced in this epic.
- Story 1.6 renders whatever Story 1.4 or 1.5 provisioned; Story 1.7's explainability data is produced within the Story 1.4 generation call.
- The Gemini client, Schema Validator, and mapping-to-`org_schemas` lib built here are reused by Epic 4 (import) and Epic 5 (conversational editor); the guarded `mutate.ts` layer is reused by Epic 3.
- Pre-account schema overrides created in Story 1.7 are later carried into the live schema at claim time (Epic 2). This epic has no forward dependency on any later epic.
- Seams landed here (i18n, metering "active record" unit) are consumed later by Epic 8 (EN/FR toggle) and Epic 7 (Stripe metering) respectively.
