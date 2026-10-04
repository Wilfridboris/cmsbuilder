---
title: 'Multi-Form Public Route & Form-Keyed Submission'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '6b65a2d0753ad0011d63314551eb2794ace859a8'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Story 14.1 added the `forms` entity and Admin create/list/rename/delete, but public behavior is unchanged: an org still has exactly one auto-generated intake form, resolved by the Epic-6 heuristic (`selectIntakeTable`), with no way to run a specific named form at a chosen slug. Epic 14 needs each form to be independently reachable and to collect into its own stored target table.

**Approach:** Add a per-form public route `/forms/{orgSlug}/{formSlug}` and a form-keyed submission endpoint `/api/intake/{orgSlug}/{formSlug}`. Both re-resolve the form server-side via a new public resolver that reads the `forms` row by `(organization_id, slug)` where `published = true`, treats its stored `target_table_key` as authoritative, and reuses the existing field-allowlist and guarded-write machinery. The legacy single-form route `/forms/{orgSlug}` (and `/api/intake/{orgSlug}`) is migrated onto the same resolver — not rewritten — collecting into the org's primary published form.

## Boundaries & Constraints

**Always:**
- The server is the sole authority on org, form, target table, and field allowlist. The per-form public route and submission handler re-resolve the form from `(orgSlug, formSlug)` server-side; the client payload never selects the table or columns.
- BOTH the per-form keyed route AND the legacy bare-org route resolve a form only when it exists under the org AND `published = true` AND its `target_table_key` names a currently-visible table with at least one eligible field. The bare-org route selects the org's primary published form (oldest `published` by `created_at`). There is NO heuristic fallback on any route (decision on Open Question 1: strict, per epic text). Any other case (unknown org/form slug, unpublished, `target_table_key` null/stale, no eligible fields) collapses to the single data-free "form not available" state (page) or a generic `400` (submission) — no provider internals, no distinction between causes.
- Accepted interim state: because publishing does not exist until 14.3, after this story every org has zero published forms, so every public intake surface (keyed and bare-org) returns "form not available" until 14.3. This is a deliberate, temporary regression of the Epic-6 auto-form, chosen over carrying a transitional heuristic fallback.
- Relationship/lookup fields are never rendered and never accepted: field selection reuses `intakeFields(table)` (non-relation, non-hidden), and the submission builds its write payload only from that server-resolved allowlist, silently dropping every other key.
- Public resolution uses the service-role admin client (`createAdminClient`); submissions write through the guarded `mutate.ts` under `INTAKE_ACTOR_ID`, scoped to the resolved `orgId` and `target_table_key`, passing the resolved `schema` and the client's `idempotencyKey` (same contract as the existing intake handler).
- Submitted records surface in the owner's dashboard in real time via the existing `records` postgres-changes channel (automatic on insert — no extra wiring). Best-effort admin email notification is preserved, iterating only non-relation `fields`.
- Runtime matches the existing public surface: `export const dynamic = "force-dynamic"` and `export const runtime = "nodejs"` on every new page and route.
- Public slugs are URL-encoded per segment when constructing links and fetch targets. No new user-facing copy is introduced; the existing `IntakeForm` namespace ("not available", form, confirmation, email) is reused as-is, with no em-dash and no hardcoded strings.

**Never:**
- Do not add a migration, column, or publish UI (publish toggle + share surface is 14.3). Do not populate or read `field_config` or `intro_text`, and do not add branding/logo/intro rendering (field customization is 14.4; branding/intro is 14.6).
- Do not write through `src/lib/data/mutate.ts`'s tenant path with any identity other than `INTAKE_ACTOR_ID`; do not introduce a public bucket, signed URL, or new actor.
- Do not implement honeypot or rate limiting (abuse protection is 14.7); do not change `src/middleware.ts` (`/forms` is already in `PUBLIC_TOP_LEVEL` and `/api/*` is already matcher-excluded).
- Do not change the `forms` Admin API/UI from 14.1. Do not add any heuristic fallback on any public route (neither the keyed nor the bare-org route may fall back to `getIntakeTarget`); the now-dead `getIntakeTarget`/`getPublicIntakeForm` are removed rather than left unused.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Keyed page happy path | `GET /forms/{orgSlug}/{formSlug}`; form published, valid target table with eligible fields | Renders `IntakeForm` for the form's `target_table_key`; submit posts to `/api/intake/{orgSlug}/{formSlug}` | N/A |
| Keyed submission happy path | `POST /api/intake/{orgSlug}/{formSlug}` with valid values | One record inserted into `target_table_key` under `INTAKE_ACTOR_ID`; owner dashboard updates live; admins emailed (best-effort); `200 {ok:true}` | N/A |
| Unknown org or form slug | Either slug matches no org / no form | Page → "form not available"; POST → `400 genericError` | No internals leaked |
| Form exists but unpublished | `published = false` | Keyed page → "not available"; keyed POST → `400` | No distinction from unknown |
| `target_table_key` null or names a deleted/hidden table | Published form, invalid target | Page → "not available"; POST → `400` | No internals leaked |
| Relation key in payload | Client posts a relation field key | Dropped from write; never persisted, never emailed | Silent drop |
| Legacy bare-org page/POST, org HAS a published form | `GET /forms/{orgSlug}` / `POST /api/intake/{orgSlug}` | Resolves the org's primary published form (oldest published by `created_at`) and behaves as the keyed path for it | As above |
| Legacy bare-org page/POST, org has NO published form | No published form yet (pre-14.3, i.e. every org) | Page → "form not available"; POST → `400`. NO heuristic fallback (strict; accepted interim state until 14.3) | No internals leaked |
| Empty submission | No field filled (non-boolean form) | Rejected | `400 genericError` (existing behavior) |

</frozen-after-approval>

## Code Map

Reuse as-is (do not change):
- `src/lib/supabase/admin.ts` — `createAdminClient()` service-role client for public resolution.
- `src/lib/intake/target.ts` — `intakeFields(table)` (non-relation, non-hidden allowlist). `selectIntakeTable` stays untouched (still used at form creation in 14.1); it is NOT used by any 14.2 public route. `visibleTables` via `src/lib/schema/overrides.ts`.
- `src/lib/data/records.ts` — `getSchema(client, orgId)`.
- `src/lib/data/mutate.ts` — `mutate(identity, "insert", tableKey, data, {idempotencyKey, schema})`, `INTAKE_ACTOR_ID`.
- `src/lib/forms/field-input.ts` `coerceAddValue`; `src/lib/forms/select-input.ts` `matchSelectValue` — per-field coercion/validation.
- `src/lib/resend/intake-notification.ts` `sendIntakeSubmissionEmail`; `src/lib/orgs/org-recipients.ts` `resolveAdminEmails`/`resolveOrgLanguage`.
- `src/app/api/intake/[slug]/schemas.ts` `intakeBodySchema`; `src/types/api.ts` `AppError`/`ApiResponse`; `src/lib/api/route-helpers.ts` `json`/`handleError`.
- `src/types/db.ts` — `FormRow`, `FormFieldConfig`, `TableDefinition`, `FieldDefinition`, `SchemaDefinition`.

Change / add:
- `src/lib/data/forms.ts` — ADD published-gated readers (admin-client callable): `getPublishedFormBySlug(client, orgId, slug)` and `getPrimaryPublishedForm(client, orgId)` (published only, oldest `created_at` first).
- `src/lib/data/intake.ts` — REMOVE `getIntakeTarget(slug)` and `getPublicIntakeForm(slug)` (dead once both public routes migrate; strict decision forbids the heuristic fallback). Relocate the `IntakeTarget` type (and drop `PublicIntakeForm`) to `src/lib/data/forms-public.ts`. Delete the file if nothing else remains.
- `src/lib/data/forms-public.ts` — NEW: owns the `IntakeTarget` type and the resolver `resolvePublicFormTarget({ orgSlug, formSlug? })` → `IntakeTarget | null`: org-by-slug (admin client) → form (keyed `getPublishedFormBySlug`, else primary `getPrimaryPublishedForm`) → `getSchema` → table by `target_table_key` in `visibleTables` → `intakeFields`; returns `null` (never throws) on EVERY unavailable case; `reportError` + `null` on unexpected provider errors. No fallback branch.
- `src/lib/intake/submit.ts` — NEW shared `submitToTarget(req, target, routeLabel)`: the body-parse → allowlist-coerce → `mutate` → notify → envelope logic extracted verbatim from the current `/api/intake/[slug]/route.ts` (lines 55–190).
- `src/app/forms/[slug]/page.tsx` — MIGRATE: resolve via `resolvePublicFormTarget({ orgSlug: slug })` (primary published form, strict); `Unavailable` when null; pass `submitPath={/api/intake/${enc(slug)}}`.
- `src/app/forms/[slug]/[formSlug]/page.tsx` — NEW: resolve via `resolvePublicFormTarget({ orgSlug: slug, formSlug })`; `Unavailable` when null; pass `submitPath={/api/intake/${enc(slug)}/${enc(formSlug)}}`.
- `src/app/api/intake/[slug]/route.ts` — MIGRATE: `resolvePublicFormTarget({ orgSlug: slug })` (primary published, strict) → `400` when null → `submitToTarget`.
- `src/app/api/intake/[slug]/[formSlug]/route.ts` — NEW: `resolvePublicFormTarget({ orgSlug: slug, formSlug })` → `400` when null → `submitToTarget`.
- `src/components/intake/IntakeForm.tsx` — replace the `slug` prop with `submitPath: string` (used only at the single `fetch` call, line ~148); `orgName`/`fields` unchanged.

Exemplar to mirror (pattern, not copy): the pre-migration `src/app/api/intake/[slug]/route.ts` + `src/lib/data/intake.ts` (auth-free resolve→write→notify; null-on-any-failure public resolver) — see the baseline commit / git history since both are refactored by this story.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/data/forms.ts` -- add `getPublishedFormBySlug(client, orgId, slug)` and `getPrimaryPublishedForm(client, orgId)` (filter `published=true`; primary = oldest `created_at`) -- published-gated read layer for public resolution.
- [x] `src/lib/data/forms-public.ts` -- add (and own the `IntakeTarget` type for) `resolvePublicFormTarget({orgSlug, formSlug?})`: strict published-only resolution, null on every unavailable case, no heuristic fallback -- single public-form authority shared by page + submission.
- [x] `src/lib/data/intake.ts` -- remove the now-dead `getIntakeTarget`/`getPublicIntakeForm` and relocate the `IntakeTarget` type to `forms-public.ts` (delete the file if empty); update all importers -- no dead heuristic resolver left behind (strict decision).
- [x] `src/lib/intake/submit.ts` -- extract `submitToTarget(req, target, routeLabel)` from the current intake route (parse/coerce/mutate/notify/envelope) -- one write path for both legacy and keyed routes.
- [x] `src/components/intake/IntakeForm.tsx` -- replace `slug` prop with `submitPath`; update the single fetch -- decouple the component from route structure.
- [x] `src/app/forms/[slug]/page.tsx` -- migrate to `resolvePublicFormTarget({orgSlug})` (strict, primary published) + `submitPath` -- legacy route onto the forms entity.
- [x] `src/app/forms/[slug]/[formSlug]/page.tsx` -- new per-form public page (strict published) -- the multi-form public surface.
- [x] `src/app/api/intake/[slug]/route.ts` -- migrate to `resolvePublicFormTarget({orgSlug})` (strict, primary published) + `submitToTarget` -- legacy submission onto the entity.
- [x] `src/app/api/intake/[slug]/[formSlug]/route.ts` -- new keyed submission (strict published) + `submitToTarget` -- form-keyed write.
- [x] `src/lib/data/forms-public.test.ts` (+ a keyed-vs-legacy route/submit test as the harness convention allows) -- cover the I/O matrix: unknown org/form, unpublished, null/stale target table, primary = oldest published, bare-org with no published form → null (no fallback), relation-key drop -- lock the resolution + gating invariants.

**Acceptance Criteria:**
- Given a published form whose target table has eligible fields, when a visitor opens `/forms/{orgSlug}/{formSlug}` and submits valid values, then exactly one record is written to that form's `target_table_key` under `INTAKE_ACTOR_ID`, it appears live on the owner's dashboard, and admins receive the best-effort email — with no relationship field rendered, accepted, or emailed.
- Given an org with no published form, when a visitor opens `/forms/{orgSlug}` or posts to `/api/intake/{orgSlug}`, then the single data-free "form not available" state is shown (page) / a generic `400` is returned (POST), with no fallback to the Epic-6 heuristic form.
- Given a form that is unpublished, unknown, or whose `target_table_key` is null/stale, when the keyed page or keyed endpoint is hit, then the page shows the single data-free "form not available" state and the endpoint returns a generic `400`, leaking no internals and not distinguishing the cause.

## Design Notes

- **Why a shared resolver + shared submit helper:** The write-side security of the current intake handler (server re-resolves target, allowlists non-relation fields, drops everything else) must hold identically on both the legacy and keyed routes. Extracting `submitToTarget` and `resolvePublicFormTarget` guarantees one code path rather than two that can drift — the 14.1 retro flagged exactly this class of untested divergence.
- **Primary = oldest published:** With no `published_at` column, the org's "primary" bare-org form is the oldest published row by `created_at` (the original, most stable choice). Ties are not expected; `created_at` ordering is deterministic enough for this surface.
- **Publishing gap is intentional (strict, Open Question 1 → Option B):** No form can be `published` until 14.3, so after this story every public intake surface returns "form not available". This is deliberately accepted (matches the epic's literal wording) over carrying a transitional heuristic fallback. Both routes are exercisable in 14.2 only by seeding `published = true` directly (tests + manual SQL).
- **UI/UX (`/web-uiux-architect`):** 14.2 introduces no new UI — it reuses the `IntakeForm` component and its namespace. The only component change is swapping `slug` for `submitPath`; keep the existing layout, states, a11y, and motion exactly. Do not add dark-mode variants.

## Verification

**Commands:**
- `npm run lint` -- expected: passes, including `eslint-plugin-i18next` (no hardcoded strings) and the `server-only`/admin-client import gates.
- `npx tsc --noEmit` -- expected: no type errors; `IntakeForm` `submitPath` prop resolves at both call sites.
- `npm test -- forms-public` -- expected: resolver + gating edge cases green.

**Manual checks:**
- Seed a form with `published = true` and a valid `target_table_key` (SQL). Visit `/forms/{orgSlug}/{formSlug}`, submit, and confirm the record lands in that table and appears live on the dashboard. Visit `/forms/{orgSlug}/{unknown}` and an unpublished form's slug → "form not available".
- With no published form (the default state until 14.3), confirm `/forms/{orgSlug}` shows "form not available" and `/api/intake/{orgSlug}` returns a generic `400` — no fallback to the Epic-6 heuristic form.

## Implementation Notes

- Added `orgSlug` to `IntakeTarget` so the best-effort notification email's dashboard CTA always uses the org slug on both routes (never the form slug); this is the one intentional, documented deviation from a verbatim extraction of the old handler.
- Review pass 1 patch: `getPrimaryPublishedForm` gained a secondary `id` sort key so the bare-org "primary" selection is fully deterministic on tied `created_at`.

## Spec Change Log

_No bad_spec loopback occurred._

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **`getPrimaryPublishedForm` has no tiebreaker on equal `created_at`** (blind-hunter + edge-case-hunter) — `low`, PATCH. `.order("created_at",{ascending:true}).limit(1)` with no secondary key means two published forms sharing a timestamp resolve non-deterministically — and this selects which form the public bare-org `/forms/{orgSlug}` URL serves. Real (if rare: API-created forms get distinct `now()` timestamps; ties need seeding). Fix is a trivial secondary `id` sort, no new surface. → patch.
- **Page `submitPath` construction is untested** (blind-hunter + verification-gap) — `medium` (unverified-by-test), DEFER. URL construction moved from the (tested) `IntakeForm` component into the two server-component pages; no test renders either page, so a regression dropping/mis-encoding the `formSlug` segment (keyed submissions silently landing in the wrong table or 404) would pass all tests. Pre-verified by the verification-gap layer, which filed `defer`: route-layer tests assert the URL shapes via hand-built params, pages are thin wrappers, and the mis-wiring is highly visible on first manual use; a page-render test needs a server-component harness this suite does not use. → defer.
- **Public keyed form shows no form title / which-form context to the visitor** (blind-hunter) — `low`, DEFER. `IntakeForm` renders only `orgName` + a generic heading; on the multi-form surface a visitor cannot tell which form they are filling. Pre-existing component behavior (unchanged by this story), made salient by multi-form. Natural home is the 14.6 branded public form (operating name + logo + intro). → defer.
- **`intro_text` is never rendered on the public form** (blind-hunter) — `false` (out of scope per intent). The spec's *Never* explicitly forbids reading/rendering `intro_text` and branding/intro, and the epic places the intro/branding surface in story 14.6. Not a defect in 14.2; the migration comment "Story 14.2+" means 14.2-or-later, satisfied by 14.6.
- **`IntakeTarget.orgSlug` doc comment "used ONLY for the email" is misleading** (blind-hunter) — `false`. Verified: the pages build `submitPath` from their own route `slug` param, not from `target.orgSlug`. Within the type, `orgSlug` really is consumed only by the notification CTA; the comment is accurate.
- **`reportError` in `resolvePublicFormTarget` hardcodes `route: "/forms/[slug]"` for all four callers** (blind-hunter) — `low`, rejected. Observability mislabeling only, and only on the rare unexpected-provider-error branch; the label still points at the resolver. Fix adds a parameter (public surface) for negligible everyday benefit.
- **Slug lookups are exact-match (case/whitespace sensitive)** (blind-hunter) — `low`, rejected. Shared links are generated lowercase-kebab; only manual mis-casing misses, and the behavior mirrors the pre-existing org-slug resolution convention (and 14.1 slug handling). Fix (`ilike`/normalize) is a behavior change beyond a direct correction.
- **Malformed body now triggers a DB resolve before rejection (pre-auth surface)** (blind-hunter) — `low`, rejected. The resolve-only path for a malformed body is strictly *less* work than a valid submission (which resolves AND writes), so it does not enlarge the abuse surface; per-IP/per-slug rate-limiting is explicitly story 14.7. Client-observable result is unchanged (generic 400).
- **`submitToTarget` instantiates a second admin client per POST** (blind-hunter) — `low`, rejected. `createAdminClient` only constructs a client object (no network); negligible. Mirrors the pre-existing resolver+handler split. Threading the client through `IntakeTarget` adds surface for no real gain.
- **Empty-`formSlug` guard is effectively unreachable via the router** (blind-hunter) — `low`, rejected. Cosmetic; the branch already carries a clarifying comment and correctly guards programmatic callers. No behavior issue.
