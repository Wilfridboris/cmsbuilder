---
title: 'Branded Public Form'
type: 'feature'
created: '2026-10-04'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
context: []
baseline_commit: '3655d41cccb0db3694df393eeb0077732c61e1a9'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A published public form renders with only the bare `organizations.name` as an eyebrow. It carries none of the owner's branding: no logo, no business operating name, and no way for the owner to author an intro/info message, even though the `forms.intro_text` column already exists and the business profile already stores an operating name and a private logo. Clients can't recognize the form as the owner's.

**Approach:** Load the org's business profile (operating name + logo path) and the form's `intro_text` inside the single public resolver (`resolvePublicFormTarget`), and render a branded header on `IntakeForm`: logo, operating name (falling back to the org name), then the owner intro above the fields. Serve the private logo through a new published-gated, server-proxied public route that streams the bytes with the admin client (no public bucket, no signed-URL fork). Add an Admin editor card to author `intro_text` via a new guarded `updateFormIntroText` mutation.

## Boundaries & Constraints

**Always:**
- **Private-bucket posture is unchanged.** The logo is served ONLY through the new server-proxied route, which downloads the object with the service-role admin client and streams the bytes. No public bucket, no signed URL on the public surface. The route is **published-gated**: it 404s unless the org has at least one published form (`getPrimaryPublishedForm`), so an org's logo becomes publicly fetchable exactly when it has published something.
- **Graceful degradation, no broken image, no layout jump.** Missing logo → no `<img>` rendered at all (not a broken/empty box). Missing operating name → the brand name falls back to `organizations.name`. Missing/blank intro → nothing rendered in its place. The logo renders inside a bounded container with `object-contain` so any PNG/JPEG aspect ratio fits without distorting or shifting the layout.
- **One resolution authority.** Branding is resolved once, inside `resolvePublicFormTarget`, and added to `IntakeTarget`. Both public pages (keyed `/forms/{slug}/{formSlug}` and legacy `/forms/{slug}`) pass it through unchanged. The business-profile read is best-effort: any error leaves branding null and the form still renders (never throws to the public surface).
- **Server-authoritative intro editing.** `updateFormIntroText` writes through the existing `form-mutate.ts` guarded layer under the caller's RLS client + identity (`actor_id`/`updated_at` bumped), 404s a form id not in the caller's org, trims the value, and stores `null` when blank. The `/api/forms/[formId]` PATCH route re-runs the writable-admin gate and maps failures to `Forms.error.*` via the `{ data, error }` envelope. Intro text is editable while PUBLISHED (no lock — like field config; it never affects where responses land).
- **WCAG AA + i18n.** Logo `<img>` has non-empty alt text (the brand name, via an interpolated `IntakeForm` string). Intro renders with `whitespace-pre-line` + `text-pretty`; brand name uses `text-balance`. The editor Textarea has an accessible label, visible focus ring, pending spinner, and `role="alert"` / `role="status"` feedback matching sibling cards. All new copy resolves through the `Forms` and `IntakeForm` namespaces (EN + FR); no hardcoded strings; no em-dash. Intro length capped server-side at 500 characters.

**Never:**
- Do not add a DB migration: `forms.intro_text`, `business_profiles.operating_name`, and `business_profiles.logo_path` all already exist.
- Do not create a public storage bucket, mint a signed URL on the public form, or expose the storage object key. Do not change the resolver's strict published-only contract, the submission handlers, `middleware.ts` (`/api/*` is already excluded from the matcher), or any 14.1–14.5 mutation.
- Do not add intro text to `createForm` (stays `null` on create). Do not add abuse protection (14.7). Do not add a new image/upload dependency; reuse the existing logo storage helpers and a plain `<img>`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Full branding | Published form; profile has operating name + logo; form has intro | Header shows logo, operating name, intro above fields | N/A |
| No logo | Profile has operating name, no `logo_path` | Operating name + intro shown; no `<img>`, no empty box | N/A |
| No operating name | `operating_name` null/blank | Brand name falls back to `organizations.name`; logo/intro still honored | N/A |
| No business profile row | No `business_profiles` row for org | Falls back to org name, no logo; form renders normally | best-effort read → null |
| Logo proxy, published | `GET /api/forms/logo/{slug}`; org has a published form + `logo_path` | Streams bytes with correct `Content-Type` + long `Cache-Control` | N/A |
| Logo proxy, not published | Same route; org has NO published form | `404` (published gate) | no bytes, no internals |
| Logo proxy, no logo | Org published but `logo_path` null, or unknown org slug | `404` | no internals leaked |
| Save intro text | `PATCH /api/forms/{id}` `{introText}` for owner's form | `intro_text` persisted (trimmed; blank → null); `200 {id,slug}` | N/A |
| Intro too long | `introText` > 500 chars | `400 Forms.error.*`; nothing written | validation |
| Unknown / cross-org PATCH | `formId` not in caller's org, or Member | `404` / `403`; no internals | RLS-hidden |

</frozen-after-approval>

## Code Map

- `src/lib/data/forms-public.ts:44-70,162-169` -- `IntakeTarget` + resolver return. ADD `operatingName: string | null`, `logoUrl: string | null`, `introText: string | null`. In the resolver, after the form resolves, best-effort `admin.from("business_profiles").select("operating_name, logo_path").eq("organization_id", orgId).maybeSingle()`; set `logoUrl = logo_path ? \`/api/forms/logo/${encodeURIComponent(orgSlug)}\` : null`, `introText = form.intro_text`. Null on any error; do not throw.
- `src/app/api/forms/logo/[slug]/route.ts` -- NEW public `GET` (nodejs, `force-dynamic`). Resolve org by slug (admin client); 404 if none. Gate: `getPrimaryPublishedForm(admin, orgId)` → 404 if null. Load `business_profiles.logo_path` → 404 if null. Download bytes (new helper) → stream with `Content-Type` + `Cache-Control: public, max-age=3600`. Any error → 404 (never leak internals).
- `src/lib/storage/logo.ts:106-138` -- `downloadLogoDataUrl` (data-URL variant). ADD `downloadLogoBytes(client, logoPath): Promise<{ bytes: Buffer; contentType: string } | null>` deriving MIME from the key extension (png/jpg only), reusing the same size/empty guards; the route consumes this. Keep `LOGO_BUCKET`, `MAX_LOGO_BYTES`.
- `src/components/intake/IntakeForm.tsx:59-75,89,182-196` -- props + header. ADD `operatingName?`, `logoUrl?`, `introText?`. Compute `brandName = operatingName?.trim() || orgName`. Render (in `CardHeader`, in order): logo `<img>` when `logoUrl` (bounded `max-h` box, `object-contain`, alt via `t("logoAlt",{name:brandName})`), brand name eyebrow (`brandName`), existing heading + subtitle, then intro `<p className="whitespace-pre-line text-pretty ...">` when non-blank. Use `brandName` for `Confirmation owner`.
- `src/app/forms/[slug]/[formSlug]/page.tsx:38-46` & `src/app/forms/[slug]/page.tsx:40-46` -- pass `operatingName={target.operatingName} logoUrl={target.logoUrl} introText={target.introText}` to `IntakeForm`.
- `src/lib/data/form-mutate.ts:33-40,189-265` -- `FormMutateIdentity`, `updateFormSlug` (template). ADD `updateFormIntroText(identity,{formId,introText})`: `getFormById` 404; trim, blank → `null`; write `intro_text`+`actor_id`+`updated_at`; NO published lock.
- `src/app/api/forms/schemas.ts:74-119` -- Zod bodies + error-key list. ADD `introTextBodySchema = z.object({ introText: z.string().max(500) })` (empty string allowed to clear); register any new `error.*` key.
- `src/app/api/forms/[formId]/route.ts:84-149` -- PATCH dispatch (publish → target → fieldConfig → slug → rename). ADD an `introText` branch (discriminated by the `introText` key) after fieldConfig and before slug/rename.
- `src/lib/data/forms-client.ts:97-108` -- client wrappers. ADD `updateFormIntroText(slug, formId, introText)` mirroring `updateFormTarget`.
- `src/components/forms/FormEditor.tsx:453-461` -- INSERT a new intro-text `<Card>` (Textarea + Save) AFTER `FormFieldsEditor` and BEFORE `FormPublishShare`, owning its own `useTransition`/error/saved state like the slug/target cards. Reuse `src/components/ui/textarea.tsx`.
- `src/app/[slug]/forms/_shared.ts:110-184` -- `loadFormForEditor` already returns the full `FormRow` (incl. `intro_text`); no change, just read it in the editor.
- `src/lib/i18n/en.json` & `src/lib/i18n/fr.json` -- `Forms` namespace (~line 812): ADD intro-card copy (title, help, label, placeholder, save, saved, too-long error). `IntakeForm` namespace (~line 904): ADD `logoAlt` (interpolates `{name}`). EN + FR, no em-dash.
- `src/lib/data/forms.ts:39,97` -- `getFormById`, `getPrimaryPublishedForm` (reused by the mutation and the logo gate). No change.

## Tasks & Acceptance

**Execution:**
- [x] `src/lib/storage/logo.ts` -- add `downloadLogoBytes` (raw bytes + content-type, png/jpg) -- streamable logo read for the proxy.
- [x] `src/app/api/forms/logo/[slug]/route.ts` -- new published-gated public GET that streams the logo via the admin client with a long cache header -- preserves the private-bucket posture.
- [x] `src/lib/data/forms-public.ts` -- add `operatingName`/`logoUrl`/`introText` to `IntakeTarget`; resolve them (best-effort profile read + form intro) -- single branding authority.
- [x] `src/components/intake/IntakeForm.tsx` -- render branded header (logo, brand name, intro) with graceful degradation + alt text -- the public branding.
- [x] `src/app/forms/[slug]/[formSlug]/page.tsx` + `src/app/forms/[slug]/page.tsx` -- pass the new branding props -- both public surfaces branded.
- [x] `src/lib/data/form-mutate.ts` -- add `updateFormIntroText` (404 unknown id; trim; blank → null; identity bump; no lock) -- guarded intro write.
- [x] `src/app/api/forms/schemas.ts` + `src/app/api/forms/[formId]/route.ts` -- add `introTextBodySchema` + an intro-text PATCH branch after fieldConfig -- route the mutation with the admin gate + envelope.
- [x] `src/lib/data/forms-client.ts` -- add `updateFormIntroText(slug, formId, introText)` -- client wrapper.
- [x] `src/components/forms/FormEditor.tsx` -- new intro-text Card (Textarea + Save, pending/error/saved) between fields editor and publish/share -- the authoring UI.
- [x] `src/lib/i18n/en.json` + `src/lib/i18n/fr.json` -- add `Forms` intro-card keys + `IntakeForm.logoAlt` (EN + FR) -- no hardcoded strings, no em-dash.
- [x] `tests/unit/forms-public.test.ts` -- add cases: branding fields populated (operatingName, logoUrl when `logo_path` set / null otherwise, introText), and degrade when no profile row -- lock the resolver branding.
- [x] `tests/unit/forms-logo-route.test.ts` -- new: 404 unknown org, 404 when no published form (gate), 404 when no `logo_path`, bytes+content-type+cache header when present -- lock the proxy invariants.
- [x] `tests/unit/form-intro-text-mutation.test.ts` -- new: valid write (trim, blank → null), 404 unknown id, >500 rejected, identity/`updated_at` bump, writes while published -- lock the write invariants.
- [x] `tests/unit/forms-route.test.ts` -- add a case asserting `{introText}` dispatches to `updateFormIntroText` (not publish/target/fieldConfig/slug/rename) -- route dispatch coverage.
- [x] `tests/unit/intake-form.test.tsx` -- add SSR branding cases (full branding; no logo → no `<img>`; blank operating name → org-name fallback) -- cover the three render rows of the matrix (added during verification).

**Acceptance Criteria:**
- Given a business profile with an operating name and logo and a published form, when the public form renders, then it shows the logo (served through the published-gated server-proxied route, private bucket unchanged) and the operating name, with an owner-authored intro above the fields.
- Given no logo or no operating name, when the form renders, then it degrades to the organization name alone with no broken image and no layout jump, and an org with no published form gets a 404 from the logo route.
- Given the form editor, when an Admin saves intro text (including clearing it), then `intro_text` persists (trimmed; blank → null) via the guarded mutation and the public form reflects it; a non-admin or cross-org caller is rejected with no internals leaked.

## Implementation Notes

## Spec Change Log

## Review Triage Log

### Iteration 0 (2026-10-04)

- **`downloadLogoBytes` real body is never executed by any test** (verification-gap, pre-verified) — `low` / **patch**. `forms-logo-route.test.ts` mocks `@/lib/storage/logo`, so the extension→content-type mapping and the empty/oversize guards never run; a regression (e.g. `.jpeg`→null, or dropping the oversize guard) ships green. The sibling pure helper `validateLogo` IS directly unit-tested, establishing the repo convention. Routed patch (test-only).
- **Resolver stores a blank `operating_name` verbatim, contradicting its own contract** (blind-hunter) — `low` / **patch**. `resolvePublicFormTarget` does `operatingName = (profile.operating_name as string|null) ?? null`, so a stored `""`/whitespace becomes `operatingName: ""`, but `IntakeTarget.operatingName`'s doc says "null ... when the operating name is blank." No user-visible harm (the component applies `?.trim() || orgName`), but a future caller testing `=== null` for blank would diverge. Smallest fix: trim-to-null in the resolver. Routed patch (direct one-line correction).
- **Logo cache undermines the published gate after unpublish** (blind-hunter) — `low` / **patch**. `Cache-Control: public, max-age=3600` lets a shared/CDN cache keep serving an org's logo for up to an hour after it unpublishes, in tension with the frozen "publicly fetchable exactly when it has published something" invariant (the route 404s per request, but the cache does not). Non-sensitive branding, but a direct one-line correction (shorter TTL) honors the invariant. Routed patch.
- **`introTextBodySchema` adds a `slug` field not in the Code Map sketch** (blind-hunter) — **false**. The schema shape lives in the non-frozen Code Map, not the frozen intent; `slug` is the org gate required by the writable-admin check and matches every sibling body schema (`slugBodySchema`/`targetBodySchema`/`fieldConfigBodySchema`). No behavioral defect; the proposed fix edits this build's spec. Rejected.
- **fieldConfig-vs-introText dispatch precedence untested (silent swallow)** (blind-hunter) — **false**. Each client wrapper sends a distinct body (`{slug,fieldConfig}` XOR `{slug,introText}`); a combined body is never produced. The ordering is deterministic and mirrors the already-tested target/fieldConfig precedence (`forms-route.test.ts`). No reachable bad outcome. Rejected.
- **FormEditor intro card interactive path untested** (blind-hunter) — `low` / reject. Matches the established repo convention: the sibling slug/target/field-config cards and their client wrappers are likewise only covered at the server layer (the `intake-form.test.tsx`/`form-editor.test.tsx` env is node with no jsdom). Interactive coverage is net-new infra (more than a direct correction) and the convention is deliberate. Rejected.
- **Client wrapper `updateFormIntroText` untested** (blind-hunter) — `low` / reject. Same convention: no `forms-client.ts` wrapper has a unit test; the body shape is covered indirectly by the route dispatch test. Unlikely to regress silently given the server now requires `slug`; fix is net-new wrapper-test infra. Rejected.
- **`maxLength={500}` makes `introTooLong` unreachable from the UI; no char counter** (blind-hunter) — `low` / reject. The client cap is a reasonable guard; the server cap is defense-in-depth and is reachable + tested via the API. A counter is a net-new feature, not a direct correction, and there is no named harm. Rejected.
- **`alt=" logo"` when both operating and org names are empty** (blind-hunter) — **false**. `brandName` is `""` only if `org.name` is `""`, precluded by the claim-time invariant that an organization has a non-empty name; the logo also only renders for a published org with a stored logo. Requires a malformed row; fix guards an unreachable state. Rejected.
- **Unsanitized owner intro rendered on the public form** (blind-hunter) — **false**. React auto-escapes text-node children, so there is no injection; the `<p>` renders plain text with `whitespace-pre-line`. Abuse protection is explicitly deferred to 14.7 in the frozen "Never" list. A missing code comment is not a defect. Rejected.
- **Edge Case Hunter** — returned `[]` (no unhandled edge cases, no deletion regressions, no falsified claims).

## Design Notes

- **Logo proxy, not a signed URL.** The public form must not fork the private-bucket posture (12.1/12.5 keep logos private; admins get 5-minute signed URLs). So the public surface references a stable org-keyed route `/api/forms/logo/{orgSlug}` that re-checks the published gate per request and streams bytes with the admin client. The URL is org-stable, so a long `Cache-Control` is safe; the only staleness is a re-uploaded logo lingering up to the cache window, an acceptable trade for rare logo changes.
- **Resolve once.** Branding lives on `IntakeTarget` so both public pages stay thin pass-throughs and the submit handlers (which already read `IntakeTarget`) are untouched by the added optional fields.
- **Header order + degradation (per /web-uiux-architect, project semantic tokens — no hand-authored `dark:`):**
  ```tsx
  {logoUrl && (
    <img src={logoUrl} alt={t("logoAlt", { name: brandName })}
         className="mb-1 max-h-14 w-auto object-contain" />
  )}
  <p className="text-sm font-medium text-muted-foreground">{brandName}</p>
  <h1 className="text-2xl font-semibold tracking-tight text-balance">{t("heading")}</h1>
  <p className="text-sm text-muted-foreground text-pretty">{t("subtitle")}</p>
  {introText?.trim() && (
    <p className="text-sm text-foreground/80 whitespace-pre-line text-pretty">{introText}</p>
  )}
  ```
  Each piece is independently conditional, so any missing input simply drops out with no empty box or shift.
- **Mirror `updateFormSlug`.** The intro mutation/route/client/test shape copies the 14.x slug/target work (same identity, envelope, guard order) minus the published lock, so it inherits the proven pattern.

## Verification

**Commands:**
- `npm run lint` -- expected: passes, including `eslint-plugin-i18next` (no hardcoded strings) and the `server-only`/admin-client import gates.
- `npx tsc --noEmit` -- expected: no in-project type errors; new `IntakeTarget` fields, `downloadLogoBytes`, and `updateFormIntroText` resolve at all call sites.
- `npx vitest run forms-public forms-logo-route form-intro-text-mutation forms-route` -- expected: resolver branding, logo-proxy gate, intro write, and route dispatch edge cases green.

**Manual checks:**
- Set a business profile operating name + logo (Settings). In the form editor, author an intro and save; reopen to confirm it persisted; clear it and confirm it clears. Open the published public form (both `/forms/{slug}` and `/forms/{slug}/{formSlug}`) and confirm logo + operating name + intro render above the fields, mobile-first. Remove the logo and confirm the form degrades to the name with no broken image. Hit `/api/forms/logo/{slug}` for an org with no published form and confirm 404.
