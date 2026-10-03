---
title: 'Email Notification on New Submission'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '291a85cf4167b8f0ca9d6ce7e169d4beae887271'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 6.2 persists each public intake submission and 6.3 pushes it to the owner's open dashboard in real time, but an Admin who is not looking at the dashboard gets no signal. Story 6.4 (FR28) requires each new submission to email the org's Admin(s) a summary via Resend, and a notification failure must never block data capture.

**Approach:** After the intake route's confirmed successful write, best-effort send a transactional email to every Admin of the org summarizing the submitted fields, reusing the existing Resend primitives and the trial-reminder email shape. Any failure in the notification path is logged and swallowed so the submitter still gets `200` and the record is always saved. Email is the sole channel (web push deferred to Growth).

## Boundaries & Constraints

**Always:**
- Send only AFTER the `mutate` insert returns success; the notification is downstream of persistence, never a precondition.
- Wrap the whole notification path (recipient + language resolution + send) in one try/catch that calls `reportError(..., { route: "/api/intake/[slug]" })` and returns normally. The submitter always gets `200 { ok: true }` — including when there are no admins, no resolvable emails, or Resend fails.
- Recipients are every `org_members` row with `role = 'admin'`, mapped to auth emails via the service-role GoTrue admin API; an admin with no resolvable email is skipped silently.
- The summary lists each submitted field as `label: value` in schema definition order, using authored labels and the shared `formatCell` formatter (currency/date/boolean as in the dashboard). Only fields present in the written payload appear.
- Localize the chrome (subject, greeting, intro, CTA, signature) EN/FR by the org's default language, mirroring the trial-reminder email. Authored labels and submitted values are shown verbatim, never translated. No em-dash.
- Strictly transactional (CASL): no marketing, unsubscribe, or tracking. Reuse `renderTransactionalEmail` + `escapeHtml` + `sendTransactional`. `await` the send in-handler (serverless kills post-response work); the one Resend round-trip of latency is accepted.

**Never:**
- No relationship/lookup data in the email (FR78): the payload already excludes relation fields and the summary iterates only `target.fields`; never add a relation branch or fetch a related label.
- No change to the write path (`mutate.ts`, the allowlist, idempotency, the 6.2 response) or the 6.3 Realtime path.
- No new migration, table, column, env var, Realtime mechanism, or web-push wiring; no blocking the response on the email; no per-field error leak to the public surface.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| New submission, one Admin | Valid intake POST; org has one admin with a resolvable email | Record written; one summary email sent; `200 { ok: true }` | N/A |
| Multiple Admins | Several `role='admin'` members | Each resolvable admin email receives the summary | A send that throws aborts the rest of the batch; logged once, still 200 |
| No admins / no resolvable email | No admin, or no admin email resolves | Record written; no email; `200 { ok: true }` | None (not an error) |
| Resend failure / missing RESEND env | Provider error or `RESEND_*` unset | Record written and visible; no email; `200 { ok: true }` | `sendTransactional` throws `AppError(502,"sendFailed")`; caught, `reportError`, swallowed |
| French-default org | `default_language = 'fr'` | Chrome in French; labels/values verbatim | N/A |
| Write fails | `mutate` returns error | `500 genericError`; no email attempted | Existing 6.2 behavior unchanged |

</frozen-after-approval>

## Code Map

Reused — do not change behavior:
- `src/lib/resend/transactional.ts:20-111` -- `escapeHtml`, `renderTransactionalEmail({langAttr,subject,innerHtml})`, `sendTransactional({to,subject,html,text})` (masks provider errors as `AppError(502,"sendFailed")`; throws when `RESEND_*` env missing).
- `src/lib/resend/trial-reminder.ts:71-133` -- mirror template: `buildEmail` assembles `<p>`-based `innerHtml` + plain-text twin from an i18n catalog, then `sendTransactional`. Copy this shape.
- `src/lib/format.ts:82-118` -- `formatCell(value, type, {empty,yes,no})`: pure, server-safe. Format each summary value with it; yes/no/empty from `Generate.cell*`.
- `src/lib/data/intake.ts:42-51` -- `IntakeTarget` = `{ orgId, orgName, table: TableDefinition, fields: FieldDefinition[] }` (fields: eligible, non-relation, definition order).
- `src/types/db.ts:11-66` -- `FieldDefinition` (`key`,`label`,`type`), `TableDefinition` (`key`,`label`).
- `src/lib/supabase/admin.ts:16-32` -- `createAdminClient()` (service-role; already used by the route).
- `src/lib/observability/report.ts:70` -- `reportError(err, context)` fire-and-forget logger.
- `src/lib/i18n/en.json:48-50` / `fr.json:48-50` -- `Generate.cellEmpty|cellYes|cellNo`; `en.json:803` `IntakeForm` namespace (add an `email` block here).
- `src/app/[slug]/page.tsx` -- owner dashboard at `/{slug}`; the email CTA links to `{appOrigin}/{slug}`.

Extracted for shared reuse:
- `src/app/api/cron/trial-lifecycle/route.ts:81-118` -- the private `resolveAdminEmails(adminClient, orgId)` and `resolveOrgLanguage(adminClient, orgId)`. Move both to a new shared module and import them back, so cron and intake share one implementation.

Edited:
- `src/app/api/intake/[slug]/route.ts:112-123` -- hoist `const adminClient = createAdminClient()` (reuse for `mutate` + notification); after the success check and before `return`, run the best-effort notification block.

New:
- `src/lib/orgs/org-recipients.ts` -- `resolveAdminEmails`, `resolveOrgLanguage` (moved from the cron).
- `src/lib/resend/intake-notification.ts` -- `sendIntakeSubmissionEmail({ to, language, orgName, tableLabel, slug, fields, data, appOrigin })`.
- `tests/unit/intake-notification-email.test.ts` -- unit tests (mock Resend).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/orgs/org-recipients.ts` -- create; move `resolveAdminEmails(adminClient, orgId): Promise<string[]>` and `resolveOrgLanguage(adminClient, orgId): Promise<'en'|'fr'>` verbatim from the cron, keeping skip-unresolvable and default-`'en'` behavior.
- [x] `src/app/api/cron/trial-lifecycle/route.ts` -- remove the two extracted functions; import them from `@/lib/orgs/org-recipients`. Behavior unchanged.
- [x] `src/lib/resend/intake-notification.ts` -- create `sendIntakeSubmissionEmail`: subject names the org; body = localized intro + a details list (`label: formatCell(data[field.key], field.type, strings)` for each `field` in `fields` whose key is in `data`) + a CTA to `{appOrigin}/{slug}` (relative when `appOrigin` absent) + signature; render via `renderTransactionalEmail`/`escapeHtml`; plain-text twin; send via `sendTransactional`. Copy from the `IntakeForm.email` catalog; yes/no/empty from `Generate.cell*`.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add `IntakeForm.email` (`subject` with an `{orgName}` argument, `greeting`, `intro`, `detailsHeading`, `cta`, `signature`), EN and FR, no em-dash.
- [x] `src/app/api/intake/[slug]/route.ts` -- hoist the admin client; after the write succeeds, inside one try/catch resolve admin emails + org language and send to each; on throw `reportError(err, { route: "/api/intake/[slug]" })` and fall through to the 200.
- [x] `tests/unit/intake-notification-email.test.ts` -- mock `resend` (hoisted `mockSend`), set/clear `RESEND_*` in before/after; assert: the summary carries each submitted field's label + type-formatted value and no relation data; subject names the org; FR catalog used when `language='fr'`; a provider error surfaces as `AppError(502,"sendFailed")`; blank/omitted fields are not listed.

**Acceptance Criteria:**
- Given a valid submission to an org with at least one admin whose email resolves, when the write succeeds, then one summary email per resolvable admin is sent via Resend and the response is `200 { ok: true }` (FR28).
- Given the notification path fails for any reason (no admins, unresolvable emails, missing Resend env, provider error), when the submission is processed, then the record is still saved and visible, the submitter still receives `200`, and the failure is logged via `reportError` and never surfaced.
- Given a submission with a required-but-unset relationship field, when the email is built, then no relationship/lookup value, id, label, or count appears anywhere in it (FR78).
- Given an org whose default language is French, when the email is sent, then its chrome is French while authored labels and submitted values are verbatim.
- Given the extracted helpers, when the trial-lifecycle cron runs, then its behavior is unchanged (it imports the shared functions).

## Implementation Notes

- Built per Code Map: new `src/lib/orgs/org-recipients.ts` (`resolveAdminEmails`, `resolveOrgLanguage` moved verbatim from the cron, which now imports them — its `BusinessProfileLanguage` import moved with them); new `src/lib/resend/intake-notification.ts` (`sendIntakeSubmissionEmail`, mirroring `trial-reminder.ts`); `IntakeForm.email` added to en/fr; the intake route hoists one admin client and runs the best-effort notification after a confirmed write.
- Localization enhancement: the `intro` copy carries an `{tableLabel}` ICU argument (both catalogs) so the email names which table the submission landed in. The authored table label is shown verbatim; this stays within the "localize the chrome" boundary.
- Testing: beyond the specified `intake-notification-email.test.ts` (email builder), the existing `tests/unit/intake-submit-route.test.ts` was extended to cover the route-level I/O matrix rows (one admin → send + 200; multi-admin batch abort on a failing send; no admins → no send; send/resolution failure swallowed → 200 + `reportError`; write-fail → no notification). This closes the Matrix Test Audit; `postReq` gained a `nextUrl.origin` for the CTA.
- Verified: `vitest` 43 passed across the 4 affected suites; `npm run lint` clean; `npx tsc --noEmit` exit 0. The post-commit Playwright manual review (per Verification) is still outstanding.

## Spec Change Log

## Review Triage Log

Pass 1 (blind-hunter + edge-case-hunter + verification-gap). Edge-case-hunter: no findings. Verification-gap: no gaps.

- **BH1 + BH2 — low, rejected (grouped; shared root cause: `formatCell` is locale/currency-fixed by design).** BH1: French emails render dates/currency via `formatCell`'s hardcoded `en-CA` formatters, so a FR recipient sees `Oct 20, 2026` / `$777.77` inside French chrome. BH2: currency is always CAD. Both verified real in `src/lib/format.ts:36-58`, but this is the app-wide records formatter (Story 1.6) used by the owner's own dashboard — the email intentionally renders each value exactly as it appears there, so diverging would create inconsistency, not fix a defect; the product is Ontario/CAD-scoped. Locale-aware formatting would add a branch for no real-world gain. Rejected.
- **BH3 — low, rejected.** A send that throws mid-loop aborts the remaining admins (one try/catch around the for-loop, `route.ts`). Verified real, but it is the spec's explicit, reasoned tradeoff (Design Notes: parity with the cron's `sendStage`, single-admin common case), the record is still captured and realtime-pushed, and per-recipient isolation would add nested try/catch complexity for an uncommon multi-admin partial-failure. Rejected.
- **BH4 — low, rejected.** The loop awaits N Resend round-trips in-handler on the public endpoint (the comment says "one round-trip" but does N). Verified, but MVP orgs have few admins, the record is already persisted before the sends, and a cap/`allSettled` adds complexity. The comment wording is a cosmetic inaccuracy, not a defect. Rejected.
- **BH5 — low, patch.** No happy-path test asserts that when all sends succeed every resolved admin is emailed (only single-admin success and the multi-admin abort case exist). Verified gap; the fix is a direct test-only addition (3 admins → 3 sends, correct `to` each). Patched.
- **BH6 — low, patch.** No test pins the two-line signature rendering (HTML `\n`→`<br />`, text newline preserved). Verified gap; direct test-only addition. Patched.
- **BH7 — low, rejected.** The relative-link fallback (`/{slug}` when `appOrigin` is empty) would be a dead link in an email, and the route layer does not test an empty origin. Verified, but the route always passes `req.nextUrl.origin` (populated in production), the fallback mirrors `trial-reminder.ts`'s documented degraded path, and the sender unit test already covers the relative branch. Not reachable in production. Rejected.

## Design Notes

`await` (not fire-and-forget): the route runs serverless (`runtime="nodejs"`), where post-response work can be killed; the send is awaited in-handler, trading one Resend round-trip of latency for reliability. Best-effort swallow: FR28 mandates notification failure never block capture, and the record is already the source of truth (delivered live by 6.3), so a dropped email is logged and tolerated, exactly as the trial cron tolerates a failed reminder.

Summary example (one lead, EN) — each line is `escapeHtml(label)`: `escapeHtml(formatCell(value, type, strings))`; relation fields are absent because `target.fields` excludes them:
```
Full name: Jordan Avery
Email: jordan@example.com
Quoted Amount: $777.77
Scheduled Date: Oct 20, 2026
```

## Verification

**Commands:**
- `npx vitest run tests/unit/intake-notification-email.test.ts tests/unit/trial-reminder-email.test.ts` -- expected: pass (new suite green; trial-reminder still green after the helper extraction).
- `npm run lint` -- expected: clean.
- `npx tsc --noEmit` -- expected: no type errors (confirms the cron still compiles against the extracted imports).

**Manual review (Playwright, post-commit) — rich path.** Against the dev app on `localhost:3000`, submit a valid lead at `/forms/session-1f4fa453` with representative fields (a named lead with a quoted amount and a scheduled date). Confirm: the owner-named confirmation renders; the row appears in the owner dashboard (6.2/6.3 unregressed); the server log shows the notification ran (a sent email when `RESEND_*` is configured in dev, or a single `reportError` with no 500 when not); the public response stays `200` with a clean console either way.

**Manual review (Playwright, post-commit) — verified.** Dev app on `localhost:3000`, `RESEND_API_KEY` + `RESEND_FROM_EMAIL` both configured in `.env.local` (so a real send was attempted). Submitted a rich lead on the logged-out public form `/forms/session-1f4fa453` exercising every field type: `JOB-6-4-EMAIL` / `Emergency plumbing` / `New Lead` / `849.50` / `2026-11-15` / `2026-11-15T09:30`.
- **Confirmation + 200:** the owner-named confirmation rendered ("Message sent" / "Thanks, Scheza Session 1f4fa453 will be in touch shortly.", no em-dash); `POST /api/intake/session-1f4fa453` returned `200 OK`. A `200` requires a successful `mutate` (a write error is a `500`), and the notification is awaited before the response, so the notification path completed without surfacing an error.
- **Record landed (6.2/6.3 unregressed, rich path):** on the authenticated dashboard the new row appears in `Quotes & Jobs` as `JOB-6-4-EMAIL`, `Emergency plumbing`, `New Lead`, `$849.50`, `Nov 15, 2026`, `Nov 15, 2026, 09:30 a.m.`. The `Customer` relation cell is `Empty` — the relation is excluded from the public form and left unset (FR78 holds), not fabricated. These are the exact `formatCell` renderings the email summary reuses.
- **Zero console errors/warnings** across the session.
- **Not directly observable:** actual Resend inbox delivery (no server-log access from the browser); the `200` + clean console is the spec's accepted evidence, and a send failure would have been swallowed to the same `200`.
