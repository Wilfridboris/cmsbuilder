# SnapBusy

Describe your business and get a working, Ontario-localized dashboard in
seconds. This repository is the Next.js App Router application scaffolded in
**Story 1.1 (Project Scaffold & Toolchain)**. Only the foundation exists yet —
no data model, LLM pipeline, or dashboard (those are later Epic 1 stories).

## Stack

- **Framework:** Next.js 16 (App Router, `src/` dir, `@/*` → `src/*`, no Turbopack)
- **Language:** TypeScript (strict)
- **Styling:** Tailwind CSS v4 + shadcn/ui (New York style, zinc base color, CSS variables)
- **i18n:** next-intl (EN default, FR) — every user-facing string resolves through `useTranslations()`
- **Testing:** Vitest (`.test.ts` = unit/integration, `.spec.ts` reserved for e2e)
- **Lint gates:** legacy `.eslintrc.json` — fails the build if `SUPABASE_SERVICE_ROLE_KEY`
  appears in client-bundled code, or if a hardcoded user-facing string bypasses the
  translation layer in `src/` components.

Pinned runtime libraries (Supabase JS + SSR, `@google/genai`, Stripe, Resend,
Framer Motion, React Hook Form, Zod + resolvers, react-swipeable, TanStack Query,
papaparse, xlsx, Sentry) are installed at the exact versions from the architecture
document but are not yet wired — later stories own their integration.

## Getting started

```bash
npm install
cp .env.example .env.local   # then fill in real values locally (never commit)
npm run dev
```

Open <http://localhost:3000>.

## Scripts

| Script               | Purpose                                                        |
| -------------------- | ------------------------------------------------------------- |
| `npm run dev`        | Start the dev server                                          |
| `npm run build`      | Production build                                              |
| `npm run type-check` | `tsc --noEmit` — zero type errors                             |
| `npm run lint`       | ESLint (legacy config) — includes the two CI safety gates     |
| `npm run test`       | Vitest unit/integration suite                                 |
| `npm run test:rls`   | RLS isolation gate — runs against the hosted Supabase test project |
| `npm run db:reset`   | `supabase db reset` — apply migrations to the local DB         |
| `npm run db:push`    | `supabase db push` — apply migrations to the linked project    |
| `npm run db:diff`    | `supabase db diff` — inspect pending schema changes            |

## Environment variables

Copy `.env.example` to `.env.local` and fill in real values. Server-only secrets
(e.g. `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`) must
never be `NEXT_PUBLIC_`-prefixed and never imported into client components — the
lint gate blocks the service-role key from client-bundled code. `.env.local`,
`.env*.local`, and `.env.production` are git-ignored; only `.env.example`
(placeholders) is committed.

## Internationalization

Locale is resolved from the `NEXT_LOCALE` cookie (default `en`), with catalogs in
`src/lib/i18n/en.json` and `src/lib/i18n/fr.json`. To preview French before a
language toggle ships (Story 1.7 area), set the cookie in the browser console and
reload:

```js
document.cookie = "NEXT_LOCALE=fr; path=/";
```

## Manual external-account steps (human action required)

The agent scaffolds all config but does **not** perform external side effects
that require your accounts. Complete these to satisfy the "Vercel preview deploy
produced" acceptance criterion and to run the app against live services.

### 1. GitHub repository

The app lives at the repository root, pushed to `origin`
(`github.com/Wilfridboris/cmsbuilder`) on the `main` branch. CI runs on every push
and pull request.

### 2. Link the Vercel project and set environment variables

1. `npm i -g vercel && vercel link` (run at the repository root).
2. In the Vercel dashboard, set every variable from `.env.example` with real
   values for the **Production** and **Preview** environments.
3. Add these GitHub repository secrets so `.github/workflows/deploy.yml`
   activates (until then the deploy job self-skips):
   - `VERCEL_TOKEN` — a Vercel access token
   - `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID` — from `.vercel/project.json` after `vercel link`
4. Open a pull request: the deploy workflow produces a **preview URL**; merging
   to `main` deploys **production**.

> **Note:** Vercel Cron schedules (usage reporting / reconciliation) are added to
> `vercel.json` in **Epic 7**, alongside the `/api/cron/*` routes they invoke.
> They are intentionally omitted now so a production deploy does not hit routes
> that don't exist yet.

### 3. Create the Supabase project (ca-central-1 — PIPEDA)

1. Create a Supabase project in the **ca-central-1** region (do not change the
   region — Canadian data residency is a compliance requirement).
2. Copy the project URL and anon key into `NEXT_PUBLIC_SUPABASE_URL` /
   `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and the service-role key into
   `SUPABASE_SERVICE_ROLE_KEY` (server-only).
3. Apply the platform schema (Story 1.2). The migration lives in
   `supabase/migrations/`. Link the project (`supabase link --project-ref <ref>`)
   then `npm run db:push`, or apply the SQL through the Supabase SQL editor. It
   creates `organizations`, `org_members`, `records`, `org_schemas`, the
   `auth_org_ids()` resolver, the membership RLS policy, and the
   `org_active_record_counts` billable-unit view.
4. Seed the walking-skeleton demo data so `/demo` renders. `src/lib/data/seed.ts`
   exports `seedDemo()` (upserts a fixed demo org + schema and seeds rows through
   the guarded write layer under the admin client). Invoke it from a one-off
   server script or a Node REPL with the service-role env set; it is idempotent
   and safe to re-run.

### 4. Create the Supabase RLS **test** project (ca-central-1) and set CI secrets

The RLS isolation test (`tests/integration/rls-isolation.test.ts`) is a **hard CI
gate** that runs against a real, dedicated Supabase **test** project — never
production. The agent authored the migration, the `test:rls` script, and the CI
step; you must provision the project and set the secrets:

1. Create a **separate** Supabase project in **ca-central-1** for testing only.
2. Apply the same platform migration (`supabase/migrations/`) to it.
3. Add these three GitHub **repository secrets** (Settings → Secrets and
   variables → Actions) so the CI RLS step enforces isolation on every push/PR:
   - `SUPABASE_TEST_URL`
   - `SUPABASE_TEST_ANON_KEY`
   - `SUPABASE_TEST_SERVICE_ROLE_KEY`
4. For local runs, put the same three values in a git-ignored `.env.test.local`
   at the repo root, then `npm run test:rls`.

> The test seeds unique orgs/users per run and cleans up afterward, so it is safe
> to re-run against the shared test project. The test service-role key is used
> only inside the test to seed data and never reaches a client bundle. Until the
> secrets are set, the CI step self-skips rather than failing the build.

## Project structure

The full target tree (per `architecture.md`) is stubbed out with placeholder
directories. Paths owned by later stories (`src/lib/data/mutate.ts`,
`src/lib/gemini/client.ts`, `src/lib/schema/validator.ts`, etc.) contain no
business logic during Story 1.1.
