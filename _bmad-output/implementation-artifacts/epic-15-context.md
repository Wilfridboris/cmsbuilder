# Epic 15 Context: First-Run Polish & Post-Testing Fixes

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic hardens the first-run journey, trust, and the generative "aha" moment using findings from post-launch testing. It fixes the only churn-grade defect found (a signed-in owner lands on an auto-derived slug and cannot navigate back to log in), promotes the business name to a first-class identity that drives both the display name and the dashboard slug, reshapes the generative intake so owners describe their business in their own words instead of enumerating fields, turns the quiet generation skeleton into a bot-led signature reveal, enables launch promo codes, adds Google sign-in, and closes a batch of small trust/polish and launch-hardening items. It builds on existing foundations (anonymous intake/generation, magic-link auth, the business-profile identity capture, the locale engine) and introduces no new architectural layers.

## Stories

- Story 15.1: First-Run Overhaul — Business Name, Confirmed Slug, Reshaped Intake & Auth-Aware Home
- Story 15.2: SchezaBot Assistant & Signature Generative Reveal
- Story 15.3: MVP Polish Quick-Wins — Copy, Inputs, Icons & Promo Codes
- Story 15.4: Google Sign-In (Fast-Follow)
- Story 15.5: Launch Hardening
- Story 15.6: Offboarding Retention Cascade Verification

## Requirements & Constraints

- The landing intake must capture a business name that becomes the organization's first-class display name (persisted as the business profile's operating name), replacing the previously derived trade+city value.
- The dashboard slug must be derived from the business name (slugified), made globally unique across organizations with a collision suffix (`-2`, `-3`…), previewed to the owner before claim, and editable before confirmation. Duplicate business *names* are allowed; only the slug is a uniqueness key. The slug must be global-unique because it also keys the *public* intake-form URLs that anonymous visitors hit without auth; it is a routing label, not the security boundary (access remains auth-scoped).
- A reserved-word guard must prevent a business-name-derived slug from shadowing a system/top-level route or resolving to an empty/degenerate value.
- The landing route must be authentication-aware: a signed-in owner is routed to (or offered a prominent link to) their dashboard with a sign-out affordance; a returning signed-out visitor always has a visible "log in" path so a user who did not memorize their slug is never stranded. The owner must always be shown their final dashboard URL after login.
- The intake must invite a free-form business description plus an optional "anything specific to track?" field; generation must infer tables from the description while also honoring any explicitly listed items.
- The claim finalization sequence must be atomic (transaction or compensating rollback) so a mid-sequence failure cannot leave a half-provisioned organization.
- Subscription checkout must accept promotion codes so launch/early-adopter coupons can be redeemed.
- Owners must be able to authenticate with Google in addition to the passwordless magic link, with consent handling matching the existing claim consent model and routing consistent with the magic-link flow.
- Launch-hardening: rate-limit the magic-link dispatch and teammate-invite endpoints (per-IP/per-email) without blocking legitimate requests; server-validate record/select-write payload keys and select values against the field schema; bound high-fan-in reverse-relation lists and full data export (pagination/cap/streaming) so a large org cannot OOM or time out; and confirm production build + type-check exit cleanly.
- Offboarding verification: a CI gate must prove, against a live-schema fixture, that the hard-delete cascade EXCLUDES invoices, credit notes, payments, and frozen PDFs (six-year retention) while deleting forms rows, and that purging customer records sets referencing invoice/credit-note links to null rather than orphaning retained documents.

## Technical Decisions

- The business name promotes to the organization display name by persisting into the existing business-profile operating-name field; the claim finalization logic that previously derived a title-cased trade+city value is rewritten to use it.
- Slug uniqueness reuses the existing unique-slug guard; previewed URLs are best-effort (availability checked on display and on edit) with the authoritative unique slug resolved at finalize.
- Google auth is backed by Supabase OAuth; the callback reuses the existing auth-confirm redirect logic and the existing primary-org-slug resolution for post-login routing (dashboard if an org exists, otherwise claim).
- SchezaBot is an existing standalone mascot (multi-mood animated SVG, zero runtime deps, SSR-safe, reduced-motion-aware). It must be vendored into the app's components, exported, and its screen-reader label wired through the i18n engine, adding no new runtime dependency. The top-level standalone distribution folder must be gitignored, mirroring the existing decoupled sibling sub-project pattern, so only the integrated copy is tracked.
- The generation reveal replaces the quiet pulse skeleton with a bot-narrated sequence paced to the *actual* generation phases (never artificially padded); it must degrade gracefully to the existing fallback banner on generation error.
- When an anonymous session org is reused across re-generations, the reveal must read back only the current generation's tables and rows — never a merge of a prior session's soft-deleted or differently-keyed records.
- Promo codes are enabled by setting the allow-promotion-codes flag on the Stripe Checkout Session; success/cancel return flows are unchanged.
- The public-surface EN/FR toggle extends the existing locale engine beyond the authenticated dashboard nav to the landing, login, and legal surfaces.
- All new or changed user-facing copy must be wired through the i18n catalogs (en + fr), contain no em-dash (the rule is re-applied to newly found i18n banner/CTA/subtitle instances and to the generation prompt text, with a guard/test asserting AI-generated labels and seed values carry no em-dash), and validate on submit (not per keystroke) with accessible inline messages.
- Rate limiting reuses the existing Edge-Middleware pattern already applied to generation and intake endpoints.

## UX & Interaction Patterns

- The landing prompt shifts from field enumeration to invitation: business name + trade type + city + a free-form "describe your business" prompt + an optional explicit-items field.
- The dashboard URL is previewed in plain language ("your dashboard will live at scheza.com/{slug}") before claim and is editable.
- SchezaBot reflects app state by mood across generation, the conversational schema editor, and error/empty states (e.g. thinking/focused while working, success/proud on completion, oops/error on failure, listening/speaking in the editor). The generation reveal ends on a proud/success pose showing the captured business name.
- Under reduced-motion, the bot shows a calm still pose and the reveal is instant; in all cases animation must hold 60fps and introduce no layout shift. Inputs must meet accessible touch-target and label standards; landing textareas must not be drag-resizable.
- Icons/favicon: the Scheza brand favicon and the full companion icon set (apple-touch-icon, PWA manifest icons, metadata icons export) must be present so the "Add to Home Screen" PWA experience is unbroken.
- On-screen and PDF invoice money must render with a currency symbol and locale thousands grouping (e.g. `$1,234.50`), not a bare two-decimal number.

## Cross-Story Dependencies

- Depends on prior epics: Epic 1 (intake/generation pipeline), Epic 2 (magic-link auth + claim/consent), Epic 8 (locale engine, PWA, offboarding cascade), and Epic 12 (business profiles, issued-invoice view and PDF template).
- Story 15.1 is the first-run spine (business name → confirmed slug → auth-aware home → reshaped intake) that the other stories build around; 15.2 depends on the reshaped-intake business name for the reveal copy.
- Story 15.6 gates Epic 8's offboarding story reaching production "done"; Story 15.5's build/type-check gate guards `main` before go-live.
