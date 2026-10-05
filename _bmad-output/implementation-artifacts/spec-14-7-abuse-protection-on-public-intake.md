---
title: 'Abuse Protection on Public Intake'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '62b38392bfe8499a4fc5d02e0be55aa8c820db06'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The public intake POST endpoints (`/api/intake/{slug}` and `/api/intake/{slug}/{formSlug}`) are unauthenticated, matcher-excluded from `src/middleware.ts`, and have zero abuse protection. A widely shared link (QR, campaign) lets a bot or script drive the endpoint into a spam funnel: every POST resolves the form, writes a record under `INTAKE_ACTOR_ID`, and emails the owner. `submit.ts:121` already names this as the deferred Epic-14 anti-abuse work.

**Approach:** Add two non-blocking defenses to the shared write path with no new dependency, infrastructure, migration, or middleware change. (1) A hidden honeypot field on `IntakeForm`; when it arrives non-empty the server returns the normal success envelope but writes nothing and emails no one, so a bot cannot tell it was rejected. (2) A per-IP and per-slug in-memory token-bucket rate limiter enforced at the top of both route handlers, before the form is resolved, returning `429 tooManyRequests` when a bucket is exhausted. Both defenses fail open — any internal error in the abuse layer lets a legitimate submission through.

## Boundaries & Constraints

**Always:**
- **Legitimate capture is never dropped by machinery failure.** If rate-limit or honeypot logic throws, the request proceeds to normal handling (fail open, per Epic 6's non-blocking rule). These decisions are expected/benign and are NOT reported to Sentry.
- **Honeypot is silent and false-positive-proof.** Non-empty honeypot ⇒ the same `200 {data:{ok:true},error:null}` as a real success, with no write and no email. The hidden input uses `autoComplete="off"`, `tabIndex={-1}`, is visually hidden and `aria-hidden`, and is named so autofill will not populate it — a human never reaches it.
- **Rate limits never block a normal visitor.** Limits are tuned so a legitimate visitor — including several people behind one NAT and a retry (same `idempotencyKey`) — stays well under the ceiling. The limiter runs BEFORE `resolvePublicFormTarget` so a flood is shed before any DB read. The per-IP and per-slug keys are exhausted independently.
- **Server-authoritative, shared, no drift.** The honeypot check lives in `submitToTarget` (the one shared write path); rate limiting is invoked identically from both route handlers via one helper (14.1 retro: no divergent copies).
- **i18n + a11y.** The honeypot label and the client `429` message resolve through the existing `IntakeForm` namespace (EN + FR); no hardcoded strings, no em-dash. A `429` shows as a non-blocking inline `role="alert"` that leaves the filled form intact for retry.

**Never:** No new dependency, no Redis/Upstash/KV/Vercel-config, no migration, no `src/middleware.ts` change (`/api/*` is already excluded), and no change to form resolution, `mutate.ts`, or any 14.1–14.6 behavior. Do not return an error that lets a bot confirm the honeypot tripped. Do not add a `Retry-After` header (would touch the shared `handleError` contract). Do not persist or share rate-limit state across instances in this story (see Decisions).

## Decisions

- **Store = process-local in-memory token buckets** (module-level `Map`), zero dependency/infrastructure, honoring the epic's explicit "no infrastructure changes" constraint. Per-instance on serverless: it throttles a sustained single-source flood on a warm instance but is not globally consistent; the honeypot is the primary defense, the limiter is defense-in-depth. The map is bounded (hard entry cap + eviction of stale/oldest) so distinct-IP floods cannot grow memory without limit. (The epic's "reuse the existing Edge-Middleware rate-limit pattern" references code that does not exist; this is the greenfield seam.)
- **Limits (tunable):** per-IP = 20 tokens, refill 20/60s; per-slug = 60 tokens, refill 60/60s. Deliberately generous.
- **Honeypot wire field = top-level body key `website`** (distinct from per-field `values[...]`), added to `intakeBodySchema` as optional; non-empty after trim ⇒ silent bot drop.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Behavior | Error Handling |
|----------|--------------|-------------------|----------------|
| Normal submission | Honeypot empty; under limit | Record written, admins emailed, `200 {ok:true}` | N/A |
| Honeypot tripped | Non-empty `website` | `200 {ok:true}`; NO write, email, or Sentry | silent |
| Per-IP flood | IP exceeds per-IP bucket | `429 tooManyRequests` before resolve | envelope key |
| Per-slug flood | One slug exceeds per-slug bucket across IPs | `429 tooManyRequests` | envelope key |
| Legit retry | Resubmit after transient failure | Allowed; `idempotencyKey` dedupes | N/A |
| Limiter throws | Bucket logic errors | Request proceeds (fail open) | swallowed |
| No client IP | No `x-forwarded-for`/`x-real-ip` | Shared `"unknown"` bucket; still resolves | N/A |
| Map saturated | Distinct-IP flood | Stale/oldest evicted; memory bounded | N/A |
| Client 429 | Fetch status 429 | Inline `role="alert"` `tooManyRequests`; form stays filled | non-blocking |

</frozen-after-approval>

## Code Map

- `src/lib/intake/rate-limit.ts` -- NEW (`import "server-only"`). Pure `consumeToken(key, capacity, refillPerMs, now): {allowed, retryAfterSec}` over a module-level `Map<string,{tokens,updatedAt}>` with a hard entry cap + eviction of expired/oldest. `getClientIp(req): string` = first hop of `x-forwarded-for`, else `x-real-ip`, else `"unknown"`. `enforceIntakeRateLimit(req, slugKey, now?)`: runs per-IP (`ip:{ip}`) + per-slug (`slug:{slugKey}`) buckets; throws `AppError(429,"tooManyRequests")` if either denies; try/catch wraps all of it and returns (allow) on unexpected error. `now` injectable for tests.
- `src/app/api/intake/[slug]/route.ts:43-52` -- call `enforceIntakeRateLimit(req, \`org:${slug}\`)` inside the existing try, BEFORE `resolvePublicFormTarget`. `handleError` already maps the thrown 429 to the envelope.
- `src/app/api/intake/[slug]/[formSlug]/route.ts:42-50` -- same, key `\`form:${slug}/${formSlug}\``.
- `src/app/api/intake/[slug]/schemas.ts:14-19` -- add `website: z.string().optional()` to `intakeBodySchema` (honeypot carrier; Zod strips unknown keys, so it must be declared).
- `src/lib/intake/submit.ts:57-62` -- also destructure `website`; if `website?.trim()` non-empty, `return { ok: true as const }` immediately (no payload build, `mutate`, email, or `reportError`). Code below unchanged.
- `src/components/intake/IntakeForm.tsx` -- add `const [honeypot,setHoneypot]=useState("")`; send `website: honeypot` in the POST body (line 188). Render an `aria-hidden`, visually-hidden wrapper with `<input id/name="website" autoComplete="off" tabIndex={-1} value={honeypot} onChange=...>` + an `sr-only <label>` = `t("website")`. Widen the `formError` union to add `"tooManyRequests"`; in `handleSubmit`, when `res.status === 429` set it (keep the form, do not confirm).
- `src/lib/i18n/en.json:910-934` & `src/lib/i18n/fr.json` (`IntakeForm`) -- ADD `website` (plausible hidden-field label) + `tooManyRequests` (e.g. "You're sending submissions too quickly. Please wait a moment and try again."). EN + FR, no em-dash.
- `src/lib/api/route-helpers.ts:214-226` (`handleError`) & `src/types/api.ts:15-25` (`AppError`) -- reuse as-is; a 429 is <500 so it is returned verbatim, not Sentry-logged. No change.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/intake/rate-limit.ts` -- NEW: token-bucket core, `getClientIp`, `enforceIntakeRateLimit` (per-IP + per-slug, fail-open, bounded map) -- the rate-limit seam.
- [x] `src/app/api/intake/[slug]/route.ts` + `src/app/api/intake/[slug]/[formSlug]/route.ts` -- call `enforceIntakeRateLimit` before resolve with the org/form key -- enforce identically on both routes.
- [x] `src/app/api/intake/[slug]/schemas.ts` -- add optional `website` honeypot field -- make the honeypot readable.
- [x] `src/lib/intake/submit.ts` -- silent bot drop when `website` non-empty (no write/email/Sentry) -- honeypot in the shared path.
- [x] `src/components/intake/IntakeForm.tsx` -- hidden non-autofill honeypot input + `website` in body + inline `tooManyRequests` on 429 -- client half.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- `IntakeForm.website` + `IntakeForm.tooManyRequests` (EN + FR) -- no hardcoded strings, no em-dash.
- [x] `tests/unit/intake-rate-limit.test.ts` -- NEW: allows under limit; `429` over per-IP and over per-slug independently; refill over injected time; IP extraction + `"unknown"` fallback; fail-open on internal error; bounded-map eviction.
- [x] `tests/unit/intake-honeypot.test.ts` -- NEW: `submitToTarget` with mocked `mutate`/email — non-empty `website` returns `{ok:true}` with `mutate` NOT called and no email; empty/absent proceeds to write.

**Acceptance Criteria:**
- Given a submission whose honeypot field is non-empty, when POSTed, then the server responds `200 {ok:true}` while writing no record and sending no email, indistinguishable from a real success.
- Given a client (IP) or a single form (slug) that exceeds its token bucket, when the next POST arrives, then it is rejected `429 tooManyRequests` before the form is resolved, and the other key's bucket is unaffected.
- Given the abuse machinery hits an internal error, when a legitimate submission is processed, then it still writes and notifies (fail open) — capture is never dropped.
- Given a `429`, when the client handles it, then an inline `role="alert"` `tooManyRequests` shows with the form preserved; no middleware, dependency, migration, or 14.1–14.6 behavior changed.

## Implementation Notes

- Verified against the staged diff (not the agent report): targeted `vitest run intake-rate-limit intake-honeypot intake-form` → 31/31; full `npx tsc --noEmit` clean (the only errors are in the untracked, git-ignored `scheza-marketing-v1/` sub-project, unrelated); `npm run lint` exit 0.
- **Matrix audit — 8 of 9 rows have passing unit tests.** Every server-side row (normal write, honeypot drop, per-IP 429, per-slug 429 + independence, limiter fail-open, no-IP `"unknown"` fallback, bounded-map eviction) is covered. The one uncovered row is **"Client 429"** (the `IntakeForm` `res.status === 429` → inline `tooManyRequests` branch): it is a client-interaction path, and this project has **no** client-interaction test infra (no jsdom / @testing-library in `devDependencies`; `intake-form.test.tsx` is SSR/static-markup only — the deliberate IntakeForm convention affirmed in the 14.6 retro triage). The spec's "Never" list forbids adding a dependency, so a jsdom interaction test cannot be added within scope. The branch is trivial (`if (res.status === 429) setFormError("tooManyRequests")`) and is verified by the spec's Manual check. Flagged for step-04 review.
- `tests/unit/intake-form.test.tsx` had one pre-existing assertion (`boolean-only form renders no <input>`) that is now false because every form renders the hidden honeypot input; updated to assert the sole input is the honeypot (`id="website"`). Not a weakened assertion — adapted to the new expected output.

## Spec Change Log

## Review Triage Log

### Iteration 0 (2026-10-04)

- **Both buckets debited unconditionally; a single-IP flood drains the shared per-slug bucket** (edge-case-hunter) — `medium` / **patch**. Verified in `rate-limit.ts` `enforceIntakeRateLimit`: both `consumeToken` calls run before the `allowed` check, so an IP-denied request still consumes a per-slug token. One attacker IP sending >60/min stays IP-blocked after 20 but keeps the per-slug bucket at 0, so legitimate visitors of that slug get 429 — contradicts the "Rate limits never block a normal visitor" invariant and AC2's "the other key's bucket is unaffected." Smallest fix: check the per-IP bucket first and throw before consuming the per-slug bucket, so an IP-rejected request never debits per-slug.
- **Route-level 429 enforcement is unverified; both route suites silently fail open** (verification-gap, pre-verified; also blind-hunter) — **patch**. Confirmed at `tests/unit/intake-submit-route.test.ts:55` (and the keyed sibling): `postReq` returns `{json, nextUrl}` with no `headers`, so the real `enforceIntakeRateLimit` → `getClientIp` throws a `TypeError`, which the limiter's try/catch swallows (fail open). Every route test runs with the limiter effectively disabled and none asserts a 429; deleting the `enforceIntakeRateLimit` line keeps both suites green. The headline abuse behavior is unpinned at the only boundary producing an HTTP 429.
- **Honeypot hardcodes a global DOM `id`/`htmlFor` ("website")** (blind-hunter) — `low` / **patch**. Every other field namespaces its id (`id="intake-${key}"`, form `${idBase}-form`); the honeypot hardcodes `id="website"` + `<label htmlFor="website">`, so two `IntakeForm` instances (or any page already carrying `id="website"`) emit duplicate ids / a mis-associated label. Direct correction: namespace the `id`/`htmlFor` with `idBase` (keep `name="website"` as bot bait).
- **Client 429 branch + `website` body carrier are unverified (no client-interaction harness)** (verification-gap, pre-verified) — **defer**. `IntakeForm`'s `res.status === 429 → tooManyRequests` branch and the `website: honeypot` request body are only reachable through `handleSubmit`, which the SSR/`renderToStaticMarkup` node-env component test never drives; the repo has no jsdom/@testing-library harness and the spec's "Never" forbids a new dependency, so closing this needs a net-new test style. Already recorded in Implementation Notes; deferred.
- **`retryAfterSec` computed but never surfaced** (blind-hunter) — `low` / **reject**. Not surfacing it is mandated by the frozen "Never: do not add a `Retry-After` header"; `retryAfterSec` is a reasonable part of `consumeToken`'s reusable return contract and is unit-tested. No user- or developer-facing harm.
- **Double-prefixed bucket keys (`slug:org:…`) and separate org/form slug buckets** (blind-hunter) — `low` / **reject**. The `slug:` wrapper over an already-`org:`/`form:`-prefixed key only lengthens an already-unique string (no collision). Bucketing the bare-org primary form and a keyed form separately is a defensible reading of "per-slug" — they are distinct public surfaces with distinct submit paths. No significant harm; changing it is a semantic redesign, not a direct correction.
- **Unbounded `website` honeypot string (`z.string().optional()`, no `.max`)** (blind-hunter) — `low` / **reject**. `req.json()` already reads the whole body, and `values`/`idempotencyKey` are themselves unbounded, so `website` adds no materially new memory vector; platform request-body limits apply and `website` is trimmed then discarded. Pre-existing class, not caused by this change; bounding one field would be inconsistent and would not close the vector.
- **Translatable honeypot label; `.sr-only` + `aria-hidden` "contradiction"** (blind-hunter) — `low` / **reject**. `aria-hidden` removes the subtree from the accessibility tree (intended); `.sr-only` hides it visually; together the field is hidden from everyone, exactly the honeypot goal. The label text is never shown and is functionally irrelevant, so translator edits are harmless; `jsx-a11y` lint passes. No harm.
- **`consumeToken` divide-by-zero when `refillPerMs === 0`** (edge-case-hunter) — **false**. Both call sites pass nonzero constants (`20/60000`, `60/60000`); `consumeToken` is otherwise module-internal. The `refillPerMs === 0` path is unreachable.
- **Pass-1 eviction only drops buckets refilled to `SLUG_CAPACITY`, so idle per-IP buckets rely on pass-2** (edge-case-hunter) — `low` / **reject**. Pass-2 always evicts the oldest-touched entry when the map is at `MAX_ENTRIES`, so the memory bound (the Always requirement) still holds. The conservative pass-1 staleness heuristic is an efficiency nuance, not a correctness defect; no named harm.

## Design Notes

- **Where each defense lives.** Rate limiting is in the route handlers (they hold the raw `slug`/`formSlug` and `req` for the IP) and runs before `resolvePublicFormTarget`, shedding floods before any admin-client DB read. The honeypot is in `submitToTarget` because only there is the body parsed — and that one shared path covers both routes with no drift.
- **Honeypot, not CAPTCHA.** A hidden real-looking field with autofill/tab/AT suppressed catches most dumb form-filling bots at zero friction, and a human cannot reach it (key for "never drop a legitimate submission"). Sophisticated bots are out of scope here.

## Verification

**Commands:**
- `npm run lint` -- expected: passes, incl. `eslint-plugin-i18next` (no hardcoded strings) and the `server-only` gate on the new module.
- `npx tsc --noEmit` -- expected: no type errors; `enforceIntakeRateLimit`, the widened `intakeBodySchema`, and the widened `formError` union resolve everywhere.
- `npx vitest run intake-rate-limit intake-honeypot` -- expected: token-bucket/IP/fail-open and honeypot drop/pass-through cases green.

**Manual checks:**
- Submit a published form normally: record lands, owner emailed. In devtools, set the hidden `website` input and submit: UI confirms, but NO record and no email. Rapidly submit many times from one client: a `429` "too quickly" inline message shows with the form still filled, while a submission to a different form/slug still succeeds.
