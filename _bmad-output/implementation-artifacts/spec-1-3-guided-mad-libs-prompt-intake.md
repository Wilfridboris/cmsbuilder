---
title: 'Story 1.3: Guided "Mad Libs" Prompt Intake'
type: 'feature'
created: '2026-09-24'
status: 'done'
route: 'dispatch'
baseline_commit: 'ae491f78ccd430388923817de6bd5428e1e702f1'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An anonymous visitor has no way to describe their business to the platform. Every downstream Epic 1 story (generation, fallback, dashboard) consumes a captured structured prompt that nothing produces yet, and the epic's zero-friction promise — describe your business, no account — has no entry point.

**Approach:** Build the hyper-minimalist landing "conversation" screen: a single-focus guided "Mad Libs" form (trade-type dropdown, city/town field, "what you track" field, one primary CTA) using react-hook-form + Zod + shadcn/ui, with submit-time accessible translated validation. On valid submit, persist a typed `GenerationIntent` payload to the anonymous client-side session seam that Story 1.4's `/api/generate` will consume — capturing input only; no account, email, generation, or dashboard.

## Boundaries & Constraints

**Always:**
- Single above-the-fold focus: only the guided prompt and its CTA. No pricing tiers, feature lists, testimonials, or marketing sections.
- Structured prompt = trade-type dropdown (fixed options: HVAC, Plumbing, Roofing, Snow Removal, Landscaping, Electrical, General Contracting, Other), a city/town text field, and a "what you track" text field.
- Trade-type is stored as a stable enum **key** (`hvac | plumbing | roofing | snow_removal | landscaping | electrical | general_contracting | other`); labels are translated via next-intl. The key + city are preserved verbatim in the payload to seed downstream Ontario localization.
- Validation runs **on submit only** (RHF `mode: 'onSubmit'` + `reValidateMode: 'onSubmit'`), never per keystroke. Messages are accessible (bound via shadcn `Form` → `aria-invalid` + `aria-describedby`) and resolved through next-intl in both EN and FR.
- The captured payload shape is `GenerationIntent = { tradeType, city, whatYouTrack, submittedLocale }`, validated by a shared Zod schema and persisted through a single typed helper — this is the seam Story 1.4 reads.
- Accessibility from the first component: real (non-placeholder) `<label>`s, `<fieldset>`/`<legend>`, keyboard-operable Radix-backed controls, WCAG AA contrast, `focus-visible` rings, ≥48×48px touch targets. All user-facing strings resolve through next-intl (no hardcoded copy).
- Stay on the shadcn New York / zinc token theme (`globals.css` oklch vars). CSS-first motion; Framer Motion only if an exit/shared-layout/gesture case genuinely needs it.

**Never:**
- No account, email, magic-link, credit-card, or PIPEDA-consent capture (Epic 2). No `organizations`/`org_members`/`records` writes — this story touches no database and no Supabase client.
- No LLM/Gemini call, `/api/generate` implementation, schema generation, provisioning, or dashboard rendering (Stories 1.4–1.6). This story only captures and hands off.
- No bespoke palette/typography from the design doc (deferred polish phase). No pricing/feature content. No language *detection* here — 1.4 detects language from the prompt text; 1.3 only preserves the raw input and UI locale.
- Do not add DOM/component or e2e test infrastructure (jsdom, Testing Library, Playwright) — `tests/e2e` is reserved for a dedicated later testing story.

**Decisions (resolved):**
- **"What you track" is a multi-line `Textarea`** (freeform description, 3–280 chars); city is a single-line `Input` (1–80 chars, no autocomplete/geocoding in MVP). "Other" trade selects the `other` key with no extra "specify" field — the free-text field carries specificity for 1.4.
- **Validation logic is pure and testable:** a `createPromptIntentSchema(t)` factory injects a translation resolver so the same schema powers both the RHF resolver and unit tests (called with an identity resolver).
- **Submit hand-off (OQ1 → Option A):** on valid submit, `saveIntent()` then `router.push('/generate')` to a NEW minimal placeholder route (`src/app/generate/page.tsx`) that reads the intent and renders a "Building…" skeleton stub — no LLM. Story 1.4 replaces the stub body with the real `/api/generate` pipeline. This story owns the route + skeleton stub only.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Valid submit | trade selected, city + "what you track" non-empty | `GenerationIntent` persisted via the intent helper; `router.push('/generate')` | N/A |
| Empty required field | one or more of trade/city/track blank on submit | Submit blocked; accessible translated inline message on each offending field; focus moves to first invalid | Field-level Zod error |
| Whitespace-only field | city or track = spaces | Treated as empty (schema trims); submit blocked | Field-level Zod error |
| Over-length input | city >80 or track >280 chars | Submit blocked with translated length message | Field-level Zod error |
| Locale FR active | UI locale = `fr` | All labels/options/CTA/errors render in French; `submittedLocale: 'fr'` captured | N/A |
| Intent round-trip | persisted payload re-read | `readIntent()` returns the exact `GenerationIntent`; absent/corrupt storage → `null` | Returns `null`, no throw |

</frozen-after-approval>

## Code Map

- `src/app/page.tsx` -- EXISTING minimal client landing (uses `Home` i18n namespace). REPLACE body to render `<PromptBuilder />` inside a minimal hero (headline + subhead from `Home`).
- `src/components/generation/PromptBuilder.tsx` -- CREATE. Client component (`'use client'`); the Mad Libs form. RHF + `zodResolver` + shadcn `Form`/`Select`/`Input`/`Textarea`/`Label`/`Button`. On valid submit → `saveIntent()` then hand-off per OQ1.
- `src/components/ui/` -- currently empty (`.gitkeep`). ADD via `npx shadcn add button input label select textarea form` (config present: new-york/zinc/RSC/lucide/TW v4). Do not hand-edit generated files.
- `src/lib/generation/intent.ts` -- CREATE. `TradeType` union + `GenerationIntent` type; `createPromptIntentSchema(t)` factory; `saveIntent(intent, storage?)` / `readIntent(storage?)` (JSON in `sessionStorage` key `snapbusy.generation.intent`; storage param injectable for tests; `readIntent` re-validates, returns `null` on absent/corrupt).
- `src/lib/i18n/en.json` / `fr.json` -- ADD a `PromptBuilder` namespace (field labels, placeholders, trade-option labels keyed by enum, CTA, validation messages) to BOTH catalogs. Extend `Home` hero copy if needed.
- `src/lib/utils.ts` -- REUSE `cn()`. `normalizeTableName()` is NOT used here (no keys persisted to the DB).
- `tests/unit/prompt-intent.test.ts` -- CREATE. Node-env unit tests for the schema + intent helper.
- REUSE conventions from `src/app/demo/page.tsx` (semantic HTML, `sr-only`, locale on `<html>`) and the next-intl wiring in `src/app/layout.tsx` + `src/lib/i18n/{config,request}.ts` (cookie `NEXT_LOCALE`, no URL prefix; `useTranslations`/`useLocale` on client).

## Tasks & Acceptance

**Execution:**
- [x] `src/components/ui/*` -- add shadcn `button input label select textarea form` via the CLI -- accessible Radix-backed primitives (first UI components in the repo).
- [x] `src/lib/generation/intent.ts` -- `TradeType`, `GenerationIntent`, `createPromptIntentSchema(t)`, `saveIntent`/`readIntent` (injectable storage) -- the typed capture contract + persistence seam consumed by Story 1.4.
- [x] `src/components/generation/PromptBuilder.tsx` -- the guided form: RHF `mode/reValidateMode: 'onSubmit'`, `zodResolver(createPromptIntentSchema(t))`, shadcn `Form` fields, `<fieldset>`/`<legend>`, 48px targets; on valid submit persist intent + hand off per OQ1 -- the landing "conversation" screen.
- [x] `src/app/page.tsx` -- replace body with a minimal single-focus hero rendering `<PromptBuilder />`; remove any pricing/feature/demo-link clutter -- above-the-fold single action.
- [x] `src/lib/i18n/en.json`, `src/lib/i18n/fr.json` -- add the `PromptBuilder` namespace (labels, trade options, placeholders, CTA, validation messages) to both -- i18n compliance, EN + FR.
- [x] `tests/unit/prompt-intent.test.ts` -- cover the I/O matrix mechanics that need no DOM: each empty/whitespace/over-length field → the expected field error; a valid input → parsed `GenerationIntent`; `saveIntent`→`readIntent` round-trip with a fake storage; corrupt/absent storage → `null` -- edge-case coverage.
- [x] `src/app/generate/page.tsx` -- minimal placeholder route reading the intent and rendering a skeleton "Building…" stub (no LLM); add its strings to the i18n catalogs -- the navigable hand-off seam Story 1.4 fills in.

**Acceptance Criteria:**
- Given the landing page loads, when rendered, then it shows only the guided prompt (trade dropdown with the 8 fixed options, city field, "what you track" field) and one primary CTA — with no pricing tiers or feature lists above the fold.
- Given a visitor leaves any required field empty (or whitespace-only), when they submit, then submission is blocked with an accessible, translated inline message per offending field, and no navigation/persistence occurs (validation on submit, not per keystroke).
- Given all fields are valid, when the visitor submits, then no account/email/credit-card is requested, a `GenerationIntent` (trade **key** + city preserved for downstream localization) is persisted through the intent helper, and the app navigates to `/generate` (skeleton stub).
- Given UI locale = FR, when the page renders, then every label, option, placeholder, CTA, and validation message is French and `submittedLocale: 'fr'` is captured.
- Given `npm run test`, when it runs, then the prompt-intent unit tests pass; and `type-check`, `lint`, `build` are green.

## Implementation Notes

**Delivered.** All seven tasks complete. `intent.ts` holds the typed contract (`TRADE_KEYS`, `GenerationIntent`, `createPromptIntentSchema(t)` factory, injectable-storage `saveIntent`/`readIntent`); `readIntent` re-validates with a locale-agnostic mirror schema (`storedIntentSchema`) and returns `null` on absent/corrupt/wrong-shape/out-of-range, never throwing. `PromptBuilder.tsx` uses RHF `mode`/`reValidateMode: 'onSubmit'` + `zodResolver`, shadcn `Form` (a11y error wiring via `aria-invalid`/`aria-describedby`), `<fieldset>`/`<legend class=sr-only>`, `min-h-12` (48px) targets; valid submit → `saveIntent({...values, submittedLocale: locale})` then `router.push('/generate')`. `/generate` is a client stub reading the intent via `useSyncExternalStore` (server snapshot `false` for stable SSR skeleton) and degrading to a "start over" link when no valid intent — never an error screen. `page.tsx` reduced to a minimal hero + `<PromptBuilder />`. `PromptBuilder` + `Generate` i18n namespaces added to en/fr.

**shadcn CLI deviation (justified).** `npx shadcn add` generated a broken `import { cn } from "cn"` in all six UI files and added a spurious `cn` npm package. Corrected the import to `@/lib/utils` and removed the bogus dependency — a broken import cannot satisfy the green-build AC; this is a path fix, not a behavioral hand-edit. The generated components use the unified `radix-ui` package (added to `package.json`).

**Verification (independently re-run against the diff).** `npm run test` → 29 pass (4 files; incl. 20 prompt-intent cases). `type-check`, `lint`, `build` all green; `/` and `/generate` both build. No stray `from "cn"` import remains.

**Matrix coverage note.** Every I/O-matrix row's node-verifiable logic (schema pass/fail per field, trimming, length bounds, save→read round-trip incl. absent/corrupt/invalid/out-of-range → `null`) is covered by passing unit tests. The purely DOM/interaction aspects (submit-block + focus-to-first-invalid, `router.push` navigation, FR label rendering) are verified by the spec's manual checks — the frozen boundary deliberately forbids adding DOM/e2e test infra in this story (reserved for the later testing story).

## Spec Change Log

## Review Triage Log

### Review pass 1 (2026-09-24)

**Patched (route: patch — re-derived by the implementation agent; verification re-run green):**
- **[patch] `storedIntentSchema` hardcodes the locale list** (BlindHunter + EdgeCase + VerificationGap, `intent.ts`) — VERIFIED duplicated source of truth: `storedIntentSchema` uses `z.enum(["en","fr"])` while `config.ts` exports `locales`/`isLocale`. Not a current bug (only en/fr exist), but adding a locale to config would silently make `readIntent` reject that locale. Fix is a direct simplification (derive from `locales`), no new surface → patched.
- **[patch] Trade `Select` never receives `field.ref`** (EdgeCase, `PromptBuilder.tsx`) — VERIFIED: the Radix `SelectTrigger` gets `onValueChange`/`value` but no `field.ref`, so RHF's focus-on-error cannot land on the trade dropdown — the spec's "focus lands on the first invalid field" AC fails for that field. Accessibility is first-class in this epic; fix is trivial (forward `field.ref`/`onBlur`) → patched.
- **[patch] `radix-ui` caret-pinned against the repo's exact-pin convention** (BlindHunter, `package.json`) — VERIFIED: `"radix-ui": "^1.6.7"` while every neighbour is exact-pinned; the caret lets Radix float on `npm update`, diverging from the reproducible-build convention. `package-lock.json` was regenerated (build green). Fix is a direct correction (drop the caret) → patched.

**Rejected:**
- **[false → reject] `submittedLocale` unchecked `useLocale() as Locale` cast loses invalid-locale submits** (EdgeCase, `PromptBuilder.tsx`) — REFUTED: `request.ts` returns `isLocale(cookieLocale) ? cookieLocale : defaultLocale`, so next-intl's active locale (and thus `useLocale()`) is always a configured `'en'|'fr'`. The off-list value the finding requires is unreachable.
- **[false → reject] `/generate` skeleton has no timeout/error path (permanent skeleton)** (BlindHunter, `generate/page.tsx`) — REFUTED: the permanent skeleton is the intended STUB behavior per the frozen OQ1-A decision; Story 1.4 replaces the stub body with the real pipeline + transition. Not a defect in this story.
- **[low → reject] `useFormField` guard is dead code / mis-ordered** (BlindHunter, `ui/form.tsx`) — real in the upstream shadcn snapshot, but the opaque-error outcome only occurs on misuse (a `FormLabel`/`FormControl` outside a `FormItem`) that does not exist in this codebase; the fix edits CLI-generated vendor code we are directed not to hand-edit.
- **[low → reject] No EN/FR key-parity test** (BlindHunter) — no current defect (catalogs are in parity); adds new test surface for a hypothetical future missing key (which next-intl surfaces at runtime). Enhancement, not a defect of this change.
- **[low → reject] Empty-`whatYouTrack` reuses the "at least 3 characters" message** (BlindHunter) — cosmetic UX nuance; the message still correctly guides the user, and the fix adds a new i18n key + schema branch. Not intolerable.
- **[low → reject] Submit navigates before confirming `saveIntent` persisted → dead-end on storage failure** (BlindHunter + EdgeCase) — reachable only when `sessionStorage` is entirely unavailable/throwing (rare; sessionStorage works even in private mode); degrades to the "start over" screen (never an error), which is the frozen design. Fix adds error-handling UI/branching for a rare state.
- **[out-of-scope → reject] No component/route (DOM) tests for `PromptBuilder`/`GeneratePage`** (BlindHunter; VerificationGap concurred not reportable) — excluded by the frozen "Never" boundary, which defers DOM/component/e2e test infra to a dedicated later testing story. Excluded by approved intent, not merely by the plan.
- **[low → reject] `/generate` loading state lacks `role="status"`/`aria-live`** (BlindHunter) — minor a11y nicety on a static stub that Story 1.4/1.6 replaces; the "Building…" heading is still readable via normal navigation. Not worth hardening a throwaway stub.
- **[low → reject] Orphaned `Home.title`/`Home.cta` catalog keys after the landing rewrite** (EdgeCase) — harmless dead keys; deleting them risks removing copy a later story may reuse. Negligible.

## Design Notes

**Motion.** Per the UI/UX discipline, none of 1.3's interactions require Framer Motion — hover/active/focus and any mount fade are CSS (`transition-*`, `@keyframes`). Reserve FM for the 1.6 skeleton "grow-into-dashboard" transition (exit/shared-layout), not here.

**Translated Zod.** `createPromptIntentSchema(t)` takes a resolver so error text lives in the i18n catalogs, not the schema. Example shape:
```ts
export const createPromptIntentSchema = (t: (k: string) => string) =>
  z.object({
    tradeType: z.enum(TRADE_KEYS, { message: t('validation.tradeRequired') }),
    city: z.string().trim().min(1, t('validation.cityRequired')).max(80, t('validation.cityTooLong')),
    whatYouTrack: z.string().trim().min(3, t('validation.trackRequired')).max(280, t('validation.trackTooLong')),
  });
```
Unit tests call it with `(k) => k` and assert on the returned key.

## Verification

**Commands:**
- `npm run test` -- expected: `tests/unit/prompt-intent.test.ts` passes (validation + intent round-trip).
- `npm run type-check` -- expected: `tsc --noEmit` passes.
- `npm run lint` -- expected: passes; no hardcoded user-facing strings; no service-role/Supabase import in this client path.
- `npm run build` -- expected: production build succeeds (landing + any placeholder route render).

**Manual checks:**
- Load `/` in EN and FR: only the guided prompt + CTA above the fold; labels/options/CTA translate.
- Submit empty → each field shows an accessible translated error; screen-reader announces via `aria-describedby`; focus lands on the first invalid field.
- Tab through the form with the keyboard only; every control is reachable and operable; focus rings visible. Touch targets ≥48px on mobile width.
- Submit valid → `sessionStorage['snapbusy.generation.intent']` holds the correct payload (trade key, city, track, locale) and the app navigates to `/generate` showing the skeleton stub.
