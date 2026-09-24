---
project_name: 'SnapBusy'
user_name: 'Boris'
date: '2026-05-18'
sections_completed: ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 58
optimized_for_llm: true
---

# Project Context for AI Agents

_Critical rules and patterns AI agents must follow when implementing code for SnapBusy. Focused on unobvious details agents might otherwise miss._

---

## Technology Stack & Versions

- **Next.js** 16 — App Router, TypeScript strict, `src/` dir, `@/*` alias, `--no-turbopack`
- **Tailwind CSS** v4 (PostCSS) + **shadcn/ui** New York theme, zinc base, CSS variables
- **Supabase** JS client 2.105.4 + `@supabase/ssr` 0.10.3 — PostgreSQL, Auth, RLS, Realtime
- **Google Gemini** `@google/genai` 2.4.0 — model `gemini-2.0-flash`, server-side only
- **TanStack Query** 5.100.10 — server state only (no Redux/Zustand)
- **React Hook Form** 7.76.0 + **Zod** 4.4.3 + `@hookform/resolvers` 5.2.2
- **next-intl** 4.12.0 — EN/FR, client-side bundle swap, no page reload
- **Framer Motion** 12.38.0 + **react-swipeable** 7.0.2
- **Stripe** server v22.1.1 + client `@stripe/stripe-js` 9.5.0
- **Resend** 6.12.3 + **Sentry** `@sentry/nextjs` 10.53.1
- **Vercel** hosting + **Supabase ca-central-1** (AWS Canada — PIPEDA mandatory, never change region)
- **shadcn/ui init:** `npx shadcn@latest init --style new-york --base-color zinc --css-variables`

---

## Critical Implementation Rules

### Language-Specific Rules

- TypeScript strict mode is on — never use `any`; type every prop, return value, and API boundary explicitly
- Import alias `@/*` maps to `src/*` — always use it; never use relative `../../` paths across feature boundaries
- `'use client'` directive — omit on Server Components; add only when hooks or event handlers are present
- No ORM — use Supabase JS client directly; Prisma/Drizzle are incompatible with dynamic tenant schemas
- **Zod validation is mandatory at three boundaries:** form submission (before API call), API route input (top of handler before any logic), LLM output (via Schema Validator before any DDL)
- Validation timing: form fields → on blur (not on keystroke); form submit → Zod parse; API route → Zod parse at top
- Throw `AppError` (with `statusCode` + `userMessage`) in API routes; never expose raw error stacks, SQL, or internal details to clients
- Date/time — ISO 8601 strings everywhere (`2026-05-17T19:00:00Z`); never Unix timestamps in user-facing APIs
- JSON field naming — `camelCase` in TypeScript interfaces, `snake_case` in DB columns and API bodies; Supabase JS client handles conversion automatically
- Constants → `SCREAMING_SNAKE_CASE` (e.g. `FALLBACK_SCHEMA`, `BLOCKED_KEYWORDS`, `HARDENED_SYSTEM_PROMPT`)
- Zod schemas → camelCase + `Schema` suffix (e.g. `schemaDefinitionSchema`, `orgMemberSchema`)

### Framework-Specific Rules

**Next.js / App Router**

- API routes live at `src/app/api/{feature}/route.ts`; always named `route.ts`
- Every route handler must follow this exact structure: authenticate session → validate input with Zod → business logic → return `ApiResponse<T>` envelope
- Standard response envelope — **always**: `{ data: T | null, error: string | null }`; success: `{ data: result, error: null }`; error: `{ data: null, error: "user-facing message" }`
- HTTP status codes: 200/201 success, 400 bad request, 401 unauthorized, 403 forbidden, 422 validation error, 500 server error — no custom codes
- Server Components for layout/static; Client Components (`'use client'`) for interactive/real-time surfaces only — minimize client bundle

**Supabase**

- **Tenant data model: shared JSONB record store, NOT physical tables per tenant.** ALL tenant rows live in ONE static `public.records (id, organization_id, table_key, data JSONB, created_at, updated_at, deleted_at)` table. A generated "table" is *logical* — a `table_key` + a field definition in `public.org_schemas (organization_id, definition JSONB)`. **There is NO runtime DDL** — the whole schema is Supabase CLI-migrated platform schema. Provisioning = insert an `org_schemas` row + seed `records`.
- Browser client (anon key, RLS-enforced) → `src/lib/supabase/client.ts`; **user-scoped** server client (anon key + user JWT via `@supabase/ssr` cookies, RLS-enforced) is the path for ALL tenant reads/writes; **service-role** server client → `src/lib/supabase/server.ts` is for NARROW platform-bootstrap ops ONLY (anonymous pre-claim generation, claim-time org bootstrap, cross-org cron, offboarding cascade)
- **NEVER write tenant rows with the service-role key** — all tenant writes go through the guarded mutation layer `src/lib/data/mutate.ts` under the caller's RLS-scoped client (NFR-FC1). `mutate.ts` MUST take identity as an explicit parameter — never call `cookies()`/read request state inside it (so an out-of-band worker can call it) — and MUST accept `actorId` + an optional `idempotencyKey` (retry-safety for future agent loops). `records` carries `actor_id` + a `version` (optimistic concurrency)
- `SUPABASE_SERVICE_ROLE_KEY` may only be imported inside `src/lib/supabase/server.ts` and API route files — never in `src/app/` components or client hooks
- `NEXT_PUBLIC_` prefix only for: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `STRIPE_PUBLISHABLE_KEY`, `SENTRY_DSN` — all other secrets are server-only, never `NEXT_PUBLIC_`
- **RLS is a SINGLE static, membership-based policy on `records`, created once in a platform migration — NEVER per-table, never at runtime.** `organization_id` is a real FK to `organizations.id` (**never a user UID**). Isolation: `USING (organization_id IN (SELECT auth_org_ids()))` where `auth_org_ids()` is a `SECURITY DEFINER` function returning the caller's org ids from `org_members`. This is what makes invited members (FR20–24) correctly see their org's rows. `org_members` carries a `principal_type` (`human | agent`) and `auth_org_ids()` is principal-agnostic, so a future Phase-3 agent is just another org-scoped member subject to the same RLS — never a service-role backdoor.

**TanStack Query**

- Use TanStack Query for all server state — no `useState` + `useEffect` for data fetching
- All CRUD mutations must use the optimistic update pattern: `cancelQueries` → `setQueryData` optimistically → `onError` rollback → `onSettled` invalidate
- Supabase Realtime updates TanStack Query cache via `invalidateQueries` — never call `setQueryData` directly in complex Realtime handlers

**Gemini**

- Every Gemini call must use `callGeminiWithTimeout()` from `src/lib/gemini/client.ts` with `HARDENED_SYSTEM_PROMPT` — no bare `ai.models.generateContent()` calls
- Timeout is 15 seconds via `Promise.race` + `AbortController`; retry once on failure; deploy `UNIVERSAL_FIELD_SERVICE_TEMPLATE` on second failure or timeout
- Model is always `gemini-2.0-flash`; output always uses `responseMimeType: "application/json"` + `responseSchema`
- `@google/genai` 2.4.0 is server-side only — never import in client components or hooks
- `'relation'` field type is explicitly excluded from MVP FieldType — do not generate or accept FK/relation fields
- Generation uses ONE structured call returning `{ schema, seedRows }` together (not two sequential calls); a malformed `seedRows` section must not invalidate a valid schema

**Schema Validator**

- Schema Validator (`src/lib/schema/validator.ts`) must run synchronously on every LLM-proposed **schema-metadata operation** before it is persisted to `org_schemas` — no exceptions, no bypasses. **It validates a JSON metadata shape; NO SQL/DDL is ever generated in this architecture**, so its job is structural, not SQL-injection defense
- Permitted operations: `add_table`, `add_field`, `add_view` only (MVP append-only)
- Reject field/`table_key` names colliding with reserved record columns: `id`, `organization_id`, `table_key`, `data`, `created_at`, `updated_at`, `deleted_at`
- Blocked keywords (defense-in-depth on names): `DROP`, `GRANT`, `TRUNCATE`, `DELETE`, `EXEC`, `--`, `;`, `/*`
- All Schema Validator rejections must be logged to Sentry with `organization_id` + raw LLM output

**i18n**

- All UI strings must use `useTranslations()` from next-intl — no hardcoded English strings in components
- Language toggle stored in `localStorage`; locale change via `setLocale()` from next-intl — no page reload, no API call
- Synthetic data generation detects language from the user's prompt at submission time

**Auth & RBAC**

- Two roles only: `admin` | `member` stored in `auth.users.user_metadata` as `{ role: "admin" | "member" }`
- Account creator is always `admin`; role is set at invite time
- Every schema-mutation API route must independently verify role from JWT — frontend role hiding is not sufficient
- Pre-claim session: `localStorage` + `sessionStorage` for anonymous generation state; `anonymous_sessions` table with 24h TTL
- Post-claim: Supabase JWT session via `@supabase/ssr` cookie-based refresh in `src/middleware.ts`

**Stripe**

- Use Stripe-hosted surfaces only (Checkout + Customer Portal) — no custom billing UI
- `subscription_status` in Supabase user record is source of truth; Stripe status is cached, not authoritative
- Always verify webhook signatures with `stripe.webhooks.constructEvent` before processing

### Testing Rules

- Test structure: `tests/unit/` for logic, `tests/integration/` for RLS and pipeline, `tests/e2e/` for full flows
- **`tests/integration/rls-isolation.test.ts` is a hard CI gate** — must pass before any tenant data is exposed to frontend; it must verify BOTH cases: an invited *member* of Org A CAN read Org A's `records`, and a *stranger* CANNOT (membership-based RLS, not user-UID equality)
- Schema Validator unit tests cover: allowlist (permitted operations only), blocklist (all 8 keywords), edge cases (mixed case, embedded keywords)
- Do not mock the Supabase database in integration tests — RLS policies must be verified against a real Supabase instance
- Unit tests for `normalizeTableName()` and `formatCurrency()` must cover empty strings, special characters, unicode, and leading/trailing underscores

### Code Quality & Style Rules

**Naming Conventions**

| Element | Convention | Example |
|---|---|---|
| Platform DB tables | `snake_case`, plural | `organizations`, `org_members` |
| Tenant-generated tables | `snake_case`, plural, via `normalizeTableName()` | `job_tracking`, `hvac_jobs` |
| DB columns | `snake_case` | `organization_id`, `created_at` |
| Foreign keys | `{table_singular}_id` | `organization_id`, `user_id` |
| RLS policy | single static policy on `records` | `"records_tenant_isolation"` |
| Logical table id | `snake_case` `table_key` (via `normalizeTableName`) | `jobs`, `hvac_jobs` |
| API route paths | `kebab-case`, plural nouns | `/api/schema-mutations` |
| Route parameters | `[camelCase]` | `[tableId]`, `[slug]` |
| TypeScript types/interfaces | PascalCase | `SchemaDefinition`, `ApiResponse<T>` |
| Components | PascalCase file + default export | `DataTable.tsx` |
| Hooks | camelCase, `use` prefix | `useOrganization`, `useTableData` |
| Context | PascalCase + `Context` | `AuthContext`, `TenantContext` |
| Utility functions | camelCase | `normalizeTableName`, `buildSystemPrompt` |

**Table Name Normalization (mandatory):** Always call `normalizeTableName(input)` on all user-provided table or field names before persisting them as a `table_key` or field `key`. (There is no DDL — but normalized keys keep `records.data` and `org_schemas` consistent and safe.)

**Component boundaries:**
- `src/components/ui/` — shadcn/ui primitives only, never hand-edit these files
- `src/lib/supabase/` — Supabase client inits only; no business logic
- `src/lib/gemini/` — all Gemini calls go through here, never call Gemini directly from route handlers
- `src/lib/schema/` — schema-metadata validation, provisioning (org_schemas upsert + seed records), and metadata mutation — NO DDL
- `src/lib/data/` — `mutate.ts` (guarded, RLS-scoped tenant writes to `records`) and `records.ts` (JSONB query layer); the ONLY path for tenant row reads/writes

**Loading state hierarchy** (in order of priority):
1. Initial page load → shadcn `Skeleton` components (not spinners)
2. Generation arc → `useGenerationState` phases with custom skeleton animation
3. CRUD operations → optimistic UI only (no loading state shown)
4. Schema mutations → chat "thinking..." bubble
5. Stripe redirect → disabled button + "Redirecting..." text

### Development Workflow Rules

- `src/` directory separates source from config — all application code lives inside `src/`
- Environment variables: `.env.local` for dev (gitignored), Vercel project env vars for staging/production — never commit `.env.production`
- `.env.example` is committed with placeholder values only — never real secrets
- CI must run: lint (including custom ESLint rule that fails build if `SUPABASE_SERVICE_ROLE_KEY` appears in client bundle) + type-check + RLS isolation test
- GitHub Actions → Vercel preview deploy per PR, production deploy on merge to main
- The ENTIRE schema (platform + `records` + `org_schemas`) uses Supabase CLI migrations. There is NO runtime DDL — provisioning a tenant app is a metadata insert + seed rows, never `CREATE`/`ALTER TABLE`

### Critical Don't-Miss Rules

**Hard blocking rules — violating these breaks security or correctness:**

- Never import `SUPABASE_SERVICE_ROLE_KEY` outside `src/lib/supabase/server.ts` and API route files
- Never write tenant rows with the service-role key — all tenant writes go through `src/lib/data/mutate.ts` under the user's RLS-scoped client (NFR-FC1). Service role is bootstrap-only (anonymous generation, claim, cross-org cron, offboarding)
- Never persist an LLM schema-metadata operation without running Schema Validator first — no exceptions, even in tests
- Never create per-table or runtime RLS — isolation is ONE static membership-based policy on `records`; `organization_id` is an org FK, never a user UID
- Never expose raw LLM output, schema JSON, or error stack traces to the browser
- Never prefix server-only secrets with `NEXT_PUBLIC_`
- Never use the `relation` field type — it is explicitly excluded from MVP FieldType and the hardened system prompt must reject it
- Never skip `normalizeTableName()` on user-provided names before storing them as a `table_key` or field `key`
- Never call Gemini without `HARDENED_SYSTEM_PROMPT` — it must be included on every single call, not just some

**Anti-patterns to avoid:**

- Do not use `useState` + `useEffect` for data fetching — use TanStack Query
- Do not call `queryClient.setQueryData` directly in complex Realtime handlers — use `invalidateQueries`
- Do not add Redux, Zustand, or any other global state library — TanStack Query + React Context is the full state strategy
- Do not use Prisma, Drizzle, or any ORM — Supabase JS client only
- Do not create custom billing UI — Stripe-hosted Checkout and Customer Portal only
- Do not show error screens on LLM failure — silent retry then deploy fallback schema; CRUD must never depend on LLM availability
- Do not hardcode English strings in components — all UI text must go through `useTranslations()`
- Do not use spinners for initial page load — use shadcn Skeleton components
- Do not validate on every keystroke — validate on blur for fields, on submit for forms
- Do not store `subscription_status` from Stripe as authoritative — Supabase user record is source of truth

**Edge cases that must be handled:**

- Gemini returns malformed JSON → Schema Validator catches it; never let it reach Supabase
- Gemini times out at 15s → deploy `UNIVERSAL_FIELD_SERVICE_TEMPLATE` and set `isFallback: true` in response
- RLS violation → Supabase returns empty array (not 403); UI must show "No records found" not an error
- Anonymous session expiry (24h TTL) → generation state is lost; user must restart prompt flow
- `normalizeTableName()` on edge inputs: empty string, all special characters, leading/trailing underscores must all produce a valid identifier or throw `AppError`
- EN/FR toggle in synthetic data: language is detected from the user's original prompt, not the UI locale at generation time

---

## Usage Guidelines

**For AI Agents:**

- Read this file before implementing any code in this project
- Follow ALL rules exactly as documented — these are non-negotiable architectural decisions
- When in doubt, prefer the more restrictive option
- If a new pattern emerges during implementation, flag it for addition to this file

**For Humans:**

- Keep this file lean and focused on agent needs
- Update when technology stack or patterns change
- Remove rules that become obvious over time

_Last Updated: 2026-05-18_
