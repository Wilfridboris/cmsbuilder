---
title: 'Story 1.1: Project Scaffold & Toolchain'
type: 'chore'
created: '2026-09-23'
status: 'done'
route: 'dispatch'
baseline_commit: 'NO_VCS'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The SnapBusy repository is empty. Every later Epic 1 story (data model, LLM pipeline, dashboard) depends on a consistent, deployable, secure-by-default foundation with the exact mandated stack, i18n wiring, and CI safety gates — none of which exist yet.

**Approach:** Scaffold a Next.js App Router project with `create-next-app` + shadcn/ui, install the architecture's pinned dependency set, wire next-intl (EN/FR) so no user-facing string is hardcoded from the first component, and stand up GitHub Actions CI (lint + type-check) plus a Vercel-deploy workflow — including a lint gate that fails the build if the Supabase service-role key reaches a client bundle, and a committed `.env.example` with placeholders only.

## Boundaries & Constraints

**Always:**
- Initialize with the exact flags: `create-next-app@latest snapbusy --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --no-turbopack`, then `shadcn@latest init --style new-york --base-color zinc --css-variables`.
- Pin every dependency to the architecture's exact version strings (see Design Notes). Runtime deps and `@types/papaparse` as a devDep.
- All user-facing strings resolve through `next-intl` `useTranslations()`; an EN catalog (`src/lib/i18n/en.json`) and a FR catalog (`src/lib/i18n/fr.json`) both exist, locale files under `src/lib/i18n/`.
- ESLint (`.eslintrc.json`, legacy format) fails the build on (a) any occurrence of `SUPABASE_SERVICE_ROLE_KEY` in client-bundled code, and (b) a hardcoded user-facing string bypassing the translation layer in `src/` components.
- `.env.example` committed with placeholder values only; `.env.local`, `.env*.local`, and `.env.production` git-ignored and never committed with real values.
- `tsconfig.json` strict mode on; import alias `@/*` → `src/*`. Config files in TypeScript form (`next.config.ts`, `tailwind.config.ts` with `darkMode: 'class'`).

**Never:**
- Do not implement any Epic 1.2+ behavior — no data model, migrations, RLS policy, `mutate.ts` body, Gemini client, or Schema Validator logic. Scaffold only. Directory placeholders/stubs for those paths are acceptable but must contain no business logic.
- Do not commit real secrets or a `.env.production`.
- Do not create a GitHub remote, push, or link/deploy to Vercel or Supabase without explicit human action (external side effects requiring the human's accounts) — see resolved decisions.
- Do not swap the mandated stack (no T3, no Supabase starter, no from-scratch); do not add Turbopack; do not use flat ESLint config.

**Decisions (resolved):**
- **Test runner: Vitest** — configure Vitest with a `tests/unit/` smoke test; `.test.ts` for unit/integration, `.spec.ts` reserved for e2e. Story 1.2's RLS isolation test will build on this.
- **Infrastructure scope: config-only + documented manual steps** — the agent creates all workflow/config files (`ci.yml`, `deploy.yml`, `vercel.json`) and a README of manual steps, and MAY run `git init` locally, but does NOT create a GitHub remote, push, or link/deploy Vercel or Supabase. The "Vercel preview deploy produced" AC is satisfied by committed config plus documented human steps.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Fresh scaffold builds | Clean checkout, `npm install` | `npm run build` and `npm run type-check` succeed with zero errors | N/A |
| Service-role key in client code | A client component references `SUPABASE_SERVICE_ROLE_KEY` | `npm run lint` fails with a clear rule violation | Build blocked (non-zero exit) |
| Hardcoded UI string | A `src/` component renders literal user-facing text not via `useTranslations()` | `npm run lint` fails | Build blocked (non-zero exit) |
| i18n render | Home page renders with locale EN, then FR | All visible strings resolve from the active catalog; no literals | N/A |
| `.env` hygiene | Repo checked out | `.env.example` present with placeholders; no real `.env*.local`/`.env.production` tracked | N/A |

</frozen-after-approval>

## Code Map

Greenfield — no application code exists. Relevant existing files are planning artifacts only:
- `_bmad-output/planning-artifacts/architecture.md` -- authoritative source for pinned versions, directory tree (lines ~1018–1219), env-var list (~695–712), CI workflow intent (~1031–1034), ESLint service-role rule (~364). Architecture supersedes `docs/stack.md` (older "DashForge" doc — do not use its OpenAI/Groq or runtime-DDL guidance).
- `_bmad-output/implementation-artifacts/epic-1-context.md` -- distilled epic constraints; the shared-JSONB data model and Gemini pipeline it names belong to later stories, not this one.
- Prescribed target structure to establish (create dirs; stub only where a later story owns the logic): `src/app/`, `src/components/{ui,generation,import,dashboard,editor,auth,intake,billing,layout,shared}/`, `src/lib/{data,gemini,schema,supabase,import,billing,stripe,resend,auth,i18n}/`, `src/{hooks,context,types}/`, `tests/{unit,integration,e2e}/`, `public/icons/`, `.github/workflows/`.

## Tasks & Acceptance

**Execution:**
- [x] `package.json` / project root -- run `create-next-app@latest snapbusy` with the exact flags into the working directory, then `shadcn@latest init` with the exact flags -- establishes the mandated framework baseline.
- [x] `package.json` -- install the pinned dependency set at exact versions (runtime + `@types/papaparse` devDep) per Design Notes; add scripts: `lint`, `type-check` (`tsc --noEmit`), `test`, `build` -- locks the toolchain.
- [x] `tsconfig.json` -- confirm strict mode + `@/*`→`src/*` alias -- foundation for all imports.
- [x] `next.config.ts`, `tailwind.config.ts` -- TS config; `darkMode: 'class'`; wire the next-intl plugin -- framework + theming baseline.
- [x] `src/lib/i18n/config.ts`, `src/lib/i18n/en.json`, `src/lib/i18n/fr.json`, `src/middleware.ts` -- next-intl routing/locale-detection config (default locale EN, locales en/fr), seed catalogs with the home-page strings -- i18n seam.
- [x] `src/app/layout.tsx`, `src/app/page.tsx` -- minimal home page rendering all text via `useTranslations()` (proves the i18n seam; no product UI) -- smallest end-to-end proof.
- [x] `.eslintrc.json` -- legacy-format config extending Next core-web-vitals; add rule (a) forbidding `SUPABASE_SERVICE_ROLE_KEY` in client-bundled code, and rule (b) failing on hardcoded user-facing strings in `src/` components -- CI safety gates (see Design Notes for chosen mechanisms).
- [x] `.env.example` -- commit with all named env vars as placeholders (server-only + `NEXT_PUBLIC_*`, see Design Notes) -- secret hygiene.
- [x] `.gitignore` -- ensure `.env.local`, `.env*.local`, `.env.production`, `node_modules`, `.next`, coverage/test artifacts are ignored -- secret hygiene.
- [x] `.github/workflows/ci.yml` -- on PR/push: install, `lint`, `type-check` (RLS test step added in Story 1.2; leave a documented placeholder, do not fail on missing test) -- CI gate.
- [x] `.github/workflows/deploy.yml`, `vercel.json` -- Vercel preview + production deploy workflow and config (activates once the human links the Vercel project) -- deploy pipeline.
- [x] `vitest.config.ts` + one trivial smoke test in `tests/unit/` -- install and configure Vitest; wire `npm run test` -- proves the test harness runs green in CI.
- [x] `README.md` -- document the manual external-account steps (create GitHub repo + push, link Vercel project & set env vars, create Supabase project) needed to satisfy the "preview deploy produced" AC -- handoff for infra the agent cannot perform.

**Acceptance Criteria:**
- Given a clean checkout, when `npm install && npm run build && npm run type-check` runs, then all succeed with zero errors.
- Given the scaffolded app, when the home page renders, then every user-facing string resolves through `next-intl` with both EN and FR catalogs present, and switching the active locale swaps all visible text.
- Given a `src/` client file that references `SUPABASE_SERVICE_ROLE_KEY`, when `npm run lint` runs, then the build fails.
- Given a `src/` component with a hardcoded user-facing string, when `npm run lint` runs, then the build fails.
- Given the repository, when inspected, then `.env.example` exists with placeholders only and no real secret or `.env.production` is tracked, and `.github/workflows/ci.yml` runs lint + type-check.

## Implementation Notes

**Scaffold lives in `snapbusy/` subfolder.** `create-next-app@latest snapbusy` was run from the repo root, producing the project under `snapbusy/` (matching architecture.md's directory tree whose root is `snapbusy/`). The existing repo-root tooling (`_bmad`, `_bmad-output`, `docs`, `.github/agents`) is untouched. CI/deploy workflows use `working-directory: snapbusy` and `cache-dependency-path: snapbusy/package-lock.json`.

**Resolved toolchain versions (create-next-app@latest defaults):** `next@16.3.6`, `react@19.2.8`, `react-dom@19.2.8`, `typescript@^5`, `tailwindcss@^4`. `@types/node` was bumped from the scaffold default `^20` to `^24` because Vitest 5 requires `@types/node >=22`.

**Lint gate mechanisms (as required by Design Notes):**
- (a) Service-role key: custom `no-restricted-syntax` rules (error) in `.eslintrc.json` matching the `process.env.SUPABASE_SERVICE_ROLE_KEY` member expression plus any `Identifier`/`Literal` named `SUPABASE_SERVICE_ROLE_KEY`. Turned OFF via an `overrides` block for server-only paths: `src/app/api/**`, `**/*.server.ts`, `src/lib/supabase/server.ts`, `src/lib/{billing,stripe,resend}/**`, `src/lib/data/mutate.ts`, `src/middleware.ts`. `eslint-plugin-no-secrets` was NOT used (a targeted AST rule is more precise and needs no extra dep).
- (b) Hardcoded strings: `eslint-plugin-i18next@6.1.4`, rule `i18next/no-literal-string` (error), scoped via `overrides` to `src/components/**` and `src/app/**` in `mode: "jsx-text-only"` with JSX attributes and call arguments excluded (avoids false positives on technical attributes/props). Excluded: `src/app/api/**`, `*.server.ts`, and test/spec files.
- Both gates were spot-checked: temporary offending files caused `npm run lint` to exit non-zero; the same references inside server-only files did not.

**ESLint format decision (deviation rationale).** The spec mandates legacy `.eslintrc.json` and forbids flat config. Next 16 ships `eslint-config-next` as flat-config-only (its `core-web-vitals` export is a flat array, unusable from `.eslintrc.json`), and `next lint` is removed. To honor the legacy-format directive AND keep the Next rules functional, `.eslintrc.json` extends `plugin:@next/next/core-web-vitals-legacy` (the legacy config the `@next/eslint-plugin-next` package ships for exactly this case) and wires `@typescript-eslint/parser` + the react/react-hooks/jsx-a11y/typescript-eslint recommended sets directly (parity with what `next/core-web-vitals` + `next/typescript` provided). ESLint 9 runs in legacy mode via `ESLINT_USE_FLAT_CONFIG=false` (set in the `lint` script through `cross-env` for cross-platform CI). `eslint.config.mjs` from the scaffold was deleted.

**next-intl wiring (no URL locale prefix).** Per architecture.md ("client-side bundle swap, no page reload; toggle stored in localStorage/cookie"), the app uses next-intl WITHOUT `[locale]` routing so pages stay at `src/app/page.tsx` as the architecture tree specifies. Active locale resolves from the `NEXT_LOCALE` cookie (default `en`) in `src/lib/i18n/request.ts` (`getRequestConfig`); `next.config.ts` applies `createNextIntlPlugin('./src/lib/i18n/request.ts')`; `src/app/layout.tsx` provides `NextIntlClientProvider` with server-loaded messages. `src/lib/i18n/config.ts` holds `locales`/`defaultLocale`. `src/middleware.ts` is a documented pass-through seam (session refresh + rate limiting land in later stories).

**Tailwind v4 + darkMode.** Tailwind v4 is CSS-first; `tailwind.config.ts` (with `darkMode: 'class'`) is loaded via `@config "../../tailwind.config.ts"` in `globals.css`, which also carries the shadcn New York / zinc CSS-variable theme and a `.dark` class variant.

**shadcn/ui.** The current `shadcn@latest init` CLI dropped the `--style`/`--base-color` flags and moved to interactive presets (Nova/Vega/…). To hit the mandated `new-york` / `zinc` / css-variables exactly, `components.json` was written with those values and shadcn's foundation was set up manually: deps `clsx`, `tailwind-merge`, `class-variance-authority`, `lucide-react`, `tw-animate-css`; `src/lib/utils.ts` with `cn()` (+ `normalizeTableName()` pure helper); zinc theme tokens in `globals.css`.

**Turbopack opt-out.** Next 16 defaults `next build` to Turbopack. To honor "do not add Turbopack" / `--no-turbopack`, the `dev` and `build` scripts pass `--webpack`. Build banner confirms `(webpack)`.

**middleware deprecation (accepted).** Next 16 warns that the `middleware` file convention is deprecated in favor of `proxy`. `src/middleware.ts` is kept because the spec and architecture name that exact file; the warning is non-blocking and migration is deferred.

**Scaffold-only discipline.** Placeholder dirs carry `.gitkeep` files stating no business logic during Story 1.1. Only two typed, logic-free stubs exist: `src/types/api.ts` (`ApiResponse<T>`, `AppError`) and `src/lib/utils.ts` (`cn`, `normalizeTableName`). No data model, Gemini client, validator, or `mutate.ts` body.

**Sentry.** `@sentry/nextjs@10.53.1` is installed but the interactive `@sentry/wizard` step was NOT run (needs an account/DSN — external side effect). Documented as a manual step.

**Review pass 1 patches (2026-09-24).** Three findings routed to patch and were fixed directly (SendMessage unavailable in this runtime): (1) `src/app/layout.tsx` no longer uses Next's generated `LayoutProps<"/">` (which broke `type-check` on a fresh clone where `.next/types` doesn't exist) — replaced with an explicit `Readonly<{ children: ReactNode }>` prop type; verified `type-check` now passes with `.next/`+`next-env.d.ts` removed. (2) `vercel.json` — removed the premature `crons` block (routes land in Epic 7); documented the deferral in README. (3) `package.json` gained `engines.node` `>=20 <21` and a `.nvmrc` (`20`) to match CI. All verification commands re-run green after patching.

## Spec Change Log

## Review Triage Log

### Review pass 1 (2026-09-24)

- **[high → patch] `src/app/layout.tsx` uses generated `LayoutProps<"/">`** — VERIFIED. Simulated a fresh clone (moved `.next/` + `next-env.d.ts` aside) and ran `tsc --noEmit`: fails with `TS2304: Cannot find name 'LayoutProps'`. CI (`ci.yml`) runs `type-check` after `npm ci` with no preceding build/typegen, so the type-check gate fails on every fresh runner. Real, reachable, breaks a core deliverable.
- **[low → patch] `vercel.json` cron jobs target routes that don't exist** — VERIFIED. `crons` declares `/api/cron/report-usage` + `/api/cron/reconcile-usage`; `src/app/api/` is only `.gitkeep` (routes land in Epic 7). Would 404 on a real production deploy before Epic 7. Low (only fires on live prod deploy, gated behind manual setup), but a direct deletion fixes it and matches the deferral discipline used for the RLS gate/deploy. (Merges Blind Hunter's CRON_SECRET-doc sub-point; CRON_SECRET is already covered by README "set every variable from `.env.example`".)
- **[low → patch] No Node version pin (`engines` / `.nvmrc`)** — VERIFIED. `ci.yml` pins `node-version: 20` but `package.json` has no `engines` and there is no `.nvmrc`; a scaffold whose purpose is a reproducible toolchain should make the Node version explicit to prevent local/CI drift. Direct additive fix.
- **[false] Service-role ESLint gate bypassed by destructuring / computed access** (Blind Hunter B7 + Edge Case E5) — REFUTED. Probed live: `const { SUPABASE_SERVICE_ROLE_KEY } = process.env` and `process.env["SUPABASE_SERVICE_ROLE_KEY"]` both fire the gate (Identifier + Literal selectors). Only deliberate string-concat obfuscation (`"SUPABASE_"+"SERVICE_ROLE_KEY"`) evades — not a realistic accidental-leak vector. Gate covers the threat model.
- **[false] Version pins contradict README "exact versions" claim** (B10) — REFUTED. README scopes the claim to the architecture-listed runtime libs (Supabase, genai, Stripe, Resend, Framer Motion, RHF, Zod, react-swipeable, TanStack Query, papaparse, xlsx, Sentry) — all exact-pinned in `package.json`. The caret-ranged packages (cva, clsx, lucide-react, tailwind-merge, tailwindcss, eslint, typescript, @types/*) are shadcn/create-next-app deps the architecture leaves unpinned; not covered by the claim.
- **[false] Vitest can't support advertised `.test.tsx` component tests (no jsdom)** (B8) — REFUTED. README claims only `.test.ts` unit/integration; it never promises component tests. No component tests exist. `environment: "node"` is correct for current logic tests; the owning story adds jsdom when components ship.
- **[low → reject] `Home.localeLabel` unused + no EN/FR key-parity test** (B5) — `localeLabel` is forward-use for the Epic 8 language toggle (not dead). A parity test on a 5-key catalog is negligible-value; AC ("both catalogs present") is satisfied. Fix adds test surface for near-zero risk.
- **[low → reject] `normalizeTableName` empty-string / digit-leading input unguarded** (Edge Case E1, E2) — the function has NO consumer in this story (Schema Validator/provisioner are Stories 1.2+). Bad outcome is unreachable now; identifier-safety rules belong to the validator story's design. Guarding undemonstrated future state.
- **[low → reject] `catalogs[locale]` yields undefined if a locale is added without a catalog** (E3) — unreachable now (en/fr both have catalogs); would require a future edit that obviously needs a matching catalog. Guards undemonstrated state.
- **[low → reject] i18next gate not scoped to `src/hooks`/`src/context`** (E4) — AC scopes the gate to `src/` components; gate covers `src/components/**` + `src/app/**`. User-facing JSX text in hooks/context is unlikely and broadening risks false positives on non-UI logic.
- **[low → reject] middleware matcher excludes `icons/`/`sw.js` but not other static assets; forward-ref lacks comment** (Blind Hunter B3 + Edge Case E6) — middleware is a no-op pass-through, so running on any static asset is harmless today; matcher tuning belongs to the story that adds middleware logic. Excluding not-yet-existing paths is forward-compatible, not a defect.
- **[low → reject] `.gitignore` missing `.turbo`/`*.log`/editor files; `next-env.d.ts` ignored yet required** (B9) — create-next-app's default ignore set is standard; `next-env.d.ts` is auto-regenerated (ignoring it is correct). The fresh-clone type-check concern is the real issue and is handled by the `LayoutProps` patch above.
- **[low → reject] ESLint safety gates have no self-test** (Verification Gap, other finding) — both gates verified firing by live probe; they function correctly today. A programmatic lint-fixture regression test is non-trivial test infrastructure, disproportionate for the scaffold; reasonable future hardening, not required here.

## Design Notes

**Pinned versions (exact, from architecture.md).** Runtime: `@supabase/supabase-js@2.105.4`, `@supabase/ssr@0.10.3`, `@google/genai@2.4.0`, `stripe@22.1.1`, `@stripe/stripe-js@9.5.0`, `resend@6.12.3`, `next-intl@4.12.0`, `framer-motion@12.38.0`, `react-hook-form@7.76.0`, `zod@4.4.3`, `@hookform/resolvers@5.2.2`, `react-swipeable@7.0.2`, `@tanstack/react-query@5.100.10`, `@tanstack/react-query-devtools@5.100.10`, `papaparse@5.4.1`, `xlsx@0.18.5`, `@sentry/nextjs@10.53.1`. DevDep: `@types/papaparse@5.3.14`. `next`/`react`/`react-dom`/`typescript`/`tailwindcss` are pulled at `create-next-app@latest` defaults (architecture leaves them unpinned); record the resolved versions in `package.json`.

**Env vars for `.env.example`.** Server-only: `SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_METERED_PRICE_ID`, `CRON_SECRET`, `RESEND_API_KEY`, `SENTRY_AUTH_TOKEN`. Public: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`, `NEXT_PUBLIC_SENTRY_DSN`.

**Lint gates.** (a) Service-role key: architecture suggests `eslint-plugin-no-secrets` or a custom rule in `.eslintrc.json` — use `no-restricted-syntax`/`no-restricted-globals` targeting `SUPABASE_SERVICE_ROLE_KEY` in files that are client-bundled (exclude `src/app/api/**`, `*.server.ts`, and files marked server-only), configured as `error`. (b) Hardcoded strings: architecture specifies no mechanism (this is a story-AC requirement it doesn't detail). Use `eslint-plugin-i18next`'s `no-literal-string` rule scoped to `src/components/**` and `src/app/**` JSX text, `error` level, with sensible allowances (technical attributes, test files) to avoid false-positive noise. Record the exact plugin/config chosen in Implementation Notes.

**Scaffold-only discipline.** For `src/lib/**` paths owned by later stories (`data/mutate.ts`, `gemini/client.ts`, `schema/validator.ts`, etc.), create the directory and, at most, an empty/typed stub — no logic. The build must not depend on those stubs.

## Verification

**Commands:**
- `npm install` -- expected: resolves with pinned versions, no peer-dep errors that block build.
- `npm run build` -- expected: production build succeeds.
- `npm run type-check` -- expected: `tsc --noEmit` passes with zero errors.
- `npm run lint` -- expected: passes on clean code; fails when a service-role-key reference or a hardcoded UI string is introduced (verify both by temporary spot-check).
- `npm run test` -- expected: smoke test passes green.

**Manual checks:**
- `.env.example` present with placeholders; `git status`/tracked-files show no `.env*.local` or `.env.production`.
- `.github/workflows/ci.yml` runs lint + type-check on PR; `deploy.yml` + `vercel.json` present and syntactically valid.
