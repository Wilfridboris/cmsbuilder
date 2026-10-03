---
title: 'Auto-Generated Public Intake Form'
type: 'feature'
created: '2026-10-02'
status: 'done'
route: 'dispatch'
baseline_commit: '42de958d40235047da3994b3a662c73cf524614f'
review_loop_iteration: 0
context: []
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A claimed dashboard has no public lead-capture channel. Owners who want to collect inquiries from a Google Business bio or a shared link must buy and wire a separate form tool, when the schema already describes exactly what they collect.

**Approach:** Auto-generate a public, no-auth, mobile-first intake form at `/forms/{slug}` whose fields are derived from the org's schema-designated intake table. This story delivers the public page only: resolve `{slug}` to an organization server-side with the service-role client (no session), load the schema, select the intake target table, and render one labelled, type-appropriate input per eligible field. The submission write, confirmation message, and inline validation are Story 6.2; real-time push (6.3), email (6.4), and payload-level relationship hardening (6.5) are later stories.

## Boundaries & Constraints

**Always:**
- `/forms/{slug}` is reachable with no login. Resolve `{slug}` to an `organization_id` server-side with the service-role admin client (`createAdminClient()`), never a session/RLS client — mirror the `/i/[token]` public pattern (`force-dynamic`, `runtime="nodejs"`, data-free failure).
- The page inherits the neutral root layout (no dashboard nav/chrome): a clean single screen with the business name and a clear heading/CTA.
- Rendered fields = `eligibleFields()` of the selected intake table minus `relation` fields. Each field renders its real `label` tied to the input via `htmlFor`/`id`; input type matches the field `type` using the existing `HTML_INPUT_TYPE` map + `inputModeFor()` (boolean→toggle). No placeholder-only labelling.
- Mobile-first and accessible: ≥48×48px touch targets (reuse `min-h-12` UI primitives); all copy translated via a new `IntakeForm` i18n namespace (en + fr); no em-dash.
- Relation fields never reach the public surface: no target-table ids, labels, counts, or pickers in markup or payload (pre-aligns with Story 6.5).
- **Intake table selection (decided):** `selectIntakeTable(schema)` picks the first `visibleTables()` entry whose `key`+`label` matches an intake-term pattern (lead/job/inquir/request/intake/contact/prospect/client/demande/rendez, case-insensitive, covering French), else the first visible table, else `null`.
- **Submit affordance (decided):** render the complete form including a visible submit button; its click handler is Story 6.2. The button is present (not disabled, not omitted) but performs no submission in 6.1.

**Never:**
- No submission write, POST handler, confirmation message, validation, or form-state coercion — all Story 6.2. No real-time (6.3), no email (6.4).
- No new DB table, migration, or runtime DDL (the form is derived from `org_schemas`); no change to RLS or the authenticated dashboard.
- Do not reuse `AddRecordForm` wholesale (dashboard-coupled); reuse the pure field-input helpers and UI primitives only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | GET `/forms/{slug}`, org has an intake table with eligible non-relation fields | Public page renders the business name, heading/CTA, and one labelled type-matched input per eligible non-relation field, in schema field order | N/A |
| Unknown / absent slug | GET `/forms/{unknown}` | A friendly "form not available" page, never an error screen; no DB/provider internals exposed | Data-free 404 semantics |
| No renderable fields | Org has no visible tables, or the intake table's only fields are hidden/relation | Friendly "nothing to collect yet / form not available" state | No crash, no empty broken form |
| Relation fields present | Intake table includes `relation` fields | Those fields are omitted from the rendered form and absent from markup/payload | N/A |
| French locale | `NEXT_LOCALE=fr` cookie (no session) | Form UI copy renders in French; field labels render as authored in the schema | Falls back to `en` when cookie absent/invalid |

</frozen-after-approval>

## Code Map

- `src/app/i/[token]/route.ts` -- the only existing public surface; copy its shape (service-role client, `force-dynamic`, `runtime="nodejs"`, data-free failure).
- `src/lib/supabase/admin.ts` -- `createAdminClient()`, the RLS-bypassing service-role client for slug→org resolution without a session.
- `src/middleware.ts:26-39` -- `PUBLIC_TOP_LEVEL`; add `"forms"` so `/forms/*` is not treated as a protected slug (`/api/*` already matcher-excluded).
- `src/lib/data/records.ts:95-118` -- `getSchema(client, orgId)` → `SchemaDefinition` (accepts the admin client; missing row → `{ tables: [] }`).
- `src/types/db.ts:11-162` -- `FieldDefinition` (key, label, `type` incl. `relation`, `hidden`), `TableDefinition`, `SchemaDefinition`.
- `src/lib/schema/overrides.ts:29` `visibleTables` + `src/lib/data/filter-sort.ts:42` `eligibleFields` -- reuse both; additionally drop `type === "relation"`.
- `src/lib/forms/field-input.ts` -- pure `inputModeFor(type)`; reuse.
- `src/components/dashboard/AddRecordForm.tsx:38-43,150-182` -- `HTML_INPUT_TYPE` map + per-type input shapes + `BooleanToggle`; mapping reference only (do NOT import — dashboard-coupled).
- `src/components/ui/{input,label,checkbox,textarea,button,card}.tsx` -- session-free primitives (`min-h-12`, label association) safe here.
- `src/app/demo/page.tsx` -- reference public page rendering a schema with next-intl server translations.
- `src/lib/i18n/{en,fr}.json` -- add an `IntakeForm` namespace.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/intake/target.ts` -- NEW pure, node-testable module: `selectIntakeTable(schema): TableDefinition | null` (intake-term heuristic over `visibleTables`, first-visible fallback, else `null` — see the decided boundary) and `intakeFields(table): FieldDefinition[]` (= `eligibleFields` minus `relation`). Framework-agnostic (no React/next-intl).
- [x] `src/lib/data/intake.ts` -- NEW server-only data function `getPublicIntakeForm(slug)`: resolve slug→org via `createAdminClient()` (`organizations.select("id, …").eq("slug", slug).maybeSingle()`), load schema via `getSchema`, run `selectIntakeTable`/`intakeFields`, return `{ orgName, tableLabel, fields }` or `null`. Never throw provider internals to the caller.
- [x] `src/app/forms/[slug]/page.tsx` -- NEW public Server Component: `force-dynamic`, call `getPublicIntakeForm`, render `IntakeForm` with the business name + fields, or the friendly unavailable state on `null`. Server translations via next-intl.
- [x] `src/components/intake/IntakeForm.tsx` -- NEW presentational form: render the heading/CTA, one labelled type-matched input per field, and a present-but-unwired submit button (handler is 6.2). Reuse UI primitives; no submission logic.
- [x] `src/middleware.ts` -- add `"forms"` to `PUBLIC_TOP_LEVEL` with a Story-6.1 comment.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add the `IntakeForm` namespace (header, CTA label, unavailable-state copy); no em-dash.
- [x] `tests/unit/intake-target.test.ts` -- NEW: cover `selectIntakeTable` (chosen strategy, incl. hidden tables and the no-table case) and `intakeFields` (drops hidden + relation fields, preserves order), plus the I/O matrix edge cases.

**Acceptance Criteria:**
- Given a claimed org with a slug and an intake table, when an unauthenticated visitor opens `/forms/{slug}`, then the page loads with no login and shows the business name and one labelled, type-matched input per eligible non-relation field (FR25).
- Given an org whose intake table has relation fields, when the form renders, then no relation picker, target-table ids, labels, or counts appear in the markup or any network payload.
- Given an unknown slug or an org with no renderable intake fields, when the page is requested, then a friendly unavailable state renders (never an error screen) and no DB/provider internals leak.
- Given `NEXT_LOCALE=fr`, when the page renders without a session, then the form UI copy is French and field labels render as authored.

## Review Triage Log

Pass 1 (blind-hunter + edge-case-hunter + verification-gap):

- **VG1 — `medium` → patch.** `src/middleware.ts` adds `"forms"` to `PUBLIC_TOP_LEVEL` but `tests/unit/middleware.test.ts` has no `/forms/{slug}` case (its public cases are `/login` and `/i/[token]`); a regression dropping the entry would 302 every public intake link to `/login?auth=required` with the full suite still green. Verified: the redirect branch (`middleware.ts:84-90`) fires for any non-public first segment. Fix: add a passthrough case mirroring the `/i/[token]` test.
- **BH1 — `false`.** Claim: `IntakeForm` using `useTranslations` without `"use client"` is a broken "server context" seam. Refuted: next-intl v4 `useTranslations` is isomorphic and resolves to the `react-server` build in an RSC; `src/lib/i18n/request.ts` + the root-layout `NextIntlClientProvider` are present; `tsc`/`lint`/tests pass and the edge-case layer independently traced the react-server resolution. RSC is a valid, lighter choice for a static presentational component.
- **BH2 — `low`, rejected.** `getPublicIntakeForm` returns `tableLabel` that the page does not consume. Real but harmless: it is explicitly specified in the Tasks return shape and documented as heading context; removing it would desync code from the spec for negligible benefit.
- **BH3 — `low`, rejected.** Empty `orgName` would render an empty eyebrow `<p>`. `organizations.name` is `text not null` (migration `20260924055022`, typed `name: string`), so the `?? ""` fallback is defensive and the empty case is unreachable in everyday use; the fix adds a branch.
- **BH4 — `low`, rejected.** Intake-term regex matches substrings (e.g. "Jobsite"). This is the human's frozen selection decision (exact pattern approved, misfire risk accepted) with a first-visible fallback; a word-boundary change contradicts the frozen boundary (out of scope by intent).
- **BH5 — `low`, rejected.** The page's `null → <Unavailable/>` branch has no dedicated test. Deterministic pass-through of two already-tested halves (`getPublicIntakeForm → null`; `Unavailable` renders); the verification-gap specialist explicitly judged it not a gap.
- **BH6 — `low`, rejected.** `reportError({ route: "/forms/[slug]" })` is a free-form string. Cosmetic; a shared-constant fix adds surface for negligible observability benefit, no everyday harm.
- **BH7 — `low`, rejected.** The boolean `radiogroup` lacks roving-tabindex/arrow-key nav and hardcodes `aria-checked={false}`. The options are native `<button>`s (individually focusable/operable); full radiogroup selection semantics require selection state, which the frozen Never defers to Story 6.2 (out of scope by intent).
- **BH8 — `low`, rejected.** French term list omits "soumission"/"devis". The term list is the frozen decision; the first-visible fallback handles unmatched French schemas (out of scope by intent).

## Design Notes

UI direction from the `web-uiux-architect` skill, adapted to this repo's established Shadcn "New York / zinc" system (oklch semantic tokens in `globals.css`, class-based dark mode, Geist, `tw-animate-css` present). Match the restrained demo-page vocabulary — do not introduce glassmorphism/bento or new color literals. Framer Motion is available but not needed here; use CSS-first motion.

- **Page shell:** full-height centered single column, no dashboard chrome. `main className="min-h-screen flex items-center justify-center bg-background px-4 py-10 sm:py-16"`, inner `w-full max-w-lg`. On mount, `animate-in fade-in slide-in-from-bottom-2 duration-500` (tw-animate-css).
- **Card:** reuse the `Card` primitive. `CardHeader`: business name as a muted eyebrow (`text-sm font-medium text-muted-foreground`), then the CTA heading (`text-2xl font-semibold tracking-tight text-balance`) and a one-line `text-sm text-muted-foreground text-pretty` subtitle. `CardContent`: fields. `CardFooter`: full-width submit.
- **Fields:** `flex flex-col gap-5`; each field is `<Label htmlFor={id}>` (`text-sm font-medium`) above its input with `gap-2`. Scalar inputs reuse the `Input` primitive at `min-h-12` (≥48px) with `type` from `HTML_INPUT_TYPE` and `inputMode` from `inputModeFor`. `boolean` renders a two-option Yes/No segmented control (`role="radiogroup"`, each option `min-h-12`), mirroring the dashboard `BooleanToggle` pattern. Native `date`/`datetime-local` inputs (mobile pickers). Semantic tokens only, so dark mode is automatic.
- **Submit:** full-width `Button size="lg"` (`min-h-12`) with a Lucide `Send` icon (`aria-hidden`) + translated label. In 6.1 it is present but unwired — use `type="button"` with no handler so it cannot accidentally submit before 6.2 wires it.
- **Unavailable state:** same centered card, a muted Lucide icon (e.g. `Inbox`, `aria-hidden`), a calm translated heading + sentence. Never error styling or a stack — mirrors the app's "degrade to friendly copy, never an error screen" rule.
- **A11y:** every input has a real associated `<Label>` (no placeholder-only); decorative icons `aria-hidden`; focus-visible rings come from the primitives; token contrast meets AA in both themes. All chrome copy from the `IntakeForm` i18n namespace (field labels come from the schema); no em-dash.

## Verification

**Commands:**
- `npm run lint` -- expected: clean.
- `npx tsc --noEmit` -- expected: no type errors.
- `npx vitest run tests/unit/intake-target.test.ts` -- expected: pass (selection + field-derivation + edge cases).

**Manual checks:**
- Start the dev server, open `/forms/{slug}` for a claimed org while logged out; confirm the form renders with correct labels/input types, ≥48px touch targets, no nav chrome, and that an unknown slug shows the unavailable state. Toggle `NEXT_LOCALE=fr` and confirm translated UI copy.

## Implementation Notes

- Files: `src/lib/intake/target.ts` (pure `selectIntakeTable`/`intakeFields`), `src/lib/data/intake.ts` (`getPublicIntakeForm`, server-only, service-role, never throws/leaks → `null`), `src/app/forms/[slug]/page.tsx` (public SC, `force-dynamic`+`runtime="nodejs"`), `src/components/intake/IntakeForm.tsx` (`IntakeForm` + `Unavailable` + shared `FormShell`), `src/middleware.ts` (`"forms"` in `PUBLIC_TOP_LEVEL`), `IntakeForm` i18n namespace in `en.json`/`fr.json`.
- `IntakeForm` is a Server Component (no `"use client"`): next-intl's `useTranslations` is isomorphic and there is no client state in 6.1. Boolean renders a `role="radiogroup"` Yes/No control (unwired, `aria-checked={false}`); the submit is `type="button"` with no handler and the `<form>` has no `action` — submission is Story 6.2.
- Unavailable cases render a 200 friendly `Unavailable` page (not an HTTP 404) by design, honoring the app's "never an error screen" rule; the matrix "data-free 404 semantics" note means no data leaks, not a literal 404 status.
- Matrix coverage: `tests/unit/intake-target.test.ts` (pure helpers), `tests/unit/intake-data.test.ts` (`getPublicIntakeForm` unknown-slug/errors/no-fields/happy-path), `tests/unit/intake-form.test.tsx` (SSR render: labels, type mapping, order, boolean, unwired submit, French, Unavailable). 33 tests pass; `tsc --noEmit` and `npm run lint` clean.
