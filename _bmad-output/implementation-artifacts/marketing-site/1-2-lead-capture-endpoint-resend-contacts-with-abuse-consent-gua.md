---
title: 'Lead capture endpoint (Resend Contacts) with abuse/consent guard'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'a765369369119801ca23cc65f8b3dcbcbe3b45bf' # scheza-marketing repo HEAD (code lives there; spec artifact lives in parent repo)
context:
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-marketing-site-2026-09-28/ARCHITECTURE-SPINE.md'
  - '{project-root}/_bmad-output/planning-artifacts/epics-marketing-site.md'
  - '{project-root}/_bmad-output/implementation-artifacts/marketing-site/1-1-scaffold-the-astro-cloudflare-project-and-deploy-pipeline.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The marketing site can render but cannot capture anyone. Every conversion point (waitlist, calculator, demo, partner, referral) needs one trustworthy, abuse-resistant server path to record a lead and its consent — with no database to run. Nothing exists yet, so Story 1.3's waitlist form has nothing to POST to.

**Approach:** Add the single validating edge endpoint `POST /api/capture-lead` (the marketing site's first Cloudflare function) plus a server-only Resend client. It verifies a Cloudflare Turnstile token server-side, rate-limits, whitelists a fixed field set, validates and normalizes the email, upserts a Resend Contact by email with custom properties (`source`/`trade`/`city`/`locale`), server-witnesses consent via a Resend marketing topic (opt-out wins), and sends a bilingual transactional confirmation email. Forged/unknown fields and a bad Turnstile token are rejected without leaking internals or the Resend key.

## Boundaries & Constraints

**Always:**
- Endpoint lives at `scheza-marketing/src/pages/api/capture-lead.ts` with `export const prerender = false` (AD-3); it is the ONLY capture path (AD-15). Read secrets via `import { env } from 'cloudflare:workers'` — never `import.meta.env` for server-only keys (AD-6).
- Turnstile is verified server-side against `https://challenges.cloudflare.com/turnstile/v0/siteverify` before any write; failure rejects (AD-10, NFR-9). Rate-limit every request keyed on client IP.
- Whitelist accepted fields: `email`, `source`, `trade`, `city`, `locale`, `marketingOptIn`, `turnstileToken`. `source` is validated against the fixed enum `{waitlist, calculator, demo, partner, referral}` server-side and never stored as a free client string; unknown values are rejected (server owns the enum — AD-4/AD-15). Any field not on the whitelist is ignored.
- Email is the identity (AD-16): normalize (trim + lowercase) then validate; upsert = `contacts.update({ email, ... })`, and on not-found create via `contacts.create`. Idempotent; a repeat email updates, never duplicates.
- Consent is server-witnessed (AD-9/FR-14): the marketing opt-in is a separate, unticked-by-default boolean; the endpoint sets the contact's marketing topic subscription (`topics: [{ id, status }]`) and records `consent_at`/`consent_locale` properties from it. Opt-out always wins; the confirmation email is transactional and sent regardless of opt-in.
- Errors return `{ data, error }` JSON with a user-facing message and correct status; never leak stack, env values, or the Resend key.
- Bilingual by construction (AD-14): confirmation email subject/body and endpoint user-facing messages come from paired EN/FR copy slots keyed by `locale`; nothing hardcoded in English only.
- Custom property keys and the consent topic are provisioned in Resend via a committed, idempotent setup script + documented steps; property keys must be pre-declared (`contactProperties.create`) before the endpoint assigns them.

**Decisions (resolved with the human):**
- **Provision live this session.** The `resend-setup.mjs` script is run against the real Resend account using the `RESEND_API_KEY` already present in the parent repo `.env.local` (sourced into the marketing env without exposing its value). It creates the audience, the consent topic, and the custom property definitions; the resulting `RESEND_AUDIENCE_ID`/`RESEND_TOPIC_ID` are recorded as config. A live smoke test of the endpoint is in scope. The script stays idempotent so re-runs are safe.
- **Rate limiting = native Workers `ratelimits` binding in code**, called fail-safe (a missing binding must not 500 the endpoint), with a Cloudflare WAF rate-limiting rule documented as the edge fallback because the binding's Pages-Functions support is unverified.

**Never:**
- No direct browser→Resend calls and no Resend key in client code (AD-5/AD-6). No second endpoint (send-invoice is Epic 3). No database/KV/D1 (referral store is Epic 4). No waitlist form/hero UI (Story 1.3) beyond a thin client helper. No real secret values committed. No SSR content pages — only this one function opts out of prerender.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid new lead | POST valid email, `source=waitlist`, valid Turnstile, `marketingOptIn=true` | Contact created in Resend with properties + topic opt_in + consent stamp; confirmation email sent; `200 {data:{ok:true},error:null}` | N/A |
| Returning email | POST existing email, changed fields | Contact updated by email (no duplicate); `200` | N/A |
| Opt-in unticked | POST valid email, `marketingOptIn` false/absent | Contact upserted; topic status `opt_out`; transactional confirmation still sent; `200` | N/A |
| Turnstile fails/expired | Bad/missing/reused token | No Resend write; `403 {data:null,error:"verification failed"}` | Reject before any write |
| Rate limited | Same IP exceeds limit | No write; `429 {data:null,error:"too many requests"}` | Fail closed |
| Invalid email | Malformed/empty email | No write; `400 {data:null,error:"invalid email"}` | Reject |
| Forged/unknown fields | Client sends `source=admin`, extra keys, or non-enum source | Unknown keys ignored; non-enum `source` → `400`; no internals/key leaked | Reject non-enum source |
| Resend/network error | Resend API 5xx or throw | `502 {data:null,error:"could not save, try again"}`; server logs detail, response leaks nothing | Catch + safe message |
| Wrong method | GET /api/capture-lead | `405` | Method guard |

</frozen-after-approval>

## Code Map

- `scheza-marketing/src/pages/api/capture-lead.ts` -- NEW. The endpoint. `export const prerender = false`, `export const POST`. This is the only place server-only secret names may appear (secret-leak-gate allows `src/pages/api/**`).
- `scheza-marketing/src/lib/resend.ts` -- NEW. Server-side Resend client wrapper: `upsertContact()`, `sendConfirmation()`, reads key via `cloudflare:workers` env. Never imported by client code.
- `scheza-marketing/src/lib/leads.ts` -- NEW. Thin client helper that POSTs to `/api/capture-lead` and returns `{data,error}` (AD-5). Safe for islands (Story 1.3) to import; contains no secret.
- `scheza-marketing/src/lib/validation.ts` -- NEW. Pure functions: email normalize+validate, field whitelist, `source` enum guard. Unit-tested; framework-agnostic (`src/lib/**`).
- `scheza-marketing/src/lib/turnstile.ts` -- NEW. `verifyTurnstile(token, ip, secret)` → boolean, calls siteverify. Server-only.
- `scheza-marketing/src/content/emails.ts` (or `src/i18n/ui.ts`) -- EN/FR paired copy for the confirmation email + endpoint messages (AD-14). `src/i18n/ui.ts` already holds the copy-deck pattern — extend it or add a sibling.
- `scheza-marketing/src/env.d.ts` -- ADD `TURNSTILE_SECRET_KEY`, `RESEND_FROM_EMAIL`, `RESEND_TOPIC_ID`, `RESEND_AUDIENCE_ID` (server-only, no `PUBLIC_` prefix) to `ImportMetaEnv`.
- `scheza-marketing/.env.example` -- ADD the same placeholders. NOTE: secret-leak-gate derives its gated-name list from here, so adding `TURNSTILE_SECRET_KEY` etc. makes them enforced (must only appear under `src/pages/api/**` or `src/lib` server files that are NOT client-imported — see Design Notes on the gate boundary).
- `scheza-marketing/scripts/flatten-static.mjs` -- REVIEW/ADJUST. Per Story 1.1 it no-ops once `dist/server/` is non-empty. This story creates the first `prerender=false` route, so `dist/server/` becomes non-empty and flattening stops — `/` and `/fr/` HTML then live under `dist/client/**`. Must reconcile so static HTML still builds and the a11y gate + Cloudflare `pages deploy dist` still resolve the homepage. See Design Notes.
- `scheza-marketing/scripts/a11y.mjs` -- REVIEW. Ensure it still locates the built homepage after the output layout changes.
- `scheza-marketing/scripts/secret-leak-gate.mjs` -- No change expected; `SERVER_ONLY_DIRS` already allowlists `src/pages/api/`. Confirm `src/lib/resend.ts` / `turnstile.ts` do not get imported by client-shipped code (else the gate fails, correctly).
- `scheza-marketing/wrangler.toml` -- ADD the `ratelimits` binding (if OQ2=A) and document required Cloudflare secrets.
- `scheza-marketing/package.json` -- ADD `resend` (^6) dependency and a test runner (see Verification) + `resend-setup` script.
- `scheza-marketing/tests/**` -- NEW. Unit tests for validation + endpoint behavior with Resend/Turnstile mocked.

## Tasks & Acceptance

**Execution:**
- [x] `scheza-marketing/package.json` -- add `resend` ^6 dependency, a lightweight test runner (`vitest`), a `test` script, and a `resend-setup` script -- enables the client + tests + provisioning (AC1).
- [x] `scheza-marketing/src/lib/validation.ts` -- pure email normalize/validate, field whitelist, `source` enum guard -- reusable, unit-testable core (AC3, AC4).
- [x] `scheza-marketing/src/lib/turnstile.ts` -- `verifyTurnstile()` calling siteverify with `secret`+`response`+`remoteip` -- abuse guard (AC2).
- [x] `scheza-marketing/src/lib/resend.ts` -- server Resend wrapper: upsert-by-email (update→create-on-404) with properties + topic subscription + consent stamp, and transactional confirmation send -- lead store + consent + email (AC1, AC2, AC4).
- [x] `scheza-marketing/src/pages/api/capture-lead.ts` -- orchestrate: method guard → rate-limit → Turnstile → whitelist/validate → upsert → confirmation → `{data,error}`; safe errors -- the endpoint (all ACs).
- [x] `scheza-marketing/src/lib/leads.ts` -- thin client `submitLead()` POSTing to the endpoint, returning `{data,error}` -- island-safe helper (AC2).
- [x] `scheza-marketing/src/i18n/ui.ts` (or `src/content/emails.ts`) -- EN/FR paired confirmation-email + endpoint-message copy -- bilingual, no hardcoded English (AC5).
- [x] `scheza-marketing/src/env.d.ts` + `.env.example` -- add `TURNSTILE_SECRET_KEY`, `RESEND_FROM_EMAIL`, `RESEND_TOPIC_ID`, `RESEND_AUDIENCE_ID` placeholders (server-only) -- config (AC1, AC6).
- [x] `scheza-marketing/scripts/resend-setup.mjs` + README section -- idempotent provisioning of audience/topic/custom-property definitions; **run live this session** with the key sourced from parent `.env.local` (value never printed); capture `RESEND_AUDIENCE_ID`/`RESEND_TOPIC_ID` into the marketing `.env` (gitignored); documents Cloudflare secrets needed -- ops (AC1).
- [x] `scheza-marketing/scripts/flatten-static.mjs` (+ `a11y.mjs` if needed) -- reconcile output layout now that `dist/server/` is non-empty so `/` and `/fr/` static HTML still build and gates pass -- keep 1.1's guarantees green (AC6).
- [x] `scheza-marketing/wrangler.toml` -- add the native `[[ratelimits]]` binding (`LEAD_LIMITER`, `limit`/`period=60`) + document required Cloudflare secrets; note the WAF-rule fallback -- rate limit (AC2).
- [x] `scheza-marketing/tests/**` -- unit tests covering every I/O & Edge-Case Matrix row (valid, returning, opt-out, turnstile-fail, rate-limit, invalid email, forged fields, resend error, wrong method) with Resend + Turnstile + rate-limiter mocked -- proves behavior (AC3).

**Acceptance Criteria:**
- Given a valid POST (good Turnstile, valid email), when the endpoint runs, then a Resend contact is upserted by normalized email with `source`/`trade`/`city`/`locale` properties and the consent topic set from the opt-in, a confirmation email is sent, and it returns `200 {data,error:null}`.
- Given a failed/absent Turnstile token or a rate-limit breach, when the endpoint runs, then no Resend write occurs and it returns `403`/`429` with a safe message.
- Given a forged payload (client-sent non-enum `source`, unknown extra fields), when processed, then unknown fields are ignored, a non-enum source is rejected, and no internals or the Resend key are leaked.
- Given the repo is inspected, when the secret-leak gate + `astro check` + build + a11y gate run, then all pass: no server-only secret name appears in client-shipped source, types are strict-clean, `/` and `/fr/` still emit static HTML, and axe finds no serious/critical issues.
- Given EN vs FR `locale`, when a confirmation is produced, then subject/body come from the paired copy slot for that locale (no hardcoded English).
- Given only `.env.example` placeholders are committed, when inspected, then no real secret exists and required Cloudflare secrets are documented.

## Implementation Notes

- **Resend API shapes verified live (drove three corrections).** Provisioning + a live smoke
  probe against the real account revealed the "New Contacts Experience" is audience-less and
  the SDK's `audiences` API is deprecated (it routes to `/segments`). Corrections applied to
  `src/lib/resend.ts`: (1) `audienceId` MUST NOT be combined with `topics` — a contact joins a
  group via `segments: [{ id }]` (array of objects, not strings) on create; (2) per-contact
  consent uses `topics: [{ id, subscription: 'opt_in'|'opt_out' }]` — the field is
  `subscription`, not `status`; (3) topic creation uses `defaultSubscription: 'opt_out'`.
  Upsert = `contacts.update({ email, properties, topics })` (audience-less path) then
  `contacts.create({ ..., segments: [{ id }] })` on 404. Read-back confirmed properties store
  as `{ value, type }`. `RESEND_AUDIENCE_ID` holds a **segment** id despite the name.
- **Live provisioning done.** `npm run resend-setup` created audience/segment
  `3a5b6824-a4c5-464c-9ee8-31688bc06cef` and topic `ba545d89-b0ad-4ada-b7a9-006ab6a57978`
  (+ six string properties). IDs are in the gitignored `scheza-marketing/.env`; set them as
  Cloudflare secrets for deploy. Email send verified via Resend's `delivered@resend.dev` test
  sink (from `onboarding@resend.dev`); `hello@scheza.com` needs domain verification for prod.
- **First edge endpoint changed the build (as predicted).** `dist/` now splits into
  `dist/client/**` (static HTML/assets) + `dist/server/**` (the Worker). `flatten-static.mjs`
  correctly no-ops (its existing guard). Fixed `a11y.mjs` and the secret-leak gate's dist scan
  to target `dist/client/**`; the gate must NOT scan `dist/server/**` (the Worker legitimately
  contains secret names — verified `RESEND_API_KEY` appears there but not in `dist/client`).
- **Env access:** endpoint reads secrets/bindings via `context.locals.runtime.env` → dynamic
  `import('cloudflare:workers')` → `import.meta.env` fallback, declared as a virtual module in
  `env.d.ts`. Kept out of the testable core (`processCaptureRequest`) so unit tests inject a
  runtime and never touch the Cloudflare runtime or `cloudflare:workers`.
- **Rate limit:** native `ratelimits` binding (`LEAD_LIMITER`) added to `wrangler.toml` and
  picked up by the adapter's generated `wrangler.json`. Called fail-open (missing/erroring
  binding never 500s); WAF rule documented as the Pages-Functions fallback.
- **Method guard:** `POST` handler + `ALL` catch-all returning 405 (verified in tests).
- **Remaining `astro check` hints (2):** `resend.audiences.*` deprecation in
  `resend-setup.mjs` — unavoidable, it is the only SDK path to create a segment; behavior
  verified working. Not errors; CI stays green.
- **Post-review manual check (Playwright on `astro dev`) caught a runtime crash the unit
  tests + SDK smoke test missed.** Every POST 500'd because `resolveEnv` read
  `context.locals.runtime.env`, which Astro v6 / adapter v14 turned into a *throwing* getter
  (removed). Fixed: `resolveEnv` now reads solely from `import('cloudflare:workers').env`
  (the frozen-boundary-mandated source), no `locals` access, empty-env fail-safe off-runtime.
  Re-verified live on `astro dev`: GET→405+Allow, tokenless→400, bad email→400, forged
  source→400, token present→403 (Turnstile fail-closed), malformed→400; EN/FR homepages
  still render. This is the seam the reviewers flagged as untested (runtime-only, not
  unit-testable) — the manual check is its coverage.

## Spec Change Log

## Review Triage Log

Review pass 1 (blind-hunter, edge-case-hunter, verification-gap). No intent_gap/bad_spec → no loopback; patches applied directly, full CI re-verified green (37 tests).

**Patched:**
- `medium` — Uncaught Resend SDK throw (edge-case, grouped update/create/send). A rejected SDK promise propagated unhandled → 500, violating the frozen I/O matrix ("throw → 502, catch + safe message"). Fix: try/catch in `upsertLeadContact`/`sendConfirmationEmail` → `ok:false` → endpoint returns safe 502 (upsert) / logs and 200s (send). Regression tests added in `tests/resend.test.ts`.
- `medium` — `resolveEnv` fell back to `import.meta.env` for server-only keys, contradicting the frozen boundary "never `import.meta.env` for server-only keys (AD-6)". Fix: removed the fallback; returns `{}` (fail-safe) off the Workers runtime.
- `medium` — Consent mapping (`topicSubscription`/`leadProperties`) + `verifyTurnstile` fail-closed guards had zero real-execution coverage (endpoint test mocks both modules). Pre-verified by the verification-gap layer. Fix: `tests/resend.test.ts` (SDK mocked) asserts topic `subscription` opt_in/opt_out and consent-stamp presence only on opt-in; `tests/turnstile.test.ts` asserts fail-closed on missing secret/token and on fetch error.
- `low` — 405 lacked `Allow` header, 429 lacked `Retry-After` (RFC 7231). Fixed and asserted.
- `low` — JSON array body reached the object guard; added `Array.isArray` guard + test (was already safely 400).
- `low` — `isValidEmail` 2+char-TLD boundary untested; added `a@b.co`/`a@b.c` assertions.
- `low` — WAF-fallback threshold undocumented; README now states 5 req / 60s per IP to match the native limiter.

**Rejected:**
- `low` — Shared `'unknown'` rate bucket when `CF-Connecting-IP` absent. Refutation: Cloudflare always sets that header in prod; off-CF the binding is absent and the limiter is a documented fail-open no-op. Not reachable in the deployed path.
- `false` — Array body "bypass" as a bug: `validateLead` still rejects it (missing_turnstile → 400); no bad outcome. (Trivial guard applied anyway.)
- `low` — `resend-setup` `topics.create` not optional-chained. `resend@6.30.0` exposes `topics` (verified live); dev-only script.
- `low` — Non-404 update error → spurious create. Consequence is one extra API call then 502; error-shape branching adds complexity for negligible benefit.
- `false` — Frozen spec says topic field `status` vs code `subscription`. Code is correct (verified live); Implementation Notes document the correction; the only fix edits the frozen spec (prohibited).
- `false` — Topic re-subscribe of a globally-unsubscribed contact. Refutation: Resend's global `unsubscribed` is the master switch (per docs) — a topic `opt_in` is inert for a globally-unsubscribed contact, and the code never clears global unsubscribe.
- `low` — `ALL` returns 405 for OPTIONS/HEAD. Same-origin form (no CORS preflight); HEAD on a POST-only API is negligible; fix adds method branching.
- `false` — `leads.ts` can't distinguish 429 vs 200. Refutation: the `{data,error}` envelope differentiates (data `{ok:true}` on 200, null + `error` on failure).
- `low` — Confirmation email lacks unsubscribe/List-Unsubscribe. Intent (AD-9) scopes unsubscribe to marketing sends via Resend's topic machinery; this send is transactional.
- `false` — Email HTML not escaped. Refutation: the template interpolates only developer-authored `EMAIL_COPY` constants; no user-controlled data reaches the HTML, so XSS is not reachable.
- `low` — POST wrapper/`resolveEnv`/rate-limit fail-open untested. Runtime-dependent seam; the testable core is fully covered; acknowledged design tradeoff.
- `low` — `RESEND_FROM_EMAIL` fallback to `onboarding@resend.dev` could ship to prod. Refutation: the test sender only delivers to the account owner, so a misconfig makes confirmation sends fail (logged, best-effort) rather than silently mis-send; the lead is still captured.
- `low` — `wrangler.toml` `namespace_id = "1001"` unexplained. Arbitrary per-binding identifier; cosmetic.

## Design Notes

- **First edge endpoint changes the build.** Story 1.1's `flatten-static.mjs` promotes `dist/client/**`→`dist/**` and self-disables once `dist/server/` exists. This story lands the first `prerender=false` route, so the adapter emits a server bundle and flattening stops. The dev must reconcile: either keep promoting the static client assets (so `dist/index.html`/`dist/fr/index.html` and the a11y gate keep working) while preserving `dist/server` for the function, or update the a11y gate + deploy docs to the new layout. Verify `pages deploy dist` still serves `/` and `/fr/` and runs the function. This is the riskiest part of the story — treat it as a first-class task, not cleanup.
- **Env access.** Use `import { env } from 'cloudflare:workers'` inside `api/` and server `lib` files. `import.meta.env` only exposes `PUBLIC_*` at runtime. There are known Astro issues mixing static + one dynamic route with the `cloudflare:workers` import (astro#16553); if it misbehaves at runtime, fall back to reading bindings from the endpoint's `context.locals` (adapter-populated). Type via `npx wrangler types` if needed.
- **Upsert pattern (Resend has no single-call upsert).** Try `resend.contacts.update({ email, ... })`; if it 404s, `resend.contacts.create({ email, ... })`. Keep it idempotent and opt-out-wins: if an existing contact is globally `unsubscribed`, do not silently re-subscribe.
- **Consent shape.** Per-contact topic subscription is the `topics: [{ id: RESEND_TOPIC_ID, status: 'opt_in'|'opt_out' }]` array on create/update — not a separate endpoint. `consent_at` (ISO) + `consent_locale` are custom properties; property keys must be pre-created via `contactProperties.create` (done by `resend-setup.mjs`).
- **Secret-leak-gate boundary.** The gate allows server-only secret names only under `src/pages/api/**`. `src/lib/resend.ts` and `turnstile.ts` reference `RESEND_API_KEY`/`TURNSTILE_SECRET_KEY`, so they must never be imported by client-shipped code (islands/pages). Keep the client helper (`leads.ts`) free of any secret and of any import of the server libs. If a server lib must live outside `api/`, confirm the gate still passes (it scans `src/**` except `api/`), so prefer importing the server libs only from `api/capture-lead.ts`.
- **`from` address** comes from `RESEND_FROM_EMAIL` (e.g. `Scheza <hello@scheza.com>`), which requires a verified domain in production; `onboarding@resend.dev` is the documented test sender.

## Verification

**Commands:**
- `cd scheza-marketing && npm install` -- expected: `resend` + test runner resolved.
- `cd scheza-marketing && npm test` -- expected: all unit tests green (every I/O matrix row).
- `cd scheza-marketing && npx astro check` -- expected: exit 0, strict TS.
- `cd scheza-marketing && npm run build` -- expected: `dist/` with the function bundle AND static `/`, `/fr/` HTML resolvable.
- `cd scheza-marketing && node scripts/secret-leak-gate.mjs && node scripts/secret-leak-gate.test.mjs` -- expected: passes clean; negative test still fails as designed.
- `cd scheza-marketing && npm run a11y` -- expected: no serious/critical axe violations on the homepage.

**Manual checks (if no CLI):**
- Inspect `capture-lead.ts`: reads secrets only via `cloudflare:workers`; returns `{data,error}`; no key/stack in any response branch.
- Confirm no client-shipped file imports `resend.ts`/`turnstile.ts` or names a server-only secret.

---

## Course correction addendum — 2026-10-06

*(Appended outside the frozen Intent per `sprint-change-proposal-2026-10-06.md`; original intent unchanged.)*

The lead-capture path is **realized by `scheza-marketing-v1`** (`src/pages/api/waitlist.ts` → Resend Contacts), promoted into the `scheza-marketing` repo. Launch-cut deltas from the original AC (**interim risk accepted by PM**):
- **No Turnstile at launch** — the server-side Turnstile verify (AD-10 / NFR-9) is **deferred**; launch relies on rate limiting + server-side payload validation only.
- **Consent simplified** — the full **CASL server-witnessed consent** record (AD-9 / FR-14: topic subscription + witnessed timestamp/locale/evidence) is **deferred**. Until it lands, public copy must not assert CASL-compliant consent or Canadian data residency.
Status remains `done` for the Resend path; Turnstile + witnessed consent return as a dedicated post-launch story.
