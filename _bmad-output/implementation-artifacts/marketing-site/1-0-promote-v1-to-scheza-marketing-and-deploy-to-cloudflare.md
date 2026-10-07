---
title: 'Promote scheza-marketing-v1 to canonical and deploy to Cloudflare'
type: 'feature'
created: '2026-10-06'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '624004972722225082c955572c09dcf3c60f6fdb'
context:
  - '{project-root}/_bmad-output/planning-artifacts/sprint-change-proposal-2026-10-06.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-marketing-site-2026-09-28/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics-marketing-site.md'
  - '{project-root}/scheza-marketing-v1/'
  - '{project-root}/scheza-brand-kit/'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Two marketing codebases exist on disk. The older `scheza-marketing/` (git-initialized, decoupled) is on the retired navy/blue/cyan brand with only a partial section set. The newer `scheza-marketing-v1/` is on the correct `scheza-brand-kit` brand (Ink/Apricot/Vermilion), has the full landing section set, and already wires the `scheza.com -> app.scheza.com` split via `PUBLIC_APP_URL` — but it has no git repo and is not deployed. There must be exactly **one** canonical, deployed marketing site.

**Approach:** Promote `scheza-marketing-v1` to be the canonical codebase **inside the existing `scheza-marketing` repo** (keep that name, decoupled per AD-12, git-ignored by the parent app), retiring the old navy build. Confirm the brand-kit assets/tokens are in place, set the two-mode hero to point at `app.scheza.com`, run the CI gates, and deploy to Cloudflare Workers at `scheza.com`.

**Out of scope (deferred post-launch):** taste-of-magic preview (1-4), EN/FR i18n, Turnstile, full CASL witnessed consent, calculator, referral, blog. See the launch profile in the PRD §0.1 and the spine's "Launch Profile (v1)" section.

</frozen-after-approval>

## Acceptance Criteria

**Given** the `scheza-marketing` repo (decoupled, git-ignored by the parent app per AD-12)
**When** the promotion is complete
**Then** its working tree is the `scheza-marketing-v1` codebase (Astro 7 `output: "static"`, Tailwind v4, `@astrojs/cloudflare` passthrough, single `/api/waitlist` Worker route)
**And** the old navy build is removed (no navy/blue/cyan tokens, no `docs/visual.png`-derived assets remain)
**And** the parent repo's `git status` shows no `scheza-marketing*/**` files tracked.

**Given** the brand
**When** the theme and assets are inspected
**Then** `src/styles/global.css` `@theme` carries the brand-kit tokens (Ink `#342350`, Apricot `#FFC69A`, Vermilion `#D94B35`, plus Cream/Apricot-tint/Ink-muted/Vermilion-text) with Manrope ExtraBold + Inter
**And** `public/brand/**`, favicons, app icons, `og-image.png` and `site.webmanifest` come from `scheza-brand-kit`.

**Given** the two-mode hero
**When** `PUBLIC_APP_URL=https://app.scheza.com` is set as the production build variable
**Then** the hero CTA reads "Build my app" and links to `https://app.scheza.com/start?trade=...&city=...&track=...`
**And** with `PUBLIC_APP_URL` empty the pre-launch "Get early access" waitlist mode renders.

**Given** CI
**When** `npm run ci` runs
**Then** check + unit tests + build + secret-leak gate (+ its negative test) + axe (WCAG 2.2 A/AA) all pass
**And** no em-dash appears in user-facing copy (per project rule; `tests/trades.test.ts` guards hero data).

**Given** deployment
**When** the site is deployed to Cloudflare Workers
**Then** `scheza.com` serves the static site with the `/api/waitlist` route live, Resend secrets set via `wrangler secret put`, and production deploys on merge to main with rollback available
**And** public copy makes **no** claim of Canadian data residency or CASL-compliant consent (deferred; interim risk per the SCP).

## Implementation notes

- Keep the `scheza-marketing` repo's git history; replace contents with v1. If cleaner, re-init is acceptable as long as the decoupling + name are preserved and the parent `.gitignore` entries (`/scheza-marketing/`, `/scheza-marketing-v1/`, `/scheza-brand-kit/`) stay intact.
- Resolve `TODO(pricing)` (`src/data/content.ts`) and `TODO(legal)` (privacy/terms/footer) before public launch, or gate them behind owner-supplied copy slots.
- `scheza-marketing-v1/` and `scheza-brand-kit/` may be left in place as source/reference or archived once promotion is verified.

### Cost / free-tier (verified against Cloudflare docs 2026-10-06)

- **Cloudflare: free.** Requests to static assets are free and unlimited on the free plan; only `/api/waitlist` (Worker invocations) count toward the **100,000/day** free limit — unreachable for a pre-launch waitlist. Within all other free limits (20,000 static files, 25 MiB/file, 10 ms CPU/invocation, 64 MiB Worker). DNS/SSL/custom domain/Web Analytics free. **Do not provision D1/R2 at launch** (they belong to the deferred blog/calculator work).
- **Watch Resend, not Cloudflare.** Resend free tier is ~**3,000 emails/month / 100 per day**, one verified domain. Each signup sends a confirmation email (plus one more if `WAITLIST_NOTIFY_TO` is set). If signups exceed ~100/day, upgrade **Resend** — Cloudflare stays free. Verify the `scheza.com` domain in Resend before enabling notifications.

## Test / verification checks

- `cd scheza-marketing && npm ci && npm run ci` -- all gates green.
- Build twice: once with `PUBLIC_APP_URL` empty (waitlist mode), once with `https://app.scheza.com` (build-my-app mode); confirm hero/pricing/header/final-CTA wording switches correctly.
- `npm run secret-gate` -- passes clean; `npm run secret-gate:test` -- negative test still fails as designed.
- Post-deploy: `scheza.com` paints fast (LCP/INP/CLS within budget), `/api/waitlist` returns a clean `{data,error}` (and 503 when Resend secrets absent), favicons/OG/manifest resolve.

**Manual checks (if no CLI):**
- Open `/` -- all sections render on the brand-kit brand (Ink/Apricot/Vermilion, Manrope headings, Inter body); logo is a brand-kit asset.
- Confirm parent `git status` shows nothing from `scheza-marketing*/`.

## Review Triage Log

Diff reviewed: `scheza-marketing` commit `6f5b148` (`1695071..6f5b148`), 75 files. Three layers run (blind-hunter, edge-case-hunter, verification-gap). Verdicts rendered against the actual code; severities assigned here, not by the reviewers.

| # | Finding (source) | Verdict | Route | Evidence |
|---|---|---|---|---|
| 1 | a11y gate omits `wcag22a` tag; AC4 + README claim "WCAG 2.2 A and AA" (ECH, VG-adjacent) | medium | patch | `scripts/a11y.mjs:62` tags = wcag2a/2aa/21a/21aa/22aa — 2.2 level-A rules never run. Code under-delivers vs the AC; smallest fix adds the tag. |
| 2 | Hero default "I run a HVAC business" — wrong article + casing vs other trades (BH) | low | patch | `Hero.astro:39` static "I run a" + `trades.ts:41` `label:"HVAC"` (default selected). User-visible default state; "an HVAC" expected. |
| 3 | Sole server route `/api/waitlist` orchestration has zero endpoint-level tests; deleted `capture-lead.test.ts` removed equivalent coverage (VG, pre-verified) | medium | patch | `tests/waitlist.test.ts` imports only `lib/waitlist.ts` helpers; no test imports `pages/api/waitlist.ts`. Status-code/`already exists`/503/spam/reply branches unverified. VG filed disposition: patch (add endpoint test). |
| 4 | Pricing renders literal `[INCLUDED RECORDS]` / `[OVERAGE RATE]` / `[SUPPORT EMAIL]` (BH) | medium | defer | `content.ts:35-37` — explicit `TODO(pricing)`; spec implementation-notes permit deferring (owner-supplied copy). Deploy is gated on the human; not public this run. |
| 5 | Privacy/Terms publish `[PRIVACY POLICY TEXT]` / `[TERMS OF SERVICE TEXT]` with public footer links (BH) | medium | defer | `privacy.astro:8`, `terms.astro:8` — explicit `TODO(legal)`; spec permits deferring. Deploy-gated. |
| 6 | Rate-limiting (5 req/60s per IP) removed from the public email endpoint; honeypot only (ECH deletion) | medium | defer | v1 `waitlist.ts` has no limiter. Intent defers Turnstile (AD-10)/abuse hardening; SCP accepts interim risk. Real pre-deploy security consideration. |
| 7 | No transactional confirmation email to the signer; old flow sent one (ECH deletion) | low-medium | defer | Confirmed opt-in is a CASL-consent mechanism; intent defers full CASL consent. On-page success remains; optional internal notify remains. |
| 8 | No sitemap; `robots.txt` has no `Sitemap:` directive (BH) | low | defer | Pre-existing v1 state; SEO asset belongs to story 1-6 (SEO baseline), not the 1-0 promotion intent. |
| 9 | `og:image:alt` / `twitter:image:alt` / `twitter:site` missing (BH) | low | defer | `BaseLayout.astro` pre-existing v1 gap; social-card/SEO meta completeness is 1-6 scope. |
| 10 | README silent on removed Turnstile/rate-limit/CASL (BH) | low | defer | Doc completeness about intent-deferred features (already tracked in the SCP). Folded into the abuse-hardening defer. |
| 11 | French promised (hero EN/FR toggle, "switch anytime" copy, footer "Français") but FR removed (BH) | false | reject | Hero toggle is inside `<figure aria-label="Example of a Scheza app">` and `aria-hidden="true"` (decorative product mockup); footer `Français` is a `<span lang="fr">`, not a link. Copy describes the app's capability. No dead site affordance. EN/FR site i18n is intent-deferred regardless. |
| 12 | FinalCTA live-mode copy drops the "Ontario" anchor (BH) | false | reject | Editorial preference with no named harm; live mode is post-launch, not the launch (waitlist) mode. Not a defect. |
| 13 | README script table may list non-existent scripts; "Astro 7" (BH) | false | reject | Every README-listed script (`dev`/`preview`/`check`/`a11y`/`secret-gate`/`resend-setup`/`ci`…) exists in `package.json`. `^7.3.5` is Astro 7. Only negligible wording nuance remains. |
| 14 | `site.webmanifest` lacks `description` + final newline (BH) | low | reject | Install-prompt `description` is negligible (users won't meet it) and adding it adds content; missing newline is cosmetic. Reject per low-rule. |
| 15 | `a11y.mjs` reads `404.html` via `readFileSync` and could throw if missing (ECH) | false | reject | `astro build` prerenders `/404.html` before `a11y` runs (verified in build output); the trigger cannot occur in the gate flow. Developer-only, no real harm. |
| 16 | Returning signup: `already exists` treated as success, new trade/city/track not updated (ECH) | low | reject | `waitlist.ts:62` create-only. Uncommon (re-signup with changed details) AND fix adds a branch + `contacts.update` call (> direct correction) → reject per low-rule. Lead is still captured. |
| 17 | 303 redirect `Location` carries `#start`; some clients drop the fragment (ECH) | false | reject | Browsers preserve same-origin fragments on 303; the form is browser-driven and non-browser clients take the JSON path. No real bad outcome. |
| 18 | Spec verification text claims `/api/waitlist` returns `{data,error}`; code returns `{ok,message}` (ECH claim) | n/a | reject | Code is self-consistent (hero reads status + `{ok}`). The only fix is to edit this build's spec prose → reject per "reject any finding whose fix edits this build's spec." Stale copy from the old endpoint. |
| 19 | Non-POST to `/api/waitlist` lacks explicit 405 + `Allow` (ECH deletion) | low | reject | Browsers POST via the form; fix adds an `ALL` export/branch (> direct correction) and the case is unlikely in everyday use → reject per low-rule. |
| 20 | secret-gate test no longer exercises CLI entry/exit (VG other) | n/a | reject | VG itself: core matcher `scan()` is verified and the gate still fails CI on findings; not a gap by the rules. |
| 21 | `already exists` string-match may drift on a Resend SDK upgrade (VG other) | n/a | reject | Out-of-repo contract (resend SDK); correctly out of scope for an in-repo test. |

**Cascade:** No `intent_gap` and no `bad_spec` entries → no loopback. Three `patch` entries (#1, #2, #3) applied directly (the implementation agent could not be re-engaged — no SendMessage in this harness) and committed to `scheza-marketing` as `4818046`; six `defer` entries (#4–#10) recorded in `../deferred-work.md`. Full `npm run ci` re-run green after the patches (16 tests incl. 8 new endpoint tests; axe green with `wcag22a` added). `review_loop_iteration` stays 0.
