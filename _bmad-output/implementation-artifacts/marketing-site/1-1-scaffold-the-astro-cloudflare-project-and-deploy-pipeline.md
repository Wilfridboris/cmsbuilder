---
title: 'Scaffold the Astro + Cloudflare project and deploy pipeline'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
baseline_commit: '87e495d88fbc3feec3ce8d2ba0b8b5acfe3e54ce'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-marketing-site-2026-09-28/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics-marketing-site.md'
  - '{project-root}/docs/visual.png'
  - '{project-root}/docs/design.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Scheza marketing site (scheza.com) does not exist yet. Every later story (waitlist, calculator, blog, referral) needs a live, fast, bilingual, on-brand foundation with CI safety rails and a Cloudflare deploy path before it can ship.

**Approach:** Scaffold a greenfield **Astro + `@astrojs/cloudflare` (SSG-first)** project in `scheza-marketing/` (a decoupled sub-project inside this repo, git-ignored per AD-12 so it never entangles the Next.js app), with TypeScript strict, Tailwind v4, Astro i18n routing (EN at `/`, FR under `/fr/**`), a placeholder static homepage, the Scheza brand tokens/assets from `docs/visual.png`, and CI + deploy configuration (build, type-check, axe a11y gate, secret-leak gate, per-PR Cloudflare preview, prod-on-main, Sentry + Cloudflare Web Analytics wiring via `.env.example` placeholders).

## Boundaries & Constraints

**Always:**
- Live under `scheza-marketing/`; it is its own project (own `package.json`, own tooling) and is git-ignored by the parent repo (AD-12). No import from, or dependency on, the `src/` Next.js app.
- Pages static/pre-rendered by default (AD-1); interactivity only in `src/islands/**`; server code only in `src/pages/api/**` (none created in this story). Adapter present so future endpoints run on Cloudflare.
- Astro i18n: EN at `/`, FR mirror under `/fr/**`; correct `hreflang`; no hardcoded user-facing strings — placeholder copy comes from a content/i18n slot (AD-14).
- Brand is authoritative from `docs/visual.png`: exact hex for navy/blue/cyan/slate palette + **Inter** primary typeface set as Tailwind v4 design tokens; logo/wordmark assets added. `docs/design.md` informs aesthetic only; visual.png wins on any color/type conflict.
- Secrets server-only, enforced by a **build-failing** CI grep/lint gate (AD-6): only the Turnstile *site* key may appear in client-shipped code.
- CI must run build, type-check, axe a11y check on key page(s), and the secret-leak gate (AD-19, AD-20). Only `.env.example` with placeholders is committed (AD-20).
- Pin stack per the Architecture Spine's Stack table, re-verified at install time; TypeScript strict on.
- UI/UX work in this story (Tailwind theme tokens, placeholder homepage, logo assets) is produced via the `web-uiux-architect` skill.
- **Deploy scope = config-only (decided):** produce all CI/deploy artifacts (GitHub Actions workflow, Cloudflare adapter + wrangler config, `.env.example`, documented required secrets) ready to connect once `scheza-marketing/` is promoted to its own repo. The CI/preview/prod-on-main/rollback ACs are satisfied as *verifiable configuration*; no live GitHub repo, Cloudflare project, or real secret is created this session.

**Never:**
- No lead-capture or email endpoints, no calculator, no blog, no referral logic (later stories). No real secret values committed. No SSR/on-demand routes. No global client router or app-wide client-state framework (AD-2). No Supabase/database for the marketing site.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| EN homepage | GET `/` | Static HTML placeholder homepage renders, on-brand, `hreflang` EN/FR emitted | N/A |
| FR homepage | GET `/fr/` | FR mirror renders from paired i18n slot, `<html lang="fr">` | N/A |
| Type check | `npm run typecheck` (or `astro check`) | Exit 0, strict mode, no errors | Fail build on any type error |
| Secret-leak gate | Server-only secret name present in client code | CI job fails with a clear message | Non-zero exit blocks merge |
| a11y gate | axe runs on the homepage in CI | No serious/critical violations | Non-zero exit blocks merge |
| PR opened | push to a PR branch | Cloudflare preview deploy produced (once repo/CF connected) | Build failure blocks preview |

</frozen-after-approval>

## Code Map

- `scheza-marketing/` -- NEW project root (git-ignored by parent). Everything below is created here.
- `scheza-marketing/astro.config.mjs` -- Astro config: `@astrojs/cloudflare` adapter, Tailwind v4, i18n (`defaultLocale: 'en'`, `locales: ['en','fr']`, `routing` with FR under `/fr`).
- `scheza-marketing/src/pages/index.astro` + `src/pages/fr/index.astro` -- placeholder static homepage, EN + FR mirror.
- `scheza-marketing/src/i18n/` + `src/content/` -- paired EN/FR copy slots for placeholder strings (no hardcoding).
- `scheza-marketing/src/styles/` + Tailwind v4 `@theme` -- brand design tokens (colors, Inter font).
- `scheza-marketing/public/` -- Scheza logo/wordmark/icon assets (from `docs/visual.png`).
- `scheza-marketing/.env.example` -- placeholders: `RESEND_API_KEY`, `PERSONAPRESS_TOKEN`, `PUBLIC_TURNSTILE_SITE_KEY`, `SENTRY_DSN`, `PUBLIC_CF_ANALYTICS_TOKEN`.
- `scheza-marketing/.github/workflows/ci.yml` -- build, type-check, axe a11y, secret-leak gate.
- `scheza-marketing/scripts/secret-leak-gate.mjs` -- grep gate: fail if a server-only secret name appears in the built client bundle.
- `docs/visual.png` -- AUTHORITATIVE brand source; sample exact swatch hex from it (do not eyeball).
- `.gitignore` (parent, already edited) -- `/scheza-marketing/` entry added so the scaffold does not pollute the Next.js repo.
- `_bmad-output/implementation-artifacts/sprint-status-marketing-site.yaml` -- flip `1-1-...` to `in-progress`/`review`/`done` as work proceeds; epic-1 to `in-progress`.

## Tasks & Acceptance

**Execution:**
- [x] `scheza-marketing/` -- scaffold Astro (latest ^7 line) with `@astrojs/cloudflare` adapter, TypeScript **strict**, Tailwind v4; pin versions per Spine Stack table, re-verified at install -- foundation (AC1).
- [x] `scheza-marketing/astro.config.mjs` -- configure i18n (EN root, `/fr/**` mirror) + Cloudflare adapter + Tailwind v4 -- bilingual routing + edge-ready (AC1).
- [x] `scheza-marketing/src/pages/index.astro`, `src/pages/fr/index.astro`, `src/i18n/*`, `src/content/*` -- placeholder homepage rendering as static HTML from paired EN/FR slots, correct `hreflang`/`lang` -- (AC1).
- [x] `scheza-marketing/src/styles/*` + Tailwind `@theme` + `public/*` -- brand tokens (exact hex sampled from `docs/visual.png`) + Inter + logo assets, via `web-uiux-architect` skill -- on-brand foundation (AC4).
- [x] `scheza-marketing/.env.example` -- placeholders only; document real-secret location (Cloudflare project secrets) -- (AC3).
- [x] `scheza-marketing/scripts/secret-leak-gate.mjs` + `.github/workflows/ci.yml` -- CI: build, `astro check` (type), axe a11y on homepage, secret-leak gate; Cloudflare preview-per-PR + prod-on-main + rollback documented/configured -- (AC2, AC3).
- [x] `scheza-marketing/README.md` -- how to dev/build/deploy, required secrets, and the "promote to own repo + connect Cloudflare" steps -- ops clarity.

**Acceptance Criteria:**
- Given the scaffold, when `npm run build` runs in `scheza-marketing/`, then it produces static HTML for `/` and `/fr/`, `astro check` passes under strict TS, and the Cloudflare adapter is configured.
- Given a PR, when CI runs, then build + type-check pass, axe finds no serious/critical a11y issues on the homepage, and the secret-leak gate fails on any server-only secret name in client output (verified by a deliberate negative test).
- Given the repo, when inspected, then only `.env.example` (placeholders) is committed; Sentry + Cloudflare Web Analytics are wired via env placeholders; no real secret is present.
- Given `docs/visual.png`, when the Tailwind theme is inspected, then navy/blue/cyan/slate tokens use the exact swatch hex and **Inter** is the primary typeface, with logo/wordmark assets present.
- Given the parent repo, when `git status` runs, then `scheza-marketing/` is git-ignored and produces no tracked changes beyond `.gitignore`, the spec, and the sprint-status update.

## Implementation Notes

- **AC1 SSG fix (`astro.config.mjs`).** `@astrojs/cloudflare` v14 is a Workers/SSR adapter; with `output: 'static'` its default `prerenderEnvironment: 'workerd'` wrapped prerendered pages into a `dist/server/.prerender/` worker (no `dist/index.html`) and its generated `wrangler.json` used the reserved `ASSETS` binding name, crashing the build. Set `prerenderEnvironment: 'node'` so prerendering runs in Node and emits real static HTML; removed the invalid `platformProxy: { enabled: true }` option (not valid in v14, caused an `astro check` type error).
- **Static flatten (`scripts/flatten-static.mjs`, wired into `npm run build`).** The adapter emits static assets under `dist/client/**`; since this story ships zero server endpoints, this script promotes `dist/client/**` to `dist/**` (yielding literal `dist/index.html` + `dist/fr/index.html`) and no-ops once `dist/server` is non-empty (i.e. once a real edge endpoint lands in a later story).
- **Secret-leak gate hardened (`scripts/secret-leak-gate.mjs`).** Original gate scanned only built `dist/` for secret *names*, but Astro inlines `import.meta.env.X` **by value**, so a planted secret leaked its value while the name never appeared (gate passed a real leak). Rewrote to primarily scan client-shipped **source** for `import.meta.env`/`process.env` access to server-only names (excluding `src/pages/api/**`, `.d.ts`, comments), keeping the dist scan as a secondary net. Negative test now correctly fails (exit 1).
- **a11y gate fix (`scripts/a11y.mjs`).** `browser.newPage()` is rejected by `@axe-core/playwright`; switched to `browser.newContext().newPage()`.
- **Minor:** removed unused `defaultLang` import in `BaseLayout.astro` (astro check warning); README updated to describe the corrected gate.
- **Post-review UI refinements (user-requested).** (1) Removed the decorative blue-blur "brand glow" div from `src/components/Hero.astro` for cleaner contrast — hero now sits on plain white. (2) Real Scheza logo masters (previously loose ChatGPT exports in `docs/Scheza/`) were moved into `scheza-marketing/brand/` with descriptive names (`mark.png`, `wordmark.png`, `logo-horizontal.png`, `logo-stacked.png`, `logo-mono-navy.png`, `logo-mono-slate.png`, `app-icon-{light,navy,blue,black}.png`); `docs/Scheza/` removed. Web-served icons in `public/` (`scheza-mark.png` 128², `favicon.png` 48², `apple-touch-icon.png` 180²) are regenerated from `brand/mark.png` via `sharp` (trimmed, contained). `brand/` holds masters and is not web-served. All CI gates re-verified green after both changes.
- **Known minor risk:** `.wrangler/deploy/config.json` is a stale local dev-cache pointer to the pre-flatten `dist/client/wrangler.json`; git-ignored and regenerated, affects only local `astro preview`/`wrangler dev`, not the Cloudflare Pages deploy (`pages deploy dist`). Delete `.wrangler/` to regenerate if local preview is needed.

## Spec Change Log

## Review Triage Log

## Design Notes

- Aesthetic per `docs/design.md` "Spatial Clean" (depth over borders, touch-first ≥48px, WCAG AA), but **brand color/type from `visual.png` wins** (design.md's Geist + black/green predate the Scheza brand). Components are `.astro`, not the app's shadcn.
- **Brand tokens (extracted from `docs/visual.png`, authoritative — do not re-eyeball):**
  - Navy `#0B2A5B` (primary/ink), Blue `#2563EB` (primary action), Cyan `#06B6F7` (accent), Ice `#E8F4FF` (tint/surface), near-black `#11161A` (mono), white `#FFFFFF`.
  - Primary typeface **Inter** (Regular 400 / Medium 500 / Semibold 600 / Bold 700).
  - Map into Tailwind v4 `@theme` as `--color-navy`, `--color-blue`, `--color-cyan`, `--color-ice`, `--color-ink`, and `--font-sans: 'Inter', ...`. Ensure text/background pairings meet WCAG AA (navy-on-white and white-on-navy both pass).

## Verification

**Commands:**
- `cd scheza-marketing && npm install` -- expected: clean install, pinned versions resolved.
- `cd scheza-marketing && npm run build` -- expected: static `dist/` with `index.html` and `fr/index.html`.
- `cd scheza-marketing && npx astro check` -- expected: exit 0, strict TS, zero errors.
- `cd scheza-marketing && node scripts/secret-leak-gate.mjs` -- expected: passes clean; fails when a server-only secret name is planted in client code (negative test).
- axe check on the built homepage (CI step) -- expected: no serious/critical violations.

**Manual checks (if no CLI):**
- Open built `/` and `/fr/` — placeholder homepage renders on-brand (navy/blue/cyan, Inter, logo), correct `<html lang>` and `hreflang`.
- Confirm `git status` in the parent repo shows no `scheza-marketing/**` files tracked.

---

## Course correction addendum — 2026-10-06

*(Appended outside the frozen Intent per `sprint-change-proposal-2026-10-06.md`; original intent unchanged.)*

This story's scaffold is now **realized by `scheza-marketing-v1`**, promoted into the `scheza-marketing` repo (see new Story **1-0**). Two deltas from the original AC:
- **Brand corrected:** tokens/assets come from **`scheza-brand-kit`** (Ink/Apricot/Vermilion, Manrope+Inter), **not** the navy/blue/cyan `docs/visual.png`. The "on-brand (navy/blue/cyan, Inter)" manual check above is superseded by Ink/Apricot + Manrope.
- **EN-only at launch:** the `/fr/` route and `hreflang` EN/FR pairing are **deferred** (NFR-5). The `/fr/` manual check does not apply to the launch cut.
Status remains `done` as the foundation is satisfied by v1; acceptance is against the brand-kit, not visual.png.
