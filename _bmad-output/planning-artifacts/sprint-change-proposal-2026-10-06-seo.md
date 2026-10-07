---
title: Sprint Change Proposal — Marketing Site SEO Re-scope
date: 2026-10-06
author: Boris (Developer navigating change)
status: approved-and-applied  # Boris approved 2026-10-06; PRD/epics/architecture/sprint-status edits applied
scope_classification: Moderate (backlog reorganization + PRD/architecture edits)
trigger: "The marketing site has no natural SEO value"
evidence: seo-demand-validation-2026-10-06.md (DataForSEO)
inputs:
  - "docs/Scheza Competitive, Positioning and SEO Strategy.md"
  - "docs/Scheza Vertical Suite Expansion Strategy(2).md"
  - _bmad-output/planning-artifacts/prds/prd-marketing-site-2026-09-28/prd.md
  - _bmad-output/planning-artifacts/epics-marketing-site.md
  - _bmad-output/planning-artifacts/architecture/architecture-marketing-site-2026-09-28/ARCHITECTURE-SPINE.md
  - _bmad-output/implementation-artifacts/sprint-status-marketing-site.yaml
supersedes: none  # complements sprint-change-proposal-2026-10-06.md (the launch-profile correction)
---

# Sprint Change Proposal — Marketing Site SEO Re-scope

> This is the **second** course correction dated 2026-10-06. The first (`sprint-change-proposal-2026-10-06.md`) re-baselined the launch to a lean, EN-only static site. This one addresses the SEO gap that lean cut left, and is scoped to the **Lean foundation** option (not the full strategy-doc content tree).

## Section 1 — Issue Summary

**Problem statement.** The launched marketing site (`scheza-marketing-v1`) has effectively **no natural SEO value**: it is a single static EN homepage that targets none of the queries real buyers use, and the launch cut explicitly **deferred NFR-3 (AEO/GEO)** and most content pages to a post-launch Epic 5. Two new strategy documents (`docs/Scheza Competitive, Positioning and SEO Strategy.md` and `docs/Scheza Vertical Suite Expansion Strategy(2).md`) prescribe a full keyword architecture — but they assert search demand ("extensive search demand demonstrated by incumbent content investment") **without validated volume**, and the PRD §12 simultaneously claims Ontario volume is "too thin" to buy. These two positions cannot both drive the backlog; the conflict needed data.

**Discovery & context.** Trigger = Boris's observation during the post-launch review that the site cannot be found. Rather than accept either the strategy doc's optimism or the PRD's pessimism, demand was validated with the **DataForSEO MCP** (Google Ads search volume, Canada + Ontario, pulled 2026-10-06).

**Evidence (full detail in `seo-demand-validation-2026-10-06.md`).**
- Ontario trades keywords are at the noise floor: `job management software` **10/mo**, `hvac software` **20/mo**, `plumbing software` **10/mo**, `contractor invoice software` **10/mo**.
- The strategy doc's proposed homepage primary keyword *"job management software for contractors"* = **10/mo in both Ontario and Canada**.
- The only sizeable high-intent pool is **branded "alternative" demand**: `jobber` 40,500/mo, `housecall pro` 4,400/mo, `servicem8` 590/mo (Canada).
- Generic category heads carry volume but **punishing CPCs** ($42–$275), signalling entrenched competition.
- Vertical-expansion corroboration: `property management software` **1,300/mo** (low competition) is the strongest adjacent surface, matching the expansion doc's Rank-2 "Scheza Property."

**Net:** the "no SEO value" complaint is correct, but the fix is **not** Ontario-trades landing pages. The data redirects SEO to (1) branded comparison / "alternative (Canada)" pages, (2) an AEO/GEO content moat for long-tail + AI citation, (3) a real technical SEO baseline — all as a **compounding secondary asset**, with warm/referral staying primary exactly as the PRD argues.

## Section 2 — Impact Analysis

### Epic Impact
- **Epic 1 (conversion core)** — *mostly intact.* Story **1-6** ("SEO/AEO/accessibility/performance baseline") is marked `review` but was realized under a launch cut that **deferred NFR-3**; its AEO/structured-data half is not actually delivered. Needs tightening, not redoing.
- **Epic 5 (Blog & SEO/AEO assets)** — *re-scoped.* Its comparison-page story **5-4** is now demand-justified and should be **pulled forward** out of the PersonaPress-dependent blog epic into a near-term SEO epic. Epic 5 becomes blog-only.
- **New Epic 6 (SEO foundation & comparison pages)** — *added.* Depends only on the Epic 1 scaffold; deliverable now, in parallel with the roadmap.
- **Epics 2, 3, 4** — *unaffected* (the "cost of evening admin" moat asset in Epic 6 is a lightweight static calculator, distinct from the full Epic 3 invoice calculator; Epic 6 links to Epic 3 when it ships).

### Artifact Conflicts
- **PRD** — §14 Information Architecture frames discoverability around the trades homepage and lists a single `/compare/jobber` SEO asset; SM-5 names "Jobber-comparison / bilingual invoice+tax terms" without volume. Needs a demand-validated **Keyword Architecture** subsection and corrected SEO framing. Core goals/MVP are **not** in conflict (§12 already says SEO is a slow-compounding secondary asset — the edits make that concrete).
- **Architecture Spine** — static-first paradigm already supports SEO pages; no paradigm change. Needs **one additive invariant** (comparison/resource pages are static, Content-Slot-driven, carry FAQ/Comparison + SoftwareApplication structured data, honest-claims-verified) and a note that these do **not** require the Epic 5 blog machinery.
- **UI/UX** — no UX contract exists yet (epics flagged bmad-ux as not run); comparison/resource page layouts fold into that open recommendation. No conflict, just more surface for the eventual UX pass.
- **Secondary artifacts** — `sprint-status-marketing-site.yaml` needs an Epic 6 block; CI/deploy envelope (AD-20) is unchanged (new pages are static routes under the same pipeline). Owner task: register Google Search Console + Bing Webmaster Tools and submit the sitemap.

### Technical Impact
Low. Everything in the Lean foundation is **static HTML under the existing Astro/Cloudflare pipeline** — no new runtime, no database, no new third-party dependency. Structured data and sitemap are build-time. Risk is editorial (honest comparison claims) more than technical.

## Section 3 — Recommended Approach

**Selected path: Direct Adjustment + one new epic (Hybrid, but no rollback).** Scope classification **Moderate**.

- **Why not rollback (Option 2):** nothing shipped is wrong; the launched v1 is a correct lean cut. Rolling back adds no simplification. *Not viable.*
- **Why not a full MVP redefinition (Option 3):** the conversion-core MVP is sound and the demand data confirms SEO should stay secondary. No need to redefine goals. *Not viable as framed.*
- **Why Direct Adjustment + Epic 6 (Option 1, chosen):** the demand-justified SEO work is additive, static, and depends only on the existing scaffold. It fixes the real gap (no comparison pages, no AEO, thin technical baseline) at low risk, without touching the primary engine. Effort **Medium**, risk **Low**, timeline impact minimal (parallelizable with Epics 2–5).

**Explicitly rejected (per the "Lean foundation" decision):** the strategy doc's full `industries/ + use-cases/ + alternatives/ + resources/` tree and geo-Ontario trades landing pages — the demand data shows near-zero volume for geo-trades heads, so that build is effort against thin demand.

## Section 4 — Detailed Change Proposals

### 4.1 PRD edits

**Edit P1 — add a demand-validated Keyword Architecture subsection under §14.**

OLD (§14, SEO asset line):
```
- Comparison/alternative pages (e.g. `/compare/jobber`) — SEO/AEO assets, fed by the Copy Deck
```

NEW (replace that line and append the subsection):
```
- Comparison / "alternative (Canada)" pages (`/compare/jobber`, `/compare/housecall-pro`,
  `/compare/servicem8`) — first-class SEO/AEO assets, fed by the Copy Deck.
- Resource / content-moat pages under `/resources/**` (Ontario invoice checklist, HVAC &
  plumbing templates, "cost of evening admin" mini-calculator) — long-tail + AEO/GEO assets.

### 14.1 Keyword & Answer-Engine Architecture (demand-validated 2026-10-06)

Source: `seo-demand-validation-2026-10-06.md` (DataForSEO, Google Ads volume, Canada/Ontario).
SEO/AEO/GEO is a COMPOUNDING SECONDARY asset (per §12); warm/referral/outbound stays primary.

Because validated head-term volume is thin (esp. Ontario), ANSWER-ENGINE visibility is a
first-class discovery channel here, not an afterthought: buyers increasingly ask AI assistants
("best job/invoicing software for a small Ontario HVAC business") instead of typing a 10/mo
head term. Classic SEO captures branded intent; AEO/GEO captures discovery that is shifting to AI.

Three co-equal pillars:
1. SEO — branded "alternative (Canada)" intent (jobber 40,500/mo, housecall pro 4,400/mo,
   servicem8 590/mo CA). Honest comparison pages + FAQ schema.
2. AEO (Answer Engine Optimization) — be the cited answer in Google AI Overviews, Bing Copilot,
   ChatGPT, and Perplexity. Extractable question-and-answer prose, content-matched schema.org
   (FAQPage/HowTo/SoftwareApplication), crawlable-by-AI static HTML (AD-1), and consistent
   canonical factual claims. Per Google's current guidance (strategy doc refs 42/44) this needs
   NO special AI markup or llms.txt; normal SEO + structure + unique evidence is the foundation.
   An optional `/llm-info` canonical-facts page (as Housecall Pro ships, ref 14) MAY be added,
   never as a ranking tactic.
3. GEO (Generative Engine Optimization) — the content moat (Ontario invoice checklist, trade
   templates, "cost of evening admin" estimator) gives generative engines unique, Ontario-
   specific, evidence-rich sources to cite, and earns the backlinks the strategy doc's moat
   section describes.

NOT A PRIMARY BET — geo-Ontario trades landing pages and generic high-CPC heads
("job management software" 10/mo Ontario; "field service management software" $74 CPC). Do not
build Ontario-trades geo pages for search traffic. Homepage keeps its positioning/conversion
job; it is not optimised for a thin head term.
```

**Edit P2 — sharpen SM-5 with the validated target.**

OLD (§7, SM-5):
```
- **SM-5 — Discoverability.** Indexation + presence for target queries (Jobber-comparison /
  bilingual invoice+tax terms) and evidence of AI-answer citation over time. Validates §10
  (SEO/AEO/GEO). `[ASSUMPTION]` measured via search console + periodic AEO/GEO spot-checks.
```

NEW:
```
- **SM-5 — Discoverability.** Indexation + ranking presence for the validated priority
  clusters: (a) "<incumbent> alternative Canada" comparison intent, (b) long-tail Ontario
  invoice/template resource queries, (c) AI-answer citation of comparison/resource pages.
  De-prioritise generic high-CPC heads and geo-Ontario trades terms (demand-validated thin,
  see §14.1). Measured via Google Search Console + Bing Webmaster Tools (incl. Bing AI
  Performance) + a periodic AEO/GEO citation spot-check across Google AI Overviews, Bing Copilot,
  ChatGPT, and Perplexity. Validates §10 (SEO/AEO/GEO).
```

**Edit P3 — add a note to §0.1 Launch Profile recording the NFR-3 follow-up.**

APPEND to the "Deferred to post-launch roadmap" list in §0.1:
```
- **SEO/AEO re-scope (2026-10-06, `sprint-change-proposal-2026-10-06-seo.md`):** NFR-3 (AEO/GEO)
  and the comparison/resource content are delivered by the new **Epic 6 (SEO foundation &
  comparison pages)**, demand-validated and scoped to the Lean foundation (not the full
  strategy-doc content tree). Keyword direction: §14.1.
```

### 4.2 Epics edits

**Edit E1 — add Epic 6 to the Epic List and as a full epic; re-scope Epic 5 to blog-only.**

ADD to the Epic List (after Epic 5):
```
### Epic 6: SEO/AEO/GEO foundation & comparison pages (demand-validated)
A real technical SEO/AEO/GEO baseline across the static site, honest "alternative (Canada)"
comparison pages for the three incumbents (the only sizeable high-intent demand pool), a small
content-moat resource set, and an answer-engine (AEO/GEO) optimization + citation-tracking loop.
Depends only on the Epic 1 scaffold; buildable now, in parallel. Captures the demand that
`seo-demand-validation-2026-10-06.md` actually found — including the AI-answer discovery that
matters most in a thin head-term market. **FRs covered:** FR-17 (comparison/SEO assets, moved
from Epic 5), FR-18; delivers NFR-2, NFR-3 (AEO/GEO).
```

ADD the epic body:
```
## Epic 6: SEO/AEO/GEO foundation & comparison pages

Make the site findable where demand actually exists — in classic search AND in AI answer/
generative engines (where thin head-term search shifts discovery). Realizes SM-5; delivers
NFR-2 and NFR-3 (AEO/GEO).

### Story 6.1: Technical SEO + structured-data baseline (site-wide)
As the site owner, I want every static page to be crawlable, canonical, and schema-marked,
so the SEO/AEO guarantee is real and not deferred.
**AC:**
- Given any indexable page, when audited, then it emits correct title/meta/canonical, a valid
  XML sitemap + robots.txt, Open Graph/Twitter cards, and descriptive alt text (NFR-2).
- Given the homepage and comparison/resource pages, then Organization + SoftwareApplication +
  (where applicable) FAQPage/BreadcrumbList schema.org data is present and matches visible
  content (NFR-3, AD-NEW).
- Given CI, then a structured-data sanity check runs; pages stay static (AD-1) and within the
  Core Web Vitals budget (NFR-1).
(Note: closes the NFR-3 gap left open when Story 1-6 shipped under the deferred launch cut.)

### Story 6.2: "Alternative (Canada)" comparison pages — Jobber, Housecall Pro, ServiceM8
As an in-market visitor comparing tools, I want an honest "<incumbent> alternative in Canada"
page, so I can decide — and Scheza gets found for that intent.
**AC:**
- Given `/compare/jobber`, `/compare/housecall-pro`, `/compare/servicem8` (+ `/fr/**` when FR
  lands), when rendered, then each is a first-class static page from owner-supplied Content
  Slots (FR-18), with a factual comparison table and FAQPage schema (AEO), canonical, and the
  NFR-1/2/4 baseline.
- Given the honesty guardrail (PRD §5, §11), then no competitor claim is published until
  verified against that competitor's current public plan; unverified rows are omitted.
- Given attribution, then each page's CTA routes to the Epic 1 waitlist capture.

### Story 6.3: AEO/GEO content-moat resource pages
As an Ontario trades owner searching a specific task, I want a genuinely useful resource,
so I find Scheza via long-tail and AI answers.
**AC:**
- Given `/resources/ontario-hvac-invoice-checklist`, `/resources/trade-invoice-templates`, and
  a lightweight `/resources/cost-of-evening-admin` mini-calculator, when rendered, then each is
  static, Content-Slot-driven, carries HowTo/FAQ/Article schema, and meets the baseline.
- Given the mini-calculator, then it is a simple static estimator (NOT the full Epic 3 invoice
  calculator) and bridges to the waitlist.
- Given a legal/CPA guardrail, then the invoice checklist carries the "not tax advice" + "as of"
  disclaimer (consistent with FR-7).

### Story 6.4: Search-console registration & internal linking (owner task)
As the site owner, I want the site registered and internally linked, so indexation starts.
**AC:**
- Given Google Search Console + Bing Webmaster Tools, then the property is verified and the
  sitemap submitted (owner-executed; documented in the repo README).
- Given the new pages, then crawlable HTML internal links connect homepage ↔ comparison ↔
  resource pages (no orphan pages).

### Story 6.5: AEO/GEO optimization & answer-engine citation tracking
As the site owner, I want Scheza to be the cited answer in AI engines, so we win discovery
where thin head-term search cannot.
**AC:**
- Given comparison + resource + homepage content, when authored, then key sections use
  extractable question-and-answer framing and self-contained factual statements an answer
  engine can quote (NFR-3), with content-matched FAQPage/HowTo/SoftwareApplication schema.
- Given canonical product facts (what Scheza is, who it is for, pricing posture, Canadian data
  stance), then they are stated consistently across pages; an optional `/llm-info`
  canonical-facts page MAY be added (never as a ranking tactic; Google needs no AI markup or
  llms.txt — PRD §14.1).
- Given a measurement loop, then a documented periodic spot-check queries Google AI Overviews,
  Bing Copilot, ChatGPT, and Perplexity for the category and records whether Scheza / its
  comparison/resource pages are cited (feeds SM-5); Bing AI Performance is monitored in Bing
  Webmaster Tools.
- Given the honesty + launch-cut guardrails (PRD §5/§11, §0.1), then canonical facts do not
  assert data-residency or CASL-consent guarantees the launch cut has not yet earned.
```

ADD to the FR Coverage Map (and remove 5-4 from Epic 5's coverage):
```
FR-17: Epic 6 - Comparison/"alternative Canada" pages + resource moat (moved from Epic 5)
NFR-2/NFR-3: delivered by Epic 6 (previously nominally Epic 1/5)
```

RE-SCOPE Epic 5: change its title/summary to **"Epic 5: Blog (PersonaPress)"** and remove
Story 5-4 (moved to Epic 6.2). Epic 5 then covers FR-16 and the distribution-metadata half of
FR-17 for blog posts only.

### 4.3 Architecture Spine edits

**Edit A1 — add one additive invariant.**

ADD after AD-8:
```
### AD-21 — Comparison & resource pages are static, slot-driven, schema-marked, honesty-gated
- **Binds:** FR-17, FR-18; NFR-1, NFR-2, NFR-3.
- **Prevents:** SEO pages drifting into SSR/JS, fabricated competitor claims, or coupling to
  the Epic 5 blog pipeline.
- **Rule:** `/compare/**` and `/resources/**` are pre-rendered static pages (AD-1) built from
  Copy Deck slots (AD-14), each carrying content-matched structured data (FAQPage/HowTo/
  Article + SoftwareApplication/BreadcrumbList). They do NOT depend on PersonaPress (AD-8) or
  any runtime. For AEO/GEO (NFR-3) they MUST expose extractable question-and-answer prose and
  consistent canonical facts that answer/generative engines (AI Overviews, Bing Copilot,
  ChatGPT, Perplexity) can cite; crawlable static HTML (AD-1) is the enabling precondition. Any
  competitor claim must be verified against that competitor's current public source before
  publish (PRD §5/§11); unverified claims are omitted, not guessed.
```

**Edit A2 — extend the Structural Seed and Capability Map.**

ADD routes to the Structural Seed under `pages/`:
```
      compare/jobber.astro, compare/housecall-pro.astro, compare/servicem8.astro   # AD-21
      resources/[...].astro        # content-moat pages (AD-21)
```

ADD to the Capability → Architecture Map:
```
| Comparison / resource SEO pages (FR-17) | `pages/compare/**`, `pages/resources/**` + `content` | AD-21, AD-1, AD-14 |
```

UPDATE the Launch Profile note (§"Launch Profile (v1)") to add:
```
- SEO/AEO content (comparison + resource pages, structured data) is delivered by Epic 6 per
  `sprint-change-proposal-2026-10-06-seo.md`; keyword direction in PRD §14.1. Static-first and
  no-database invariants are unchanged.
```

### 4.4 sprint-status-marketing-site.yaml edits

ADD under `development_status:` (after the epic-5 block):
```
  epic-6: backlog
  6-1-technical-seo-structured-data-baseline: backlog
  6-2-alternative-canada-comparison-pages: backlog
  6-3-aeo-content-moat-resource-pages: backlog
  6-4-search-console-registration-internal-linking: backlog
  6-5-aeo-geo-optimization-and-citation-tracking: backlog
  epic-6-retrospective: optional
```
And move `5-4-comparison-seo-aeo-pages` out of epic-5 (now realized by 6-2); note the move in a
comment. Update the EPIC BUILD ORDER note: Epic 6 depends only on Epic 1 and is a recommended
near-term parallel track (suggested sequence 1 → 6 → 5 → 3 → 4 → 2, since 6 is demand-justified
and cheap, and 5/blog can follow).

## Section 5 — Implementation Handoff

**Scope classification: Moderate** (backlog reorganization + PRD/architecture edits; no rollback, MVP intact).

| Recipient | Responsibility |
|---|---|
| **PM (Boris)** | Approve this proposal; apply PRD edits P1–P3 (or delegate); author Copy Deck content for comparison + resource pages (owner-supplied copy per FR-18); verify competitor claims before publish; execute 6.4 (Search Console/Bing registration). |
| **Architect** | Apply spine edits A1–A2 (AD-21 + seed/map). Light touch; paradigm unchanged. |
| **PO / Scrum (or Boris)** | Apply the epics edits (E1) and sprint-status block (4.4); sequence Epic 6 as the near-term parallel track. |
| **Developer agent (Amelia / bmad-build)** | Implement Stories 6.1–6.3 onto the existing `scheza-marketing` scaffold once stories are drafted (`ready-for-dev`). All static; reuses Epic 1 capture CTA. |

**Success criteria.**
- Three comparison pages + the resource set live, static, schema-valid, within CWV budget.
- Sitemap submitted; pages indexed in GSC within ~2–4 weeks.
- SM-5 tracked against the validated clusters (not vanity traffic / not geo-trades heads).
- AEO/GEO: comparison/resource pages carry extractable Q&A + content-matched schema; a periodic
  citation spot-check (AI Overviews / Bing Copilot / ChatGPT / Perplexity) is running.
- No fabricated competitor claims (honesty guardrail held).

**Dependencies / sequencing.** Epic 6 needs only the Epic 1 scaffold (done). It can run in parallel with Epics 2–5. The full Epic 3 invoice calculator and EN/FR (NFR-5) remain on the existing roadmap; Epic 6's FR pages mirror into `/fr/**` when NFR-5 lands.

## Section 6 — Decision Log / Open Items

- **Decision:** SEO scoped to Lean foundation (comparison + AEO moat + technical baseline), not the full strategy-doc content tree. Rationale: DataForSEO demand (`seo-demand-validation-2026-10-06.md`).
- **Decision:** geo-Ontario trades landing pages are NOT built for search traffic (demand-validated thin).
- **Open (future, not this proposal):** the Vertical Suite Expansion is a separate strategic track; `property management software` (1,300/mo, low comp) is flagged as the best-supported SEO expansion surface when the suite motion begins — to be handled by its own PRD/epic, not here.
- **Open:** EN/FR mirrors of comparison/resource pages ship with NFR-5.
