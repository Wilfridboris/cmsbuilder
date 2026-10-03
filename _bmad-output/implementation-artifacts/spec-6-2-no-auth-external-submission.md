---
title: 'No-Auth External Submission'
type: 'feature'
created: '2026-10-02'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'fbcc0efe14cfcdf592ea7a80913748b19a44894d'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 6.1 shipped the public intake form at `/forms/{slug}` but left it inert: the submit button is `type="button"` and the `<form>` has no handler. A visitor can fill it in but cannot submit, so no lead is ever captured.

**Approach:** Wire the form end to end. Make the client form interactive (field state, accessible inline validation, a submitting state, a warm owner-named confirmation that replaces the form). Add a narrow public POST handler at `/api/intake/[slug]` that re-resolves the intake table server-side and writes one record through the guarded `mutate.ts` under a dedicated anonymous actor, scoped to the slug's org. Real-time push (6.3), email (6.4), and payload-level relation hardening (6.5) are later stories.

## Boundaries & Constraints

**Always:**
- The POST handler is the authority: it re-resolves slug -> org and the intake table + eligible-field allowlist server-side (same resolver the page uses), writes ONLY allowlisted non-relation fields, silently drops any other submitted key, and re-coerces every value. The client payload never chooses the table or the columns. This is the narrow intake write path (NFR-FC1), never an arbitrary service-role write.
- The write goes through `mutate(identity, "insert", table.key, data, { idempotencyKey })` with `identity = { client: createAdminClient(), actorId: INTAKE_ACTOR_ID, orgId }`. `INTAKE_ACTOR_ID` is a NEW dedicated constant in `mutate.ts`, distinct from `SYSTEM_ACTOR_ID`, so intake rows are attributable and distinguishable from synthetic/demo rows.
- Validation is format-only, because the schema carries no `required` flag: per-field coercion via `coerceAddValue` (number/currency -> `invalidNumber`); empty fields are omitted; a fully-empty submission (no field filled) is blocked client-side and rejected server-side. No per-field "required" is invented. Inline errors are accessible (`aria-invalid` + `aria-describedby` + `role="alert"`) and translated (en + fr) and shown before submission.
- On a 200, the form is replaced by a warm confirmation naming the owner (e.g. "Thanks, {owner} will be in touch shortly."). No em-dash in any copy.
- A submit failure (network or server) shows a non-blocking inline `role="alert"` error and leaves the filled form intact so the visitor can retry; the client sends a stable `idempotencyKey` (`crypto.randomUUID()` per form instance) so a retried submit dedupes.
- Keep the 6.1 surface: no session, no dashboard chrome, 48x48px touch targets, real `<label>` association, semantic tokens only. The Yes/No boolean control becomes wired (reflects selection via `aria-checked`).
- The route mirrors the public shape: `export const dynamic = "force-dynamic"`, `runtime = "nodejs"`, and never leaks DB/provider internals (unknown slug / no intake table -> generic error envelope, no internals).

**Never:**
- No real-time/`invalidateQueries` wiring (6.3), no email/Resend (6.4), no relation fields in markup or payload (6.1/6.5 already exclude them; do not reintroduce).
- No new DB table, column, migration, or RLS change; no change to the authenticated dashboard or `/api/records`.
- No rate-limiting, CAPTCHA, or spam/honeypot protection on the public endpoint (deferred; not in 6.2 AC) and no field-level required policy beyond "at least one field".
- Do not import `AddRecordForm` (dashboard-coupled); reuse only the pure helpers (`coerceAddValue`, `inputModeFor`) and session-free UI primitives.
- The public write is intentionally NOT billing-gated (human decision, review BH1): a `read_only` or expired-`trial` org still captures leads. Do not route it through `assertWritable`/`resolveWritableOrgIdentity`. Rationale: lead capture is the core free value; gating inbound on the owner's billing would kill their funnel, 403 an anonymous visitor, and leak the owner's billing state to strangers. The owner sees the leads on reactivation.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | POST `/api/intake/{slug}` with valid values + `idempotencyKey` | One record inserted into the resolved intake table, org-scoped, actor = `INTAKE_ACTOR_ID`; `{ data: { ok: true }, error: null }` 200; client swaps form for owner-named confirmation | N/A |
| Invalid field format | A number/currency field has non-numeric text | Client blocks submit, shows inline translated `role="alert"` on that field; if it reaches the server, server rejects with a generic 400 envelope (no write) | 400 `{ data: null, error }` |
| Empty submission | No field filled | Client blocks submit with an inline "fill at least one field" message; server rejects fully-empty data | 400, no write |
| Unknown / absent slug | POST to a slug with no org or no intake table | Generic error envelope; no row written; no DB/provider internals leaked | 400/404 `{ data: null, error }` |
| Extra / relation keys in payload | Body includes keys not in the server allowlist (or a relation field) | Those keys are dropped; only allowlisted non-relation fields are written | N/A |
| Retry after failure | Same `idempotencyKey` submitted twice | Second insert is treated as idempotent success; no duplicate row | N/A |
| French locale | `NEXT_LOCALE=fr`, no session | Inline validation, submit-error, submitting, and confirmation copy render in French | Falls back to `en` |

</frozen-after-approval>

## Code Map

- `src/components/intake/IntakeForm.tsx` -- convert to a `"use client"` component owning draft/error/submitting/confirmed state; wire `onSubmit`, inline validation, submitting button, confirmation swap, and the Yes/No selection (`aria-checked`). Keep `FormShell`/`Unavailable` (presentational). The `<form>` and submit button are the exact unwired seam (lines 76, 84-91 today).
- `src/app/forms/[slug]/page.tsx` -- pass `slug` to `IntakeForm` (currently only `orgName` + `fields`), so the client knows the POST target. Stays a Server Component.
- `src/lib/data/intake.ts` -- add a server-only `getIntakeTarget(slug)` returning `{ orgId, orgName, table, fields } | null` (the single slug->org->schema->`selectIntakeTable`/`intakeFields` resolver); refactor `getPublicIntakeForm` to call it and project to the page shape. The POST handler uses `getIntakeTarget`.
- `src/app/api/intake/[slug]/route.ts` -- NEW public POST handler: `force-dynamic`, `runtime="nodejs"`; parse body (zod), `getIntakeTarget(slug)`, build allowlisted+coerced `data`, reject empty, `mutate(... "insert" ...)`, return the `json()` envelope; `handleError(err, "/api/intake/[slug]")` on failure.
- `src/lib/data/mutate.ts:39,64` -- `SYSTEM_ACTOR_ID` + `mutate(identity, op, tableKey, data, opts)`; add `INTAKE_ACTOR_ID` beside `SYSTEM_ACTOR_ID`. `insertRecord` already handles idempotency + relation integrity.
- `src/lib/forms/field-input.ts` -- reuse `coerceAddValue(type, raw)` (`omit`/`ok`/`error` with `errorKey`) and `inputModeFor`; boolean handled by the form (true/false), not `coerceAddValue`.
- `src/lib/api/route-helpers.ts:28,214` -- `json()` + `handleError()` envelope/error convention; mirror `/api/records`.
- `src/lib/data/records-client.ts` -- `parseEnvelope`/`RecordApiError` fetch-wrapper pattern to mirror for the client POST.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- extend the `IntakeForm` namespace: `invalidNumber`, `emptyForm`, `sending`, `submitError`, `confirmationHeading`, `confirmationBody` (with `{owner}`). No em-dash.
- `src/app/i/[token]/route.ts` -- reference for public route shape (admin client, `force-dynamic`, data-free failure). `/api/*` is matcher-excluded in `src/middleware.ts` (verified) so no middleware change.
- `tests/unit/intake-*.ts(x)` -- existing patterns: `renderToStaticMarkup` + `NextIntlClientProvider` for the form; `vi.mock` of `@/lib/supabase/admin`, `@/lib/data/records`, `@/lib/observability/report` for data/route.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/data/mutate.ts` -- add `export const INTAKE_ACTOR_ID = "00000000-0000-0000-0000-0000000000b0";` beside `SYSTEM_ACTOR_ID`, with a comment naming it the anonymous public-intake actor.
- [x] `src/lib/data/intake.ts` -- add server-only `getIntakeTarget(slug): Promise<{ orgId, orgName, table, fields } | null>` (the shared resolver, never throws -> `null`); refactor `getPublicIntakeForm` to delegate to it. Keep the `null`-on-any-failure contract.
- [x] `src/app/api/intake/[slug]/route.ts` -- NEW public POST: zod-parse `{ values: Record<string, unknown>, idempotencyKey: string }`; `getIntakeTarget`; for each allowlisted field coerce via `coerceAddValue` (boolean -> true/false), drop non-allowlisted keys, reject empty data and coercion errors with a generic 400; `mutate` the insert under `INTAKE_ACTOR_ID`; return `json({ data: { ok: true }, error: null }, 200)`; `handleError` otherwise. Never leak internals.
- [x] `src/components/intake/IntakeForm.tsx` -- make it `"use client"`; hold per-field draft + error state; validate (format + at least one filled) on submit with accessible inline errors; POST to `/api/intake/{slug}` with coerced values + a per-instance `idempotencyKey`; show submitting state, then replace the card body with the owner-named confirmation; on failure show an inline `role="alert"` and keep the form. Wire `BooleanChoice` selection (`aria-checked`). Accept a `slug` prop.
- [x] `src/app/forms/[slug]/page.tsx` -- pass `slug={slug}` to `IntakeForm`.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add the new `IntakeForm` keys (`invalidNumber`, `emptyForm`, `sending`, `submitError`, `confirmationHeading`, `confirmationBody` with `{owner}`); no em-dash.
- [x] `tests/unit/intake-submit-route.test.ts` -- NEW: cover the POST handler matrix (happy path writes allowlisted+coerced data under `INTAKE_ACTOR_ID`; drops extra/relation keys; rejects empty + bad format; unknown slug -> generic error, no write; idempotent retry) with mocked admin client + `mutate`.
- [x] `tests/unit/intake-form.test.tsx` -- extend: inline validation (`aria-invalid`/`aria-describedby`/`role="alert"`), wired boolean `aria-checked`, submitting state, confirmation naming the owner, submit-error alert, and French copy (mock `fetch`).

**Acceptance Criteria:**
- Given a completed valid form, when the visitor submits with no account, then a record is persisted via `mutate.ts` under `INTAKE_ACTOR_ID` scoped to the slug's org and written only to the designated intake target, and a confirmation naming the owner replaces the form (FR26, NFR-FC1).
- Given a submitted body containing keys outside the server-resolved eligible-field allowlist (or a relation field), when it is processed, then only allowlisted non-relation fields are written and no other key reaches the record.
- Given invalid or entirely-missing field values, when the visitor tries to submit, then accessible translated inline validation appears before submission and no write occurs.
- Given a submit that fails, when the error is shown, then it is a non-blocking inline `role="alert"`, the filled form is preserved, and a retry with the same `idempotencyKey` does not create a duplicate.

## Implementation Notes

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter + edge-case-hunter + verification-gap):

- **BH1 — read-only billing gate on public intake — intent_gap (human).** Verified: every authenticated write routes through `resolveWritableOrgIdentity` -> `assertWritable` (`src/lib/billing/access.ts`), which 403s a `read_only` or expired-`trial` org; the new `/api/intake/[slug]` builds its identity by hand and never consults `assertWritable`, so a public submission writes regardless of the owner's billing state. The frozen intent is silent and two readings are defensible (keep capturing leads vs. gate like every other write), so only the human can settle it. Routed to the human.
- **BH2 — `medium` -> `low`, rejected.** Intake collapses all `mutate` errors to 500 while `/api/records` maps `invalidReference` -> 400. Real, but intake drops every relation key so `insertRecord`'s `assertRelationReferencesExist` has nothing to reject and `versionConflict` cannot occur on insert; a mutate error here is genuinely unexpected, so 500 is appropriate. Unreachable in everyday use + fix adds a branch.
- **BH3 — `low`, patch.** `"Sending..."` / `"Envoi en cours..."` use ASCII dots; the repo's polished progress copy uses the typographic ellipsis. Direct copy correction, no added complexity.
- **BH4 — `low`, patch.** Confirmation heading "Thank you"/"Merci" repeats the body "Thanks,/Merci, {owner}..."; stacked thanks reads redundant. Direct copy change to a non-redundant heading.
- **BH5 — `low`, patch.** `IntakeField` input `id` is the fixed `intake-${key}` while `errorId` is namespaced by `useId()`; inconsistent, and two forms on one page would collide on input id/label. Single-form surface today (latent) but a direct consistency fix.
- **BH6 — `low`, rejected.** Field error message is always `invalidNumber`, slightly off for a `currency` field. Rarely hit (only number/currency can error) and a type-aware message adds a key + branch.
- **BH7 — `false`, rejected.** Claim: interactive form behaviors (confirmation swap, submit-error alert, submitting, boolean click) are untested. The verification-gap layer read the tests and cleared it: env is node/no-jsdom by deliberate convention (sibling tests document the same SSR-only approach; `tests/e2e` is `.gitkeep`), the server write path is unit-tested, client coercion mirrors it, and interaction is covered by the post-commit manual Playwright review (spec Manual checks). Not a true gap.
- **BH8 — `low`, rejected.** Route test defines a local `INTAKE_ACTOR_ID` literal and mocks `mutate` wholesale, so a change to the real constant wouldn't fail a test. Negligible: distinctness from `SYSTEM_ACTOR_ID` is obvious/stable in `mutate.ts`; a guard needs `importActual`.
- **BH9 — out of scope by intent, deferred.** Unbounded public write / no rate-limiting; re-runs `getIntakeTarget` (two DB reads) per POST. The frozen Never explicitly excludes rate-limiting/CAPTCHA/spam. Excluded by intent -> recorded in `deferred-work.md`.
- **EC1 — `low`, patch.** `values` is `z.record(z.string(), z.unknown())`, so a scalar entry may be an object/array; the route's `String(submitted)` writes `"[object Object]"`/`"1,2"` verbatim. Low real-world harm (a client can post junk strings anyway), but input hygiene on a public untrusted write warrants a small guard rejecting non-primitive scalar values.
- **EC2 — out of scope by intent, rejected.** `date`/`datetime`/`email`/`phone` accepted as raw text with no format validation server-side. The frozen intent defines validation as format-only via `coerceAddValue` (number/currency), matching the dashboard. Excluded by intent.
- **EC3 — out of scope by intent, rejected.** Client mirror of EC2 (only `invalidNumber` inline). Same intent scoping.
- **VG1 — `low`, patch.** The `INTAKE_ACTOR_ID` doc comment claims the claim-time clear "scopes only to SYSTEM_ACTOR_ID"; verified the clear (`src/lib/claim/claim.ts`) scopes by `organization_id` + `deleted_at IS NULL` and *sets* `actor_id = SYSTEM_ACTOR_ID`. The invariant (real leads not swept) holds by lifecycle timing, not actor scoping; the comment misleads about a safety invariant. Direct comment correction.

## Design Notes

UI direction from the `web-uiux-architect` skill, held inside the repo's established Shadcn "New York / zinc" system (oklch semantic tokens, class-based dark mode, Geist, `tw-animate-css`). No glassmorphism/bento, no new color literals, no Framer Motion (CSS-first, matching 6.1). All new states live inside the existing `FormShell` card.

- **Inline field error:** below the input, `<p role="alert" id={errorId} className="text-xs text-destructive">{t("invalidNumber")}</p>`; input gets `aria-invalid` + `aria-describedby={errorId}` (mirrors `AddRecordForm` lines 177-190). Error clears on next valid change.
- **Wired Yes/No:** each option toggles the field's boolean; selected option `aria-checked` + a filled look via semantic tokens (`bg-primary text-primary-foreground`), unselected `bg-background text-foreground`; both stay `min-h-12 min-w-12`; focus-visible ring from the existing classes. Clicking clears any error on that field.
- **Submitting button:** `disabled` while pending with a Lucide `Loader2` `className="size-4 animate-spin"` (aria-hidden) + `{t("sending")}`; `disabled:opacity-50 disabled:pointer-events-none`; re-enables on completion/failure.
- **Confirmation (replaces body):** same `CardHeader`, a muted Lucide `CheckCircle2`/`MailCheck` (aria-hidden), `{t("confirmationHeading")}` + `t("confirmationBody", { owner })`; mounts with `animate-in fade-in duration-500`. Warm, no em-dash, never error styling.
- **Submit error:** inline `role="alert"` in the footer area, `text-sm text-destructive`, non-blocking; button returns to its idle label so the visitor can retry.
- **A11y:** every input keeps its real `<Label>`; decorative icons `aria-hidden`; AA contrast via tokens in both themes; all chrome copy from the `IntakeForm` namespace (field labels stay schema-authored).

## Verification

**Commands:**
- `npm run lint` -- expected: clean.
- `npx tsc --noEmit` -- expected: no type errors.
- `npx vitest run tests/unit/intake-submit-route.test.ts tests/unit/intake-form.test.tsx tests/unit/intake-data.test.ts` -- expected: pass (route matrix + interactive form + resolver refactor).

**Manual checks:**
- Dev server, logged out: open `/forms/{slug}` for a claimed org, fill and submit; confirm the owner-named confirmation appears and a new row shows in that org's intake table (viewable as a normal record). Submit an invalid number and an empty form; confirm inline accessible errors block submission. Toggle `NEXT_LOCALE=fr` and confirm translated validation/confirmation copy. Confirm an unknown slug POST returns a generic error with no internals.
