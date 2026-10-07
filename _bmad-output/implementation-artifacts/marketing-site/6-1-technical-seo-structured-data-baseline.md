---
title: 'Technical SEO + structured-data baseline (site-wide)'
type: 'feature'
created: '2026-10-07'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '481804631d21f1d92931ec839ac625014b5475ba' # scheza-marketing HEAD
context:
  - _bmad-output/planning-artifacts/sprint-change-proposal-2026-10-06-seo.md
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The marketing site (`scheza-marketing/`) shipped under a lean launch cut that deferred NFR-3. It has a bare meta layer and **zero structured data**: no XML sitemap, no JSON-LD (Organization / SoftwareApplication / FAQPage), incomplete OG/Twitter tags, and no CI guard. Crawlers and AI answer engines have nothing machine-readable to cite, so the SEO/AEO guarantee is unmet.

**Approach:** Add a site-wide technical SEO + structured-data baseline on the existing static Astro/Cloudflare pipeline: a reusable `head` slot on the layout, an `@astrojs/sitemap` build-time sitemap wired into `robots.txt`, typed JSON-LD builders (Organization + SoftwareApplication site-wide, FAQPage on the homepage derived from the existing `FAQS`) injected through the slot, and a CI structured-data sanity check over the built HTML. This is the technical/structured-data half only; the homepage keeps its conversion copy per the approved 2026-10-06 SEO re-scope.

## Boundaries & Constraints

**Always:**
- All pages stay static/pre-rendered (`output: "static"`, AD-1); sitemap and schema are build-time only — no runtime, no DB, no client-side JS for SEO.
- JSON-LD must match visible content: FAQPage is generated from the same `FAQS` array the page renders, so copy and schema cannot drift.
- Emit only verifiable facts; omit unknown fields rather than guess (honesty guardrail, PRD §5/§11). SoftwareApplication omits `offers`/price until `TODO(pricing)` resolves currency; no social `sameAs` or contact email until supplied.
- TypeScript strict; reuse `BaseLayout` as the single meta owner (do not fork meta logic); secret-leak and axe gates stay green.
- Canonical / OG URLs resolve from `Astro.site` (`https://scheza.com`).

**Never:**
- Do NOT rewrite the homepage copy, H1, or title to the strategy-doc keyword skeleton ("job management software for contractors") — explicitly out of scope (approved course-correction; 10/mo demand, PRD §14.1).
- Do NOT build `/compare/**` or `/resources/**` pages (Stories 6-2 / 6-3) — only the reusable infra they will import.
- Do NOT add `/fr/**` routes (NFR-5 deferred).
- No new heavy dependencies beyond `@astrojs/sitemap` (first-party).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Homepage built | `index.astro`, default meta | `dist/index.html` has title/description/canonical, complete OG+Twitter (incl. image alt), and Organization + SoftwareApplication + FAQPage JSON-LD | N/A |
| Legal page built | `privacy`/`terms` with own title+description | Full meta + canonical + Organization JSON-LD; no FAQPage | N/A |
| Sitemap generated | `npm run build` | `dist/sitemap-index.xml` lists canonical URLs, excludes `/api/*` and `/404` | CI fails if absent |
| robots fetched | `/robots.txt` | Keeps `Disallow: /api/`, adds `Sitemap: https://scheza.com/sitemap-index.xml` | N/A |
| FAQ source edited | `FAQS` array changes | FAQPage JSON-LD regenerates; question count == visible `<details>` count | N/A |
| Malformed JSON-LD | built HTML missing required `@type`/field or invalid JSON | CI structured-data check fails the build | fail with page + reason |
| SoftwareApplication | pricing unconfirmed (`TODO(pricing)`) | schema emitted WITHOUT `offers`/price | N/A |

</frozen-after-approval>

## Code Map

All paths under `scheza-marketing/`. Investigation insights (Tasks below give the edits):
- `src/layouts/BaseLayout.astro` -- **sole meta owner** (props `title`/`description`/`ogImage`, canonical from `Astro.site`); head is currently sealed (no slot). Reuse, do not fork. Missing: `og:image:alt`, `twitter:title`, `twitter:description`, `twitter:image:alt`.
- `src/layouts/SimplePage.astro` -- wraps BaseLayout; used by `privacy`/`terms`/`404`.
- `src/data/content.ts` -- `FAQS: {q,a}[]` (7 entries, rendered by `src/components/Faq.astro`) = single source for FAQPage LD. `PRICING.base` is `"$29"` but currency is `TODO(pricing)` → no price in schema.
- `src/data/brand.ts` -- visual SVG assets only; no company facts (put new facts in `seo.ts`).
- `astro.config.mjs` -- `output:"static"`, `site:"https://scheza.com"`; integrations list is **empty** (no sitemap yet).
- `public/robots.txt` -- has `Disallow:/api/`, no `Sitemap:` line.
- `.github/workflows/ci.yml` -- single `verify` job: check → test → build → secret-gate → a11y. `scripts/a11y.mjs` + `secret-leak-gate.mjs` are the dist-scanning pattern to mirror for `seo-check.mjs`.
- `tests/*.test.ts` -- vitest (`include: tests/**/*.test.ts`), ES imports from `../src/...`.

## Tasks & Acceptance

**Execution:**
- [x] `scheza-marketing/src/data/seo.ts` (new) -- typed canonical facts (`ORGANIZATION`, `SOFTWARE_APPLICATION`) + pure builders `organizationLd()`, `softwareApplicationLd()` (omits `offers`), `faqPageLd(faqs)`. Single source of truth reused by 6-2/6-3.
- [x] `scheza-marketing/src/components/JsonLd.astro` (new) -- serialize a passed object into `<script type="application/ld+json">` with safe escaping; avoids hand-written script tags.
- [x] `scheza-marketing/src/layouts/BaseLayout.astro` -- add `<slot name="head"/>`; complete OG/Twitter tags with alt text; keep canonical logic.
- [x] `scheza-marketing/src/layouts/SimplePage.astro` -- forward `head` slot to BaseLayout; emit Organization LD for legal/404 pages.
- [x] `scheza-marketing/src/pages/index.astro` -- explicit homepage title/description; inject Org + SoftwareApplication + FAQPage(FAQS) via head slot. No copy change.
- [x] `scheza-marketing/src/pages/{privacy,terms,404}.astro` -- add meaningful descriptions; confirm canonical.
- [x] `scheza-marketing/astro.config.mjs` + `scheza-marketing/package.json` -- add `@astrojs/sitemap` (filter out `/api/*`, `/404`) + dependency.
- [x] `scheza-marketing/public/robots.txt` -- add `Sitemap: https://scheza.com/sitemap-index.xml`.
- [x] `scheza-marketing/scripts/seo-check.mjs` (new) + `package.json` `seo-check` script (chained into `ci`) + `.github/workflows/ci.yml` step after build -- parse `dist/` HTML: every indexable page has title/description/canonical/OG; homepage has valid, parseable Org + SoftwareApplication + FAQPage LD with required fields and FAQPage count == `FAQS.length`; `dist/sitemap-index.xml` exists. Fail with page + reason.
- [x] `scheza-marketing/tests/seo.test.ts` (new) -- vitest unit tests for the builders (shape + required fields, SoftwareApplication omits offers, `faqPageLd` maps `FAQS` 1:1 and escapes).

**Acceptance Criteria:**
- Given any indexable page (`/`, `/privacy`, `/terms`), when the site is built, then its HTML emits a correct title, meta description, canonical, and complete Open Graph + Twitter card tags with image alt text. (NFR-2)
- Given the built site, when the sitemap is generated, then `dist/sitemap-index.xml` lists canonical URLs of indexable pages and excludes `/api/*` and `/404`, and `robots.txt` references it via a `Sitemap:` directive. (NFR-2)
- Given the homepage, when rendered, then it contains valid Organization + SoftwareApplication + FAQPage JSON-LD whose FAQ entries exactly match the visible FAQ content, and SoftwareApplication omits price/offers. (NFR-3, honesty guardrail)
- Given legal/404 pages, when rendered, then Organization JSON-LD is present and no FAQPage schema appears where there is no FAQ content.
- Given CI, when the `verify` job runs, then the structured-data step fails the build on any missing/malformed JSON-LD, missing sitemap, or incomplete page meta; pages stay static and the a11y + secret-leak gates stay green. (NFR-1, AD-1, AD-6, AD-19)
- Given the homepage copy, when the story is complete, then its H1/title/positioning copy is unchanged (no keyword skeleton applied).

## Implementation Notes

- **`dist/` layout.** The Cloudflare adapter emits static HTML to `dist/client/` (not `dist/`); `@astrojs/sitemap` writes there too. `seo-check.mjs` scans `dist/client` — the same directory the existing a11y and secret-leak gates use. Spec text that said `dist/index.html` is realized as `dist/client/index.html`.
- **Sitemap shape.** `@astrojs/sitemap` 3.7.4 emits `sitemap-index.xml` (the index) + `sitemap-0.xml` (the URL set). The config `filter` excludes `/api/*` and `/404`; verified in the built `sitemap-0.xml` (lists only `/`, `/privacy/`, `/terms/`).
- **seo-check hardening (post-dispatch).** Extended `seo-check.mjs` beyond the dispatched version to parse `sitemap-0.xml` and fail if the homepage URL is absent or any `/api/`/`/404` URL is listed — so the AC's "excludes /api and /404" is gated, not just config-guaranteed. Proven to fail on injected bad `<loc>` entries.
- **Honesty guardrail enforced in two places.** `softwareApplicationLd()` omits `offers`/price, and `seo-check.mjs` fails the build if `offers`/`price` ever appear on the homepage SoftwareApplication node (pricing currency unresolved — `TODO(pricing)`).
- **Verified:** `npm run check` 0 errors; `npm test` 24 pass (8 new); `npm run build` ok; `npm run seo-check` ok (3 indexable pages). Homepage carries Organization + SoftwareApplication + FAQPage (7 Q&A == 7 rendered `<details>`).
- **Review pass 1 patches (2026-10-07):** (1) `seo-check.mjs` no longer imports `src/data/content.ts` — that `.ts` import crashed the gate on CI's pinned Node 20 (`ERR_UNKNOWN_FILE_EXTENSION`; it only ran locally on Node 24). The gate now counts the rendered FAQ `<details>` in the built homepage and asserts the FAQPage entry count matches — Node-20-safe and a truer "matches visible content" check. (2) `ORGANIZATION.logoPath` changed from `/og-image.png` (a 1200×630 social card) to `/icon-512.png` (a real square logo mark). Both re-verified green. See Review Triage Log.

## Spec Change Log

## Review Triage Log

### Pass 1 (2026-10-07)

- **high → patch** — `scripts/seo-check.mjs:16` `import { FAQS } from "../src/data/content.ts"` crashes the gate on CI's pinned Node 20 (ci.yml:24) with `ERR_UNKNOWN_FILE_EXTENSION` (no TS type-stripping before Node 22.18/23.6); passed locally only because local Node is v24.11.1. Gate never scans a page. (blind-hunter #1 ≡ verification-gap #1, grouped — same root cause.)
- **low → patch** — `src/data/seo.ts` `ORGANIZATION.logoPath: "/og-image.png"` uses a 1200×630 social-share card as `Organization.logo`; valid schema but a poor logo for knowledge-panel/AEO. Square assets already exist (`public/icon-512.png`, `public/brand/scheza-symbol-full-color-ink.svg`). Fix is a one-line direct correction → bundled into the patch. (blind-hunter #4.)
- **defer** — `src/components/JsonLd.astro` script-breakout escaping (`<`→`<`, U+2028/U+2029) is exercised by no test and, because current copy contains none of those chars, not by the gate either; `tests/seo.test.ts:67-73` ("round-trips…serialization safety") only round-trips the builder via `JSON.stringify`, never rendering the component — misleading coverage. Latent (only bites when content contains `</script>`/separators). (verification-gap #2 + its Other-findings note, grouped.)
- **low → reject** — `SimplePage.astro` does not forward `ogImage`/`ogImageAlt`, so legal/404 pages can't customize the OG image. Rejected: those pages correctly use the default site OG card; no required harm, and the fix adds public surface. (blind-hunter #2.)
- **maybe-false/low → reject** — gate doesn't assert OG/Twitter image URLs are absolute. Rejected: output is already absolute via `new URL(ogImage, Astro.site)` with `site` set; coverage-strength nit only. (blind-hunter #3.)
- **false → reject** — 404 matching "drift" between config `/\/404\/?$/` (URL) and gate `404\.html$` (file path). Rejected: the two operate on different inputs (sitemap URLs vs built file paths) by necessity; no incorrect outcome. (blind-hunter #5a.)
- **false → reject** — possible duplicate/conflicting `Organization` nodes. Rejected: homepage `index.astro` uses `BaseLayout` directly (one Org via its own slot); legal/404 use `SimplePage` (one Org); no page emits two. (blind-hunter #5b.)
- **false → reject** — legal pages' OG/Twitter unchecked beyond presence. Rejected: `REQUIRED_META` runs on every indexable page, privacy/terms included. (blind-hunter #5c.)
- **low → reject** — origin string `https://scheza.com` duplicated across `astro.config.mjs`/`seo.ts`/`robots.txt`, and `flatten-static` REQUIRED omits the sitemap. Rejected: DRY nit (developer-only), and `seo-check` already fails on a missing sitemap (reviewer conceded). (blind-hunter #6.)
- **low → reject** — 404 page has no `noindex`. Rejected: Cloudflare serves `404.html` with a 404 status and it's excluded from the sitemap; adding a meta guard protects an undemonstrated scenario and adds surface. (blind-hunter #7.)
- **low → reject** — no check that `SITE_URL` stays in sync with astro `site`. Rejected: developer-only latent drift, same family as #6; fix adds complexity for an unlikely case. (blind-hunter #8.)

## Design Notes

- **Reusable seam.** `BaseLayout` stays the single meta owner; per-page schema flows through a named `head` slot so Stories 6-2/6-3 reuse the same mechanism. `JsonLd.astro` + the `seo.ts` builders are the surface those stories import.
- **Schema honesty.** Organization = name/url/logo/description. SoftwareApplication = name/`applicationCategory: BusinessApplication`/`operatingSystem: Web`/url/description — NO `offers` until `TODO(pricing)` resolves currency. FAQPage is generated from `FAQS`, never hand-authored.
- **FAQ note.** Google discontinued FAQ rich results in May 2026; FAQPage remains valid structured data, emitted for AEO citation (AI Overviews / Bing Copilot / ChatGPT / Perplexity), not as a rich-result ranking gimmick (PRD §14.1).
- Organization LD shape:
  ```json
  { "@context":"https://schema.org","@type":"Organization","name":"Scheza","url":"https://scheza.com","logo":"https://scheza.com/og-image.png","description":"…" }
  ```

## Verification

**Commands:** (run in `scheza-marketing/`)
- `npm run check` -- expected: astro check passes, no TS errors (strict).
- `npm test` -- expected: vitest green incl. `tests/seo.test.ts`.
- `npm run build` -- expected: static build succeeds; `dist/sitemap-index.xml` present; `dist/index.html` carries Org + SoftwareApplication + FAQPage `ld+json`.
- `npm run seo-check` -- expected: passes; fails loudly on any missing/malformed meta, JSON-LD, or sitemap.
- `npm run ci` -- expected: full gate chain + `seo-check` green.

**Manual checks:**
- Paste `dist/index.html` JSON-LD into Schema.org / Google Rich Results validator → Organization, SoftwareApplication, FAQPage all valid with no errors.
