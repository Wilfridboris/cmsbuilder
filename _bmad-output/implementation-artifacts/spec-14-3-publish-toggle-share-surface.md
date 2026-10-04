---
title: 'Publish Toggle & Share Surface'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: 'f00bcec4410e52d0f89ad70cb900ebb5d977e1a5'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Stories 14.1–14.2 gave an org multiple forms and a strict public route that only serves a form when `published = true`, but nothing can set `published`: every form is permanently unpublished, so every public intake surface returns "form not available". Admins also have no way to get a live form's link to a customer.

**Approach:** Add an Admin publish toggle (a `Switch`, off by default, gated until the form has a valid target table) in the form editor, backed by a guarded `publishForm` mutation on the existing `/api/forms/[formId]` PATCH route. Beside it add a share surface — copy-link with confirmation, a QR code, a preview-as-visitor link, and a prefilled "send to a client" share action — mirroring the existing `InvoiceDeliveryActions` pattern. Because publishing a form freezes its public URL, slug editing becomes locked once a form is published.

## Boundaries & Constraints

**Always:**
- The publish mutation is the sole authority on whether a form may be published. `published = true` is allowed only when the form has a **valid target table**: `target_table_key` is non-null, names a currently-visible table, and that table has at least one eligible intake field (`intakeFields(table)` non-empty) — the exact predicate the 14.2 public resolver requires to render, so a form can never be published into an immediate "not available" state. Otherwise the write is rejected with a translated key. Unpublishing is always allowed. The editor evaluates the same predicate server-side to disable the toggle with a reason; frontend disabling is never the only gate.
- Writes go through the existing `form-mutate.ts` guarded layer under the caller's RLS client and identity (`actor_id`/`updated_at` bumped), exactly like `renameForm`; the PATCH route re-runs the writable-admin gate before any DB access and maps failures to `Forms.error.*` keys via the `{ data, error }` envelope.
- Slug editing is allowed only while unpublished (the public URL freezes on publish): `updateFormSlug` rejects a slug edit on a published form and the editor disables the slug control with an unpublish hint. Title rename stays allowed in any state (the title never affects the link).
- The share surface derives the public URL client-side from `window.location.origin` after mount (via `useIsClient`, SSR-safe; no origin env var exists), building `{origin}/forms/{orgSlug}/{formSlug}` with per-segment `encodeURIComponent`. Copy uses `navigator.clipboard.writeText` with `aria-live` confirmation; share uses feature-detected `navigator.share` with a prefilled message, falling back to copy.
- The share surface (copy link, QR, preview, send) is shown only when the form is `published`; while unpublished the editor shows a short hint ("Publish this form to get a shareable link") and no live link. Preview opens the real public URL in a new tab — there is no unpublished/gate-bypassing preview (decision). The QR code is rendered with `react-qr-code` (pure SVG, zero runtime deps), the one new dependency this story adds (decision).
- WCAG AA: labelled controls, `>=44px` touch targets (`min-h-11`/`min-h-12`), visible focus rings, `aria-hidden` decorative icons, motion gated by `useReducedMotion`, mobile-first. All new copy resolves through the `Forms` namespace (EN + FR); no hardcoded strings; no em-dash.

**Never:**
- Do not add a migration or column (`published` already exists). Do not add a `published_at`. Do not touch `field_config`/`intro_text` or add branding/intro/logo (field customization is 14.4/14.5; branding is 14.6). Do not add target-table reassignment UI (14.4) — the target shown in the editor stays read-only.
- Do not change `src/middleware.ts`, the public route/resolver (14.2), or `mutate.ts`. Do not add honeypot/rate limiting (14.7). Do not introduce a toast library (reuse the `aria-live` inline-feedback pattern). Do not add a quick publish toggle to the list view; publish lives in the editor.
- Do not expose provider internals in any failure; a blocked publish surfaces only a non-technical reason.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Publish a valid form | `PATCH /api/forms/{id}` `{slug, published:true}`; form has a valid target table | `published=true` persisted; `200 {id,slug}`; the public form becomes reachable | N/A |
| Unpublish | `{slug, published:false}` | `published=false` persisted; `200`; public surface returns "not available" again | N/A |
| Publish blocked (no/invalid target) | `{published:true}`; `target_table_key` null, or names a hidden/deleted table, or table has no eligible fields | No write; `409 Forms.error.publishBlocked`; editor shows the toggle disabled with reason | No internals leaked |
| Editor render, not publishable | GET editor page, invalid target | Toggle rendered disabled; reason text shown; share surface shows the unpublished state | N/A |
| Slug edit on published form | `{newSlug}` while `published=true` | Rejected, no write; `409 Forms.error.slugLocked`; editor slug control disabled with hint | No write |
| Copy link | Published form, click copy | `{origin}/forms/{orgSlug}/{formSlug}` on clipboard; "Copied" `aria-live` confirmation for ~2.5s | `copyFailed` text on clipboard error |
| Preview as visitor | Published form, click preview | Opens the public URL in a new tab (`rel="noopener noreferrer"`) | N/A |
| Non-admin / cross-org | Member or cross-org admin hits PATCH | `403`; editor page already redirects to `/{slug}` | No internals leaked |
| Unknown / cross-org form id | `formId` not in caller's org | `404 Forms.error.notFound` | RLS-hidden |

</frozen-after-approval>

## Code Map

- `src/types/db.ts:632-664` -- `FormRow` (has `published: boolean`, `target_table_key: string | null`). No change.
- `src/lib/data/form-mutate.ts` -- guarded mutation layer; `FormMutateIdentity`, `FormMutateResult`, `renameForm` (the pattern to mirror). ADD `publishForm(identity, {formId, published})`.
- `src/lib/forms/publishability.ts` -- NEW. `evaluateFormPublishability(client, orgId, form)` -> `{ publishable, reason }` reusing `getSchema` (`src/lib/data/records.ts`), `visibleTables` (`src/lib/schema/overrides.ts`), `intakeFields` (`src/lib/intake/target.ts`). Shared by the mutation and the editor loader.
- `src/app/api/forms/[formId]/route.ts:46-102` -- PATCH; discriminates slug-edit vs rename. ADD a publish branch (checked first on a `published` boolean body).
- `src/app/api/forms/schemas.ts` -- Zod bodies + `firstFormErrorKey`. ADD `publishBodySchema` (`{slug, published:boolean}`).
- `src/lib/data/forms-client.ts` -- client fetch wrappers (`renameForm` pattern). ADD `setFormPublished(slug, formId, published)`.
- `src/app/[slug]/forms/_shared.ts:58-89` -- `loadFormForPage`. CHANGE to also return publishability: new `loadFormForEditor(slug, formId)` -> `{ form, publishable, reason }` (resolves org/client once, reads form, evaluates publishability).
- `src/app/[slug]/forms/[formId]/page.tsx` -- editor page; passes props to `FormEditor`. Wire the new loader + pass `published`, `publishable`, `reason`.
- `src/components/forms/FormEditor.tsx` -- Admin editor (rename/slug/target/delete cards, `useTransition` + inline `role="alert"`). Disable slug control when published (hint). Render the new publish+share component between Target and Delete.
- `src/components/forms/FormPublishShare.tsx` -- NEW client island: Publish card (`Switch` from `src/components/ui/switch.tsx`, gated/disabled + reason) + Share card (copy, QR via `react-qr-code`, preview, send), shown only when published. Mirrors `src/components/invoices/InvoiceDeliveryActions.tsx`.
- `package.json` -- ADD the `react-qr-code` dependency (pure-SVG QR, zero runtime deps).
- `src/lib/forms/share.ts` -- NEW pure helper `publicFormUrl(origin, orgSlug, formSlug)` (mirror `src/lib/invoicing/share.ts` `invoiceShareUrl`). Testable.
- `src/components/invoices/use-is-client.ts` -- reuse `useIsClient()` for SSR-safe origin.
- `src/lib/i18n/en.json:812-864` & `src/lib/i18n/fr.json` -- `Forms` namespace. ADD publish/share/error keys (EN + FR).

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/forms/publishability.ts` -- add `evaluateFormPublishability(client, orgId, form)` returning `{ publishable, reason: 'ok'|'no-target'|'invalid-target' }` -- single source of truth for the publish gate.
- [x] `src/lib/data/form-mutate.ts` -- add `publishForm(identity, {formId, published})`: load form; if `published===true` re-evaluate publishability and reject `Forms.error.publishBlocked` when not publishable; else update `published`+`actor_id`+`updated_at`; 404 on unknown id -- guarded publish write.
- [x] `src/lib/data/form-mutate.ts` (`updateFormSlug`) -- reject a slug edit when the existing form is `published` (`Forms.error.slugLocked`), before normalization -- freeze the public URL after publish.
- [x] `src/app/api/forms/schemas.ts` -- add `publishBodySchema` (`{slug, published:boolean}`) -- validated publish body.
- [x] `src/app/api/forms/[formId]/route.ts` -- add a publish branch to PATCH, checked before slug/rename -- route the publish mutation with the existing admin gate + envelope.
- [x] `src/lib/data/forms-client.ts` -- add `setFormPublished(slug, formId, published)` -- client wrapper mirroring `renameForm`.
- [x] `src/app/[slug]/forms/_shared.ts` -- add `loadFormForEditor(slug, formId)` returning form + publishability -- server-computed gate for the editor.
- [x] `src/app/[slug]/forms/[formId]/page.tsx` -- use `loadFormForEditor`; pass `published`/`publishable`/`reason` to `FormEditor` -- feed the toggle state.
- [x] `src/lib/forms/share.ts` -- add `publicFormUrl(origin, orgSlug, formSlug)` (per-segment encode) -- testable URL builder.
- [x] `package.json` -- add `react-qr-code` -- pure-SVG QR dependency.
- [x] `src/components/forms/FormPublishShare.tsx` -- new publish `Switch` (disabled+reason when not publishable; `useTransition`; inline `role="alert"`/`aria-live`) and share surface shown only when published (copy, QR via `react-qr-code`, preview-in-new-tab, Web Share with prefilled message + copy fallback; unpublished shows the publish-first hint) -- the story's UI, mirroring `InvoiceDeliveryActions`.
- [x] `src/components/forms/FormEditor.tsx` -- render `FormPublishShare`; disable slug input+save when published with an unpublish hint -- integrate publish/share and enforce slug lock in the UI.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add `Forms` publish/share keys and `error.publishBlocked`/`error.slugLocked` (EN + FR) -- no hardcoded strings, no em-dash.
- [x] `src/lib/forms/publishability.test.ts` + `src/lib/forms/share.test.ts` (+ publish-route/mutation coverage as the harness allows) -- cover the matrix: publish-blocked (null/hidden/no-eligible-fields target), publish/unpublish happy paths, slug-edit-on-published rejection, URL build + encoding -- lock the gate + URL invariants.

**Acceptance Criteria:**
- Given a form whose target table is valid, when an Admin flips the publish toggle on, then `published=true` is persisted, the public form at `/forms/{orgSlug}/{formSlug}` becomes reachable, and the share surface (copy link, QR, preview, send) activates with the correct absolute URL.
- Given a form with no valid target table, when the editor renders, then the publish toggle is disabled with a clear non-technical reason and a direct PATCH attempting to publish it returns `409 Forms.error.publishBlocked` with no write.
- Given a published form, when an Admin attempts to change its slug (UI or direct PATCH), then the slug control is disabled with an unpublish hint and the request is rejected with `Forms.error.slugLocked`, leaving the public URL intact; unpublishing re-enables slug editing.

## Design Notes

- **Reuse `InvoiceDeliveryActions` almost verbatim** (`src/components/invoices/InvoiceDeliveryActions.tsx`): copy-link + `aria-live` + `AnimatePresence`/`useReducedMotion` feedback, the `useIsClient` origin guard, and the `navigator.share` feature-detect-after-mount shape are exactly what this story needs. Do not re-solve them.
- **Switch, not a button.** Use `src/components/ui/switch.tsx` with an associated `<Label>`, off by default. Match `FormEditor`'s Card + semantic-token styling (`bg-card`, `text-muted-foreground`, `text-destructive`); do not hand-author `dark:` variants (the primitives theme via OKLch tokens — consistent with the 14.2 note against dark-mode variants).
- **QR renders only when a live `shareLink` exists** (published + client mounted): a pure-SVG code in a labelled `Card`/section.

## Verification

**Commands:**
- `npm run lint` -- expected: passes, including `eslint-plugin-i18next` (no hardcoded strings) and the `server-only`/admin-client import gates.
- `npx tsc --noEmit` -- expected: no type errors; new props and `publishForm`/`setFormPublished` resolve at all call sites.
- `npm test -- publishability share` -- expected: gate + URL-builder edge cases green.

**Manual checks:**
- In the editor for a form with a valid target: toggle publish on, confirm the badge/list shows Published, copy the link and open it (loads the public form), scan/inspect the QR encodes the same URL, click preview (new tab). Toggle off and confirm the public URL returns "form not available".
- For a form with no available table: confirm the toggle is disabled with a reason and the slug field is editable; publish a form and confirm the slug field becomes disabled with an unpublish hint.

## Implementation Notes

- **Test location deviation (justified):** the spec named `src/lib/forms/*.test.ts`, but the vitest config's `include` is `tests/**/*.test.{ts,tsx}` — co-located `src` tests would never run. The three test files live in `tests/unit/` (`forms-publishability.test.ts`, `forms-share.test.ts`, `forms-publish-mutation.test.ts`) so they actually execute. Coverage matches the spec's intent (gate predicate, URL builder, publish/unpublish/blocked, slug-lock, 404).
- **Published state lifted into `FormEditor`:** `FormPublishShare` owns the toggle but reports changes up via `onPublishedChange`, so the slug control locks in sync the moment publish flips (no page reload). `handleSlug` also early-returns when published (defense in depth behind the disabled control; the server rejects with `slugLocked` regardless).
- **Publish gate is server-authoritative and shared:** `evaluateFormPublishability` is the single predicate used by both the `publishForm` mutation (the write authority) and `loadFormForEditor` (the disabled-switch reason). It reuses the exact `visibleTables` + `intakeFields` check the 14.2 resolver uses and fails closed on a schema read error.
- **Verification (reality-checked against the diff):** `npx vitest run` on the 3 new files → 16/16 pass (full suite 1519/1519 per the implementer); `npx tsc --noEmit` → no in-project errors (2 pre-existing errors in the untracked `scheza-marketing-v1/` Astro subproject are unrelated); `npm run lint` → clean.
- **Matrix verification gap (for step-04):** logic-layer matrix rows (publish/unpublish, publish-blocked variants, slug-lock, unknown-id 404) are unit-covered. The UI-interaction rows (editor renders the toggle disabled with a reason; copy-link `aria-live` confirmation; preview-in-new-tab) and the pre-existing admin-gate 403 row are not unit-testable in this harness (no component-render rig — the constraint 14.2 documented). They are exercised by the Manual checks and should be validated in the post-commit Playwright manual review.

## Spec Change Log

_No bad_spec loopback occurred._

## Review Triage Log

### Pass 1 (review_loop_iteration 0)

- **Route publish-branch dispatch is untested** (verification-gap) — `medium`, PATCH. `forms-route.test.ts` mocks `form-mutate` without `publishForm` and no test body carries `published`, so the new publish branch (checked first) and its ordering vs slug/rename are unverified at the route layer; a mis-wire would ship green. → patch.
- **Share URL built from live unsaved `formSlug`** (blind-hunter + edge-case-hunter) — `medium`, PATCH. `FormEditor` passes its live slug-input state to `FormPublishShare`; an unsaved slug edit followed by publishing makes Copy/QR/Preview target an unpersisted slug (404), contradicting the AC's "correct absolute URL". → patch (feed the persisted slug).
- **`react-qr-code` added with a caret** (blind-hunter) — `low`, PATCH. The exact-pinned runtime deps (react, framer-motion, stripe, resend) establish the convention; the lockfile already resolves `2.2.0`. Trivial deletion of the caret. → patch.
- **Publish mutation test never asserts `updated_at` bump** (verification-gap, other) — `low`, PATCH (bundled). The mutator sets `updated_at`; the test only asserts `published`/`actor_id`. Trivial assertion. → patch.
- **Publish predicate duplicated with the 14.2 resolver** (blind-hunter + edge-case-hunter) — `low`, rejected. The spec required reusing the `visibleTables`+`intakeFields` primitives (done) and ONE predicate shared by the mutation and the editor loader (done — both call `evaluateFormPublishability`); cross-story dedup into `forms-public.ts` was never required. The ~3-line orchestration overlap is low-drift, both are test-locked, and extracting a shared helper that rewires 14.2 code is disproportionate. Not a this-story defect.
- **Two independent `published` states (editor + child)** (blind-hunter + edge-case-hunter) — `low`, rejected. They do not diverge in practice: the child owns the toggle and syncs the parent via `onPublishedChange`, and a prop change without remount is ignored by both equally. The fix restructures state ownership (more than a direct correction) for no reachable bug.
- **TOCTOU between publish read and write** (edge-case-hunter) — `low`, rejected. Fails safe: the 14.2 public resolver re-validates target/eligibility at request time, so a racing table deletion yields the already-handled "form not available", never bad data. A transactional re-check adds complexity for a benign, self-correcting outcome.
- **`navigator.clipboard` absent / no raw-link manual-copy fallback** (edge-case-hunter + blind-hunter) — `low`, rejected. Production and localhost are secure contexts (clipboard available); the `catch` already surfaces `copyFailed`. Adding a manual-copy UI is scope beyond the AC and unlikely to be reached.
- **`bg-white` on the QR container is hardcoded** (blind-hunter) — `false`/`low`, rejected. A QR code requires a light background to remain scannable; the fixed white panel is intentional and correct even in dark mode, not a token oversight.
- **`PUBLISH_ERROR_KEYS` duplicated; `slugLocked` dead in it** (blind-hunter) — `low`, rejected. The unused key is harmless (never matched on the publish path); a shared error-key constant adds public surface for negligible benefit.
- **Empty disabled-reason hint when reason is `ok`** (edge-case-hunter) — `false`, rejected. Unreachable: `evaluateFormPublishability` returns `ok` only with `publishable:true`, and the hint renders only when `!publishable`; no caller produces `ok` + not-publishable.
- **Dead `result.error` check in the route publish branch** (edge-case-hunter) — `false`, rejected. `publishForm` throws on failure (never returns `{error}`); the guard is intentional and identical to the sibling slug/rename branches.
- **Web Share `title` and `text` identical** (blind-hunter, note) — `low`, rejected. Mirrors the `InvoiceDeliveryActions` exemplar; cosmetic, platform-dependent, no functional harm.
