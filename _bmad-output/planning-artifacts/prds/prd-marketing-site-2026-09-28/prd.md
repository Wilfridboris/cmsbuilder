---
title: Scheza Marketing Site
status: draft
created: 2026-09-28
updated: 2026-09-28
---

# PRD: Scheza Marketing Site
*Working title — confirm.*

## 0. Document Purpose

This PRD is for the PM (Boris), whoever builds the marketing site, and the downstream UX / architecture / epics workflows. It specifies **only the public marketing website at `scheza.com`** — the pre-launch property whose job is to explain Scheza, prove it, and capture warm signups. It does **not** cover the product itself (`app.scheza.com`, specified in `_bmad-output/planning-artifacts/prd.md`), the future community property, or the future agent product line — those are separate PRDs and remain untouched here.

It builds on existing inputs rather than duplicating them: the **GTM & Traction Strategy** (`_bmad-output/gtm-traction-strategy.md` — waitlist copy, SERP intel, the calculator lead-magnet spec, the 8-week plan), the **Design Thinking session** (`_bmad-output/design-thinking-2026-09-24.md` — the retention/positioning insights), and the app PRD's positioning. Its architecture companion — framework (Astro on Cloudflare), the single Lead contract, capture/consent/referral safety, and the deploy/ops envelope — lives in `_bmad-output/planning-artifacts/architecture/architecture-marketing-site-2026-09-28/ARCHITECTURE-SPINE.md`; implementation decisions defer to it. Vocabulary is anchored in the Glossary (§3); features are grouped with globally numbered FRs nested under them; assumptions are tagged inline as `[ASSUMPTION]` and indexed in §9. **Copy is owner-supplied** — this document defines *content slots and constraints*, not finished words; Boris writes all marketing copy.

## 1. Vision

The Scheza marketing site is the **pre-launch conversion engine**: a fast, bilingual, credibility-first website that turns an Ontario trades owner (or a partner, or a curious peer) into a **named, warm signup** before the app is publicly available. It is the top of the funnel the GTM strategy calls "the conversion core" — a "taste-of-magic" landing experience, a genuinely useful free tool, real pilot testimonials, and a referral loop that gets trades to bring other trades onto the list.

Its message is deliberately **not** "we build you an app in 30 seconds." Anyone can build an app; the 30-second generation is the *hook that earns attention*, not the reason to choose Scheza. The site is built around what a competitor cannot copy: **an assistant that learns your specific business and gets more useful every month** (the per-tenant data flywheel), wrapped in **a Canadian community and resources for the trades** (EN/FR, data in Canada, made for how they work). The app is the front door; the compounding relationship and the belonging are the product.

It matters because the growth engine is warm and personalized, not paid — Ontario search volume is too thin and category CPCs are too high to buy traffic. The site's real output is a warm, named list and the proof to convert it: it feeds the personalized-outbound + referral + pilot-testimonial machine that the launch will run on. And it must start working *now*, in parallel with the app being built — the blog and the waitlist compound with time.

## 2. Target User

### 2.1 Jobs To Be Done

The site serves three distinct visitors. The primary buyer drives the design; the other two are served without diluting it.

**Primary — "Time-Starved Tim" (the buyer):** an Ontario short-cycle service-trade owner (HVAC, plumbing, electrical, appliance repair, handyman), 1–15 staff, lives on his phone.
- **Functional:** understand in seconds what Scheza is and whether it's for someone like him; see proof it works for *his* trade; get a genuinely useful thing (a compliant invoice) before committing; leave his email to get early access.
- **Emotional:** feel the "someone finally built this for *me*" recognition; trust it (Canadian, real people, real testimonials) enough to hand over an email; relief that the 9 PM paperwork dread has an answer.
- **Social:** look organized/professional; feel part of something for Canadian trades, not sold to by another generic US SaaS.
- **Contextual:** on a phone, spotty signal, 30 seconds of attention, EN or FR.

**Secondary — the Amplifier (leverage, not pipeline):** founders, indie hackers, agencies, accountants/bookkeepers, press, potential partners. JTBD: understand the story fast, find a reason to share or to open a partner conversation. Served mainly by the blog, the vision/direction narrative, and shareable demo clips.

**Secondary — the Pilot recruit:** a real GTA trade willing to join the Wizard-of-Oz pilot. JTBD: a low-friction "I'll try this / talk to you" path distinct from the passive waitlist.

### 2.2 Non-Users (v1)

- Trades whose billing/compliance genuinely differs (construction/renovation with holdbacks, recurring/seasonal-contract trades, auto repair) — deferred per the app PRD; the site should not court them.
- Non-Ontario businesses at launch (Quebec/FR-Quebec tax is a later expansion; the site is Ontario-first with EN/FR copy).
- People looking for a free invoice-PDF generator with no interest in a business system — the calculator serves them as a lead magnet, but they are not the target and the site should not optimize for that intent.

### 2.3 Key User Journeys

- **UJ-1. Tim meets himself on the homepage.**
  - **Persona + context:** Tim, HVAC owner in Mississauga, taps a link from a LinkedIn demo clip on his phone, mid-morning, one bar of signal.
  - **Entry state:** unauthenticated, first visit, EN.
  - **Path:** page paints almost instantly → hero says "See the app that runs your trade — built for your business in 30 seconds" → he picks **trade = HVAC**, **city = Mississauga** → taps **Build my app** → sees a preview populated with HVAC-shaped jobs/invoices/customers that look like his → reads the one line that lands: *it learns your business and gets more useful every month.*
  - **Climax:** the "whoa, this is *my* business" recognition; then the reframe that it keeps working for him, not just a one-time trick.
  - **Resolution:** "This is a taste — your full app launches soon" → he leaves his email for early access. Now a named lead (trade + city + email).
  - **Edge case:** if generation/preview is slow or fails, he still sees a canned trade-specific example and the email capture — the page never dead-ends on a spinner. Realizes UJ-1.

- **UJ-2. Tim gets a real invoice before he ever signs up.**
  - **Persona + context:** Tim needs to bill a customer tonight; finds the free calculator via search or the nav.
  - **Path:** opens the **Invoice + Tax Calculator** → enters business name, client, line items, picks **Ontario** → sees a clean branded invoice with correct HST → wants the PDF → enters email to download.
  - **Climax:** he has a real, compliant invoice in hand — Scheza did the annoying part for free.
  - **Resolution:** gets the PDF (transactional email); a *separate, unticked* box offers early access + trades tips. Post-download: "Scheza remembers every job, client, and invoice for you — get early access."
  - **Edge case:** he ignores the opt-in — fine; he got value, and he's seen the brand. Realizes UJ-2.

- **UJ-3. Tim brings another Tim.**
  - **Persona + context:** Tim is on the waitlist; sees "jump the line."
  - **Path:** copies his invite link → texts it to a plumber buddy → buddy lands on the site, builds his preview, signs up crediting Tim.
  - **Climax:** both get a perk (e.g. first month free); Tim moved up the list.
  - **Resolution:** the referral loop is live pre-launch; the list grows trade-to-trade. Realizes UJ-3.

- **UJ-4. Priya the bookkeeper opens a partner conversation.**
  - **Persona + context:** Priya runs books for several GTA trades; a post or the blog brings her to the site.
  - **Path:** reads the "for partners / bookkeepers" angle and a blog post → sees the Canadian, EN/FR, clean-data story → uses the "talk to us" path.
  - **Climax:** she sees Scheza as an ally, not a threat, to her trades clients.
  - **Resolution:** a warm partner conversation for launch day. Realizes UJ-4.

- **UJ-5. A skeptic Tim reads a real testimonial.** *(lighter)* Tim, burned by past software, scrolls to the testimonials and reads a named Mississauga HVAC owner say "I stopped doing invoices at 9 PM." The specific, real quote does more than any headline; he signs up. Realizes UJ-5.

## 3. Glossary

Downstream workflows and readers must use these terms exactly. No synonyms elsewhere in the PRD.

- **Marketing Site** — the public website at `scheza.com` (root domain). The subject of this PRD. Distinct from the **App**.
- **App** — the Scheza product at `app.scheza.com`, specified in the app PRD. Out of scope here except as a link target.
- **Visitor** — anyone on the Marketing Site; not authenticated. May become a **Lead**.
- **Lead** — a Visitor who has submitted an email, stored in the **Leads Store**. Has a source (`waitlist | calculator | demo | partner | referral`) and, where captured, trade + city + locale.
- **Leads Store** — **Resend Contacts** (email = identity; `source`/`trade`/`city`/`locale` as custom contact properties; consent via Resend topics), written server-side by the capture endpoint. The marketing site has no database of its own. Note: Resend is US-hosted, so the lead list resides in the US by a disclosed PIPEDA exception (see §11); the App's Canadian data residency is unaffected.
- **Taste-of-Magic Preview** — the interactive homepage element: Visitor picks trade + city and sees a representative preview of a Scheza app for that trade. `[ASSUMPTION]` the preview is a canned/templated trade-specific view at launch, not a live LLM generation (see §8, Open Q1).
- **Waitlist** — the early-access Lead list; the primary conversion target.
- **Referral Loop** — the mechanism by which a Lead shares an invite link and both parties earn a perk ("jump the line").
- **Calculator** — the free bilingual Invoice + Tax Calculator lead magnet. Deterministic (no LLM). Produces a branded invoice PDF.
- **Blog** — content surface on the Marketing Site rendered from the **PersonaPress** headless blog API.
- **PersonaPress** — the external headless blog API (`personnapress.com/headless-blog-api`) that supplies blog content.
- **Marketing Opt-In** — explicit, separate, unticked CASL consent to receive marketing email; the *only* thing that adds a Lead to the marketing/newsletter audience.
- **Transactional Email** — a message sent to fulfill a Visitor's direct request (e.g. the requested Calculator PDF); CASL-exempt; sent via Resend.
- **Copy Deck** — the owner-supplied document holding all finalized marketing copy (EN + FR) mapped to the Content Slots on each page.
- **Content Slot** — a named, constrained placeholder in a page where owner-supplied copy (or a demo asset) is inserted.
- **Demo Clip** — a short video (YouTube-hosted or App-hosted) shown via a click-to-play facade so it never blocks page load.
- **SEO / AEO / GEO** — Search Engine Optimization / Answer Engine Optimization / Generative Engine Optimization: being found by search engines and cited by AI answer/generative engines (Google AI Overviews, ChatGPT, Perplexity). A first-class quality requirement (§10).

## 4. Features

Each subsection is a coherent feature; FRs are numbered globally with stable IDs. **Copy for every Content Slot is owner-supplied** (`FR-COPY`, §4.7).

### 4.1 Home / Taste-of-Magic Landing

**Description:** The single most important page. It must paint and become interactive extremely fast (§10 performance budget), then deliver recognition and the differentiated message in this order (confirmed positioning spine): **Hook → Difference → Belonging → Proof → Direction.** The hero holds the Hook and the **Taste-of-Magic Preview**: the Visitor selects trade + city and sees a representative Scheza app preview for that trade, then is invited to leave an email for early access. Below the fold, Content Slots carry the differentiation (an assistant that *learns your business*), the belonging (Canadian trades community + resources, EN/FR, data in Canada), proof (testimonials, §4.5), and the honest direction/vision. Realizes UJ-1.

**Functional Requirements:**

#### FR-1: Taste-of-Magic Preview
A Visitor can select their **trade** (from a defined list) and enter their **city**, then trigger a preview of a Scheza app for that trade. Realizes UJ-1.

**Consequences (testable):**
- The trade selector offers the launch beachhead trades (HVAC, plumbing, electrical, mechanical, appliance repair, cleaning, handyman) plus "Other".
- On trigger, a representative preview renders for the chosen trade within the performance budget (§10); city is reflected in the preview where feasible.
- If the preview cannot render (error/slow), a canned trade-specific fallback is shown; the page never dead-ends on a loading state.
- The preview is visibly framed as a taste ("This is just a taste. Your full app launches soon.") leading into email capture (FR-2).

**Out of Scope:** live account creation or entry into the App; the preview does not persist data.

#### FR-2: Waitlist email capture
A Visitor can submit an email to join the **Waitlist**, associated with the trade + city + locale already provided. Realizes UJ-1.

**Consequences (testable):**
- Submitting a valid email writes a **Lead** to the **Leads Store** with `source=waitlist`, trade, city, locale, timestamp.
- No credit card, no account, no additional required fields beyond email (trade/city carried from FR-1 where present).
- Adding the Lead to the **marketing audience** requires the **Marketing Opt-In** (FR-14); a bare waitlist email is stored as a Lead but is only marketed to per its consent state.
- Duplicate email does not create a duplicate Lead; it updates the existing record.
- Confirmation state is shown without a full page reload.

#### FR-3: Positioning content blocks (Difference / Belonging / Direction)
The page presents the differentiation, belonging, and vision messages as **Content Slots** filled from the **Copy Deck**.

**Consequences (testable):**
- Distinct slots exist for: the Difference (learning assistant / compounding value), the Belonging (Canadian trades community + resources, EN/FR, data in Canada), and the Direction (vision narrative).
- The Direction slot is styled/labeled as vision, not a current feature (guardrail against over-promising; see §5).
- All slots render owner-supplied EN and FR copy via i18n; no hardcoded strings.

**Notes:** `[NOTE FOR PM]` the exact hero H1 and A/B alternates exist in GTM Round 3 — those are candidate Copy Deck entries, owned by Boris.

### 4.2 How It Works / Examples

**Description:** The proof-by-showing page: **Demo Clips** (YouTube- or App-hosted) presented via click-to-play facades, plus best-in-class optimized in-app screenshots, and the before/after story (the 9 PM ritual → done in one tap). Includes at least one French demo. Realizes UJ-1, UJ-5.

**Functional Requirements:**

#### FR-4: Performance-safe demo video
A Visitor can watch **Demo Clips** without the video harming page load.

**Consequences (testable):**
- Video is loaded via a click-to-play facade: only a lightweight thumbnail/poster loads initially; the player/iframe loads on user interaction.
- No autoplaying video; no video asset is in the critical rendering path.
- The page meets the §10 performance budget with videos present.
- At least one Demo Clip is available in French.

#### FR-5: Optimized in-app screenshots
A Visitor sees high-quality in-app screenshots that are fast on mobile.

**Consequences (testable):**
- Images are served in a next-gen format, responsive/sized per viewport, and lazy-loaded below the fold.
- Screenshots carry descriptive alt text (accessibility + SEO/AEO).

#### FR-6: Examples content structure
The page organizes examples as **Content Slots** (per trade / per outcome) fillable from the Copy Deck and asset library.

**Consequences (testable):**
- Slots support a video, a screenshot set, and a short caption each.
- Adding a new trade example requires no code change beyond content/config. `[ASSUMPTION]`

### 4.3 Free Invoice + Tax Calculator (Lead Magnet)

**Description:** A standalone, genuinely useful bilingual tool: the Visitor enters line items and picks a province, sees a clean branded invoice with correct tax, and downloads a PDF. Deterministic math (no LLM). Ontario HST at launch; the tax config is dated and structured so Quebec (GST + QST) can be added later. It ships independently of the App and reuses the stack. Realizes UJ-2.

**Functional Requirements:**

#### FR-7: Invoice calculation and preview
A Visitor can enter business info, client, line items (description/qty/rate), and a province, and see a live invoice preview with correctly calculated tax.

**Consequences (testable):**
- Ontario selected → HST 13% applied correctly; totals and per-line math are correct.
- Tax rates live in a config constant with an "as of" date and a "not tax advice" disclaimer.
- Province selector includes Ontario at launch; Quebec (GST 5% + QST 9.975% on the pre-GST amount) is present but may be flagged as coming soon. `[ASSUMPTION]` (see §8, Open Q3).
- Usable with **no account**.

#### FR-8: PDF generation and delivery
A Visitor can download or be emailed a branded invoice PDF.

**Consequences (testable):**
- The rendered PDF matches the preview (identity/logo, line items, taxes, totals, terms).
- Email address is required only to download/email the PDF; the PDF email is **Transactional Email** (CASL-exempt), sent via Resend.
- A **Lead** is written with `source=calculator`.

#### FR-9: Bilingual output
A Visitor can switch EN/FR, changing both the tool UI and the invoice output.

**Consequences (testable):**
- The EN/FR toggle switches UI strings and the generated invoice's labels/output language.
- No hardcoded strings; all via i18n.

#### FR-10: Bridge to Scheza
After generating, the Visitor sees a CTA connecting the tool to the product.

**Consequences (testable):**
- Post-generation CTA text (owner-supplied) points to early access, e.g. "This invoice isn't saved anywhere. Scheza remembers every job, client, and invoice for you."
- The CTA leads to the Waitlist capture (FR-2) or the Marketing Opt-In (FR-14).

**Feature-specific NFRs:** the Calculator must be fully functional with the App offline/not yet deployed (it is decoupled from the tenant data model). No LLM dependency.

### 4.4 Early Access / Demo + Referral

**Description:** The conversion hub: the Waitlist ask, the **Referral Loop**, and a distinct **Pilot / "talk to us"** path for recruiting real trades into the Wizard-of-Oz pilot and for partner conversations. Realizes UJ-3, UJ-4.

**Functional Requirements:**

#### FR-11: Referral loop
A Lead can obtain a personal invite link and share it; referred signups are attributed.

**Consequences (testable):**
- Each Lead can generate/copy a unique invite link.
- A Visitor arriving via an invite link who becomes a Lead is attributed to the referrer (`source=referral`, referrer id recorded).
- The perk is **40% off** for both the referrer and the referred contractor; perk state is recorded for fulfillment at launch (referrer also jumps the line).
- A **referral coefficient** is computable from stored attribution (feeds SM-2).
- Rigorous attribution (server-issued opaque tokens, reject self-referral, one attribution per referred email) needs a small trusted store that Resend Contacts alone cannot provide; that store is decided when this feature is built. **The referral loop ships when its minimal store lands, not before.** `[NOTE FOR PM]` (See architecture spine AD-17.)

#### FR-12: Demo / pilot request
A Visitor can request a demo / express interest in the pilot via a path distinct from the passive Waitlist.

**Consequences (testable):**
- A short form captures name, business/trade, city, contact, and an optional note.
- Submissions are written as Leads with `source=demo` and are distinguishable from waitlist signups for follow-up.
- `[ASSUMPTION]` "demo/pilot" at launch means **early-access + pilot recruiting**, not a live sales-call booking calendar (see §8, Open Q2).

#### FR-13: Partner angle entry point
A Visitor identifying as a partner (bookkeeper/accountant/agency) has a clear path to start a conversation. Realizes UJ-4.

**Consequences (testable):**
- A partner-oriented Content Slot and contact path exist (may reuse FR-12's form with a "partner" flag).

### 4.5 Social Proof / Testimonials

**Description:** Real, named testimonials from pilot users (and partners), first-class on the homepage and reused across pages. Realizes UJ-5.

**Functional Requirements:**

#### FR-15: Testimonials
The site displays real, attributed testimonials (name, trade, city; optional photo/clip).

**Consequences (testable):**
- Testimonials are content-managed (Copy Deck / config), not hardcoded.
- A placeholder/empty state exists for pre-testimonial launch, replaced as pilot quotes arrive.
- No fabricated testimonials — content is real or the slot is hidden (see §5).

### 4.6 Blog

**Description:** A content surface rendered from **PersonaPress**, live in v1 so blogging can start while the App is still being built. It is an SEO/AEO/GEO and social/outbound asset, not a lead machine. Realizes UJ-4 (partners), amplifier reach.

**Functional Requirements:**

#### FR-16: Blog rendering from PersonaPress
The site renders blog index and post pages from the PersonaPress headless API.

**Consequences (testable):**
- Posts are fetched from PersonaPress via its token-authenticated API; the API token is a server-only secret (never `NEXT_PUBLIC_`).
- Blog pages meet the §10 performance and SEO/AEO/GEO requirements (SSG/ISR or equivalent; server-rendered content, not client-only). `[ASSUMPTION]` rendering strategy TBD in architecture.
- Post pages carry article structured data (schema.org Article) and correct canonical/hreflang.
- If PersonaPress is unavailable at build/request time, the site degrades gracefully (cached/last-known or a clean empty state), never a broken page.

#### FR-17: Blog as distribution asset
Posts are structured for sharing and outbound.

**Consequences (testable):**
- Each post has share-ready metadata (Open Graph / Twitter cards) and a canonical URL.
- Blog language is **per-post** (each post is EN or FR as authored; posts are not translated 1:1). Each post renders under its own locale with correct canonical; `hreflang` is emitted only when a translated counterpart exists.

### 4.7 Content & Copy Management (cross-cutting)

**Description:** Because Boris owns all copy, the site is built as a set of **Content Slots** filled from a **Copy Deck**, in EN and FR.

**Functional Requirements:**

#### FR-COPY (FR-18): Owner-supplied copy via slots
All marketing copy and demo assets are inserted into named Content Slots; none is hardcoded by the builder.

**Consequences (testable):**
- Every user-facing string is externalized (i18n) and traceable to a Copy Deck entry.
- Updating copy does not require a code change beyond content/config. `[ASSUMPTION]`
- FR copy can ship with owner-provided placeholders where final copy is pending, without blocking build.

### 4.8 Consent & Compliance (cross-cutting capture behavior)

#### FR-14: CASL-safe consent capture
Marketing consent is captured separately and explicitly at every capture point.

**Consequences (testable):**
- The **Marketing Opt-In** is a separate, **unticked-by-default** checkbox; only a checked opt-in adds a Lead to the marketing audience.
- The Calculator PDF is sent as **Transactional Email** regardless of the Marketing Opt-In state.
- Every marketing email carries sender identification and a working unsubscribe (CASL); unsubscribes propagate to the Leads Store.
- Consent state and timestamp are stored per Lead.
- **Consent is server-witnessed** (not a bare client claim): the opt-in, its timestamp, locale, and evidence are recorded server-side through the validating capture path, on a single Lead identity keyed by email; opt-out always wins. The browser is not trusted to assert consent directly. (See architecture spine AD-9, AD-15, AD-16.)

## 5. Non-Goals (Explicit)

- **Not the App.** No account creation, no tenant data, no real app functionality — only a link/CTA to `app.scheza.com`. `[NON-GOAL for MVP]`
- **Not the community.** No forums, discussions, workflow sharing, or feature-request boards — that is a separate future property (`community.scheza.com`).
- **Not the agent product line.** No agent-building product, no `agent.scheza.com` build. The learning-assistant/agent story appears **only as honest vision/direction copy**, never as a shipping feature or a purchasable thing.
- **Not a copy-authoring engagement.** This PRD/team does not write the marketing copy; Boris does. We build the slots.
- **Not a paid-acquisition landing system.** No ad-campaign landing-page factory or paid-search infrastructure in v1 (the engine is warm/referral/outbound, not paid).
- **Not self-hosted heavy media.** Demo video is external (YouTube/App), never self-hosted assets that threaten the performance budget.
- **Not multi-province tax at launch.** Ontario HST only in the Calculator; Quebec and others are structured-for-later, not built.
- **We are not becoming a free-invoice-PDF tool.** The Calculator is a lead magnet, not the product; it must always bridge back to Scheza.

## 6. MVP Scope

### 6.1 In Scope

- **Home / Taste-of-Magic Landing** with preview + waitlist capture (FR-1, FR-2, FR-3).
- **How It Works / Examples** with performance-safe video + optimized screenshots (FR-4, FR-5, FR-6).
- **Free Invoice + Tax Calculator** (Ontario HST), bilingual, PDF, bridge CTA (FR-7–FR-10).
- **Early Access / Demo + Referral Loop**, plus pilot/partner path (FR-11, FR-12, FR-13).
- **Testimonials** with real-or-hidden discipline (FR-15).
- **Blog** rendered from PersonaPress, live so blogging starts now (FR-16, FR-17).
- **Content-slot/Copy-Deck architecture**, EN/FR throughout (FR-18).
- **CASL-safe consent + Leads Store** via Resend Contacts (topics for consent) (FR-14).
- **SEO / AEO / GEO + performance** as a hard requirement across all pages (§10).

### 6.2 Out of Scope for MVP

- Live LLM generation in the preview (canned/templated trade previews at launch). `[NOTE FOR PM]` if a real live generation converts materially better, revisit (Open Q1) — this is emotionally load-bearing to the "magic".
- Quebec/multi-province tax in the Calculator — structured-for-later only.
- A booked live-sales-call calendar — "demo" means early-access/pilot at launch (Open Q2).
- Full French UI beyond the marketing pages and invoice output (the App's French UI is a separate product concern).
- Community, agent product, and any authenticated experience.
- A/B testing infrastructure (nice-to-have; copy A/B alternates exist but automated experimentation is not required for v1). `[NOTE FOR PM]`

## 7. Success Metrics

**Primary**
- **SM-1 — Named Waitlist size.** Count of Leads with trade + city + email and a valid consent state. Target: **hundreds of warm, named trades** pre-launch (per GTM). Validates FR-1, FR-2, FR-14.
- **SM-2 — Referral coefficient.** Referred signups ÷ referring Leads. Target: **> 0 and trending up** (the loop demonstrably brings trades). Validates FR-11.

**Secondary**
- **SM-3 — Calculator conversion.** Calculator completions → PDF downloads → Marketing Opt-In rate. Target: a healthy opt-in share of completions (set baseline in first 2 weeks). Validates FR-7–FR-10, FR-14.
- **SM-4 — Pilot/partner pipeline.** Pilot requests and partner conversations opened. Target: **5–7 active pilot recruits, 2–3 partner conversations** (per GTM). Validates FR-12, FR-13.
- **SM-5 — Discoverability.** Indexation + presence for target queries (Jobber-comparison / bilingual invoice+tax terms) and evidence of AI-answer citation over time. Validates §10 (SEO/AEO/GEO). `[ASSUMPTION]` measured via search console + periodic AEO/GEO spot-checks.
- **SM-6 — Performance.** Core Web Vitals pass on mobile for all key pages (see §10). Validates §10.

**Counter-metrics (do not optimize)**
- **SM-C1 — Raw follower/traffic count.** Do *not* optimize vanity reach; the GTM doc's #1 trap is mistaking amplifier followers for buyer pipeline. Counterbalances SM-1 (a big list of non-trades is failure, not success).
- **SM-C2 — Calculator usage without bridge.** Do *not* optimize for people using the free tool and leaving; if PDF downloads rise while Marketing Opt-In stays flat, the lead magnet is a giveaway, not a funnel. Counterbalances SM-3.

## 8. Open Questions

1. **Preview fidelity:** does the Taste-of-Magic Preview convert better as a **live LLM generation** or a **canned trade-specific template** at launch? (GTM open question; MVP assumes canned — FR-1.)
2. **"Demo" definition:** at launch, is the demo/pilot path purely **early-access + pilot recruiting**, or does it include a **booked sales/demo call** (e.g. a scheduling tool)? (FR-12.)
3. **Quebec tax timing:** show Quebec (GST+QST) in the Calculator as "coming soon", hide it, or include it at launch with legal/CPA review? (FR-7.)
4. **Blog language — RESOLVED (2026-09-28):** per-post language (each post EN or FR as authored, not translated 1:1); render under its own locale, `hreflang` only where a translated pair exists. Rendering is build-time SSG (spine AD-8). (FR-16, FR-17.)
5. **Hosting & lead store — RESOLVED (2026-09-28):** the Marketing Site is a **decoupled app hosted on Cloudflare** (Pages/Workers, $0 egress, edge CDN; per `docs/cloudflare_deployment_chat.md`), shipping independently of and before the App. It has **no database of its own — Leads are stored as Resend Contacts** (US-hosted, disclosed PIPEDA exception; §11). A minimal `ca-central-1` store may be added later only for referral attribution (FR-11). See NFR-8 and §14.
6. **Referral perk — RESOLVED (2026-09-28):** **40% off** for both the referrer and the referred contractor (referrer also jumps the line). Abuse controls per spine AD-17 (Cloudflare D1: reject self-referral, one attribution per email). (FR-11.)
7. **Domain confirmation:** confirm `scheza.com` = marketing root and `app.scheza.com` = app. `[ASSUMPTION]` from memory.

## 9. Assumptions Index

- **§3 / FR-1** — The Taste-of-Magic Preview is a canned/templated trade-specific preview at launch, not live LLM generation. (Open Q1)
- **§3 / FR-16** — Domain is `scheza.com` (marketing root) with `app.scheza.com` for the App. (Open Q7)
- **Hosting & lead store** — DECISION (not an assumption): decoupled app on **Cloudflare**; **Leads stored as Resend Contacts** (US, disclosed exception), no DB of its own; minimal ca-central-1 store only if/when referral attribution is built. Confirmed by Boris 2026-09-28. (Open Q5 resolved.)
- **FR-6 / FR-18** — Content/examples/copy are config-driven so additions need no code change.
- **FR-7** — Quebec appears in the province selector but may be "coming soon" at launch. (Open Q3)
- **FR-11** — Referral perk resolved: 40% off both parties (Open Q6 resolved). Referral store resolved: Cloudflare D1 (spine AD-17).
- **FR-12** — "Demo/pilot" = early-access + pilot recruiting at launch, not a live-call booking calendar. (Open Q2)
- **FR-16 / FR-17** — Blog rendering strategy (SSG/ISR) and EN/FR scope TBD in architecture. (Open Q4)
- **SM-5** — SEO/AEO/GEO measured via search console + periodic AI-answer spot-checks.

---

## 10. Cross-Cutting NFRs

*System-wide quality attributes. These are hard requirements, not aspirations — SEO/AEO/GEO and speed are the product's discoverability, per Boris's "guarantee".*

- **NFR-1 — Performance (extremely fast).** Key pages (Home, Examples, Calculator, Blog post) must pass **Core Web Vitals on mobile** (LCP, INP, CLS within Google "good" thresholds). No third-party asset (video, analytics) may push a key page out of budget; video uses click-to-play facades (FR-4); images are next-gen, responsive, lazy-loaded (FR-5). `[ASSUMPTION]` explicit numeric budgets set in architecture.
- **NFR-2 — SEO.** Server-rendered/static HTML for all indexable pages; correct titles, meta, canonical, `hreflang` for EN/FR, XML sitemap, robots, clean semantic markup, descriptive alt text. Comparison/alternative content (e.g. "Scheza vs Jobber", bilingual invoice+tax terms) is supported as first-class pages/routes.
- **NFR-3 — AEO / GEO.** Content is structured to be cited by AI answer/generative engines: schema.org structured data (Article, Product/SoftwareApplication, FAQ where relevant), clear question-and-answer framing, factual/extractable prose, and crawlable-by-AI content (not locked behind client-only JS). Success tracked in SM-5.
- **NFR-4 — Accessibility.** WCAG 2.1 AA for the marketing pages (contrast, keyboard nav, alt text, focus states) — also reinforces SEO/AEO.
- **NFR-5 — Bilingual (EN/FR).** All marketing pages and the Calculator output support EN/FR via i18n; no hardcoded strings; language switch without full reload where applicable.
- **NFR-6 — Analytics/instrumentation.** Capture funnel events (preview built, waitlist submit, calculator complete, PDF download, referral link created/used, demo request) with UTM attribution, in a privacy-respecting, consent-aware way. Feeds all SMs. `[ASSUMPTION]` tool TBD (PostHog per GTM).
- **NFR-7 — Resilience/independence.** The Marketing Site (esp. Waitlist and Calculator) must function with the App not yet deployed and must degrade gracefully if PersonaPress or the preview backend is unavailable — never a broken page or a dead-end spinner.
- **NFR-8 — Hosting (decision).** The Marketing Site is a **decoupled app hosted on Cloudflare** (Pages/Workers; static pages + two edge functions: lead capture and Calculator PDF email), chosen for $0 egress, edge speed, and spike-resilience. It is independent of the App's Vercel project and has **no database of its own**. **Leads are stored as Resend Contacts** (see Leads Store, §3). The lead list resides in the US (Resend) by a disclosed PIPEDA exception (§11); the App's `ca-central-1` tenant data is separate and unaffected. A minimal Canada-resident store may be introduced for referral attribution when that feature is built (see FR-11 note).
- **NFR-9 — Abuse & integrity guard.** Every public write (lead capture and the invoice-email endpoint) is protected by **Cloudflare Turnstile verified server-side** plus rate limiting, and validates its payload server-side before acting. Lead fields (including `source`, consent, and referral attribution) are **server-derived/whitelisted**, never trusted from the client; the browser does not write leads directly. This protects lead-list integrity, CASL consent provability, referral honesty, and Resend cost. (See architecture spine AD-5, AD-10, AD-15, AD-17, AD-18.)

## 11. Constraints and Guardrails

**Privacy / Data governance**
- **Leads are stored as Resend Contacts (US-hosted).** This is a deliberate, disclosed exception to the App's Canadian-residency posture: PIPEDA permits cross-border processing with transparency, so the **privacy policy must disclose** that a US email provider holds the mailing list. The App's tenant/customer data stays in `ca-central-1` and is never touched by the Marketing Site. If a store is later added for referral attribution, it should be `ca-central-1` (or the exception re-examined). (See architecture spine AD-11, AD-12.)
- Secrets (PersonaPress token, Resend key) are server-only, referenced only in edge endpoints/build; only the Turnstile site key is client-side. Enforced by a CI secret-leak gate.

**Compliance (CASL)**
- Marketing consent is separate, explicit, unticked (FR-14). Requested PDFs are transactional. Every marketing email carries ID + unsubscribe. SMS, if ever used, is post-opt-in only — never cold (GTM guardrail); not in MVP.
- Calculator carries an "as of" date and a "not tax advice" disclaimer.

**Trust / honesty (positioning guardrail)**
- The learning-assistant/agent capability is presented as **honest direction/vision only** — never worded as a shipping feature. This guards against the promise-vs-delivery gap the design-thinking work identified as a churn/trust risk.
- **Testimonials are real or hidden** — no fabricated proof (FR-15).

## 12. Why Now

Timing is load-bearing: the growth engine is warm/personalized/referral (paid search is unaffordable at Ontario CPCs of $74–$298 and volume is thin), so a **warm named list and real proof must be accumulated before launch**. The blog and SEO/AEO/GEO assets compound slowly — starting them now, in parallel with the App build, is the difference between launching to a list and launching to silence. The Marketing Site is the one property that pays off *most* by existing early.

## 13. Aesthetic and Tone

- **Voice:** owner-supplied (Copy Deck), but the PRD constrains it: plain, direct, trades-native ("if you can send a text, you can use Scheza"), Canadian, warm, anti-corporate. **No em-dashes in user-facing copy** (house rule).
- **Feel:** fast, clean, credible, mobile-first. "Built, not blank." Made-in-Canada cues without kitsch.
- **Anti-references:** generic US SaaS landing pages; over-animated hero pages that hurt performance; "AI hype" that over-promises the assistant.

## 14. Information Architecture

Top-level surfaces (all under `scheza.com`, EN/FR):
- `/` — Home / Taste-of-Magic Landing
- `/how-it-works` (and/or `/examples`) — How It Works / Examples
- `/tools/invoice-calculator` (+ `/fr/outils/...`) — Calculator
- `/early-access` (or `/get-started`) — Early Access / Demo + Referral
- `/blog` + `/blog/{slug}` — Blog (PersonaPress)
- Comparison/alternative pages (e.g. `/compare/jobber`) — SEO/AEO assets, fed by the Copy Deck
- Standard: `/privacy`, `/terms`, footer with consent/unsubscribe info

IA is designed so a future `agent.` or `community.` narrative *could* be linked without restructuring, but neither is built here.
