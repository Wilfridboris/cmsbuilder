---
title: Scheza Marketing Site — SEO Demand Validation
type: research-evidence
created: 2026-10-06
author: Boris (via DataForSEO)
source_tool: DataForSEO MCP — Google Ads Search Volume (Keywords Data API)
feeds: sprint-change-proposal-2026-10-06-seo.md
inputs:
  - "docs/Scheza Competitive, Positioning and SEO Strategy.md"
  - "docs/Scheza Vertical Suite Expansion Strategy(2).md"
---

# SEO Demand Validation — Scheza Marketing Site

Real search-volume evidence for the keyword clusters proposed in the **Competitive/Positioning/SEO Strategy** and **Vertical Suite Expansion Strategy** docs, pulled to decide how much natural SEO value the marketing site can realistically capture and where to point it.

## Method

- **Tool / endpoint:** DataForSEO MCP → `POST /v3/keywords_data/google_ads/search_volume/live` (Google Ads, latest API).
- **Metric:** `search_volume` = Google's trailing-12-month **average monthly searches** (exact, not an estimate band). `cpc` in **USD**. `competition` = paid-SERP competition (LOW/MEDIUM/HIGH + 0–100 index). These are *paid-auction* signals; organic difficulty differs, but high CPC reliably marks high commercial contention.
- **Geos:** **Canada** (`location_code 2124`) and **Ontario** (`location_code 20121`), language English.
- **Date pulled:** 2026-10-06. Window: 2025-09 → 2026-08.
- **Caveat:** Google Ads groups near-duplicate phrases and suppresses data for some low-volume terms; treat ≤20/mo as "effectively zero, directional only." Volumes rounded to Google's buckets (10/20/30/…).

## Headline finding

**The marketing site genuinely has almost no natural SEO value today** (one static EN homepage targeting none of these queries), **and the SEO strategy's own premise — win Ontario trades search — is not supported by demand.** Ontario-geo trades keywords are at or near the noise floor (job management software **10/mo**, hvac software **20/mo**, plumbing software **10/mo**, contractor invoice software **10/mo**). This **confirms the PRD §12 "Why Now" claim** that "Ontario search volume is too thin and category CPCs are too high to buy traffic."

The usable SEO demand that *does* exist sits in three places, none of which the current site or the strategy-doc homepage-keyword plan captures:

1. **Branded comparison / "alternative" intent** — `jobber` 40,500/mo, `housecall pro` 4,400/mo, `servicem8` 590/mo in Canada. This is the single largest, highest-commercial-intent pool, and incumbents rank weakly for a `…alternative Canada` qualifier.
2. **National generic category terms** — `field service management software` 1,000, `invoice software` 720, `property management software` 1,300 — real volume but **brutal CPCs ($42–$275)** signalling entrenched organic competition; a long, slow climb.
3. **The long-tail content moat (AEO/GEO)** — Ontario-specific checklists/templates/calculators and comparison FAQs. These won't register as head-term volume but capture fragmented long-tail queries and AI-answer citations, and earn the backlinks the strategy doc's moat section describes.

**Implication:** SEO for this site should be scoped as a **compounding secondary asset** (comparison pages + AEO content moat), **not** as a primary Ontario-trades traffic channel, and **not** as Ontario-geo landing pages. The warm/referral/outbound engine remains primary exactly as the PRD argues. See `sprint-change-proposal-2026-10-06-seo.md`.

## Canada — national demand (location_code 2124, English)

### Branded & "alternative" intent (highest-leverage SEO target)

| Keyword | Avg monthly | CPC (USD) | Competition |
|---|---:|---:|---|
| jobber | 40,500 | 17.74 | LOW (25) |
| housecall pro | 4,400 | 7.43 | HIGH (67) |
| servicem8 | 590 | 63.19 | MEDIUM (34) |
| jobber alternative | 70 | 56.71 | HIGH (72) |
| housecall pro alternative | 10 | — | MEDIUM (61) |
| servicem8 alternative | 10 | — | — |

> `jobber` volume is inflated by the generic English word and the brand; still, branded demand for the three incumbents is the only four-/five-figure pool in the set.

### Generic category terms (real volume, high CPC / contested)

| Keyword | Avg monthly | CPC (USD) | Competition |
|---|---:|---:|---|
| property management software | 1,300 | 25.82 | LOW (27) |
| field service management software | 1,000 | 74.11 | LOW (20) |
| field service software | 1,000 | 74.11 | LOW (20) |
| invoice software | 720 | 42.37 | MEDIUM (59) |
| contractor management software | 260 | 275.47 | LOW (31) |
| nonprofit software | 210 | 53.82 | MEDIUM (45) |
| restaurant management software | 110 | 23.96 | LOW (19) |
| contractor app | 110 | 24.83 | MEDIUM (66) |
| plumbing software | 110 | 33.49 | MEDIUM (56) |
| invoicing software canada | 90 | 34.72 | HIGH (87) |
| childcare software | 90 | 41.59 | MEDIUM (66) |
| field service app | 70 | 28.41 | MEDIUM (57) |
| job management software | 50 | 63.10 | MEDIUM (51) |
| hvac software | 50 | 94.64 | MEDIUM (54) |
| contractor invoice software | 50 | 68.16 | MEDIUM (39) |
| invoice software for contractors | 50 | 68.16 | MEDIUM (39) |
| hvac business software | 30 | 50.94 | MEDIUM (50) |
| plumbing business software | 30 | 46.62 | LOW (33) |
| plumbing invoice software | 30 | 81.91 | MEDIUM (46) |
| job tracking app | 30 | 52.35 | MEDIUM (58) |
| small business software canada | 30 | 30.43 | LOW (27) |
| hvac scheduling software | 20 | — | MEDIUM (54) |
| agency management software | 10 | 30.97 | MEDIUM (34) |
| retail operations software | 10 | 31.42 | LOW (17) |
| hvac service software | 10 | 157.91 | HIGH (95) |
| hvac invoice software | 10 | — | MEDIUM (36) |
| trade business software | 10 | — | LOW (0) |
| job management software for contractors | 10 | — | — |

**Read:** the strategy doc's proposed homepage primary keyword — *"job management software for contractors"* — is **10/mo nationally and 10/mo in Ontario**. Its qualified head term *"job management software"* is **50/mo nationally, 10/mo Ontario**. These cannot anchor a traffic strategy. The trade-specific terms (`hvac …`, `plumbing …`) are 10–50/mo each.

## Ontario — demand (location_code 20121, English)

| Keyword | Avg monthly | CPC (USD) | Competition |
|---|---:|---:|---|
| field service management software | 390 | 56.00 | LOW (21) |
| invoice software | 320 | 42.02 | MEDIUM (57) |
| contractor management software | 110 | 192.92 | LOW (31) |
| hvac software | 20 | 104.73 | MEDIUM (60) |
| jobber alternative | 20 | 53.45 | HIGH (76) |
| job management software | 10 | 85.71 | MEDIUM (53) |
| hvac business software | 10 | 50.94 | HIGH (86) |
| plumbing software | 10 | 35.58 | MEDIUM (47) |
| contractor invoice software | 10 | 137.93 | LOW (30) |
| job management software for contractors | 10 | — | — |

**Read:** outside two broad generics (`field service management software`, `invoice software`), Ontario trades demand is at the 10–20/mo floor. **Geo-targeted Ontario trades landing pages would compete for near-zero volume.** Ontario-native *trust* content still matters, but as conversion/AEO support, not as a search-traffic bet.

## Vertical Suite Expansion — demand signal (Canada, national)

| Edition candidate | Proxy keyword | Avg monthly | CPC (USD) | Competition |
|---|---|---:|---:|---|
| Scheza Property | property management software | 1,300 | 25.82 | LOW (27) |
| Scheza Community | nonprofit software | 210 | 53.82 | MEDIUM (45) |
| Scheza Restaurant Ops | restaurant management software | 110 | 23.96 | LOW (19) |
| Scheza Care | childcare software | 90 | 41.59 | MEDIUM (66) |
| Scheza Professional | agency management software | 10 | 30.97 | MEDIUM (34) |
| Scheza Retail Ops | retail operations software | 10 | 31.42 | LOW (17) |

**Read:** this *independently corroborates the expansion doc's sequencing* — **Property** has the strongest adjacent search demand (1,300/mo, low competition) and is the doc's Rank-2 edition; Community/Restaurant/Care are modest; Professional and Retail Ops head terms are SEO-thin (the demand there is long-tail / category-specific, not on these generic heads). Nothing here argues for pulling an edition forward ahead of the Service beachhead, but it flags **Property** as the best-supported SEO expansion surface when the suite motion begins.

## What this means for the marketing site (summary)

1. **The "no SEO value" problem is real** but the fix is **not** Ontario-trades landing pages — demand isn't there.
2. **Prioritise:** (a) honest **comparison / "alternative (Canada)" pages** for Jobber / Housecall Pro / ServiceM8 (captures the only sizeable high-intent pool), (b) an **AEO/GEO content moat** (Ontario invoice checklist, HVAC/plumbing templates, "cost of evening admin" calculator, FAQ schema) for long-tail + AI citation, (c) **technical SEO baseline** (static HTML, sitemap, schema.org, canonical) which the lean v1 does not yet fully deliver.
3. **De-prioritise:** chasing generic high-CPC heads (`field service management software`, `contractor management software`) and geo-Ontario trades pages as primary SEO plays.
4. **Keep the PRD's core bet intact:** warm/referral/outbound stays the primary growth engine; SEO/AEO is the slow-compounding secondary asset the PRD already frames it as — the data just tells us *which* SEO surfaces to build.

## Raw data

Full API responses saved alongside this file as `seo-demand-validation-2026-10-06.raw.json` for traceability.
