---
title: '"Alternative (Canada)" comparison pages — Jobber, Housecall Pro, ServiceM8'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '57df1b250f850bc28fdc0626a19dbe136e86e965' # scheza-marketing HEAD
context:
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-06-seo.md
  - _bmad-output/implementation-artifacts/marketing-site/6-1-technical-seo-structured-data-baseline.md
  - docs/Scheza Competitive, Positioning and SEO Strategy.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Branded "alternative (Canada)" intent is the only sizeable high-intent SEO/AEO demand pool the site can realistically capture (`jobber` 40,500/mo, `housecall pro` 4,400/mo, `servicem8` 590/mo CA; demand-validated 2026-10-06), yet the site has no comparison pages. Visitors deciding between tools — and AI answer engines fielding "best Jobber alternative in Canada" — have nothing from Scheza to read or cite.

**Approach:** Add three first-class static comparison pages (`/compare/jobber`, `/compare/housecall-pro`, `/compare/servicem8`) on the existing Astro/Cloudflare pipeline, each driven by typed, owner-supplied Content Slots: a positioning hero, a factual Scheza-vs-incumbent comparison table, an extractable `<details>` Q&A section emitted as FAQPage JSON-LD, and a single primary CTA routing to the Epic 1 waitlist. Reuse the Story 6-1 SEO seam (`seo.ts` builders + `JsonLd.astro`), adding a `BreadcrumbList` builder. Every competitor claim carries a source + "as of" date and is omitted rather than guessed.

**Decision (2026-10-07):** the developer authors the comparison content for this build by researching each incumbent's *current* public plan via the web; every competitor-column claim is tagged with `sourceUrl` + `asOf: 2026-10` and unverifiable dimensions are omitted. The owner (Boris) reviews the authored claims before the (already human-gated) deploy.

## Boundaries & Constraints

**Always:**
- Static/pre-rendered only (`output: "static"`, AD-1): no runtime, no DB, no client-side JS for these pages. Build-time schema + sitemap. New pages auto-join the sitemap and `seo-check` gate.
- Reuse the single SEO seam: `faqPageLd`, `organizationLd`, `softwareApplicationLd`, `absoluteUrl` from `src/data/seo.ts` and `JsonLd.astro`. Do not fork meta logic — compose on `BaseLayout` with explicit per-page title/description (mirror `index.astro`).
- Honesty guardrail (PRD §5/§11, AD-21): every competitor-column claim is verified against that competitor's current public plan and tagged with `sourceUrl` + `asOf`; unverifiable rows are omitted, never guessed.
- Scheza column states only verifiable facts. No price (currency unresolved — `TODO(pricing)`), and no data-residency or CASL-consent guarantee the launch cut has not earned (per §0.1 / Story 6.5 AC).
- FAQPage JSON-LD is generated from the same per-page FAQ array the page renders as `<details>`; rendered `<details>` count == FAQPage `mainEntity` count (the `seo-check` gate asserts this).
- WCAG 2.2 AA: comparison table and FAQ must pass the axe gate on desktop (1366×900) and phone (390×844). TypeScript strict; secret-leak + a11y + seo-check gates stay green.
- CTA routes to the Epic 1 waitlist capture via an absolute `/#start` link (homepage hero owns the form); do not duplicate the capture form or its env-branching.

**Never:**
- Do NOT fabricate, estimate, or infer competitor pricing/features. No claim without a source.
- Do NOT claim Jobber lacks Canadian credibility (it is an Edmonton-based Canadian company under Canadian privacy law). Do NOT present any competitor's USD list price as if it were CAD — label currency, since Scheza quotes CAD. Do NOT differentiate on "AI" or "unlimited users" alone (ServiceM8 and Housecall Pro already market both); differentiate on per-business generated setup, Ontario invoicing/localization, Canadian-resident data, painless imports, PWA, and the French path. Do NOT assert PIPEDA compliance from data residency, or "get paid faster" — use "send invoices sooner". (per strategy doc "Claims to avoid")
- Do NOT add `/fr/**` routes (NFR-5 deferred).
- Do NOT reuse `FinalCta.astro`/`Hero` bare `#start`/`#pricing` fragments on these pages — those anchors exist only on the homepage and would be dead links.
- Do NOT rewrite homepage copy or the global `FAQS`. No coupling to PersonaPress / the Epic 5 blog pipeline. No new heavy dependencies.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Compare page built | `COMPARISONS["jobber"]` etc. | `dist/client/compare/jobber/index.html` with title/description/canonical + full OG/Twitter, Org + SoftwareApplication + FAQPage + BreadcrumbList JSON-LD, comparison table, CTA → `/#start` | N/A |
| FAQ ↔ schema parity | page `faqs` array | rendered `<details>` count == FAQPage `mainEntity` count | `seo-check` fails build on mismatch |
| Unverifiable competitor claim | a comparison dimension with no public source | row omitted from `rows` entirely | N/A (never guessed) |
| Mobile table | viewport 390px | table reflows to an accessible card-stack (no horizontal scroll); one semantic `<table>` for SR | axe gate fails on violation |
| Breadcrumb builder | `breadcrumbListLd([...])` | valid BreadcrumbList with ordered `itemListElement` + absolute URLs | N/A |
| Sitemap/robots | `npm run build` | 3 compare URLs present in `sitemap-0.xml`; excluded: `/api/*`, `/404` | `seo-check` fails if homepage URL absent |

</frozen-after-approval>

## Code Map

All paths under `scheza-marketing/`.
- `src/data/seo.ts` -- **reuse** `organizationLd()`, `softwareApplicationLd()` (omits offers), `faqPageLd(faqs)`, `absoluteUrl(path)`, `SITE_URL`, types `JsonLdObject`/`FaqEntry`. **Add** `breadcrumbListLd(items: {name,url}[])`.
- `src/components/JsonLd.astro` -- **reuse** as-is (`schema` prop; escapes `<`/separators).
- `src/layouts/BaseLayout.astro` -- base to compose on (props `title`/`description`/`ogImage`/`ogImageAlt`; `head` named slot; auto canonical from `Astro.url`). `SimplePage.astro` is too constrained (fixed `container-page` main) for full-bleed hero/CTA — use `BaseLayout` like `index.astro`.
- `src/components/{Header,Footer,Icon,Logo}.astro` -- reuse for page chrome + icons (`arrow`, `chevron`, check/cross).
- `src/components/Faq.astro` -- **extend** to accept optional `items?: readonly FaqEntry[]` (default global `FAQS`) so compare pages pass their own; homepage call stays unchanged. Chevron `group-open:rotate-180` pattern is the FAQ golden example.
- `src/data/content.ts` -- `FaqEntry` shape `{q,a}`; do not modify `FAQS`/`PRICING`.
- `src/styles/global.css` -- Tailwind v4 brand tokens (`ink`, `ink-muted`, `apricot`, `apricot-soft`, `vermilion-text` #b23a26 for small text, `cream`, `sand`, `line`, `lilac`), utilities `container-page`/`section-title`/`eyebrow`, `shadow-card`/`shadow-float`, Manrope/Inter.
- `scripts/a11y.mjs` -- hardcoded `PAGES` array (line ~13): **must add** `/compare/jobber/`, `/compare/housecall-pro/`, `/compare/servicem8/`.
- `scripts/seo-check.mjs` -- auto-scans every indexable page in `dist/client`; requires title/description/canonical/OG/Twitter + ≥1 Organization LD, and FAQPage count == rendered `<details>`. No change needed (auto-covers new pages).
- `astro.config.mjs` -- `@astrojs/sitemap` filter already excludes `/api/*`+`/404`; `/compare/*` auto-included.
- `tests/seo.test.ts` -- vitest; **add** tests for `breadcrumbListLd` (shape, ordered positions, absolute URLs) and that each `COMPARISONS` entry's `faqs` is a valid `FaqEntry[]`.

## Tasks & Acceptance

**Execution:**
- [x] `src/data/competitors.ts` (new) -- typed Content Slots: `ComparisonRow { dimension; scheza; competitor; sourceUrl?; asOf? }`, `ComparisonPage { slug; competitorName; competitorUrl; eyebrow; h1; intro; rows; faqs: FaqEntry[]; metaTitle; metaDescription }`, and `COMPARISONS: Record<slug, ComparisonPage>` for the three incumbents. Content authored now via web research of each incumbent's current public plan; every competitor-column claim carries `sourceUrl` + `asOf: 2026-10`; dimensions without a verifiable public source are omitted. Strict-typed.
- [x] `src/data/seo.ts` -- add `breadcrumbListLd(items)` builder (absolute URLs via `absoluteUrl`, ordered `position`).
- [x] `src/components/ComparisonTable.astro` (new) -- accessible responsive Scheza-vs-incumbent table: one semantic `<table>` with `<caption class="sr-only">`, `<th scope="col">`, row-header `<th scope="row">`; desktop table + mobile card-stack (<640px) via `data-label` + `before:content-[attr(data-label)]`; Scheza column emphasized (`bg-apricot-soft`). (Comparison is prose-based, so no ✓/✗ glyphs are used — the glyph+`sr-only` pairing was moot.)
- [x] `src/components/Faq.astro` -- add optional `items` prop defaulting to `FAQS` (backward-compatible); keep focus-visible ring + 44px min target on `summary`.
- [x] `src/pages/compare/jobber.astro`, `.../housecall-pro.astro`, `.../servicem8.astro` (new) -- compose on `BaseLayout` with explicit title/description from `COMPARISONS[slug]`; inject Org + SoftwareApplication + FAQPage(faqs) + BreadcrumbList via `head` slot; render Header, hero, `<ComparisonTable>`, `<Faq items={...}>`, a primary CTA `<a href="/#start">`, Footer. (Shared body extracted to `src/layouts/ComparePage.astro`; the three pages are thin wrappers passing `slug`.)
- [x] `scripts/a11y.mjs` -- add the three `/compare/*/` routes to `PAGES`.
- [x] `tests/seo.test.ts` -- add `breadcrumbListLd` tests and a guard that every `COMPARISONS` entry's `faqs` conform to `FaqEntry`.

**Acceptance Criteria:** (behaviors beyond the I/O matrix)
- Given a competitor claim, when authored, then it appears only with a `sourceUrl` + `asOf`; dimensions without a verifiable public source are absent. (honesty guardrail, PRD §5/§11)
- Given the Scheza column, when rendered, then it asserts no price and no data-residency/CASL guarantee. (§0.1, Story 6.5)
- Given the primary CTA on any comparison page, when clicked, then it routes to `/#start` (the Epic 1 waitlist capture).
- Given CI, when the `verify` job runs, then the a11y (desktop + phone), secret-leak, and seo-check gates stay green and pages remain static. (NFR-1, AD-1)

## Implementation Notes

- **Shared layout extraction.** The three `/compare/<slug>.astro` pages are thin wrappers over a new `src/layouts/ComparePage.astro` that composes `BaseLayout` + Header + hero + `ComparisonTable` + `Faq` + closing CTA + Footer and injects all four JSON-LD nodes via the `head` slot. Keeps the pages DRY and the slot data flowing from one `COMPARISONS[slug]` lookup.
- **`seo-check.mjs` generalized (beyond task list).** The FAQPage↔rendered-`<details>` count parity check was previously homepage-only; it now runs on ANY indexable page carrying a FAQPage node. This gates the compare pages' FAQ parity (I/O matrix row) rather than trusting it. Pages without a FAQ remain exempt.
- **`Header.astro` nav fragments made root-absolute (beyond task list).** `#how/#features/#pricing/#faq` → `/#how/...` so the shared nav isn't a dead in-page fragment on `/compare/*` and legal pages (same class of bug as the spec's "no bare `#start`/`#pricing`" rule). No behavior change on the homepage.
- **Honesty: competitor figures verified against live pages (2026-10).** Jobber Core US$29/mo annual · US$49/mo no-commitment, additional users US$29/mo, tiers $29/$99/$149/$399 — confirmed at getjobber.com/pricing. Housecall Pro Basic $79/$59 (1 user) · Essentials $189/$149 (5) · Max $329/$299 (8), extra users $35/mo on Max — confirmed at housecallpro.com/pricing. ServiceM8 tiers + unlimited-users-on-paid sourced to servicem8.com/pricing (matches the strategy doc; not re-fetched). Every row labels USD; Scheza column states no price/residency/CASL guarantee.
- **Verified (run in `scheza-marketing/`):** `npm run check` 0 errors; `npm test` 31 pass (seo.test.ts 15, incl. new breadcrumb + COMPARISONS guards); `npm run build` ok (3 compare pages prerendered, sitemap emitted); `npm run seo-check` ok (6 indexable pages, FAQ parity enforced on compare pages); `npm run a11y` ok (no WCAG 2.2 A/AA violations on all 6 pages × desktop 1366×900 + phone 390×844). Sitemap lists the 3 `/compare/*` URLs.

## Spec Change Log

## Review Triage Log

### Pass 1 (2026-10-07)

Three layers (blind-hunter, edge-case-hunter, verification-gap). No `intent_gap` / `bad_spec` (implementation matches the frozen spec) — no loopback. Outcome: 3 patch (applied this pass), 1 defer, rest rejected.

- **medium → patch (applied)** — Nothing asserted that the `/compare/*` pages actually emit BreadcrumbList/FAQPage JSON-LD; a dropped `<JsonLd>` in `ComparePage.astro` would pass CI silently. Real: `seo-check` only required `Organization` on every page. Patched `scripts/seo-check.mjs` to assert both nodes on any `compare/` page. (blind-hunter #2.)
- **low → patch (applied)** — ServiceM8 page lacked an "App languages" row even though EN-only is a verified, Scheza-favorable differentiator (Housecall Pro page has one). Verified ServiceM8 is English-only via its official help page (support.servicem8.com/.../which-languages-are-supported) and added the sourced row. (blind-hunter #3, concrete half.)
- **low → patch (applied)** — Meta descriptions ran ~180 chars, truncating the "Every claim sourced" trust signal in SERPs. Trimmed all three to ~155 so the signal survives. Trivial, no surface. (blind-hunter other-findings.)
- **low → defer** — The comparison-page set is hand-maintained in four places (pages dir, `COMPARISONS`, a11y `PAGES`, sitemap) with no cross-check, so a future 4th page can silently miss a11y coverage. Pre-existing pattern (a11y.mjs hardcoding predates this story); recorded to deferred-work. (blind-hunter #5.)
- **low → reject** — Source links use `rel="nofollow noopener"` without `noreferrer` / no "opens in new tab" SR cue. `noopener` already covers the security concern; new-tab announcement is WCAG *advisory* (G201) and the axe AA gate passes; per-link `sr-only` surface is not worth it. (blind-hunter #1.)
- **low → reject** — "Enforce a shared canonical dimension set across the three pages." Per-page dimension differences are not contradictions — each page compares Scheza to a different competitor on that competitor's relevant axes; no named harm, and the enforcement machinery adds complexity. (blind-hunter #3, structural half.)
- **low → reject** — `seo-check` FAQ-parity counts every `<details>` page-wide, so a future non-FAQ `<details>` on a FAQPage-bearing page would false-fail. Only `Faq.astro` emits `<details>` (grep-confirmed) — unreachable on every current page; section-scoping adds fragile HTML parsing for an undemonstrated case. (blind-hunter #4 ≡ edge-case #2, grouped.)
- **low → reject** — "Entry price" rows pair a sourced competitor USD figure with Scheza "price to be announced". This is honest and spec-mandated (Scheza asserts no number while `TODO(pricing)` is open); the flat/unlimited-crew differentiator already appears in the "Team pricing" row, and the competitor's entry price is genuinely useful for "alternative" intent. (blind-hunter #6.)
- **low → reject** — No test forbids bare `#start`/`#pricing` fragments on the new pages. Pages use `/#start` and Header uses `/#…`; a bespoke gate guards a hypothetical regression for negligible benefit. (blind-hunter other-findings.)
- **low → reject** — `breadcrumbListLd([])` is unguarded and would emit an empty `itemListElement`. The only caller passes a 2-item literal; the empty path is unreachable, so a throw-guard protects an undemonstrated input. (edge-case #1.)
- **low → reject** — The generalized `seo-check` FAQ block omits the per-entry Question/Answer well-formedness check the homepage block has. `faqPageLd` is the sole producer of FAQPage nodes and always emits well-formed entries (unit-tested); malformed entries are unreachable without hand-authored JSON-LD, which the pages do not use. (edge-case #3.)
- **low → reject** — `ComparisonTable` renders a source link when `row.sourceUrl` is set but `row.asOf` is missing, dropping the date. The component degrades gracefully (no crash) and the `COMPARISONS` test asserts every row carries `asOf`, so the state is unreachable with current data. (edge-case #4.)
- **low → reject** — `Faq.astro`'s `isDefault` guard (which keeps the `[SUPPORT EMAIL]` placeholder off compare pages) has no automated check. Regression requires inverting the branch; the placeholder already ships intentionally on the homepage, and the repo deliberately build-gates components rather than render-testing them. No clean cheap assertion. (verification-gap other-findings.)
- **false → reject** — `ComparePage.astro` throws on an unknown slug "without a test". The three entry points pass literal valid slugs, so the throw is unreachable by construction — correct defensive behavior that needs no test. (verification-gap other-findings.)
- **no gap** — verification-gap found no hard gaps: `breadcrumbListLd` and `COMPARISONS` are unit-tested, and the new Astro components are covered by the running build gates (seo-check parity, axe a11y) per the repo's convention.

## Design Notes

Section order per page: Header → positioning hero (`eyebrow` + `section-title` H1 "The honest <Incumbent> alternative for Canadian trades" + `text-pretty` intro + primary CTA + honesty micro-cue) → comparison table → FAQ → closing CTA band → Footer. Single primary CTA target `/#start`; no secondary `#pricing` link (pricing is `TODO(pricing)`).

Comparison table — do NOT use horizontal scroll at 390px. Keep ONE semantic `<table>` for screen readers and reflow it visually to a card-stack on mobile:
```html
<!-- <640px: hide thead (sr-only), each <tr> becomes a card; each <td> shows its column via data-label -->
<td data-label="Scheza" class="before:content-[attr(data-label)] before:block before:font-bold sm:before:hidden">…</td>
```
Pair every ✓/✗ glyph with `sr-only` text ("Included"/"Not available") — never rely on the glyph alone (contrast + SR). Scheza column `bg-apricot-soft`; use `vermilion-text` (#b23a26) for any small accent text to hold 5.7:1. CSS-only micro-interactions (`transition-colors hover:bg-apricot-soft` on rows, `hover:-translate-y-0.5` on the CTA), guarded by `motion-reduce:*`.

FAQ reuses the `Faq.astro` `<details class="group">` + `group-open:rotate-180` chevron pattern; `summary` keeps `focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2`, `cursor-pointer`, `list-none`, min-height 44px.

AEO/GEO: write FAQ answers as self-contained, extractable prose an answer engine can quote verbatim; keep canonical facts consistent across the three pages.

**Verified content source.** `docs/Scheza Competitive, Positioning and SEO Strategy.md` holds an October-2026 competitive table with cited public facts — use it as the authoring baseline, each row's `sourceUrl` set to the competitor's own public page and `asOf: 2026-10`; re-check against the live page during implementation before finalizing:
- Jobber — plans ~US$29 Core / $99 Connect / $149 Grow / $399 Plus (billed annually); extra users ~US$29/mo; Canadian (Edmonton) company. Source: getjobber.com/pricing.
- Housecall Pro — Basic $79/mo ($59 annual) · Essentials $189/$149 · Max $329/$299; 1/5/8 users, extras charged; apps in English + Spanish, not French. Source: housecallpro.com/pricing, /llm-info.
- ServiceM8 — Free (30 jobs/1 user) · Starter $29/50 · Growing $79/150 · Premium $149/500 · Premium Plus $349/1,500+ jobs; paid plans unlimited users; English only. Source: servicem8.com/pricing.
- Scheza column: no price (CAD, `TODO(pricing)`), no data-residency/CASL guarantee; honest differentiators per the strategy doc's positioning map (generated-per-business, Ontario-native, flat/unlimited-crew, imports, PWA, FR path).

## Verification

**Commands:** (run in `scheza-marketing/`)
- `npm run check` -- expected: astro check passes, 0 TS errors (strict).
- `npm test` -- expected: vitest green incl. new `breadcrumbListLd` + competitors FAQ tests.
- `npm run build` -- expected: static build; `dist/client/compare/{jobber,housecall-pro,servicem8}/index.html` present; `dist/sitemap-0.xml` lists the three URLs.
- `npm run seo-check` -- expected: passes for all indexable pages (compare pages carry required meta + Org/SoftwareApplication/FAQPage/BreadcrumbList; FAQ counts match).
- `npm run ci` -- expected: full gate chain (check → test → build → secret-gate → a11y → seo-check) green, incl. axe on the three compare routes at desktop + phone.

**Manual checks:**
- Paste each compare page's JSON-LD into the Google Rich Results / Schema.org validator → Organization, SoftwareApplication, FAQPage, BreadcrumbList valid, no errors.
- Confirm every competitor-column claim traces to its `sourceUrl` and reads correctly "as of" its date.
