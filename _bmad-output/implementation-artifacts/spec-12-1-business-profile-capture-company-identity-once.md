---
title: 'Story 12.1: Business Profile — Capture Company Identity Once'
type: 'feature'
created: '2026-09-28'
status: 'done'
route: 'dispatch'
baseline_commit: '87e495d88fbc3feec3ce8d2ba0b8b5acfe3e54ce'
review_loop_iteration: 0
context:
  - '_bmad-output/implementation-artifacts/epic-12-context.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Every invoice (Epic 12) must carry the owner's legal identity, tax registration, and how-to-pay details. Without a place to capture that once, the owner re-types it per invoice and later issue/render (12.4/12.5) has nothing authoritative to snapshot from.

**Approach:** Add an Admin-only "Business Profile" section under Settings that captures company identity and payment details once into a new typed platform table `business_profiles` (one row per organization, keyed by `organization_id`), stored in dedicated typed columns (not the JSONB records store). Identity capture only: it stores what later stories render and snapshot; it does not issue, render, or validate invoices.

## Boundaries & Constraints

**Always:**
- Singleton per org: `business_profiles` is UNIQUE on `organization_id`, with RLS tenant isolation via the existing `auth_org_ids()` policy; save is an upsert (last-write-wins).
- Capture: legal name (required), operating name, entity type, jurisdiction/province, GST/HST number + registration effective date, logo, business + mailing addresses, default payment terms, default invoice language, and a structured Payment Instructions block (e-transfer email, cheque payable-to + mailing address, optional owner card-payment link as free text).
- If a GST/HST number is entered, an effective date is required (and vice versa); unregistered leaves both empty. Constrained fields (entity type, default language) use text + `CHECK`, never Postgres enums.
- Logo: store the uploaded image in a private Storage bucket keyed under the org; the Admin-only upload validates content-type (PNG/JPEG only, no SVG) and size (≤ 2 MB) server-side and persists the object key in `logo_path`. The stored object is read back privately for display (short-lived server-minted signed URL or authenticated server proxy) — never a public bucket or public URL. Storage is introduced here and reused by 12.5.
- Persist enough that a later taxed-invoice render can show legal name together with operating name and the GST/HST number — that render is Story 12.5, out of scope here.
- Writes go through a guarded, RLS-scoped mutation layer mirroring `schema-mutate.ts` (explicit identity, `actor_id` recorded); never the service-role client for tenant data. Both the Settings page and the API route enforce Admin via `requireAdmin`; non-Admins get `403`, unauthenticated `401`, before any access.
- Use the `{ data, error }` envelope where `error` is a translation KEY, never raw copy/stack/SQL. All strings via next-intl (en + fr, real French, no em-dashes, no hardcoded copy).
- UI meets the platform a11y baseline (labeled inputs, keyboard operable, ≥48px targets, WCAG AA, reduced-motion) and is built following the `/web-uiux-architect` skill, reusing `src/components/ui` primitives.

**Never:**
- Never write to `records`, `org_schemas`, or any tenant JSONB table; never store identity in the records store.
- Never build a template designer; never issue, number, render a PDF, compute HST, or implement `assertIssuable` (those are 12.2–12.8). No invoice tables are created here.
- Never use the service-role client for this data; never expose raw errors or SQL to the client.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Load, none saved | Admin opens Business Profile, no row | `GET` returns `{ data: null }`; empty form renders | N/A |
| Load, existing | Admin opens, row exists | `GET` returns the profile; form pre-fills | N/A |
| Create | Admin saves valid data, no row yet | Row inserted keyed by `organization_id`; profile returned; success shown | N/A |
| Update | Admin saves again with changes | Same row upserted (last-write-wins) | N/A |
| Logo upload | Admin uploads a PNG/JPEG ≤ 2 MB | Stored privately; `logo_path` saved; current logo previews via a private read | N/A |
| Bad logo | Wrong type (incl. SVG) or > 2 MB | Rejected before storing, translated error, no write | `BusinessProfile.error.logoInvalid` (400/413) |
| Missing legal name | Save with legal name blank | Rejected, field error, no write | `BusinessProfile.error.legalNameRequired` (400) |
| Registration pair broken | GST/HST number or date present without the other | Rejected, translated pairing error, no write | `BusinessProfile.error.registrationPairRequired` (400) |
| Non-Admin / no session | Member, anon, or missing session on GET or PUT | Rejected before any access | `forbidden` (403) / `unauthorized` (401) |
| Cross-org Admin | Admin of another org addresses this slug | Rejected (RLS + slug/membership check) | `forbidden` (403) |

</frozen-after-approval>

## Code Map

- `src/lib/api/route-helpers.ts` -- REUSE `resolveOrgIdentity(slug, actorId)`, `json`, `handleError`, `AppError`, `{ data, error }` envelope.
- `src/lib/auth/{session,rbac,org}.ts` -- REUSE `getCurrentUser()`, `requireAdmin(user, adminClient)` (401/403). Same gate as `/api/invite` + Settings page.
- `src/lib/data/schema-mutate.ts` -- exemplar typed-table mutation (RLS client only, explicit identity, `actor_id`); mirror it. Do NOT use the generic JSONB `src/lib/data/mutate.ts`.
- `src/app/api/records/route.ts` + `records/schemas.ts` -- route exemplar: named exports, `export const dynamic="force-dynamic"`, sibling `schemas.ts`, slug in query (GET)/body (PUT).
- `src/app/[slug]/settings/page.tsx` + `src/components/settings/InviteForm.tsx` -- Admin-gated page (compose the new form below Invite) and form exemplar (`useState` flow, `role="alert"` errors, motion success, `useId`).
- `src/components/ui/{input,label,select,textarea,button,card,form}.tsx` -- REUSE (Tailwind v4, Radix, lucide, Framer Motion). No new design system.
- `src/components/import/ImportDropzone.tsx` + `src/app/api/import/analyze/route.ts` -- reference for an accessible file-input/dropzone + a multipart upload route (no Storage yet; adapt for the logo).
- Storage: none exists today. Introduce a private bucket + a small server-side storage helper (e.g. `src/lib/storage/`); read objects back via a short-lived server-minted signed URL or authenticated proxy. Never a public bucket.
- `src/types/db.ts` -- hand-written rows; add `BusinessProfileRow`.
- `src/lib/i18n/en.json` + `fr.json` -- add `BusinessProfile` namespace; real French, no em-dashes.
- `supabase/migrations/` -- add `YYYYMMDDhhmmss_business_profiles.sql` (latest `20260927130000_*`); follow CREATE TABLE + `enable row level security` + `auth_org_ids()` policy + header-comment convention from `20260924060000_pending_claims.sql` / `20260925170000_organizations_member_read.sql`. Apply via Supabase MCP (test project).
- `src/lib/schema/validator.ts` -- plain-language rejection pattern reference only; this story validates via Zod, not a new validator (`assertIssuable` is 12.4).
- Next.js 16.3.6, App Router, vitest (`tests/unit/`). Verify Next APIs against `node_modules/next/dist/docs/` before coding.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/{ts}_business_profiles.sql` -- create typed singleton `business_profiles` (UNIQUE `organization_id`, FK `on delete cascade`), typed columns for identity/tax/addresses/payment terms/default language + structured payment-instructions fields + nullable `logo_path`, `created_at`/`updated_at`/`actor_id`; enable RLS; add `auth_org_ids()` tenant-isolation policy. Entity type + language via text + `CHECK`.
- [x] `src/types/db.ts` -- add `BusinessProfileRow` mirroring every column.
- [x] `supabase/migrations/{ts}_business_profile_logos_bucket.sql` -- create a private Storage bucket for logos and its `storage.objects` RLS policies so only members of the owning org can read/write objects under their org prefix (mirror the `auth_org_ids()` tenant pattern). Apply via Supabase MCP.
- [x] `src/lib/data/business-profile-mutate.ts` -- guarded upsert of the singleton under the RLS-scoped client (explicit identity, records `actor_id`); never the admin client. Mirror `schema-mutate.ts`.
- [x] `src/lib/storage/logo.ts` -- server-side helpers: validate content-type (PNG/JPEG) + size (≤ 2 MB), upload under an org-scoped key returning `logo_path`, and mint a short-lived signed read URL (or proxy) for private display. RLS-scoped client, never service-role.
- [x] `src/app/api/business-profile/schemas.ts` -- Zod: legal name required; entity-type + language enums; GST/HST number ↔ effective-date pairing refinement; payment-instructions sub-object; failures carry `BusinessProfile.error.*` KEYs.
- [x] `src/app/api/business-profile/route.ts` -- `GET` (slug in query) returns profile or `null` (plus a private signed logo URL when `logo_path` is set); `PUT` (slug in body) upserts. Both: `getCurrentUser` → `resolveOrgIdentity` → `requireAdmin` (+ slug/membership match) before any DB access; guard body; map failures to matrix KEYs. `export const dynamic="force-dynamic"`.
- [x] `src/app/api/business-profile/logo/route.ts` -- Admin-only multipart `POST` that validates + stores the logo via `src/lib/storage/logo.ts` and persists `logo_path`; same auth gate; maps type/size failures to `BusinessProfile.error.logoInvalid`.
- [x] `src/lib/data/business-profile-client.ts` -- client GET/PUT helpers returning the profile or throwing a typed error carrying the translation key.
- [x] `src/components/settings/BusinessProfileForm.tsx` -- Admin-only form (loads via GET, saves via PUT) covering all fields + the Payment Instructions block + an accessible logo upload/preview (adapt `ImportDropzone`, posts to the logo route); labeled/keyboard-accessible, translated inline errors (`role="alert"`) + motion success; built per `/web-uiux-architect`.
- [x] `src/app/[slug]/settings/page.tsx` -- render `BusinessProfileForm` below `InviteForm`.
- [x] `src/lib/i18n/en.json` + `fr.json` -- add `BusinessProfile` namespace (title/subtitle, every field label + helper, Payment Instructions + logo labels, `error.*` incl. `logoInvalid`, success). Real French, no em-dashes.
- [x] `tests/unit/business-profile-schema.test.ts` + `tests/unit/route-business-profile.test.ts` -- vitest for every matrix row: schema validation (required legal name, GST/HST pairing, enum guards, logo type/size), and route gates (401/403 before access, GET-null vs existing, PUT create vs update, logo accept/reject, cross-org reject).

**Acceptance Criteria:**
- Given an Admin, when they save a valid Business Profile with a logo and reload, then every field (including Payment Instructions) persists to the org's single `business_profiles` row, the logo is stored privately with its key in `logo_path` and previews via a private read, and nothing is written to `records`/`org_schemas`.
- Given a non-Admin or unauthenticated caller, when they hit GET or PUT, then it returns `403`/`401` before any access.
- Given the `fr` locale, when the Business Profile screen renders, then all copy is real French via next-intl with no em-dashes and no hardcoded strings.

## Implementation Notes

- Applied migrations to the Supabase test project via MCP: `business_profiles` (20260929001728) and `business_profile_logos_bucket` (20260929001737). Security advisor shows no new findings for the new table/policy (its `business_profiles_tenant_isolation` policy is present); the remaining advisor items are pre-existing and unrelated.
- `/web-uiux-architect` polish pass on `BusinessProfileForm.tsx`:
  - Fixed a client error-mapping defect: the server returns the frozen fully-qualified key (`BusinessProfile.error.legalNameRequired` / `...registrationPairRequired` / `...logoInvalid`) for schema/logo failures, but `ERROR_KEYS` holds the short codes, so those specific translated messages never rendered (the user always saw the generic fallback). `resolveError` now normalizes off the `BusinessProfile.error.` prefix so the precise matrix message shows.
  - Scoped `aria-invalid` to the offending field only (legal name for `legalNameRequired`; the GST/HST number+date pair for `registrationPairRequired`) instead of marking the legal-name input invalid on any form-level error (WCAG: never flag a valid field).
  - Loading skeleton's screen-reader text now uses a dedicated `loading` key ("Loading your business profile..." / "Chargement de votre profil d'entreprise...") instead of the misleading "Saving...".

## Spec Change Log

## Review Triage Log

Review iteration 1 (blind-hunter, edge-case-hunter, verification-gap). No intent_gap/bad_spec → no loopback; all survivors routed to patch.

**Patched:**
- `medium` · **patch** · `route.ts` PUT validates the body (`putBodySchema.safeParse`) before `resolveAdminIdentity`, so an unauthenticated/non-admin caller with a malformed body gets `400` instead of `401`/`403` — diverging from the logo route (auth-first) and the records exemplar. Verified at route.ts PUT. Fix: authenticate/authorize before full-body validation (extract slug, then `getCurrentUser`→org→admin). [ECH, VG]
- `medium` · **patch** · `business-profile-mutate.ts` (insert-vs-update branch in `setBusinessProfileLogoPath`, `logo_path` omission + `onConflict` in `upsertBusinessProfile`) and `signLogoUrl` null-guard have zero test coverage — the route test mocks the whole module, so a regression ships green. Verified: no test imports the real module; sibling `schema-mutate.ts` is directly tested. Fix: add `tests/unit/business-profile-mutate.test.ts`. [VG, blind]
- `low` · **patch** · `schemas.ts` `optionalDate` regex `^\d{4}-\d{2}-\d{2}$` accepts impossible calendar dates (`2024-13-45`); via direct API a bad date reaches the Postgres `date` column → generic `500 writeFailed` instead of `400`, and the "must be a real calendar date" comment is false. (UI `<input type=date>` prevents it; Admin-only.) Fix: strengthen the existing refine to reject non-calendar dates. [blind, ECH]
- `low` · **patch** · `savedBody` (en+fr) is dead copy — never referenced (saved region renders only `savedTitle`). Fix: render it in the success confirmation. [blind]
- `low` · **patch** · stray `review-business-profile-full.png` (184 KB screenshot) present in the change set at repo root, not intended source. Fix: unstaged from the change (left on disk, surfaced to human — provenance unclear). [blind]

**Rejected:**
- `low` · logo-before-profile inserts a placeholder row with `legal_name: ""` — by-design and self-correcting (form requires legal name on the next save; empty string is clearly incomplete). The real gate against issuing a nameless invoice is 12.4 `assertIssuable` (out of scope). [blind, ECH, VG]
- `low` · "saved" confirmation not auto-cleared / stays after a logo change — a persistent success affordance is a defensible design choice; benign.
- `low` · no max-length / URL validation on free-text fields — `cardLink` is specified as *free text* in the frozen boundary, and length caps are unspecified hardening whose fix adds guards.
- `false` · cross-org rejection ordering — a non-member is rejected by RLS in `resolveOrgIdentity` (403) and a multi-org Admin by the `membership.slug` check (403); both correct, and a test already asserts the cross-org 403. No bad outcome.
- `low` · logo route trusts `File.type` (no magic-byte sniff) — Admin-only, private bucket, served as an image content-type via signed URL in `<img>` (no execution path); content-type is validated per spec.
- `low` · no retry affordance on a load error — a page refresh recovers; fix adds new UI surface.
- `low` · form is client-only with no SSR-injected initial data — consistent with the codebase's client-fetch pattern (records, invite); fix is architectural, not a direct correction.

## Verification

**Commands:**
- `npm run test -- tests/unit/business-profile-schema.test.ts tests/unit/route-business-profile.test.ts tests/unit/business-profile-mutate.test.ts` -- expected: all schema + route + mutation-layer edge-case tests pass; full suite stays green. **Result (post-review): 49 passed (schema + route + mutate + settings-page).**
- `npx tsc --noEmit` -- expected: no new type errors from Story 12.1 files. **Result: exit 0.**
- `npm run lint` -- expected: clean. **Result: exit 0.**

**Manual checks:**
- On `/[slug]/settings` as an Admin: save the Business Profile with a PNG/JPEG logo, reload, confirm all fields (incl. Payment Instructions) and the logo preview persist; try an SVG and a > 2 MB image and confirm a translated rejection; enter a GST/HST number without a date and confirm a translated pairing error; sign in as a Member and confirm the section is unreachable; toggle locale to `fr` and confirm copy is translated.
