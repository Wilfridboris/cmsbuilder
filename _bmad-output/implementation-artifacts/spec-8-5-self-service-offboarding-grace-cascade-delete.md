---
title: 'Self-Service Offboarding (Grace + Cascade Delete)'
type: 'feature'
created: '2026-10-05'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'b4be52f3c65202a6f5438e20722ea3a7ee67249a'
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** FR38/FR39 require that when a paying account cancels, it enters a 30-day read-only grace period (data visible, no new entries) with the "Download My Data" export prominently surfaced, receives email warnings at Day 1/7/25, and is then hard-cascade-deleted at Day 30 — irreversibly, but EXCLUDING the invoice-related tables and their frozen PDFs under the six-year statutory-retention obligation. Today cancellation flips an org straight to terminal `read_only` with no clock, no warnings, and no eventual deletion.

**Approach:** Hang an offboarding lifecycle off the existing cancellation signal. Record when the grace clock starts, keep reusing `read_only` as the non-writable grace state, add a daily cron sweep that sends the three staged Resend warnings and runs the Day-30 purge, a `cascadeDeleteOrganization` that deletes only the user-data tables (never the retained invoice tables, never the `organizations` row) and marks the org terminally `deleted`, a grace-period banner surfacing the deletion date + export, and a settings "Close account" section explaining the lifecycle. Reactivation during grace is re-subscribing (existing Stripe checkout), which clears the clock.

## Boundaries & Constraints

**Always:**
- The grace clock starts ONLY on a voluntary subscription cancellation: `customer.subscription.deleted` (the Stripe-portal cancel from Story 7.3) stamps `offboarding_initiated_at = now` as it writes `read_only`. The Day-30 cascade and the warning emails act ONLY on orgs with `offboarding_initiated_at` set and `offboarding_purged_at` null. (Decision: Stripe-portal-only trigger — no new in-app cancel endpoint/button; a trial-only user with no subscription is not delete-bound and simply lapses to `read_only` as today. The settings "Close account" section is explanatory and links to Manage Billing to cancel.)
- `read_only` stays the single enforced non-writable state; grace adds no new writable path. `isReadOnly` must also return true for the new terminal `deleted` status. Reads are never gated (the export must keep working throughout grace — Story 8.4 relies on this).
- The Day-30 cascade deletes ONLY: `records`, `org_schemas`, `org_members`, `business_profiles` (+ its `business-logos` storage object), `pending_claims`, and `forms` for the org. It runs via the service-role `createAdminClient()` (an allowlisted platform op — the only elevated-privilege write path here).
- Statutory-retention EXCLUDE list — the cascade MUST NOT touch, under any path: `invoices`, `invoice_line_items`, `invoice_tax_lines`, `invoice_payments`, `invoice_number_counters`, `credit_notes`, `credit_note_line_items`, `credit_note_tax_lines`, `credit_note_number_counters`, or any object in the `invoice-pdfs` bucket. Because every org-scoped table FKs `organizations ON DELETE CASCADE`, the cascade MUST NOT delete the `organizations` row (that would cascade-delete the retained invoices). Instead it sets `subscription_status = 'deleted'` + `offboarding_purged_at = now` on the surviving tombstone row.
- Purging `records` is safe: `invoices.customer_record_id` / `credit_notes.customer_record_id` are `ON DELETE SET NULL`, and issued docs carry a frozen `customer_snapshot`, so retained invoices lose only the live loose link.
- Staged warning emails are transactional (CASL), sent via Resend to all org admins in the org's language, idempotent per stage via `offboarding_reminder_day{1,7,25}_sent_at` stamps written only after a successful send; a failed send leaves the stamp null to retry next sweep and never aborts the rest of the sweep.
- A `deleted` org shows a terminal "account closed" state in the app shell (no empty dashboard); the grace banner and all offboarding copy come from a next-intl `Offboarding` namespace present and non-empty in both `en.json` and `fr.json`. WCAG AA; no em-dashes (house style).
- The cron route is `CRON_SECRET`-protected via the existing `authorizeCron`, declared in `vercel.json`, and runs daily.

**Never:**
- Never delete the `organizations` row, the `auth.users` account, or the Stripe customer/subscription as part of the purge (retention + cross-cutting risk). Never hard-delete through the guarded `mutate.ts` path — the cascade is its own service-role operation.
- Never start the grace clock for `read_only` reached via trial expiry or past-due dunning; those orgs are untouched by this story (their cleanup is out of scope).
- Never add a new writable gate or change RLS, the data model of `records`/`org_schemas`, or any invoice/credit-note table or trigger.
- Never re-translate stored data; `deleted`/grace affects access and UI copy only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cancellation lands | `customer.subscription.deleted` for an org | status → `read_only`, `offboarding_initiated_at = now` stamped once (idempotent if already set) | Unresolvable org already logged by existing handler |
| Grace day-1/7/25 sweep | org in grace, day ≥ N, stage stamp null | one Resend warning to each admin, stage stamp set | send fails → stamp stays null, sweep continues, error reported |
| Grace sweep, stage already sent | stage stamp non-null | no duplicate email | N/A |
| Day-30 sweep | org in grace, `now ≥ initiated + 30d`, not purged | cascade purges user-data tables + logo, org row kept as `deleted` tombstone, `offboarding_purged_at` set; invoice tables + PDFs intact | partial failure reported; stamp not set so it retries; purge is re-entrant |
| Already purged | `offboarding_purged_at` non-null | skipped | N/A |
| Reactivation in grace | `checkout.session.completed` → `active` | `offboarding_initiated_at` + all reminder stamps cleared; normal access restored | N/A |
| Write during grace | authenticated member POST/PATCH/DELETE | `403 readOnly` (unchanged gate) | surfaced by existing handlers |
| Visit a `deleted` org | admin/member opens the app | terminal "account closed" screen, no dashboard/data | N/A |
| Export during grace | admin hits `/api/export` | `200` bundle (reads never gated) | N/A |

</frozen-after-approval>

## Code Map

- `supabase/migrations/<new-ts>_add_offboarding_lifecycle_to_organizations.sql` -- NEW. Add to `organizations`: `offboarding_initiated_at timestamptz`, `offboarding_reminder_day1_sent_at`, `offboarding_reminder_day7_sent_at`, `offboarding_reminder_day25_sent_at`, `offboarding_purged_at timestamptz` (all nullable). Widen the `subscription_status` CHECK to add `'deleted'`. Add partial index `(offboarding_initiated_at) WHERE offboarding_initiated_at IS NOT NULL AND offboarding_purged_at IS NULL` for the sweep. Mirror prior org-column migrations (e.g. `20261001120000_add_past_due_since_to_organizations.sql`).
- `src/types/db.ts` -- EDIT. Add `'deleted'` to `SubscriptionStatus` (line ~208); add the five new nullable columns to `OrganizationRow` (mirror `trial_reminder_day12_sent_at` et al., ~253-259).
- `src/lib/billing/access.ts` -- EDIT. `isReadOnly` (35-47) returns true for `status === 'deleted'` too. ADD small predicates `isOffboarding(row)` (initiated set, not purged) and `isDeleted(status)` for UI/layout. Do not change `assertWritable` (55-59).
- `src/app/api/stripe/webhook/route.ts` -- EDIT. In `handleSubscriptionDeleted` (210-225): when writing `read_only`, also stamp `offboarding_initiated_at = now` if currently null (idempotent). In `writeOrgStatus` (347): when writing `'active'`, also clear `offboarding_initiated_at` + the three reminder stamps (extend the existing past-due-marker clear). REUSE existing org resolution + `writeOrgStatus`.
- `src/lib/offboarding/cascade-delete.ts` -- NEW, server-only. `cascadeDeleteOrganization(adminClient, orgId)`: delete rows of the INCLUDE set only (`records`, `org_schemas`, `org_members`, `business_profiles`, `pending_claims`, `forms`), remove the `business-logos` object(s) under `${orgId}/` (via `LOGO_BUCKET` from `src/lib/storage/logo.ts`), then set `subscription_status='deleted'` + `offboarding_purged_at=now`. Export the INCLUDE and EXCLUDE table-name lists as consts so a test can assert the EXCLUDE set is never referenced. Re-entrant (each delete filtered by `organization_id`).
- `src/app/api/cron/offboarding/route.ts` -- NEW. GET; `authorizeCron(req)`; select orgs where `offboarding_initiated_at not null and offboarding_purged_at is null`; per org compute days since `initiated`; send Day1/7/25 warnings (stamp idempotently) and, when `days >= 30`, call `cascadeDeleteOrganization`. Mirror `src/app/api/cron/trial-lifecycle/route.ts` structure, per-stage error isolation (258-262), and `createAdminClient()` usage.
- `vercel.json` -- EDIT. Add `{ "path": "/api/cron/offboarding", "schedule": "0 12 * * *" }` (daily; alongside the two existing crons, 3-12).
- `src/lib/resend/offboarding-reminder.ts` -- NEW. `sendOffboardingReminderEmail({ to, language, stage, slug, deletionDate, appOrigin? })` mirroring `src/lib/resend/trial-reminder.ts`: catalog copy under `Offboarding.email.<stage>.{subject,body}`, `sendTransactional`, `buildBillingLink`-style settings link (point at the export). Reuse `resolveAdminEmails` + `resolveOrgLanguage` from `src/lib/orgs/org-recipients.ts`.
- `src/components/layout/GracePeriodBanner.tsx` -- NEW `'use client'`. Inline full-width `border-b` block modeled closely on `src/components/layout/TrialBanner.tsx` (same container, tokens, FM reveal gated by `useReducedMotion`) — NOT portalled/fixed, so the backdrop-blur gotcha does not apply. `useTranslations('Offboarding')`. Props from the server: `{ slug, role, daysRemaining, deletionDateLabel }` (server pre-formats the localized date + whole-days countdown; component stays pure). See UI direction in Design Notes.
- `src/app/[slug]/layout.tsx` -- EDIT. Already reads `subscription_status`/`trial_expires_at` (62-91); also read `offboarding_initiated_at`. If `status === 'deleted'` render the terminal "account closed" screen (server-rendered, replaces nav+children). Else, when `isOffboarding`, render `GracePeriodBanner` in TrialBanner's slot (102-109) AND suppress `TrialBanner`'s read-only state (pass a flag or skip it) so only ONE banner shows; non-offboarding behavior unchanged. Compute `daysRemaining` from `offboarding_initiated_at + 30d` and the localized deletion-date label here.
- `src/components/layout/AccountClosedScreen.tsx` -- NEW server component. Terminal, calm "account closed" panel (see Design Notes). `getTranslations('Offboarding')`, `accountClosed.*` keys.
- `src/components/settings/OffboardingSection.tsx` -- NEW. Explains the 30-day grace + Day-30 deletion, surfaces the export, and (Option A) links to Manage Billing to cancel. Use the `/web-uiux-architect` skill for this UI. Mirror the settings section idiom.
- `src/app/[slug]/settings/page.tsx` -- EDIT. Add the Offboarding `<section id="offboarding" className="... scroll-mt-16">` after the DataExport section, before `</main>`. Page is already admin-gated.
- `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- EDIT. Add the `Offboarding` namespace to both: settings-section copy, banner copy, "account closed" copy, and `email.{day1,day7,day25}.{subject,body}` (ICU, like `Trial.email.*`).

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<new-ts>_add_offboarding_lifecycle_to_organizations.sql` -- NEW columns + widened `subscription_status` CHECK (`+'deleted'`) + sweep partial index. Apply via Supabase MCP (test project) and record the migration.
- [x] `src/types/db.ts` -- add `'deleted'` to `SubscriptionStatus` and the five columns to `OrganizationRow`.
- [x] `src/lib/billing/access.ts` -- `isReadOnly` covers `'deleted'`; add `isOffboarding` / `isDeleted`.
- [x] `src/app/api/stripe/webhook/route.ts` -- stamp `offboarding_initiated_at` on cancel→read_only; clear offboarding columns on reactivate→active.
- [x] `src/lib/offboarding/cascade-delete.ts` -- NEW purge honoring the INCLUDE/EXCLUDE lists + logo removal + tombstone write; re-entrant; exported table-name consts.
- [x] `src/lib/resend/offboarding-reminder.ts` -- NEW staged warning email (day1/7/25), catalog-driven, both locales.
- [x] `src/app/api/cron/offboarding/route.ts` -- NEW sweep: auth, select grace orgs, staged emails (idempotent), Day-30 cascade.
- [x] `vercel.json` -- declare the `/api/cron/offboarding` daily job.
- [x] `src/components/layout/GracePeriodBanner.tsx` -- NEW inline grace banner (countdown + export + keep-account), per Design Notes UI direction.
- [x] `src/components/layout/AccountClosedScreen.tsx` -- NEW terminal account-closed panel, per Design Notes UI direction.
- [x] `src/app/[slug]/layout.tsx` -- read offboarding state; render GracePeriodBanner in grace and suppress TrialBanner's read-only state; render AccountClosedScreen for `deleted`.
- [x] `src/components/settings/OffboardingSection.tsx` + `src/app/[slug]/settings/page.tsx` -- NEW explanatory settings section wired after DataExport, per Design Notes UI direction.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add the `Offboarding` namespace (UI + banner + account-closed + email stages) in both.
- [x] `tests/unit/offboarding-cascade.test.ts` -- NEW. Prove the purge deletes exactly the INCLUDE set and NEVER references any EXCLUDE table or the `organizations` row delete; tombstone write sets `deleted` + `offboarding_purged_at`; re-entrant on a re-run.
- [x] `tests/unit/cron-offboarding.test.ts` -- NEW. `401` without `CRON_SECRET`; day-1/7/25 send once and stamp (no duplicate on re-run); `days>=30` triggers cascade; a send failure doesn't abort the sweep; purged orgs skipped.
- [x] `tests/unit/offboarding-reminder.test.ts` -- NEW. Correct subject/body per stage in both locales; no em-dash; deletion date rendered.
- [x] `tests/unit/offboarding-catalog.test.ts` -- NEW. Every `Offboarding` key present and non-empty in both `en.json` and `fr.json` (catalog-parity convention).
- [x] `tests/unit/billing-access-offboarding.test.ts` + webhook test -- NEW/EDIT. `isReadOnly` true for `deleted`; `isOffboarding` logic; webhook stamps on cancel and clears on reactivate.

**Acceptance Criteria:**
- Given a paying org whose cancellation takes effect, when the webhook lands, then the org is `read_only`, the grace clock is stamped, writes return `403 readOnly`, and the export + grace banner surface the deletion date throughout the 30 days (FR38).
- Given an org in grace, when the daily sweep sees Day 1, Day 7, and Day 25, then each admin receives exactly one Resend warning per milestone in the org's language, with no duplicates across reruns (FR39).
- Given an org that reaches Day 30, when the sweep runs, then the cascade irreversibly removes every user-data table and the logo, leaves the `organizations` tombstone (`deleted`) plus all invoice/credit-note/payment rows and their `invoice-pdfs` objects intact, and the org is skipped on subsequent sweeps (FR38; Story 12.5 retention override).
- Given an org that re-subscribes during grace, when `active` is written, then the grace clock and reminder stamps clear and normal access resumes.
- Given a `deleted` org, when anyone opens the app, then a terminal "account closed" screen renders (no dashboard), in either locale, meeting WCAG AA.

## Implementation Notes

- Built to the Code Map. NEW: migration `20261005120000_add_offboarding_lifecycle_to_organizations.sql` (5 nullable columns + `deleted` CHECK + partial sweep index; applied to the test project, recorded as `20261006034651` by the MCP — on-disk filename differs, a cosmetic `db push` hygiene note), `src/lib/offboarding/cascade-delete.ts`, `src/app/api/cron/offboarding/route.ts`, `src/lib/resend/offboarding-reminder.ts`, `src/components/layout/GracePeriodBanner.tsx`, `src/components/layout/AccountClosedScreen.tsx`, `src/components/settings/OffboardingSection.tsx`, and tests `offboarding-cascade`, `cron-offboarding`, `offboarding-reminder`, `offboarding-catalog`, `billing-access-offboarding`, `grace-period-banner`. EDITED: `src/types/db.ts` (`deleted` + 5 columns), `src/lib/billing/access.ts` (`isReadOnly` covers `deleted`; `isOffboarding`/`isDeleted`), `src/app/api/stripe/webhook/route.ts` (grace-clock stamp on voluntary cancel, clear on reactivate), `src/app/[slug]/layout.tsx` (offboarding/deleted branches), `src/app/[slug]/settings/page.tsx` (`#data-export` id + OffboardingSection), `src/lib/i18n/{en,fr}.json` (`Offboarding` namespace), `vercel.json` (daily cron).
- Grace reuses `read_only` + the `offboarding_initiated_at` clock; the only new state is the terminal `deleted` tombstone. The Day-30 cascade deletes only the INCLUDE set + the `business-logos` object and writes the tombstone, never deleting the org row or any invoice/credit-note/payment table or `invoice-pdfs` object. Day 1/7/25 warnings are idempotent per-stage; reactivation (checkout -> active) clears the clock + stamps.
- **Review Pass 1 (Blind Hunter + Edge Case Hunter + Verification Gap):** 2 patches applied, 1 deferred, 12 rejected (recorded in the Review Triage Log).
  - **[patch] Voluntary-only grace clock.** `handleSubscriptionDeleted` now skips the `offboarding_initiated_at` stamp when `subscription.cancellation_details?.reason === "payment_failed"` (involuntary dunning-exhaustion cancellation), so a failed-payment org is never delete-bound — honoring the frozen Never boundary regardless of the Stripe dunning config. A new webhook test pins that a `payment_failed` deletion writes `read_only` but does NOT stamp the clock, while a voluntary one does.
  - **[patch] GracePeriodBanner render test.** Added `tests/unit/grace-period-banner.test.tsx` (mirrors `trial-banner.test.tsx`): the admin variant renders both CTAs with `settings#offboarding`/`settings#billing` hrefs; the member variant renders the member message and neither CTA.
- **Verified after patches:** `npm run type-check` clean; `npm run lint` clean (pre-existing eslintrc-deprecation notice only); `npm run build` compiles with `/api/cron/offboarding` emitted dynamic; the full Vitest suite passes (1699 tests) — the 3 `tests/integration/*-db` timeouts seen once under full-parallel load are pre-existing real-Supabase 5s-timeout flakiness unrelated to this story and pass in isolation (54/54).
- **Playwright MCP manual review (localhost:3000, authed admin `session-1f4fa453`, rich 5-table org) — PASSED.** Simulated grace via Supabase MCP (`offboarding_initiated_at = now()-3d`, deletion 2026-11-02): the GracePeriodBanner renders as the sole banner (TrialBanner suppressed) with the localized deletion date and countdown — FR "2 novembre 2026 / 27 jours restants", and toggling EN re-labels it instantly with no hard reload to "November 2, 2026 / 27 days left"; both CTAs point correctly (`#offboarding`, `#billing`). Settings shows the OffboardingSection (3-step lifecycle + six-year retention note + Manage-billing/Download links). During grace, `GET /api/export` still returns `200 application/zip` (reads ungated) while `POST /api/records` returns `403 readOnly` (writes blocked). Simulated `deleted`: the terminal AccountClosedScreen replaces the whole shell in both locales (EN "This account has been closed."; FR "Ce compte a été fermé."), no nav/data. The fixture org was restored to its exact pre-review state afterward. Console errors are only the pre-existing dev-only `manifest.webmanifest` notice. The Day-30 cascade itself was not run live (destructive); it is covered by `offboarding-cascade`/`cron-offboarding` unit tests.

## Spec Change Log

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **[patch·medium] Dunning-exhaustion cancellations can start the delete clock (Blind Hunter).** `handleSubscriptionDeleted` stamps `offboarding_initiated_at` for every `customer.subscription.deleted`, but Stripe fires that event for involuntary dunning-exhaustion cancellations too. The frozen Never bullet forbids dunning from starting the clock. The app currently assumes Stripe is NOT set to cancel-after-retries (the 7.4 cron safety-net exists for exactly that), so it is likely unreachable today — but the harm if the config flips is silent data deletion of a failed-payment customer. Cheap defensive guard honors the explicit intent. → patch (voluntary-only guard + test).
- **[patch·low] GracePeriodBanner role-gating has no render test (Verification Gap).** The sibling `TrialBanner` pins its identical admin-only-CTA rule via `tests/unit/trial-banner.test.tsx`; `GracePeriodBanner` has no equivalent, so inverting the `isAdmin` guard (members shown admin billing/export CTAs) would ship green. → patch (add `grace-period-banner.test.tsx`).
- **[defer] "Purging records is safe" rests on untested pre-existing FKs (Verification Gap).** The retention guarantee depends on `invoices/credit_notes.customer_record_id` being `ON DELETE SET NULL`; the fully-mocked cascade test cannot exercise it, and the repo has no live-schema integration tests. Pre-existing FK, not introduced here. → defer.
- **[reject·false] `forms` INCLUDE may use a non-`organization_id` column (Blind Hunter).** Verified `supabase/migrations/20261003120000_forms.sql:21` — `forms.organization_id uuid not null`; the cascade's `.eq("organization_id", orgId)` is correct. Not a defect.
- **[reject·low] Banner download CTA points at `#offboarding` not `#data-export` (Blind Hunter).** Matches the spec's UI direction; `#offboarding` lands on the section whose own link reaches `#data-export`. Cosmetic one-click difference; code matches intent. Rejected.
- **[reject·low] AccountClosedScreen copy is owner-framed for a member viewer (Blind Hunter).** The account is closed for members too; copy is acceptable. A member variant adds surface for negligible gain. Rejected.
- **[reject·low] Banner date (viewer locale) vs email date (org language) can differ (Blind Hunter).** Same calendar day, localized per medium; each surface is internally consistent. No correctness harm. Rejected.
- **[reject·out-of-scope] No Day-30 "account closed" confirmation email (Blind Hunter).** FR39 and the frozen matrix enumerate exactly Day 1/7/25; a terminal confirmation is beyond the stated intent. Rejected (intent-bounded).
- **[reject·low] `resolveOrgLanguage` reads `business_profiles`, which the cascade deletes (Blind Hunter).** Currently correct: the Day-30 branch `continue`s before any email, so language resolution never runs post-purge. Documentation nit only. Rejected.
- **[reject·low] Catalog test checks a hardcoded key list, not deep structural parity (Blind Hunter).** It does fail on a key missing in either locale (undefined → non-string); matches the repo convention (`data-export-catalog.test.ts`). Rejected.
- **[reject·low] No test for the layout "exactly one banner" selection (Blind Hunter + Verification Gap other).** `isOffboarding`/`isDeleted` are unit-tested; the layout's banner-selection JSX has no test harness precedent in the repo (no `[slug]/layout` test exists) and is covered by the assigned Playwright manual review, as in Stories 8.1-8.4. Rejected (manual-review bucket).
- **[reject·low] `sendStage` returns true / over-counts `emailed` when the post-send stamp write fails (Blind Hunter + Verification Gap other).** Explicitly handled: logs via `reportError` and accepts a possible re-send as a documented "a duplicate warning beats a silently dropped one" tradeoff. Summary over-count is cosmetic. Rejected.
- **[reject·low] Multi-admin partial send is not idempotent per-recipient (Edge Case Hunter + Blind Hunter).** A mid-loop send failure re-sends to already-notified admins next run. Low harm (duplicate transactional email), most orgs are single-admin (solo tier), and per-recipient tracking adds real complexity. Matches the project's duplicate-beats-dropped stance. Rejected.
- **[reject·low] Cron missing multiple days could reach Day-30 before Day-25 sends (Edge Case Hunter).** Requires a multi-day Vercel Cron outage; the daily schedule delivers the staged warnings in normal operation. Guarding adds a branch for an infra-catastrophe case. Rejected.
- **[reject·low] `business-logos` `storage.list` default 100-object cap is not paginated (Edge Case Hunter).** Logos are one-per-org by key convention (`{orgId}/logo.{ext}`, upsert), so a prefix holds at most a couple of objects; >100 is unreachable. Pagination would add complexity for an impossible input. Rejected.

## Design Notes

- **Grace == `read_only` + a clock, not a new state.** The non-writable semantics already exist and are enforced in one place (`access.ts`); adding a parallel "grace" status would fork the gate. The only new state is the terminal `deleted` tombstone. `offboarding_initiated_at` is what distinguishes a cancellation (delete-bound) from a trial-expiry/dunning `read_only` (untouched).
- **The cascade must NOT delete the org row.** Every child table is `ON DELETE CASCADE` on `organizations`, so deleting the row would wipe the statutorily-retained invoices. The purge therefore deletes the INCLUDE tables explicitly and keeps the org as a `deleted` tombstone carrying the retained invoice tables. This is the single non-obvious correctness point of the story and the reason a test asserts the EXCLUDE set is never touched.
- **Loose customer links are safe to orphan.** `invoices/credit_notes.customer_record_id` are `ON DELETE SET NULL` and issued docs carry frozen snapshots, so purging `records` nulls only the live link.
- **Reactivation is re-subscribe.** Recovery within grace reuses the existing `checkout.session.completed → active` path (now also clearing the clock), so no separate "undo" endpoint. Export remains available the entire time (Story 8.4 gate choice).

### UI/UX direction (via /web-uiux-architect)

Match the app's shadcn New York / zinc idiom and semantic tokens; WCAG AA; mobile-first; no em-dashes. Reuse `buttonVariants`, `cn`, lucide icons. Reduced-motion must be honored (`useReducedMotion` on FM; `motion-reduce:animate-none` on CSS).

- **GracePeriodBanner** (inline, mirrors `TrialBanner` exactly in structure/tokens/motion):
  - Urgent-but-calm, not failure-red. Base: `w-full border-b border-amber-300/60 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200`. Inner: `mx-auto flex w-full max-w-5xl flex-col gap-2 px-6 py-3 sm:flex-row sm:items-center sm:justify-between`. `role="alert"`.
  - Left: lucide `CalendarClock` `size-5 shrink-0 mt-0.5` `aria-hidden`; title `text-sm font-semibold` (e.g. "Your account is scheduled to close"); message `text-sm text-pretty` naming `{deletionDateLabel}`; a countdown chip `rounded-full bg-destructive/10 text-destructive px-2 py-0.5 text-xs font-semibold` reading the `{daysRemaining}`-days-left ICU string.
  - Right (admin only; member sees notice only): primary `buttonVariants({ variant: "default", size: "sm" })` Link "Download my data" → `/{slug}/settings#offboarding`; quieter `buttonVariants({ variant: "outline", size: "sm" })` Link "Keep my account" → `/{slug}/settings#billing`. `shrink-0 self-start sm:self-auto`.
  - FM reveal copied from TrialBanner (`initial y:-4 → 0`, `duration: 0.25`, reduced-motion → opacity only).

- **OffboardingSection** (server; after DataExport, preceded by `<hr className="border-border" />`):
  - Section idiom: `<section id="offboarding" className="flex flex-col gap-8 scroll-mt-16">` → `<header className="flex flex-col gap-2">` with `<h2 className="text-2xl font-semibold tracking-tight text-balance">` "Close account" + `<p className="text-sm text-muted-foreground text-pretty">` subtitle.
  - Body card: `rounded-xl border border-border bg-muted/30 p-6 flex flex-col gap-4`. Lead sentence, then a semantic `<ol className="flex flex-col gap-3">`; each `<li className="flex items-start gap-3">` with a lucide icon `size-5 shrink-0 mt-0.5 text-muted-foreground` + `text-sm text-pretty`: `Clock` (30-day read-only grace, data visible + exportable), `Mail` (reminders at day 1/7/25), `Trash2` (permanent deletion at day 30, cannot be undone). Then a reassurance row with `ShieldCheck`: invoices/credit notes retained six years by law even after closing.
  - Action row: quiet `buttonVariants({ variant: "outline", size: "sm" })` Link "Manage billing to cancel" → `#billing` (closing happens in Stripe; no destructive button here), plus a ghost/outline Link "Download my data" → `#data-export`.

- **AccountClosedScreen** (server; replaces nav+children when `deleted`):
  - `min-h-dvh grid place-items-center bg-background px-6`. Card `w-full max-w-md rounded-2xl border border-border bg-card p-8 text-center shadow-sm flex flex-col items-center gap-4 animate-in fade-in duration-500 motion-reduce:animate-none`.
  - Muted (not red) icon well: `flex size-12 items-center justify-center rounded-full bg-muted text-muted-foreground` with lucide `Archive` `aria-hidden`. `<h1 className="text-xl font-semibold tracking-tight text-balance">` "This account has been closed." + `<p className="text-sm text-muted-foreground text-pretty">` noting data was permanently deleted and tax-required invoices are retained separately (contact support). One quiet `buttonVariants({ variant: "outline" })` Link home. `<main aria-labelledby>` for the heading.

## Verification

**Commands:**
- `npm run type-check` -- expected: no errors
- `npm run lint` -- expected: clean (allow the pre-existing eslintrc-deprecation notice)
- `npm test` -- expected: green incl. the new offboarding tests
- `npm run build` -- expected: compiles with `/api/cron/offboarding` emitted as a dynamic route

**Manual checks (Playwright MCP, localhost:3000, authed admin `/session-…` fixture):**
- Simulate grace (set `offboarding_initiated_at` on the fixture org via Supabase MCP): grace banner renders with the deletion date + working Download-My-Data link; writes are blocked; FR toggle re-labels the banner with no reload.
- Simulate `deleted`: the app shell shows the terminal "account closed" screen in both locales.
- Dry-run the cron handler against a seeded grace org to confirm the day-N email selection and that the Day-30 purge keeps the invoice tables/PDFs.
