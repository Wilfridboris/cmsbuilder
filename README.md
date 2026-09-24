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
3. The database schema, RLS policy, and the RLS isolation CI gate are added in
   **Story 1.2** — nothing to migrate yet.

## Project structure

The full target tree (per `architecture.md`) is stubbed out with placeholder
directories. Paths owned by later stories (`src/lib/data/mutate.ts`,
`src/lib/gemini/client.ts`, `src/lib/schema/validator.ts`, etc.) contain no
business logic during Story 1.1.
