# Web-Verification Review — Scheza Marketing Site Architecture Spine

- **Subject:** `ARCHITECTURE-SPINE.md` (Scheza Marketing Site, created 2026-09-28)
- **Reviewer role:** Fact-checking reviewer — verify committed technology decisions against the live web
- **Verification date:** September 2026
- **Method:** Web search + direct fetch of authoritative sources (GitHub releases, vendor blogs/docs). Search-engine AI summaries were cross-checked against primary sources (GitHub release pages) wherever a version claim looked surprising.

## Verdict

The paradigm and platform choices (Astro on Cloudflare, browser-side pdf-lib, browser→Supabase insert-only RLS, Resend behind an edge endpoint, Turnstile abuse guard, Tailwind v4) are all sound and current. The **one material problem is a stale Astro version pin**: the Stack table says "Astro ^5 (stable; Astro 6 in beta)", but as of September 2026 Astro 6 has been stable since February 2026 and **Astro 7** is the current stable major. Everything else verifies as correct, with two low-severity notes worth capturing.

## Findings

### [high] Astro version pin is stale — 5 is not "current stable", 6 is not "beta"

- **Spine claim (line 139):** `Astro | ^5 (stable; Astro 6 in beta — confirm at cold-start)`
- **Verified fact:**
  - Astro 6 beta was announced 2026-01-13 (blog explicitly: "Astro 6 is currently beta software… before the stable v6.0 release"; "Already on Astro 5? Upgrade to the beta").
  - Astro 6 shipped stable in early 2026.
  - As of September 2026 the latest stable core release is **astro@7.3.5** (published 2026-09-24 per the GitHub releases page; 7.3.4 on 2026-09-22).
- **Impact:** The pin and its parenthetical are both wrong now. A builder at cold-start following "^5 … Astro 6 in beta" would deliberately choose an outdated major and treat the current-minus-one as pre-release. The spine already says "Re-verify pins at cold-start," which mitigates this, but the embedded assertion is misleading enough to correct.
- **Corrected fact / recommended pin:** `Astro | ^7 (stable; latest 7.3.x as of 2026-09). Astro 6 stable since 2026-02.` Confirm the exact minor at cold-start.

### [medium] @astrojs/cloudflare adapter — claim is correct; align the pin to the Astro 7 line

- **Spine claim (line 140):** `@astrojs/cloudflare (adapter) | latest for chosen Astro major`
- **Verified fact:** The `@astrojs/cloudflare` adapter supports on-demand rendering / server endpoints on Cloudflare (Pages Functions / Workers) — it deploys on-demand rendered routes, server islands, actions, and sessions; API endpoints (server endpoints) are supported for DB access/auth while keeping secrets server-side; `routes.extend.include/exclude` controls per-route on-demand vs. prerender. This directly supports AD-1 (static-first with selective SSR) and AD-3 (the single `api/send-invoice` edge endpoint).
- **Latest adapter version observed:** `@astrojs/cloudflare@14.3.3` (2026-09-22), which is the current line matching Astro 7.
- **Impact:** No correctness problem — the "latest for chosen Astro major" instruction is good practice. Flagged only because the "chosen Astro major" it resolves against changes once the Astro pin above is corrected to ^7 (adapter 14.x, not the 5/6-era adapter).
- **Status:** Verified supported. Adjust downstream of the Astro fix.

### [low] Supabase anon key naming — pattern is correct, but the anon key is being retired end of 2026

- **Spine claim (AD-5 line 57, AD-6 line 62, Stack line 145):** browser inserts leads with the **publishable (anon) key** under insert-only RLS; `@supabase/supabase-js | ^2`.
- **Verified fact:**
  - `@supabase/supabase-js` v2 is current; browser-side inserts under an insert-only RLS policy using the publishable/anon key is an explicitly supported and safe pattern — the publishable key carries the same low privileges as the anon key and RLS is enforced against policies + JWT. This validates AD-5 as designed (no `select/update/delete` for anon).
  - **Migration note:** Supabase is deprecating the legacy `anon` and `service_role` keys by end of 2026. New client code should use the **publishable key** (`sb_publishable_…`) in the browser and the **secret key** (`sb_secret_…`) server-side. The spine's phrasing "publishable (anon) key" already anticipates this and is fine, but the pin should not assume the literal `anon` key name will persist past 2026.
- **Impact:** None to the architecture; the insert-only RLS pattern is exactly right. Worth a one-line note so the builder wires up `sb_publishable_…` rather than hunting for a legacy `anon` key that may be deprecated by launch.
- **Status:** Verified safe/supported.

### [low] resend ^6 — correct and Workers-compatible

- **Spine claim (line 146):** `resend | ^6 (match app 6.12.x)`
- **Verified fact:** The `resend` Node SDK is on the v6 major; latest is **v6.30.0** (2026-09-25). `^6` is correct and `6.12.x` is a valid in-range floor. Resend maintains an official `resend-cloudflare-workers-example`, and Cloudflare Workers enabled `nodejs_compat`/`nodejs_compat_v2` by default for compatibility dates ≥ 2026-08-04, so the SDK runs on the Workers runtime behind the `api/send-invoice` endpoint (AD-3) without special config.
- **Impact:** None. Optionally bump the "match app" reference note if the app has since moved past 6.12.x, but `^6` remains accurate.
- **Status:** Verified.

### [low] pdf-lib ^1.17 — correct; browser + Workers, no native binaries

- **Spine claim (AD-7 lines 67, Stack line 144):** PDF generation via `pdf-lib` runs **in the browser**; `pdf-lib | ^1.17`.
- **Verified fact:** `pdf-lib` is pure TypeScript/JavaScript with no native dependencies; latest release is **v1.17.1**. It runs in the browser and is one of the standard recommended options for PDF generation on the Cloudflare Workers `workerd` runtime precisely because it needs no native binaries, no filesystem, and no process spawning. This satisfies AD-7 (client-side PDF, offline-capable) and would also work if the email endpoint ever needs to build the PDF server-side.
- **Impact:** None. `^1.17` is accurate.
- **Status:** Verified.

### [low] Cloudflare Turnstile — current and appropriate

- **Spine claim (AD-10 lines 82, Stack line 147):** Cloudflare Turnstile + rate limiting guards the public lead insert and the email endpoint; `Cloudflare Turnstile | current`.
- **Verified fact:** Turnstile is Cloudflare's current, actively maintained CAPTCHA-alternative bot guard (Managed / Non-Interactive / Invisible modes), free on the Standard plan as of September 2026, privacy-preserving (no ad-retargeting data harvesting — good fit for the PIPEDA posture in AD-11), and integrates cleanly with a Cloudflare-hosted Astro site. Appropriate choice for AD-10.
- **Status:** Verified.

### [info] Tailwind CSS v4 — stable, correct

- **Spine claim (line 143):** `Tailwind CSS | v4 (match app)`
- **Verified fact:** Tailwind CSS v4.0 shipped stable in January 2025; the v4 line is well past stable (4.3.x as of mid-2026, CSS-first config, Lightning CSS engine). "v4 (match app)" is accurate.
- **Status:** Verified.

### [info] Other pins

- **React ^19** (line 142, islands, optional) — v19 is current; consistent with the app. No issue.
- **TypeScript ^5 (strict)** (line 148) — current major line. No issue.
- **Cloudflare Pages/Workers** (line 141) — platform, current. No issue.

## Corrected Stack table (proposed)

| Name | Current pin | Corrected / confirmed |
| --- | --- | --- |
| Astro | ^5 (6 in beta) | **^7** (7.3.x as of 2026-09; 6 stable since 2026-02) — **fix** |
| @astrojs/cloudflare | latest for chosen major | latest for Astro 7 (14.x, e.g. 14.3.3) — confirmed supports SSR/endpoints on CF |
| React (islands) | ^19 | ^19 — ok |
| Tailwind CSS | v4 | v4 (4.3.x) — ok |
| pdf-lib | ^1.17 | ^1.17 (1.17.1) — ok, browser + Workers, no native deps |
| @supabase/supabase-js | ^2 | ^2 — ok; use `sb_publishable_…` key (anon deprecated end-2026) |
| resend | ^6 (6.12.x) | ^6 (6.30.0 latest) — ok, Workers-compatible |
| Cloudflare Turnstile | current | current — ok |
| TypeScript | ^5 strict | ^5 — ok |

## Sources

- Astro 6 beta announcement (date + "beta" status): https://astro.build/blog/astro-6-beta/
- Astro releases (astro@7.3.5 / 7.3.4, @astrojs/cloudflare@14.3.3): https://github.com/withastro/astro/releases
- @astrojs/cloudflare adapter (on-demand rendering, server endpoints, routes.extend): https://docs.astro.build/en/guides/integrations-guide/cloudflare/
- Astro on-demand rendering guide: https://docs.astro.build/en/guides/on-demand-rendering/
- pdf-lib releases (v1.17.1): https://github.com/Hopding/pdf-lib/releases
- PDF generation on Cloudflare Workers (pdf-lib, no native binaries on workerd): https://pdf4.dev/blog/pdf-generation-cloudflare-workers
- Supabase API keys (publishable vs anon, RLS): https://supabase.com/docs/guides/getting-started/api-keys
- Supabase migrating to publishable/secret keys (anon deprecation end-2026): https://supabase.com/docs/guides/getting-started/migrating-to-new-api-keys
- resend-node releases (v6.30.0): https://github.com/resend/resend-node/releases
- Cloudflare Workers Node.js compat default (2026-08-04): https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/
- Cloudflare Turnstile product/docs: https://www.cloudflare.com/products/turnstile/ , https://developers.cloudflare.com/turnstile/
- Tailwind CSS v4.0 release: https://tailwindcss.com/blog/tailwindcss-v4
