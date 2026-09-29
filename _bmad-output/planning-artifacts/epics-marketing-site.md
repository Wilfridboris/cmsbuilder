---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-create-stories
  - step-04-final-validation
inputDocuments:
  - _bmad-output/planning-artifacts/prds/prd-marketing-site-2026-09-28/prd.md
  - _bmad-output/planning-artifacts/architecture/architecture-marketing-site-2026-09-28/ARCHITECTURE-SPINE.md
  - docs/visual.png  # AUTHORITATIVE brand guide: logo, navy/blue/cyan palette (exact hex), Inter typography
  - docs/design.md  # UX philosophy / aesthetic (Spatial Clean, touch-first, a11y); visual.png wins on color/type conflicts
---

# Scheza Marketing Site - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for the **Scheza Marketing Site** (scheza.com) — a NEW, decoupled pre-launch web property (its own repo/deploy on Cloudflare), separate from the existing app (app.scheza.com). It decomposes the requirements from the Marketing Site PRD and the Architecture Spine into implementable stories.

> Note: this is `epics-marketing-site.md`, deliberately distinct from `epics.md` (the app's epic breakdown) to avoid overwriting it.

## Requirements Inventory

### Functional Requirements

FR-1: Taste-of-Magic Preview — a Visitor selects trade + city and triggers a representative Scheza app preview for that trade (canned template at launch), with a guaranteed non-dead-end fallback, framed as a taste leading to email capture.
FR-2: Waitlist email capture — a Visitor submits an email to join the Waitlist, associated with trade + city + locale; written as a Lead (source=waitlist); no account/credit card; duplicate email updates rather than duplicates; confirmation without full reload.
FR-3: Positioning content blocks — the homepage presents Difference (learning assistant), Belonging (Canadian trades community + resources, EN/FR, data in Canada), and Direction (vision, styled as vision not a shipping feature) as owner-filled Content Slots.
FR-4: Performance-safe demo video — Demo Clips load via click-to-play facade (thumbnail first, player on interaction); no autoplay; never in the critical path; at least one French clip.
FR-5: Optimized in-app screenshots — next-gen format, responsive/sized per viewport, lazy-loaded, descriptive alt text.
FR-6: Examples content structure — examples organized as Content Slots (per trade / per outcome), each supporting a video, screenshot set, and caption; new example adds via content/config, no code change.
FR-7: Invoice calculation and preview — Visitor enters business/client/line items + province; live invoice preview with correct tax (Ontario HST 13% at launch); rates in dated config with "not tax advice" disclaimer; usable with no account.
FR-8: PDF generation and delivery — Visitor can download (client-side) or be emailed a branded invoice PDF; PDF matches preview; email required only to download/email; PDF email is transactional (Resend); a Lead is written (source=calculator).
FR-9: Bilingual output — EN/FR toggle switches both the tool UI and the generated invoice output; no hardcoded strings.
FR-10: Bridge to Scheza — post-generation CTA (owner copy) connecting the free tool to early access / the product.
FR-11: Referral loop — a Lead obtains a unique invite link; referred signups are attributed (source=referral, referrer recorded); both parties' perk state recorded; referral coefficient computable.
FR-12: Demo / pilot request — a Visitor requests a demo / pilot interest via a path distinct from the passive Waitlist; captures name, business/trade, city, contact, note; written as Lead (source=demo).
FR-13: Partner angle entry point — a Visitor identifying as partner (bookkeeper/accountant/agency) has a clear path to start a conversation (Lead source=partner).
FR-14: CASL-safe consent capture — marketing opt-in is separate + unticked; transactional PDF sent regardless; every marketing email carries ID + unsubscribe; consent server-witnessed (timestamp, locale, evidence) on a single email-keyed identity; opt-out wins; browser not trusted to assert consent.
FR-15: Testimonials — real, attributed testimonials (name, trade, city; optional photo/clip), content-managed; empty/hidden state pre-launch; no fabricated proof.
FR-16: Blog rendering from PersonaPress — blog index + post pages rendered from the PersonaPress headless API (token server-only), build-time SSG, Article structured data + canonical/hreflang, graceful degradation if API down.
FR-17: Blog as distribution asset — each post has share metadata (OG/Twitter) + canonical URL; blog language is per-post (each post EN or FR as authored, not translated 1:1), hreflang only where a translated pair exists.
FR-18: Owner-supplied copy via slots — all marketing copy + demo assets inserted into named Content Slots (EN/FR); nothing hardcoded by the builder; copy updates need no code change; placeholders allowed without blocking build.

### NonFunctional Requirements

NFR-1: Performance — key pages pass Core Web Vitals (LCP, INP, CLS) on mobile; no third-party asset pushes a key page out of budget.
NFR-2: SEO — server-rendered/static HTML for indexable pages; titles/meta/canonical/hreflang (EN/FR); sitemap; robots; semantic markup; alt text; comparison/alternative pages first-class.
NFR-3: AEO / GEO — structured to be cited by AI answer/generative engines: schema.org (Article, Product/SoftwareApplication, FAQ), Q&A framing, extractable prose, crawlable-by-AI content.
NFR-4: Accessibility — WCAG 2.1 AA across marketing pages and islands; automated a11y checks in CI.
NFR-5: Bilingual (EN/FR) — all pages + calculator output via i18n; no hardcoded strings; language switch without full reload where applicable.
NFR-6: Analytics/instrumentation — capture funnel events (preview built, waitlist submit, calculator complete, PDF download, referral link created/used, demo request) with UTM, consent-aware; PII only to a Canada-resident sink.
NFR-7: Resilience/independence — site (esp. Waitlist + Calculator) functions with the app not yet deployed; degrades gracefully if PersonaPress/preview backend is down; never a broken page or dead-end spinner.
NFR-8: Hosting — decoupled app on Cloudflare (Pages/Workers), independent of the app's Vercel project; Leads persist in Supabase ca-central-1 (residency = data at rest, not edge hosting).
NFR-9: Abuse & integrity guard — every public write (capture + email endpoint) protected by Cloudflare Turnstile verified server-side + rate limiting + server-side payload validation; lead fields (source, consent, referral) server-derived/whitelisted; browser never writes leads directly.

### Additional Requirements

**Starter / greenfield scaffold (impacts Epic 1, Story 1):** brand-new repo, **Astro ^7** + **@astrojs/cloudflare ^14** adapter, TypeScript strict, Tailwind v4; Astro i18n routing (EN root, /fr/** mirror). Deploys to Cloudflare Pages.
- Paradigm: static-first islands with trust-guarding edge endpoints (AD-1/2/3). Pages static by default; interactivity only in `src/islands/**`; server code only in `src/pages/api/**`.
- Data / lead store: **no database of its own — Leads are stored as Resend Contacts** (AD-4): email = identity, custom properties `source`/`trade`/`city`/`locale`, consent via Resend topics (AD-9); upsert-by-email (AD-16); browser never writes leads — endpoint-written with the server-held Resend key (AD-5/AD-12). Lead PII resides in Resend (US) by a disclosed PIPEDA exception (AD-11).
- Two edge endpoints only: `api/capture-lead` (validating capture → Resend upsert + confirmation email — Turnstile verify, field whitelist, server-derived source, consent witness; AD-15) and `api/send-invoice` (regenerate PDF server-side from structured data, self-send only; AD-18).
- Referral: server-issued opaque tokens, reject self-referral, one attribution per email (AD-17) — stored in **Cloudflare D1** (resolved; chosen over KV for the uniqueness + count that attribution needs), built with **Epic 4**, so the referral loop ships then. Perk = **40% off** for both parties.
- Calculator: deterministic tax math (`lib/calc`) + `pdf-lib` (`lib/pdf`), shared client+server, no LLM (AD-7).
- Blog: build-time fetch from PersonaPress + HTML sanitize; rebuild via PersonaPress webhook / scheduled fallback (AD-8/AD-20).
- Preview: canned per-trade template behind an island seam for future live generation (AD-13).
- Security/CI: build-failing secret-leak gate (AD-6); only Supabase URL + publishable key + Turnstile site key client-side.
- Deploy/ops envelope: GitHub → Cloudflare Pages, preview-per-PR, prod-on-main, instant rollback; secrets in Cloudflare project secrets; Sentry error reporting + Cloudflare Web Analytics; `.env.example` placeholders only (AD-20).
- Accessibility: WCAG 2.1 AA enforced via axe checks in CI (AD-19).

### UX Design Requirements

None extracted — **no UX design contract exists yet** (bmad-ux has not been run for the marketing site). Visual identity, page layouts, interaction/animation states, and component design are not yet specified. Copy is owner-supplied (FR-18); visual/UX design is a recommended parallel or follow-on input.
- [OPEN] Recommend running bmad-ux for the marketing site to produce DESIGN.md + EXPERIENCE.md before or alongside build; stories will reference "per UX contract (TBD)" for visual specifics.

### FR Coverage Map

FR-1: Epic 1 - Taste-of-magic trade+city preview on the homepage
FR-2: Epic 1 - Waitlist email capture (Lead, source=waitlist)
FR-3: Epic 1 - Positioning content blocks (Difference/Belonging/Direction)
FR-4: Epic 2 - Performance-safe demo video (click-to-play facade)
FR-5: Epic 2 - Optimized in-app screenshots
FR-6: Epic 2 - Examples content structure (per-trade/outcome slots)
FR-7: Epic 3 - Invoice calculation + live preview (Ontario HST)
FR-8: Epic 3 - PDF generation (client) + email delivery (send-invoice endpoint)
FR-9: Epic 3 - Bilingual calculator UI + invoice output
FR-10: Epic 3 - Bridge-to-Scheza CTA after generation
FR-11: Epic 4 - Referral loop (opaque tokens, attribution)
FR-12: Epic 4 - Demo / pilot request path
FR-13: Epic 4 - Partner angle entry point
FR-14: Epic 1 - CASL-safe, server-witnessed consent capture
FR-15: Epic 2 - Real, attributed testimonials (real-or-hidden)
FR-16: Epic 5 - Blog rendering from PersonaPress (build-time SSG)
FR-17: Epic 5 - Blog distribution metadata + comparison/SEO assets
FR-18: Epic 1 - Owner-supplied copy via named Content Slots (foundation)

NFRs are cross-cutting: NFR-1/2/4/5/7/8/9 are established in Epic 1 and honored across all epics; NFR-3 (AEO/GEO) is realized primarily in Epic 5; NFR-6 (analytics) is wired in Epic 1 with per-epic events added as capabilities land.

## Epic List

### Epic 1: Live landing + waitlist capture (the conversion core)
A visitor lands on a fast, bilingual homepage, sees the taste-of-magic preview and the positioning, and joins the waitlist. Establishes the foundation the whole site stands on: greenfield Astro/Cloudflare scaffold + deploy pipeline, the single Lead contract + `leads` table + `capture-lead` endpoint + Turnstile + CASL server-witnessed consent, and the copy-slot/i18n system. Standalone: a live page that captures named, consented leads; ships before anything else.
**FRs covered:** FR-1, FR-2, FR-3, FR-14, FR-18 (establishes NFR-1/2/4/5/7/8/9)

### Epic 2: Proof & examples
The "how it works" / examples page: performance-safe demo video (click-to-play facade), optimized in-app screenshots, per-trade example slots, and real attributed testimonials (reusable on the homepage). Builds on Epic 1's content-slot + i18n foundation; needs no later epic.
**FRs covered:** FR-4, FR-5, FR-6, FR-15

### Epic 3: Free Invoice + Tax Calculator (lead magnet)
The bilingual calculator island (deterministic tax math + client-side `pdf-lib`), the bridge-to-Scheza CTA, and the `send-invoice` endpoint (server-regenerated PDF, self-send only). Reuses Epic 1's capture/consent infra; stands alone as a usable free tool that ships without the app.
**FRs covered:** FR-7, FR-8, FR-9, FR-10

### Epic 4: Early access, referral & partner
The early-access page: the referral loop (server-issued opaque tokens, non-forgeable attribution), the demo/pilot request path, and the partner entry point. Reuses Epic 1's capture infra; stands alone.
**FRs covered:** FR-11, FR-12, FR-13

### Epic 5: Blog & SEO/AEO assets
PersonaPress blog (build-time render + HTML sanitize + webhook/scheduled rebuild), share/distribution metadata, and the comparison pages ("Scheza vs Jobber") as SEO/AEO assets. Depends only on the Epic 1 scaffold, so it can be built early/in parallel to start blogging immediately.
**FRs covered:** FR-16, FR-17 (delivers NFR-3)

---

## Epic 1: Live landing + waitlist capture (the conversion core)

Deliver a live, fast, bilingual homepage that captures named, consented leads — and the foundation the whole site depends on. Realizes UJ-1.

### Story 1.1: Scaffold the Astro + Cloudflare project and deploy pipeline

As the site builder,
I want a new Astro project deploying to Cloudflare with CI and bilingual routing,
So that every later story ships onto a live, fast, safe foundation.

**Acceptance Criteria:**

**Given** a new repository (separate from the app)
**When** the project is scaffolded
**Then** it runs Astro ^7 with the `@astrojs/cloudflare` ^14 adapter, TypeScript strict, and Tailwind v4
**And** Astro i18n routing serves EN at `/` and FR under `/fr/**`
**And** a placeholder homepage renders as static HTML.

**Given** a pull request
**When** CI runs
**Then** build + type-check pass, an axe accessibility check runs on key pages, and a build-failing secret-leak gate rejects any server-only secret name in client-shipped code (AD-6, AD-19)
**And** a Cloudflare preview deploy is produced per PR, with production deploying on merge to main and instant rollback available (AD-20).

**Given** environment configuration
**When** the repo is inspected
**Then** only `.env.example` with placeholders is committed; real secrets live in Cloudflare project secrets; Sentry error reporting and Cloudflare Web Analytics are wired (AD-20).

**Given** the Scheza brand guide (`docs/visual.png`)
**When** the Tailwind v4 theme is configured
**Then** the brand color palette (navy/blue/cyan, exact hex from the guide) and **Inter** as the primary typeface are set as design tokens, and the Scheza logo/wordmark assets are added — so all later stories build on-brand (brand = visual.png; aesthetic approach = design.md).

### Story 1.2: Lead capture endpoint (Resend Contacts) with abuse/consent guard

As a marketer,
I want one validating server endpoint that safely records leads into Resend,
So that lead data and consent are trustworthy and abuse-resistant — with no database to run.

**Acceptance Criteria:**

**Given** the Resend account
**When** the lead store is configured
**Then** a marketing audience/segment exists with custom contact properties for `source`, `trade`, `city`, `locale`, and a marketing **topic** for consent (AD-4, AD-9); the Resend API key is server-only (AD-6).

**Given** a POST to `api/capture-lead`
**When** the endpoint processes it
**Then** it verifies a Cloudflare Turnstile token server-side, rejects on failure, and applies rate limiting (AD-10, NFR-9)
**And** it whitelists accepted fields, derives `source` server-side, validates the email, and **upserts the Resend contact by normalized email** (AD-15, AD-16)
**And** consent is server-witnessed: the marketing topic subscription + consent timestamp/locale are set from the (unticked-by-default) opt-in; opt-out always wins (AD-9, FR-14)
**And** a confirmation email is sent via Resend.

**Given** a malformed or forged payload (e.g. client-sent `source`, bogus fields)
**When** the endpoint processes it
**Then** forged/unknown fields are ignored and a safe `{ data, error }` response is returned without leaking internals or the Resend key.

### Story 1.3: Homepage hero and waitlist signup

As a visitor (Time-Starved Tim),
I want to grasp what Scheza is and join the waitlist in seconds,
So that I get early access without creating an account.

**Acceptance Criteria:**

**Given** the homepage
**When** it loads on mobile
**Then** the hero renders from EN/FR Content Slots (copy-slot + i18n foundation, FR-18, AD-14) with no hardcoded strings
**And** a waitlist form island with an email field, an unticked-by-default marketing opt-in, and a Turnstile widget is present.

**Given** a visitor submits a valid email
**When** the form posts to `api/capture-lead`
**Then** a Lead is recorded (`source=waitlist`) with trade/city/locale where available and the consent choice
**And** a confirmation state shows without a full page reload (FR-2)
**And** submitting a duplicate email updates rather than duplicates.

### Story 1.4: Taste-of-magic trade + city preview

As a visitor,
I want to see a Scheza app that looks like my trade,
So that I feel it was built for me and want early access.

**Acceptance Criteria:**

**Given** the homepage preview island
**When** a visitor selects a trade and enters a city and triggers it
**Then** a representative canned per-trade preview renders within the performance budget, reflecting the city where feasible (FR-1, AD-13)
**And** the trade list covers the beachhead trades plus "Other".

**Given** the preview cannot render (error/slow)
**When** the visitor triggers it
**Then** a canned trade-specific fallback is shown and the flow leads into the waitlist capture — it never dead-ends on a spinner (NFR-7).

**Given** a future live-generation mode
**When** it is added later
**Then** it can replace the canned source behind the same island interface without making the page dynamic (AD-13).

### Story 1.5: Positioning content blocks (Difference / Belonging / Direction)

As a visitor,
I want to understand why Scheza is different and trustworthy,
So that I choose it over "just another app builder".

**Acceptance Criteria:**

**Given** the homepage below the hero
**When** it renders
**Then** distinct Content Slots present the Difference (learning assistant / compounding value), Belonging (Canadian trades community + resources, EN/FR, data in Canada), and Direction (vision) messages in the confirmed spine order (FR-3).

**Given** the Direction slot
**When** it renders
**Then** it is visibly styled/labeled as vision, not a shipping feature (over-promise guardrail).

**Given** EN and FR
**When** either locale is viewed
**Then** all positioning copy comes from paired owner-supplied slots with no hardcoded strings (AD-14).

### Story 1.6: Homepage SEO / AEO / accessibility / performance baseline

As the site owner,
I want the homepage discoverable, citable, accessible, and fast,
So that the SEO/AEO/GEO guarantee holds from day one.

**Acceptance Criteria:**

**Given** the homepage
**When** it is audited
**Then** it passes Core Web Vitals on mobile and no third-party asset pushes it out of budget (NFR-1)
**And** it emits correct title/meta/canonical, EN/FR `hreflang`, sitemap, and robots (NFR-2)
**And** it includes schema.org structured data (Organization / SoftwareApplication, FAQ where relevant) for AI-answer citation (NFR-3).

**Given** an accessibility audit
**When** axe runs in CI on the homepage
**Then** it meets WCAG 2.1 AA (contrast, keyboard nav, focus, alt text, labels) (NFR-4, AD-19).

**Given** the analytics layer
**When** a visitor builds a preview or submits the waitlist
**Then** consent-aware events with UTM are captured to a residency-compliant sink (NFR-6, AD-11).

---

## Epic 2: Proof & examples

Show, don't tell: examples, demo video, screenshots, and real testimonials. Realizes UJ-1, UJ-5.

### Story 2.1: Examples / how-it-works page with per-trade content slots

As a visitor,
I want to see practical examples for my kind of work,
So that I believe Scheza fits my trade.

**Acceptance Criteria:**

**Given** the examples page
**When** it renders
**Then** examples are organized as Content Slots per trade/outcome, each supporting a video, a screenshot set, and a caption (FR-6)
**And** adding a new example needs only content/config, no code change
**And** the page is static, bilingual, and meets the SEO/a11y/performance baseline (NFR-1/2/4/5).

### Story 2.2: Performance-safe demo video

As a visitor,
I want to watch a short demo,
So that I see the magic — without the page getting slow.

**Acceptance Criteria:**

**Given** a demo clip on the page
**When** the page loads
**Then** only a lightweight thumbnail/poster loads; the player/iframe loads only on click (facade); nothing autoplays and no video is in the critical path (FR-4, NFR-1).

**Given** the demo set
**When** reviewed
**Then** at least one clip is available in French (FR-4).

### Story 2.3: Optimized in-app screenshots

As a visitor,
I want crisp product screenshots that load fast on my phone,
So that I trust the product looks real and polished.

**Acceptance Criteria:**

**Given** screenshots on the page
**When** rendered
**Then** they use a next-gen format, are responsive/sized per viewport, and are lazy-loaded below the fold (FR-5)
**And** each carries descriptive alt text (NFR-4, NFR-2).

### Story 2.4: Real, attributed testimonials

As a skeptical visitor,
I want to read real testimonials from people like me,
So that I trust Scheza enough to sign up.

**Acceptance Criteria:**

**Given** the testimonials component
**When** it renders
**Then** it shows real, attributed testimonials (name, trade, city; optional photo/clip), content-managed not hardcoded (FR-15), and is reusable on the homepage.

**Given** no testimonials exist yet (pre-pilot)
**When** the component renders
**Then** it shows a clean empty/hidden state — never a fabricated testimonial.

---

## Epic 3: Free Invoice + Tax Calculator (lead magnet)

A genuinely useful bilingual tool that ships without the app and bridges back to Scheza. Realizes UJ-2.

### Story 3.1: Invoice calculation and live preview (Ontario HST)

As a trades visitor,
I want to build an invoice and see correct tax instantly,
So that I get real value before signing up.

**Acceptance Criteria:**

**Given** the calculator island
**When** a visitor enters business/client/line items and selects Ontario
**Then** a live invoice preview shows correct per-line and total math with HST 13% (FR-7)
**And** tax rates come from a dated config constant with a "not tax advice" disclaimer
**And** the tool is fully usable with no account, client-side, with the app offline (AD-7, NFR-7).

### Story 3.2: Client-side branded PDF download

As a trades visitor,
I want to download a clean branded invoice PDF,
So that I can send it to my customer.

**Acceptance Criteria:**

**Given** a completed invoice in the preview
**When** the visitor clicks download
**Then** a PDF is generated in the browser via `pdf-lib` (`lib/pdf`) that matches the preview (identity/logo, line items, taxes, totals, terms) (FR-8, AD-7)
**And** no server call is required for the download path.

### Story 3.3: Bilingual calculator UI and invoice output

As a French-preferring visitor,
I want the tool and the invoice in French,
So that it works the way I do business.

**Acceptance Criteria:**

**Given** the EN/FR toggle
**When** switched
**Then** both the tool UI and the generated invoice labels/output change language (FR-9)
**And** no strings are hardcoded (AD-14).

### Story 3.4: Email-the-PDF endpoint (regenerate + self-send)

As a visitor,
I want the invoice emailed to me,
So that I have a copy — and Scheza captures me as a lead.

**Acceptance Criteria:**

**Given** a POST to `api/send-invoice`
**When** processed
**Then** it accepts structured invoice data only (never client PDF bytes or a client-chosen recipient), verifies Turnstile, regenerates the PDF server-side from the shared `lib/calc` + `lib/pdf`, and sends only to the captured/verified email via Resend as transactional email (FR-8, AD-18, AD-10, AD-9).

**Given** the email request
**When** it completes
**Then** a Lead is recorded (`source=calculator`) via the capture path with the visitor's consent choice.

### Story 3.5: Bridge-to-Scheza CTA and opt-in

As the site owner,
I want the free tool to point users to early access,
So that the lead magnet feeds the funnel, not just gives away a PDF.

**Acceptance Criteria:**

**Given** a generated invoice
**When** the visitor finishes
**Then** an owner-supplied bridge CTA (e.g. "Scheza remembers every job, client, and invoice for you") leads to waitlist capture / the marketing opt-in (FR-10)
**And** the opt-in is separate and unticked (FR-14).

---

## Epic 4: Early access, referral & partner

The conversion hub: referral loop, pilot recruiting, and partner conversations. Realizes UJ-3, UJ-4. Note: demo/partner capture reuse the Epic 1 Resend capture path; the **referral loop introduces a Cloudflare D1 store** for token→attribution, since Resend Contacts cannot enforce uniqueness/counting (AD-17). Perk is **40% off** for both parties.

### Story 4.1: Early-access page and demo / pilot request

As a real trade willing to try Scheza,
I want a clear "talk to us / join the pilot" path,
So that I can get in early beyond the passive waitlist.

**Acceptance Criteria:**

**Given** the early-access page
**When** a visitor submits the demo/pilot form (name, business/trade, city, contact, optional note)
**Then** a Lead is recorded (`source=demo`) distinguishable from waitlist signups for follow-up (FR-12)
**And** the page is bilingual and meets the SEO/a11y/performance baseline.

### Story 4.2: Partner entry point

As a bookkeeper/accountant/agency,
I want a path to start a partner conversation,
So that I can explore working with Scheza.

**Acceptance Criteria:**

**Given** a partner-oriented Content Slot and contact path
**When** a partner submits interest
**Then** a Lead is recorded (`source=partner`) (FR-13).

### Story 4.3: Referral link generation

As a waitlisted lead,
I want a personal invite link,
So that I can refer another contractor and jump the line.

**Acceptance Criteria:**

**Given** the Cloudflare D1 referral store is provisioned (AD-17)
**When** a lead requests an invite link
**Then** a server-issued opaque referral token is generated and persisted to D1 (never a raw contact id/email in the link) and shown to copy (FR-11, AD-17).

### Story 4.4: Referral attribution on signup

As the site owner,
I want referred signups attributed honestly,
So that the referral loop is measurable and not gameable.

**Acceptance Criteria:**

**Given** a visitor arriving via an invite link who becomes a Lead
**When** capture processes the token against the D1 referral store
**Then** the referrer is resolved server-side, the attribution is recorded, self-referral (same identity) is rejected, and exactly one attribution per referred email is counted (idempotent via a D1 uniqueness constraint) (FR-11, AD-17)
**And** the **40% off** perk for both the referrer and the referred contractor is recorded for launch fulfillment (referrer also jumps the line)
**And** a referral coefficient is computable from stored attribution (SM-2).

---

## Epic 5: Blog & SEO/AEO assets

An owned content + discoverability asset, live early so blogging can start during the app build. Realizes UJ-4 and amplifier reach.

### Story 5.1: Blog rendering from PersonaPress (build-time, sanitized)

As the site owner,
I want blog posts rendered from PersonaPress as fast static pages,
So that I can start blogging while the app is built.

**Acceptance Criteria:**

**Given** the PersonaPress headless API (token server/build-only)
**When** the site builds
**Then** blog index and post pages are generated as static HTML from PersonaPress, with external HTML sanitized/escaped (FR-16, AD-8, AD-6).

**Given** PersonaPress is unavailable at build
**When** the build runs
**Then** the site degrades to last-known/empty state, never a broken page (NFR-7).

### Story 5.2: Blog distribution metadata and structured data

As the site owner,
I want each post shareable and citable,
So that posts feed social/outbound and get found.

**Acceptance Criteria:**

**Given** a blog post page
**When** it renders
**Then** it includes Article schema.org data, canonical URL, `hreflang`, and Open Graph / Twitter card metadata (FR-17, NFR-2/3)
**And** blog language is per-post (each post EN or FR as authored, not translated 1:1); each renders under its own locale with correct canonical, and `hreflang` is emitted only where a translated counterpart exists (AD-8).

### Story 5.3: Blog rebuild trigger

As the site owner,
I want the site to refresh when I publish,
So that new posts appear without a manual deploy.

**Acceptance Criteria:**

**Given** a new/updated PersonaPress post
**When** its webhook fires
**Then** a rebuild/redeploy is triggered; a scheduled rebuild exists as a fallback (AD-20, FR-16).

### Story 5.4: Comparison / SEO-AEO pages

As an in-market visitor comparing tools,
I want an honest "Scheza vs Jobber" page,
So that I can decide — and Scheza gets found for that intent.

**Acceptance Criteria:**

**Given** the comparison page(s) (e.g. `/compare/jobber`)
**When** rendered
**Then** they are first-class static pages driven by owner-supplied Content Slots, with SEO metadata and AEO/GEO structured data (FAQ/comparison), meeting the performance + a11y baseline (NFR-2/3/1/4, FR-17).
