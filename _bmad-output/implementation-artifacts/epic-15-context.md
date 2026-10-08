# Epic 15 Context: First-Run Polish & Post-Testing Fixes

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic fixes the only churn-grade defect found in hands-on MVP testing (a signed-in owner lands on an auto-derived slug like `/other-toronto` and has no way to navigate back to log in) and polishes the first-run journey around trust and the "aha" moment. It captures the business name as a first-class identity, reshapes the generative intake so owners describe their business in their own words instead of enumerating fields, turns the quiet generation skeleton into a bot-led signature reveal, enables launch promo codes at checkout, and clears a batch of small trust/polish items. It also hardens the launch surface (rate limiting, server-side validation, bounded queries) and verifies the statutory data-retention cascade. It builds on the existing intake/generation flow, magic-link auth, and the `business_profiles` table; it adds no new database table or migration.

## Stories

- Story 15.1: First-run overhaul (business name, confirmed slug, reshaped intake, auth-aware home)
- Story 15.2: SchezaBot assistant and signature generative reveal
- Story 15.3: MVP polish quick-wins (copy, inputs, icons, promo codes)
- Story 15.4: Google sign-in (fast-follow)
- Story 15.5: Launch hardening
- Story 15.6: Offboarding retention cascade verification

## Requirements & Constraints

- The landing intake must collect a business name and promote it to the organization's first-class display name, replacing the previously derived trade+city title value.
- The dashboard slug must be derived from the business name (slugified), made globally unique across organizations via collision suffixing (`-2`, `-3`…), and shown to the owner as their dashboard URL before claim, editable before confirmation. Duplicate business *names* are allowed; the name is a display heading, never a uniqueness key. The slug is globally unique only because it also keys the public intake-form URLs that anonymous visitors hit. After login the owner must always be shown their final dashboard URL so a same-name collision never strands or misdirects them.
- A reserved-word guard must prevent a slug from shadowing a system top-level route (login, auth, forms, generate, demo, i, api, the home route) or resolving to an empty/degenerate value.
- The landing route must be authentication-aware: a signed-in owner is routed to (or offered a prominent card to) their dashboard with a sign-out affordance, never the empty claim form; a returning signed-out visitor always has a visible "log in" path so someone who did not memorize their slug is not stranded.
- An EN/FR locale toggle must be available on public, unauthenticated surfaces (landing, login, legal), extending the existing locale engine beyond the authenticated nav.
- The reshaped intake must invite a free-form business description plus optional explicit items; generation must infer the schema from the description while also honoring any explicitly listed items.
- The subscription checkout must accept promotion codes so launch/early-adopter coupons created in the Stripe dashboard redeem at the hosted checkout, with success and cancel flows unchanged.
- An owner must be able to authenticate with Google (Supabase OAuth) in addition to the passwordless magic link; first-time consent handling matches the existing claim consent model, and routing stays consistent with the magic-link flow.
- Launch hardening: per-IP/per-email rate limiting on the magic-link claim and teammate-invite endpoints; server-side validation that written keys match the table field schema and that select values are on the field's option list; bounded (paginated/capped/streamed) high-fan-in reverse-relation lists and full-data export; and a confirmed green production build and type-check before go-live.
- Retention verification: a test against a live-schema fixture must prove the offboarding hard-delete cascade excludes invoices, credit notes, invoice payments, and their frozen PDF objects (six-year retention) while deleting forms rows, and must exercise the `ON DELETE SET NULL` guarantee on customer-record references so purging records never orphans a retained invoice. This is wired into CI as a hard gate on the offboarding story reaching production.
- Non-functional constraints applying throughout: no em-dash in any user-facing copy or AI-generated labels/values; new or changed copy wired through the i18n layer (en + fr); form validation on submit (not per keystroke) with accessible inline messages; animations hold 60fps with no layout shift and honor reduced-motion; no new runtime dependency introduced by the mascot.

## Technical Decisions

- **No new platform table, no migration, no CI/IaC change.** Reuse `business_profiles` for the operating/display name, the existing auth-confirm redirect and primary-org-slug resolution for routing, the existing Gemini prompt for generation, and the existing Stripe checkout route for promo codes. Google OAuth is a new Supabase provider config (credentials + redirect URL) only.
- **Slug is a routing label, not a security boundary.** Access is auth-scoped (RLS + org membership), so two same-named businesses are fully isolated regardless of slug; typing another org's slug is blocked. Global uniqueness is required solely because the slug also keys the public, anonymous intake-form URLs. Per-tenant subdomains and opaque public-form tokens are explicitly post-MVP options, not part of this epic.
- **Slug derivation pipeline:** slugify the business name, apply the reserved-word guard, preview as best-effort (checked when shown and when edited), then resolve the authoritative unique slug at finalize via the existing uniqueness guard.
- **Atomic claim finalization:** the claim-finalization sequence (membership, slug, record clearing, token consumption) must be made atomic via transaction or compensating rollback, so a mid-sequence failure cannot leave a half-provisioned org.
- **Mascot integration:** the existing standalone 22-mood animated SVG mascot (zero deps, SSR-safe, reduced-motion-aware) is vendored into the app components tree, exported for app use, and its screen-reader label wired through i18n. State drives mood (e.g. thinking/focused while generating, success/proud on completion, oops/error on failure, listening/speaking in the schema editor). After vendoring, the top-level mascot distribution folder must be added to `.gitignore`, mirroring the sibling decoupled sub-project pattern, so only the integrated copy is tracked.
- **Clean reveal from reused session org:** when an anonymous visitor re-generates in the same browser session (the session org is reused), the reveal must read back only the current generation's tables and rows, never a merge of a prior session's soft-deleted or differently-keyed records.
- **AI output guard:** the generation prompt's own instruction text must contain no em-dash, and a guard or test must assert AI-generated table labels, field labels, and seed values never contain an em-dash.
- **Money formatting:** issued invoice amounts on screen and in the frozen PDF must render with a currency symbol and locale thousands grouping, not a bare two-decimal string.
- **Build blocker to confirm:** the previously deferred typed-routes build blocker around the policy-version constant must be explicitly verified resolved; if it reproduces, relocate the constant out of the route module.

## UX & Interaction Patterns

- **First-run spine:** landing prompt collects business name + trade type + city, plus a free-form "describe your business" prompt and an optional "anything specific you want to track?" field (inviting description over enumeration). The owner sees and can edit the previewed dashboard URL before confirming, and is always shown the final URL after login.
- **Signature generative reveal:** the bot-led reveal replaces the quiet pulse skeleton. The mascot narrates the real generation phases while the dashboard assembles (tables, then fields, then seed rows streaming in), ending on a proud/success pose showing the captured business name. Pacing follows actual latency and is never artificially padded; a fast response resolves fast. On a generation error it degrades gracefully (mascot oops pose) and the existing starter-template fallback banner shows, with no stuck or broken animation. Under reduced-motion the bot shows a calm still pose and the reveal is instant.

## Key Code Touchpoints

Concrete reuse anchors verified against the codebase. Reuse these rather than re-deriving; keep existing field names, cookie keys, and response-schema enum values stable.

**Claim finalization & slug (15.1 backend):**
- `finalizeClaim` (`src/lib/claim/claim.ts`) runs five sequential service-role writes (membership insert, slug + display-name set on `organizations`, trial set, synthetic-record soft-delete, claim-consume) with no wrapping transaction. Make it atomic by wrapping finalization in a Postgres RPC, modeling the existing `issue_invoice()` RPC (SECURITY INVOKER, single transaction, deterministic conflict error).
- Slug helpers in `src/lib/claim/slug.ts`: `deriveSlug` (currently trade+city → kebab, fallback `"app"`), `ensureUniqueSlug` (appends `-2`, `-3`… until free, excludes the claiming org's own id for idempotency), `slugBaseToName` (title-cases the base for the display name). For 15.1: derive the slug and display name from the business name instead; reuse `ensureUniqueSlug` as-is; add a reserved-word guard (there is no centralized reserved-route list today — add a constant covering the top-level route folders and `/api/*` and check both).
- Data model: `organizations.name` is the display name and `organizations.slug` is `UNIQUE`; `business_profiles.operating_name` (Epic 12, one row per org, currently nullable) is the typed home for the business display name and should be promoted into `organizations.name`.
- `POST /api/claim` (`src/app/api/claim/route.ts`) body is `{ email, consent: true, schema, intent?: { tradeType, city } }` — no business name yet. Thread a `businessName` through the intent into `pending_claims` and `finalizeClaim` (the `pending_claims` row needs a `business_name` column).

**Landing intake form (15.1 / 15.3):**
- `PromptBuilder` (`src/components/generation/PromptBuilder.tsx`) collects `tradeType` (enum), `city` (text), and `whatYouTrack` (textarea), validated on submit (not per keystroke) via react-hook-form + Zod. For 15.1 add the business name field and reshape `whatYouTrack` into a free-form description plus an optional explicit-items field; keep submit-only validation and the i18n-namespaced labels. For 15.3 change the textarea from the current `resize-y` to `resize-none` (making it non-draggable is the explicit 15.3 requirement, not a preserved behavior).
- Intake payload seam: on valid submit, `saveIntent()` (`src/lib/generation/intent.ts`) persists the `GenerationIntent` (`{ tradeType, city, whatYouTrack, submittedLocale }`) to sessionStorage, then routes to `/generate`; `/api/generate` validates the POST body against the mirrored intent schema. When extending the intent, update all three Zod schemas (stored intent, prompt-build input, generation body) and keep the storage key and POST payload shape stable (or bump the API version).
- Copy namespaces in `src/lib/i18n/en.json` / `fr.json`: `PromptBuilder` (field labels/placeholders/validation), `Home` (hero/tagline), `Generate` (skeleton + reveal + fallback). Add new field copy to the `PromptBuilder` namespace in both locales.

**Generation reveal (15.2):**
- `/generate` page (`src/app/generate/page.tsx`) reads the intent, POSTs to `/api/generate`, shows `DashboardSkeleton` (from `src/components/dashboard/DemoDashboard.tsx`, uses shadcn `Skeleton` with `aria-busy`/`aria-live`) while waiting, then reveals via `DemoDashboard` using Framer Motion grow gated on `useReducedMotion`. The bot-led reveal (15.2) replaces this skeleton; `/api/generate` already does one Gemini call with a single retry and falls back to a hardcoded universal template (`isFallback: true`) on double failure, which the reveal must degrade to gracefully.

**Auth-aware home & sign-out (15.1 / 15.4):**
- `src/app/page.tsx` renders the client-side claim form (`PromptBuilder`) to everyone with no auth check; convert to a server component that branches on session. Use `getCurrentUser()` (`src/lib/auth/session.ts`) for identity and `resolveUserPrimaryOrgSlug()` (`src/lib/auth/org.ts`, returns `{ slug } | null`) for routing — the same resolver the login callback already uses. Follow the RLS-safe pattern in `src/app/[slug]/page.tsx`. Leave `resolveUserPrimaryOrgSlug` and the middleware gate on `/{slug}` unchanged.
- Login redirect decision tree lives in `src/app/auth/confirm/route.ts` (verify OTP → resolve primary org slug → else first-time claim → else `/login?login=no-org`); the Google OAuth callback should route through this same resolver.
- No sign-out affordance exists anywhere yet — add one (e.g. a logout route calling `supabase.auth.signOut()`) and wire it into `DashboardNav` (`src/components/layout/DashboardNav.tsx`) and the home-page signed-in branch.

**Public-surface locale toggle (15.1 / G8):**
- `next-intl` v4, cookie-based (`NEXT_LOCALE`, mirrored to localStorage), no URL prefix. `LocaleProvider` already wraps the whole root layout, so locale is hydrated on `/`, `/login`, and the legal pages; the `LocaleToggle` component is currently rendered only inside the authenticated `DashboardNav`. Surface it on the public pages. Landing and login are client components (use the locale-switcher hook directly); legal pages are server components and need a small client wrapper.

**Em-dash scrub & AI guard (15.3):**
- Message bundles are `src/lib/i18n/en.json` and `src/lib/i18n/fr.json`; live em-dash strings are at the fallback-banner, last-table, cta-subtext, and settings-subtitle keys (same positions in both en and fr).
- The no-em-dash instruction already exists in the Gemini prompt; 15.3 adds a guard/test over AI output.

**Gemini prompt reshape (15.1 / 15.3):**
- `buildGenerationPrompt()` in `src/lib/gemini/prompts.ts` injects the free-form "what you track" text verbatim; the generation intent is defined in `src/lib/generation/intent.ts` and read by `/api/generate`. For 15.1, extend the intent with optional explicit items as model hints while keeping the free-form description path. The prompt already detects and outputs in the user's language.

## Cross-Story Dependencies

- Story 15.2's reveal finale depends on Story 15.1's captured business name (shown at the end of the reveal).
- Build-order: 15.1 is the spine and goes first; 15.2 (vendor then reveal) can run in parallel; 15.3 anytime; 15.4 sequenced last to keep OAuth off the launch critical path; 15.5 and 15.6 must complete before go-live.
- 15.6 is a hard CI gate on the Epic 8 offboarding story reaching production, and verifies retention carve-outs tied to Epic 12 invoicing data.
- The first-run changes touch the magic-link auth redirect path; verify magic-link routing still resolves correctly after 15.1 and 15.4.
