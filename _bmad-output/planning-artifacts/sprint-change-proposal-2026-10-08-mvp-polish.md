# Sprint Change Proposal — First-Run Polish & Post-Testing Fixes

- **Date:** 2026-10-08
- **Author:** Boris (PM) with BMad Create-Epics-and-Stories
- **Project:** Scheza app (`app.scheza.com`)
- **Scope classification:** Moderate (new MVP epic + PRD addition; product vision intact)
- **Mode:** Incremental (scope decisions approved individually)
- **Trigger:** Boris's own post-launch testing of the MVP (10 observations)

---

## Section 1 — Issue Summary

Boris's hands-on testing surfaced ten adjustments. Each was grounded in the codebase before planning:

1. **AI builds the table from a description** — already describe→generate (`gemini/prompts.ts:88`), but the single "what you track" field forces enumeration; reshape to a business description plus optional explicit items.
2. **Em-dash shown to users** — 4 live i18n strings (`en.json`/`fr.json` lines 67/116/127/170) plus the generation prompt's own instruction text (`prompts.ts:109`) still carry em-dashes. (retro-item-81 closed the earlier `fallback.ts`/`prompts.ts` reason strings; this is the residue.)
3. **Login lands on `/other-toronto`, cannot get back** — the only churn-grade defect. The org slug is auto-derived from `tradeType + city` (`claim/slug.ts:36`, title-cased in `finalizeClaim`), there is no slug confirmation, `/` shows the claim form again to signed-in users, and there is no visible "log in" path for returning visitors.
4. **Business name on `/`** — not collected anywhere; a known gap in `deferred-work.md` ("No first-class business/display name").
5. **No favicon** — a favicon file exists (`src/app/favicon.ico`); the likely gaps are brand confirmation and the companion icon set (apple-touch / PWA manifest), which matter for the Epic 8.2 install experience.
6. **Promo codes at checkout** — the subscription Checkout Session (`stripe/checkout/route.ts:115`) does not set `allow_promotion_codes`.
7. **Textbox editable by dragging** — only the landing `PromptBuilder` textarea has `resize-y` (`PromptBuilder.tsx:140`).
8. **Google sign-in** — Supabase magic-link only; no OAuth provider.
9. **Other gaps (requested):** G1 returning-user login discoverability, G2 no auth-aware home / sign-out, G3 session-expiry re-strands users, G4 PWA/icon completeness, G5 slug permanence/rename (rename stays deferred).
10. **scheza-bot in `.gitignore` + a cool/viral generating animation** — `scheza-bot/` is a finished, standalone 22-mood animated SVG mascot (zero deps, SSR-safe, reduced-motion-aware) that is **not wired into the app** and **not git-ignored**. It is the natural vehicle for both the AI assistant avatar and the generation reveal; today the reveal is a quiet `animate-pulse` skeleton.

**Category:** New requirements + bug fix emerged from stakeholder testing.

---

## Section 2 — Impact Analysis

**Epic impact.** New **Epic 15 — First-Run Polish & Post-Testing Fixes** (next free number after Epic 14). No existing epic is reopened. The first-run spine extends Epic 1 (intake/generation), Epic 2 (magic-link auth), and Epic 12 (`business_profiles`).

**Story impact.** No existing story is modified. The slug-derivation and claim-finalization behavior from Epic 1/2 is adjusted (business-name-derived, confirmed), not rewritten.

**Artifact conflicts.**
- **PRD:** FR105–FR110 added (new "First-Run Polish" section). No existing FR amended.
- **Architecture:** no new platform table. Reuses `business_profiles` (Epic 12), the `auth/confirm` redirect + `resolveUserPrimaryOrgSlug` (Epic 2), the Gemini prompt (Epic 1), and the Stripe checkout route (Epic 7/12). Google OAuth is a new Supabase provider config.
- **UI/UX:** net-new business-name field + slug confirmation + auth-aware home; the vendored SchezaBot mascot as the assistant avatar and the bot-led generation reveal.
- **Ledger:** the "business/display name" deferral moves to `SCHEDULED — Epic 15 Story 15.1`. retro-item-81 (em-dash) and retro-item-83 (sibling gitignore) stay `done`; Epic 15 re-applies the same two rules to newly-found instances (the i18n banners, and the newer `scheza-bot` sibling).

**Technical impact.** No DB migration, no CI/IaC change. SchezaBot adds no runtime dependency (its test harness needs `jsdom` as a dev dep). Google OAuth needs provider credentials + redirect URL config.

---

## Section 3 — Recommended Approach

**New Epic 15, four grouped stories by work-unit** (not one-per-fix). Approved scope decisions:

1. **First-run fix:** full redesign (business name → confirmed friendly slug → auth-aware home → reshaped intake), not a minimal patch.
2. **Google sign-in:** fast-follow, sequenced last.
3. **Generating animation:** signature reveal, built on the SchezaBot mascot.
4. **Promo codes:** simple `allow_promotion_codes` enable (not full campaign tooling).
5. **Story structure:** 4 grouped stories.

Rejected: a minimal churn-bug-only patch (leaves the ugly derived slug and the missing business name); full coupon-campaign tooling (out of MVP); building Google OAuth into the critical path (needless launch risk).

**Effort:** Medium (15.1 and 15.2 are the substantive stories; 15.3 is quick wins; 15.4 is isolated). **Risk:** Low–Medium (the first-run spine touches the auth redirect path — verify the magic-link flow still routes correctly).

---

## Section 4 — Detailed Change Proposals (applied 2026-10-08)

1. **`epics.md`** — appended the Epic 15 block + Stories 15.1–15.4 in full `Given/When/Then` format.
2. **`prd.md`** — added FR105–FR110 under a new "First-Run Polish & Post-Testing Fixes" section.
3. **`sprint-status.yaml`** — added the `epic-15` block (four stories `backlog`, retrospective `optional`).
4. **`deferred-work.md`** — "business/display name" entry → `SCHEDULED — Epic 15 Story 15.1`.
5. **This proposal** — the audit trail, referenced from the epics/PRD/sprint-status headers.

### Story summary

| Story | Goal | Items | FRs |
|-------|------|-------|-----|
| 15.1 First-run overhaul | business name + reshaped intake + confirmed business-name slug + reserved-word guard + auth-aware home + returning login + public-surface EN/FR toggle | #1, #3, #4, G1, G2, G6, G8 | FR105–108 |
| 15.2 SchezaBot assistant + signature reveal | vendor the mascot, wire mood↔state, bot-led generation reveal, then gitignore the source folder | #10, #10a, #10b | UX-DR |
| 15.3 MVP polish quick-wins | em-dash scrub (i18n + AI guard) + non-draggable textboxes + favicon/icon set + invoice money formatting + promo codes | #2, #5, #6, #7, G4, G7 | FR109 |
| 15.4 Google sign-in | Supabase Google OAuth alongside magic link | #8, G3 | FR110 |
| 15.5 Launch hardening | /api/claim + /api/invite rate limiting + server-side record/select validation + bounded lists/export + pre-go-live build/type-check verification | G9, G10, G11, G12 | — |
| 15.6 Offboarding retention verification | prove the hard-delete cascade excludes invoices/credit-notes/payments (6-yr retention) and includes forms, against a live schema; hard gate on Epic 8 Story 8.5 | compliance | — |

**Folded-in hardening (from the deferred-work ledger, same-code):** `finalizeClaim` made atomic (line 24) → 15.1; reused-session-org reveal mixing (lines 12/74) → 15.2; `/api/invite` rate limiting (line 36) → 15.5. Deferred-and-accepted for MVP: single-select filter/sort (212), orphaned-value render (200), datetime `on` granularity (86), public-form own-title (236), anonymous-org TTL cleanup (8), and the broader test-debt cluster (focused test pass recommended on the realtime + `mutate.ts` paths before go-live).

**Sequencing:** 15.1 build-order spine first; 15.2 (vendor → reveal) in parallel, with the reveal finale depending on 15.1's business name; 15.3 anytime; 15.4 last; 15.5 + 15.6 before go-live.

**Slug model (recorded decision, Story 15.1):** the dashboard slug is a routing label, not the security boundary — access is already auth-scoped via RLS + `org_members`, so two same-named businesses are fully isolated. The slug is globally unique only because it also keys the public intake-form URLs (anonymous, no auth to disambiguate); same-name collisions get a `-2` suffix. Per-tenant subdomains (Salesforce-style) and opaque public-form tokens (like the existing invoice `/i/[token]`) are post-MVP options, not MVP changes.

---

## Section 5 — Implementation Handoff

**Scope: Moderate → Product Owner / Developer.**

- **PM/PO:** owns FR105–FR110 and the Epic 15 block; confirms FR numbering (FR104 was the prior tail).
- **Developer (bmad build):** builds 15.1 → 15.4 per spec; each story's spec owns its detailed UI/UX (web-uiux-architect at spec time) and tests. Verify the magic-link redirect still routes correctly after the first-run changes.

**Success criteria:** a new owner names their business, sees and confirms a friendly dashboard URL, watches the SchezaBot-led reveal build their dashboard, and can always get back in (auth-aware home + visible login + Google one-tap); launch coupons redeem at checkout; no em-dash reaches users or AI-generated labels; the landing textboxes are not drag-resizable; the brand favicon and PWA icons are complete; the `scheza-bot/` source folder is git-ignored with only the integrated copy tracked.

**Next step:** hand Story 15.1 to bmad build.
