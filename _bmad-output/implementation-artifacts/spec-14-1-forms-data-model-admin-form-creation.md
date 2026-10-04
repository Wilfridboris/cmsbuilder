---
title: 'Forms Data Model & Admin Form Creation'
type: 'feature'
created: '2026-10-03'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '866eeb1d6c4ea1164e47c022d17dcea145be7731'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Scheza has exactly one auto-generated public intake form per dashboard (Epic 6); an owner cannot run more than one campaign, name a form, or point a form at the right table. Epic 14 turns intake into an owner-managed, multi-form tool — Story 14.1 is the walking skeleton: the `forms` data model plus Admin-only create/list/rename/delete, with no public behavior change yet.

**Approach:** Add one org-scoped platform table `forms` (whole Epic-14 schema in a single migration; 14.1 wires only the columns it needs) with RLS mirroring `business_profiles`. Add guarded create/list/rename/delete through a dedicated mutator + reader (never the JSONB `mutate.ts`), surfaced by Admin-only API routes and an Admin-only Forms area (list + minimal editor) in the dashboard. A form's slug is kebab-cased from its title and unique within the org; its target table is pre-filled by the existing intake-term heuristic (`selectIntakeTable`), authoritative-choice editing deferred to 14.4.

## Boundaries & Constraints

**Always:**
- `forms` is org-scoped with `UNIQUE (organization_id, slug)`; every form row belongs to exactly one org via `organization_id` FK `ON DELETE CASCADE`.
- RLS uses the single static membership policy `organization_id in (select public.auth_org_ids())` for both `using` and `with check`, identical in shape to `business_profiles`.
- All writes go through the caller's RLS-scoped client (never the service-role admin client) under the resolved Admin identity; every API route runs `requireUser()` → `resolveWritableAdminIdentity(slug, user)` (writes) / `resolveAdminIdentity` (reads) BEFORE any DB access.
- Form management is Admin-only, enforced server-side (403 for Members/non-members) independent of UI hiding; the Forms nav link and controls are hidden for Members.
- Slugs are kebab-case (lowercase, diacritics stripped, non-alphanumerics collapsed to single hyphens, trimmed), unique within the org, editable while unpublished, resolving collisions with a `-2`/`-3`… suffix. The DB UNIQUE constraint is the backstop; a unique-violation retries with the next suffix.
- All user-facing copy comes from the new `Forms` i18n namespace (EN + FR) plus the new `DashboardNav.forms` key; no hardcoded strings; no em-dash in copy. Every error returned to the client is a translation KEY via the `{ data, error }` envelope.

**Never:**
- Do not change public behavior: do not modify the existing public page `src/app/forms/[slug]/page.tsx` or the submission handler `src/app/api/intake/[slug]/route.ts`. Publishing, the per-form public route, share surface, field customization, branding, and abuse protection are out of scope (14.2–14.7).
- Do not let Members reach create/list/rename/delete (UI or API).
- Do not write form data through `src/lib/data/mutate.ts` (that layer is for the tenant JSONB `records` store only).
- Do not add a public bucket or signed-URL fork; no logo/branding work here.
- Do not populate `field_config` or allow target-table reassignment in this story (editor shows the heuristic-chosen target read-only).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Create happy path | Admin POSTs `{ slug, title: "Job Request" }`; org has a "Jobs" table | Row persisted: `slug="job-request"` (org-unique), `target_table_key` = heuristic pick, `published=false`, `field_config=[]`; returns `{ id, slug }` | N/A |
| Slug collision on create | Admin creates a second form titled "Job Request" | New row gets `slug="job-request-2"` | N/A |
| Empty/whitespace title | Admin POSTs blank title | Rejected before write | `AppError(400, "Forms.error.titleRequired")` |
| Title slugifies to empty (non-Latin only) | Title with no Latin alphanumerics | Slug falls back to a safe base (e.g. `form`), then org-uniqued | N/A |
| Edit slug — valid & free | Admin PATCHes slug to an org-unique kebab value on an unpublished form | Slug updated | N/A |
| Edit slug — taken | PATCH slug equals another form's slug in same org | Rejected; slug unchanged | `AppError(409, "Forms.error.slugTaken")` inline, non-technical |
| Edit slug — malformed | PATCH slug with spaces/symbols | Normalized to kebab then uniqueness-checked; if still invalid/empty, rejected | `AppError(400, "Forms.error.slugInvalid")` |
| Heuristic finds no table | Org has no visible tables | Form created with `target_table_key = null` | N/A (publish stays blocked in 14.3) |
| Rename | PATCH `{ title }` on existing form | Title updated; slug NOT auto-changed (slug edited separately) | N/A |
| Delete | Admin DELETEs a form | Form row hard-deleted; returns success | N/A |
| Member attempts any op | Member calls GET/POST/PATCH/DELETE | Rejected before DB access | `AppError(403, "forbidden")` |
| Unauthenticated | No session | Rejected | `AppError(401, "unauthorized")` |
| Cross-org form id | Admin PATCH/DELETE a `formId` not in their org | Not found under RLS; no write | `AppError(404, "Forms.error.notFound")` |

</frozen-after-approval>

## Code Map

Reuse:
- `src/lib/intake/target.ts` — `selectIntakeTable(schema): TableDefinition | null` (bilingual intake-term heuristic, pure). Use at create time to pre-fill `target_table_key`. Do not change.
- `src/lib/claim/slug.ts` — private `kebab()` + `ensureUniqueSlug()` (org-table/admin-client specific). Extract the kebab logic to a shared util (below); do NOT reuse `ensureUniqueSlug` (it targets `organizations` via the admin client).
- `src/lib/utils.ts` — home for the shared `kebabCase` helper (alongside `normalizeTableName`).
- `src/lib/api/route-helpers.ts` — `requireUser()`, `resolveAdminIdentity(slug,user)`, `resolveWritableAdminIdentity(slug,user)`, `json<T>()`, `handleError<T>()`, `OrgIdentity` ({ client, actorId, orgId }).
- `src/lib/auth/rbac.ts` — `requireAdmin` (already used by the resolvers; no change).
- `src/lib/supabase/server.ts` — `createServerSupabaseClient` (RLS client the identity carries).
- `src/types/db.ts` — add `FormRow` + `FormFieldConfig` types (hand-written, mirror the migration). `SchemaDefinition`/`TableDefinition`/`FieldDefinition` live here too.
- `getSchema(client, orgId)` (the `org_schemas.definition` JSONB reader used by `getIntakeTarget` in `src/lib/data/intake.ts`) — call with the RLS client + `orgId` in `createForm` to get the `SchemaDefinition`, then run `selectIntakeTable`.
- `src/components/ui/` — shadcn primitives: `button`, `input`, `label`, `card`, `dialog`, `table`, `badge`. `Switch` exists but is NOT used here (publish is 14.3).

Exemplars to mirror (pattern, not copy):
- `supabase/migrations/20260928120000_business_profiles.sql` — platform-table + RLS DDL shape.
- `src/app/api/invoices/route.ts` + `src/app/api/invoices/schemas.ts` — route auth chain, zod validation, `firstErrorKey` helper, `{data,error}` envelope, `force-dynamic`.
- `src/lib/data/business-profile-mutate.ts` — identity-agnostic mutator shape (`MutateIdentity`-style { client, actorId, orgId }).
- `src/app/[slug]/invoices/page.tsx` + `src/app/[slug]/invoices/_shared.ts` — Admin-gated dashboard page + `load*PageContext()` (gate with `requireAdmin`, redirect non-admin to `/{slug}`).
- `src/components/layout/DashboardNav.tsx` — Admin-only nav link inside `{isAdmin ? … : null}`, `getTranslations("DashboardNav")`.
- `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` — namespace structure.

## Tasks & Acceptance

**Execution:**
- [x] `supabase/migrations/<ts>_forms.sql` -- create `public.forms` (`id uuid pk default gen_random_uuid()`, `organization_id uuid not null references organizations(id) on delete cascade`, `title text not null`, `slug text not null`, `target_table_key text`, `published boolean not null default false`, `intro_text text`, `field_config jsonb not null default '[]'::jsonb`, `actor_id uuid`, `created_at`/`updated_at timestamptz not null default now()`, `unique (organization_id, slug)`, `index on (organization_id)`); enable RLS + single `forms_tenant_isolation` policy via `auth_org_ids()` -- whole Epic-14 schema in one migration, 14.1 wires title/slug/target_table_key.
- [x] `src/types/db.ts` -- add `FormFieldConfig` and `FormRow` types mirroring the migration -- typed access for mutator/reader/routes.
- [x] `src/lib/utils.ts` -- add exported pure `kebabCase(input): string`; refactor `src/lib/claim/slug.ts`'s private `kebab` to call it (behavior-identical) -- one slug normalizer, no duplication.
- [x] `src/lib/forms/form-slug.ts` -- `deriveFormSlug(title)` (kebabCase + safe fallback) and `ensureUniqueFormSlug(client, orgId, base, excludeFormId?)` querying `forms` scoped by `organization_id` under the RLS client -- org-scoped uniqueness with `-N` suffix.
- [x] `src/lib/data/forms.ts` -- reader: `listForms(client, orgId): Promise<FormRow[]>` (newest first), `getFormById(client, orgId, formId): Promise<FormRow | null>` -- RLS reads for pages + routes.
- [x] `src/lib/data/form-mutate.ts` -- guarded mutators `createForm(identity, { title })`, `renameForm(identity, { formId, title })`, `updateFormSlug(identity, { formId, slug })`, `deleteForm(identity, { formId })`; create derives slug + pre-fills target via `selectIntakeTable`; unique-violation retries next suffix -- single write seam, RLS client only.
- [x] `src/app/api/forms/schemas.ts` -- zod schemas (create/rename/slug/list) + `firstFormErrorKey` returning `Forms.error.*` keys -- validation, no inline strings.
- [x] `src/app/api/forms/route.ts` -- `GET` (list, `resolveAdminIdentity`) + `POST` (create, `resolveWritableAdminIdentity`); `force-dynamic` -- Admin-only list/create.
- [x] `src/app/api/forms/[formId]/route.ts` -- `PATCH` (rename / slug edit) + `DELETE`, both `resolveWritableAdminIdentity`; 404 key when the form is not in the caller's org -- Admin-only edit/delete.
- [x] `src/app/[slug]/forms/_shared.ts` -- `loadFormsPageContext(slug)` gating with `requireAdmin`, redirecting non-admin/non-member to `/{slug}` -- mirror invoices `_shared`.
- [x] `src/app/[slug]/forms/page.tsx` -- Admin-only Forms list + create entry point -- lists org forms, no public effect.
- [x] `src/app/[slug]/forms/[formId]/page.tsx` -- Admin-only minimal editor (title, slug edit, read-only target table, delete) -- home for slug edit before publish.
- [x] `src/components/forms/*` -- client components (list, create dialog, editor form) calling the API via a `src/lib/data/forms-client.ts` fetch helper; surface inline non-technical validation errors -- UI, built with the `/web-uiux-architect` skill (see Design Notes).
- [x] `src/components/layout/DashboardNav.tsx` -- add Admin-only Forms link (`/{slug}/forms`, lucide icon, `t("forms")`) inside the `{isAdmin}` block -- navigation.
- [x] `src/lib/i18n/en.json` & `src/lib/i18n/fr.json` -- add `Forms` namespace (titles, buttons, field labels, `error.*` keys, delete confirm) + `DashboardNav.forms` -- EN + FR, no hardcoded copy, no em-dash.
- [x] `src/lib/forms/form-slug.test.ts` (+ a mutator/route test as the harness convention allows) -- unit-test the I/O matrix edge cases: collision suffixing, diacritics, empty→fallback, org-scoping -- lock the slug invariants.

**Acceptance Criteria:**
- Given an Admin and an org with a visible intake-ish table, when they create a form titled "Job Request", then a `forms` row persists with `slug="job-request"`, `target_table_key` set to the heuristic table, `published=false`, `field_config=[]`, and the form appears in the Forms list.
- Given an unpublished form, when the Admin edits its slug to an org-unique value, then it is accepted; when the slug collides with another form in the org, then it is rejected with an inline non-technical message and the slug is unchanged.
- Given a Member (or unauthenticated caller), when they call any Forms API route or load the Forms page, then they are denied (403/401) and the Forms nav link is not rendered for them.
- Given any form operation, when it completes, then no change occurs to the existing public intake page or `/api/intake/[slug]` behavior.

## Design Notes

- **UI/UX construction (/web-uiux-architect standards):** Build the Forms list, create dialog, and editor to the elite-web-UI bar below. First match the existing dashboard pages (e.g. `src/app/[slug]/invoices`) for layout container, spacing, and whether dark-mode variants are used — do NOT introduce `dark:` variants if the app isn't already dark-mode-aware.
  - **Primitives:** compose only from `src/components/ui/` (shadcn/Radix): `Dialog` for create, `Card`/`Table` for the list, `Input`/`Label`/`Button` for fields, `Badge` for the target-table/draft chip. Merge classes with `cn()`.
  - **Tailwind v4 + 8pt grid:** spacing in multiples of 4 (`p-4`, `gap-6`); `size-*` not `w-*/h-*`; `text-balance` on headings, `text-pretty` on help text.
  - **Feedback states on every interactive element:** `hover:`, `active:`, and `focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2`. Icon-only buttons get `aria-label` / `sr-only` text; decorative Lucide icons get `aria-hidden="true"`.
  - **Motion — CSS first:** entrance/hover via Tailwind `transition-*` + CSS `@keyframes`; reach for Framer Motion only for dialog exit (`AnimatePresence`) if the shadcn `Dialog` doesn't already handle it. No FM for hover/list rendering.
  - **Async feedback (React 19):** use `useActionState`/pending state so create/rename/slug-save/delete show a spinner (`Loader2 animate-spin`) and disable the control while in flight; inline slug validation errors render under the field in a `text-destructive`/`role="alert"` region, never as a raw alert.
  - **Accessibility (WCAG AA):** text contrast ≥ 4.5:1, min 44x44px touch targets (expand with padding), mobile-first then `md:`/`lg:`. Destructive delete is confirmed via an `AlertDialog`/`Dialog`, not a native `confirm()`.
  - All copy from the `Forms` namespace; no hardcoded strings; no em-dash.
- **Why full schema now:** The `forms` table is created once with every Epic-14 column (incl. `published`, `intro_text`, `field_config`) so 14.2–14.6 need no follow-up migration; 14.1 simply leaves the later columns at their defaults.
- **Slug uniqueness under concurrency:** `ensureUniqueFormSlug` pre-checks, but the `UNIQUE (organization_id, slug)` constraint is authoritative — on a 23505 unique violation the mutator retries with the next `-N` suffix (mirrors the idempotency retry in `mutate.ts`).
- **Target heuristic is a suggestion:** `selectIntakeTable` pre-fills `target_table_key` at creation only; explicit owner reassignment is 14.4, so the editor shows it read-only here.

## Verification

**Commands:**
- `npm run lint` -- expected: passes, including `eslint-plugin-i18next` (no hardcoded strings).
- `npx tsc --noEmit` (or the repo's typecheck script) -- expected: no type errors; `FormRow` resolves everywhere.
- `npm test -- form-slug` (repo test runner) -- expected: slug edge-case tests green.
- Apply the migration on the local/test Supabase project and confirm `forms` exists with the UNIQUE constraint + RLS policy enabled.

**Manual checks:**
- As an Admin on `/{slug}/forms`: create a form, see it listed, open the editor, edit the slug (valid + colliding cases), rename, delete. As a Member: the Forms nav link is absent and visiting `/{slug}/forms` redirects to `/{slug}`.
- Confirm the existing public form at `/forms/{orgSlug}` and a submission to `/api/intake/{orgSlug}` behave exactly as before.

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **PATCH dispatch untested with a passing gate** (verification-gap) — `medium`, PATCH. `forms-route.test.ts` only exercises the 401/403 gate; the `slugBodySchema`-vs-`renameBodySchema` discrimination in `api/forms/[formId]/route.ts` never runs, so a swapped/broken dispatch ships green. → patch (add route tests).
- **POST blank-title → titleRequired untested at the route boundary** (verification-gap) — `medium`, PATCH. The matrix's empty-title row is verified only at the mutator (defense-in-depth); the real production path (zod `createBodySchema` → `firstFormErrorKey` → `titleRequired`) has no executed test. → patch.
- **createForm 23505 retry + getSchema-error branches untested** (verification-gap + blind-hunter #7/#8) — `medium`, PATCH. `form-mutate.test.ts` never returns a `23505` insert nor a `getSchema` error, so the concurrency backstop and the "surface schema-read error rather than null the target" guard are unverified; dropping either ships green. → patch (add mutator tests).
- **`patchBodySchema` is a dead export** (blind-hunter #1 / verification-gap other) — `low`, PATCH. Confirmed unused: `[formId]/route.ts` imports the two member schemas, never the union. Harmless clutter that could drift from real dispatch behavior; fix is a pure deletion. → patch.
- **Body parsed before `requireUser()` in POST/PATCH** (blind-hunter #3) — `low`, rejected. The DB-access-before-auth invariant holds; the forms routes mirror the invoices exemplar (parse, then auth) exactly, so "fixing" it would diverge from every sibling route. Platform caps body size; admin surface.
- **No max-length on `title`/`newSlug`** (blind-hunter #4) — `low`, rejected. Admin-only (trusted actor) + platform body-size cap; everyday harm negligible, and the fix adds new error-key surface (EN+FR).
- **PATCH with both `title` and `newSlug` silently drops title** (blind-hunter #2) — `low`, rejected. Unreachable from the app (the client sends exactly one shape); fix adds a guard for an undemonstrated state.
- **Whitespace-only `newSlug` → genericError instead of slugInvalid** (edge-case-hunter, low-confidence) — `low`, rejected. The UI guards empty slugs locally; only a direct non-UI API caller hits it, and still receives a 400 (no bad data). Fix adds a branch.
- **Delete-error focus/retry affordance** (blind-hunter #5) — `low`, rejected. The error is in a `role="alert"` region (auto-announced) and the Delete button remains for retry; no real harm.
- **FormsList refresh() failure collapses the list** (blind-hunter #9) — `low`, rejected. Transient, admin-only, reload recovers; fix adds non-destructive-error branching.
- **No test for readOnly-org admin on forms routes** (blind-hunter #6) — `low`, rejected. Not an I/O-matrix row; the `readOnly` throw is the shared `resolveWritableAdminIdentity` gate, already covered by `billing-access` tests.
- **Nav link lacks aria-current/active state** (blind-hunter #10) — `low`, rejected. Pre-existing across all dashboard nav links; not caused by this story and the new link is consistent with its siblings.
