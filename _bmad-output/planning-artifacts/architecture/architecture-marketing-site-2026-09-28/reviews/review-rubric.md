# Rubric Review — Scheza Marketing Site Architecture Spine

**Reviewed:** `ARCHITECTURE-SPINE.md` (status: draft, 2026-09-28)
**Against:** PRD `prd-marketing-site-2026-09-28/prd.md` (FR-1..18, NFR-1..8), project-context.md
**Reviewer:** rubric-walking architecture reviewer
**Date:** 2026-09-28

## Verdict: PASS-WITH-FINDINGS

This is a strong, coherent spine. The paradigm ("static-first islands with edge endpoints") is well chosen for the SEO/AEO/CWV mandate, the 14 ADs mostly fix real divergence points with enforceable rules, the Lead contract is genuinely singular, and decoupling from the app is clean. The findings below are one stale version pin (high), a genuinely silent operational envelope (high), one under-specified enforcement mechanism (medium), and a handful of coverage/consistency gaps (low–medium). None are structural; all are fixable in the current draft.

---

## Criterion 1 — Does it fix the real divergence points for the level below, missing none?

**Largely yes.** The real divergence risks for a marketing-site build are: (a) render strategy drift (a builder SSR-ing a content page), (b) interactivity sprawl into an SPA, (c) each capture form inventing its own lead shape, (d) multiple/leaky lead write paths, (e) secrets leaking client-side, (f) coupling to the app runtime, (g) i18n retrofit debt, (h) blog coupling to a live external API, (i) CASL consent conflation. Each of these has a dedicated AD (AD-1, AD-2, AD-4, AD-5, AD-6, AD-12, AD-14, AD-8, AD-9). This is the right set.

**Gap (low):** Two cross-cutting divergence points named in the PRD have no invariant of their own:
- **Analytics/instrumentation event contract (NFR-6).** The spine defers the *tool* (correctly), but the *event set + UTM naming* is exactly the kind of thing two islands will implement inconsistently. The PRD names the event set explicitly (preview built, waitlist submit, calculator complete, PDF download, referral link created/used, demo request). There is a Consistency-Conventions row ("consent-aware event capture; UTM on capture events") but no AD binding NFR-6 and no canonical event-name list. This is a real divergence surface left to a one-line convention.
- **Structured-data / SEO-head contract (NFR-2/NFR-3).** AD-8 covers the blog's Article schema, canonical, hreflang. But NFR-3 requires Product/SoftwareApplication + FAQ schema on non-blog pages, and NFR-2 requires titles/meta/canonical/hreflang/sitemap/robots on *every* indexable page. No AD governs how static pages emit their SEO head + structured data, so each page author can diverge. Given SEO/AEO is called "the product's discoverability... a hard requirement," this deserves an invariant, not just the AD-1 "static" guarantee.

## Criterion 2 — Is every AD's Rule enforceable and does it actually prevent its stated divergence?

**Mostly yes.** AD-4 (verbatim Lead shape + enum), AD-5 (insert-only RLS, anon key, no select/update/delete), AD-6 (secret allowlist), AD-7 (client-side calc/pdf, server only on email), AD-12 (own repo/deploy, single shared resource) are all concrete and checkable.

**Finding (medium):** **AD-6 enforcement is asserted but not mechanized.** The rule ("Resend key, PersonaPress token, service role referenced only inside `src/pages/api/**` or build scripts") is exactly the app's most safety-critical invariant, and the app enforces it with a *custom ESLint rule that fails the build if the service-role key appears in the client bundle* (project-context.md, Development Workflow Rules). The spine states the rule but gives no enforcement mechanism (no lint rule, no CI gate, no `PUBLIC_`-prefix convention note). Astro's client/server boundary is looser and easier to violate than Next's, so an assertion-only AD-6 is weaker here than in the app. Recommend naming a concrete guard (ESLint no-restricted-imports / build-time check) the way the app does.

**Finding (low):** **AD-10 rate limiting is unlocated.** "Turnstile + rate limiting" — Turnstile has a clear home, but *where* rate limiting lives (Cloudflare WAF rate-limiting rules? in-endpoint? KV counter?) is unspecified. On a static-first site the only server surface is `api/send-invoice`; the browser→Supabase insert (AD-5) has no server hop to rate-limit in-app, so its rate limiting *must* be Cloudflare-edge-level. The AD should say so, or two builders will diverge (one assumes the endpoint self-limits, the other assumes the platform does, and the anon insert path gets neither).

**Finding (low):** **AD-13's "same island interface" seam is named but not defined.** The rule says a future live-generation endpoint swaps "behind the same island interface" — good intent, but the interface contract (props/return shape the island consumes) isn't specified, so the seam is only as real as the first implementer makes it. A one-line contract would make the seam enforceable.

## Criterion 3 — Could anything under Deferred let two units diverge?

**Mostly safe — one concern.** The deferrals are well-guarded: live-preview is behind the AD-13 seam, Quebec tax has a structured rates config, referral fulfillment has a fixed attribution shape (AD-4), community/agent properties are out of scope.

**Finding (low → medium):** **"Analytics tool choice" deferral defers more than the tool.** As noted in Criterion 1, deferring the tool is fine, but the *event names and UTM parameter conventions* should be fixed now, because every capture island and the calculator will emit events independently and any inconsistency (e.g. `waitlist_submit` vs `waitlistSubmit` vs `submit_waitlist`) directly corrupts SM-1..SM-4, which are computed from these events. The attribution/perk deferral is safe; the analytics event-contract deferral is the one that can let units diverge. Pin the event vocabulary in the spine even while deferring the tool.

## Criterion 4 — Is named tech verified-current?

**Finding (HIGH): The Astro version pin is stale.** The Stack table pins `Astro ^5 (stable; Astro 6 in beta — confirm at cold-start)`. As of the authoring date (2026-09-28) this is already wrong: **Astro 6 shipped stable on 2026-02-10, and Astro 7 is the current line (7.3.1, released 2026-09-03).** So on the day this spine was written, Astro 5 was two majors behind, Astro 6 was not "in beta" (it was ~7 months stable), and new projects should default to Astro 7. The spine even self-labels the stack as "verified current at authoring (2026-09-28)" — this specific claim is not accurate.

Impact is limited because the spine (correctly) says "the code owns this once it exists. Re-verify pins at cold-start," and the adapter/React/Tailwind pins are floating majors. But the flagship framework pin being two majors stale in a table stamped "verified current" is exactly the kind of thing this criterion exists to catch. Recommend updating to `Astro ^7` (or explicitly `^6` LTS with a stated reason) and removing the "6 in beta" parenthetical.

**Other pins — acceptable:**
- `@supabase/supabase-js ^2` — current; **note (low):** Supabase is migrating anon/service_role → publishable (`sb_publishable_*`)/secret (`sb_secret_*`) keys, deprecating the old names by end of 2026. AD-5/AD-6 use "publishable (anon) key" language, which is forward-compatible, but the spine should be aware the literal `anon`/`service_role` names are on a deprecation path within this project's lifetime.
- `resend ^6 (match app 6.12.x)` — consistent with project-context (Resend 6.12.3). Good.
- `Tailwind v4 (match app)` — consistent. Good.
- `React ^19`, `pdf-lib ^1.17`, `TypeScript ^5` — reasonable.
- `Cloudflare Turnstile / Pages/Workers` — current, verified working with Supabase.

## Criterion 5 — Does it ratify rather than needlessly contradict the brownfield?

**Yes — the decoupling is deliberate and well-justified, and the intentional divergences are all defensible:**
- Astro (vs app's Next.js 16) — justified by static-first paradigm.
- Cloudflare (vs app's Vercel) — resolved decision in PRD Open Q5 / NFR-8.
- Browser→Supabase insert with insert-only RLS (vs app's strict "never write from client; all writes through guarded `mutate.ts` under user JWT") — this is a real contrast, but it's *sound*: the app's rule protects multi-tenant `records` under membership RLS; the marketing leads table is single-purpose, anonymous, insert-only, on its own policies. AD-12's "dedicated leads table with its own policies" correctly firewalls this. Not a needless contradiction.

**It actively ratifies the load-bearing app invariants:** Supabase ca-central-1 residency (AD-11, marked `[ADOPTED]`), server-only secrets (AD-6), ISO-8601 dates + snake_case DB / the money-in-minor-units and UUID conventions, and the shared-Supabase-project-only rule. Good brownfield discipline.

**Finding (low):** **`NEXT_PUBLIC_` is a Next-ism carried into an Astro project.** The PRD (FR-16, §11) and app both say "never `NEXT_PUBLIC_`." In Astro the client-exposed prefix is `PUBLIC_`, not `NEXT_PUBLIC_`. The spine's AD-6 wisely uses an *allowlist* framing rather than the prefix, which sidesteps this — but the Consistency-Conventions/secrets row and any inherited copy should make clear the Astro convention is `PUBLIC_`, so a builder doesn't cargo-cult `NEXT_PUBLIC_` (which Astro ignores, silently failing to expose) or, worse, invert the mental model. Minor, but a concrete foot-gun at the exact boundary AD-6 protects.

## Criterion 6 — Does it cover the driving spec's capabilities? (FR/NFR home check)

Walking the Capability→Architecture Map against FR-1..18 / NFR-1..8:

| FR/NFR | Home in map? | Notes |
|---|---|---|
| FR-1..18 | Yes | All present (FR-3..6 grouped; FR-13 under demo/partner; FR-18 = copy) |
| NFR-1..3, 8 | Yes | CWV/SEO/AEO → whole site; residency → AD-11/12 |
| **NFR-4 (Accessibility, WCAG 2.1 AA)** | **NO** | **Not in the Capability→Architecture Map and no AD binds it.** |
| **NFR-5 (Bilingual)** | Partial | AD-14 governs it, but NFR-5 is not listed as a row in the map (FR-9/FR-18 are). |
| **NFR-6 (Analytics)** | Weak | Only a Consistency-Conventions row; no AD, no map row. |
| **NFR-7 (Resilience/independence)** | Partial | AD-8 (blog degrade) + AD-7 (calc offline) + AD-12 cover it in pieces; NFR-7 has no explicit map row tying them together. |

**Finding (HIGH → but scoped): NFR-4 (Accessibility) has no home.** WCAG 2.1 AA is a hard NFR in the PRD (§10) and is explicitly tied to SEO/AEO. Nothing in the spine — no AD, no convention row, no map entry — governs accessibility. On a static-first site much of this (semantic markup, alt text, focus states, contrast, keyboard nav) is a per-component discipline that *will* diverge without an invariant. This is a whole PRD requirement with zero architectural home. Recommend an AD or at least a Consistency-Conventions row + map entry making WCAG AA a build-time gate (e.g. axe/lighthouse-a11y in CI alongside the CWV budget).

**Finding (medium): map has two ID errors that undermine its job as the traceability artifact.**
- Row "Positioning / examples (FR-3..6)" is governed by "AD-1, AD-14, **AD-18**" — **there is no AD-18** (ADs run 1–14). Likely meant AD-2 or a typo for a convention. A dangling reference in the one table whose purpose is FR→AD traceability.
- **There is no FR-14-labeled "AD" issue, but note the AD list itself skips cleanly 1–14; the map is where the numbering breaks.**

**Finding (low): FR-13 (partner entry) and FR-15 (testimonials) are covered but thinly.** FR-13 is folded into FR-12's form ("may reuse... with a partner flag") — fine, but the map row lumps FR-12/13 and no AD governs the partner-flag field's relationship to the Lead `source` enum (partner is not one of `{waitlist, calculator, demo, referral}`). Either partner routes to `source=demo` with a flag (say so) or the enum needs a value — currently ambiguous, a small AD-4 divergence risk.

## Criterion 7 — Is every dimension the altitude owns decided, deferred, or an open question? (operational envelope check)

This is the criterion the spine most under-serves.

**Finding (HIGH): The operational/environmental envelope is almost entirely silent.** The spine owns an initiative-altitude property with its own repo and its own Cloudflare deploy (AD-12), which means it owns its operational envelope — and most of it is neither decided, deferred, nor listed as an open question:

- **CI/CD — silent.** No pipeline, no build/deploy trigger, no quality gates. The app has an explicit CI contract (lint incl. the secret-in-bundle rule, type-check, RLS test, preview-per-PR, prod-on-merge). The marketing site inherits none of this and defines none. Given AD-8's "rebuilds refresh content (scheduled or webhook-triggered)" and AD-6's secret discipline, CI/CD is squarely owned here and is blank.
- **Environments — silent.** No mention of preview vs production, no staging, no branch→environment mapping. Cloudflare Pages has a preview/production model; the spine doesn't decide how it's used.
- **Observability — silent.** No error tracking for the one live endpoint (`send-invoice`). The app uses Sentry; the marketing site names nothing for endpoint errors, failed Resend calls, or failed PersonaPress build fetches (AD-8 says "degrade to last-known/empty" but nothing says the failure is *observed/alerted*). Analytics (NFR-6) is product telemetry, not ops observability — the latter is missing entirely.
- **Secrets management — partial.** AD-6 decides *what* is server-only and *where* it may be referenced, but not *how/where secrets are stored* (Cloudflare Workers secrets / env bindings) or how they differ per environment. The "how it's managed" half of secrets management is silent.
- **Rollback — silent.** No rollback story (Cloudflare Pages keeps immutable deployments and supports instant rollback — a one-line ratification would close this).
- **Build-refresh scheduling (AD-8)** — the *mechanism* ("scheduled or webhook-triggered") is named as an either/or but not decided or turned into an open question. Who triggers the rebuild when PersonaPress publishes? Undecided and unflagged.

Several of these are near-trivial to close on Cloudflare (rollback, environments, secrets storage are platform-native), but "trivial to close" is not the same as "decided." Per the criterion, a whole dimension left silent is a flag, and the operational envelope is the dimension most left silent. Recommend an "Operations & Delivery" section (or ADs) that at minimum: (a) states the CI/CD pipeline and its gates, (b) decides preview/prod environments, (c) names endpoint observability, (d) locates secret storage, (e) ratifies Cloudflare rollback, (f) decides the blog rebuild trigger.

**Well-covered dimensions (for balance):** data model (single Lead table, decided), data residency (AD-11), rendering strategy (AD-1), interactivity model (AD-2), i18n (AD-14), security/secrets *policy* (AD-6), abuse (AD-10), decoupling (AD-12), the external-dependency degrade posture (AD-7/AD-8). The *product* architecture is thorough; the *operational* architecture is the gap.

---

## Summary of findings (by severity)

- **[HIGH] C4 — Astro version pin stale.** Spine pins `Astro ^5`, calls Astro 6 "in beta"; in fact Astro 6 stable shipped 2026-02-10 and Astro 7.3.1 is current (2026-09-03). The "verified current at authoring" stamp is inaccurate for the flagship framework. Update to `^7` (or justified `^6` LTS).
- **[HIGH] C7 — Operational/environmental envelope largely silent.** No CI/CD, environments, observability, rollback, secret-storage, or blog-rebuild-trigger decisions; secrets management is policy-only. A whole owned dimension left undecided/unflagged.
- **[HIGH/scoped] C6 — NFR-4 (Accessibility, WCAG 2.1 AA) has no home.** No AD, convention row, or map entry, despite being a hard PRD NFR tied to SEO/AEO.
- **[MEDIUM] C2 — AD-6 enforcement not mechanized.** The app backs the identical rule with a build-failing lint gate; the spine asserts it with no mechanism, and Astro's boundary is looser than Next's.
- **[MEDIUM] C6 — Map integrity errors.** Dangling `AD-18` reference (only AD-1..14 exist); NFR-4/5/6 missing/weak as map rows; FR-13 partner path has no clear Lead `source` mapping (partner ∉ the enum).
- **[MEDIUM] C3/C1 — Analytics event contract deferred, not just the tool.** Event names + UTM conventions should be pinned now; SM-1..4 are computed from them and will corrupt if islands diverge.
- **[LOW] C1 — SEO-head/structured-data contract for non-blog pages ungoverned** (AD-8 only covers the blog).
- **[LOW] C2 — AD-10 rate limiting unlocated;** the anon insert path has no server hop, so it must be Cloudflare-edge-level — say so.
- **[LOW] C2 — AD-13 seam interface named but not defined.**
- **[LOW] C4 — Supabase anon/service_role key names on a deprecation path** (→ publishable/secret by end 2026); AD language is forward-compatible but should note it.
- **[LOW] C5 — `NEXT_PUBLIC_` is a Next-ism;** Astro's client prefix is `PUBLIC_`. AD-6's allowlist framing avoids the trap, but inherited copy could mislead.

## What's strong (keep)

- The paradigm→layer→location mapping is crisp and directly serves the CWV/SEO mandate.
- AD-4 + AD-5 together make the Lead contract genuinely singular and the write path genuinely non-leaky — the highest-value invariants for this spec, done well.
- AD-12's "single shared resource = a dedicated leads table with its own policies" is exactly the right firewall against brownfield entanglement.
- AD-7 (fully client-side, works with app/endpoints offline) directly satisfies NFR-7 for the lead magnet and de-risks the launch.
- AD-13's canned-preview-behind-a-seam correctly turns PRD Open Q1 into a non-blocking, non-rewriting deferral.
- Brownfield ratification (residency, ISO dates, snake_case DB, secrets posture) is disciplined.
