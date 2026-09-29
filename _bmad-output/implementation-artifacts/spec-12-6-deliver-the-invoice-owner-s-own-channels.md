---
title: 'Story 12.6: Deliver the Invoice (Owner''s Own Channels)'
type: 'feature'
created: '2026-09-29'
status: 'done'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '250f05d099ac7d1764d2b1e42b98715e0f1d3882'
context:
  - '_bmad-output/implementation-artifacts/epic-12-context.md'
  - '_bmad-output/implementation-artifacts/spec-12-5-render-freeze-the-invoice-pdf.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** An issued invoice has a frozen PDF (`pdf_path`, Story 12.5) and an unguessable `share_token` (12.4), but the owner has no way to get it to the customer: there is no public link to the PDF, no email send path, and no share/download UI. The issued view also does not yet show the Payment Instructions the customer needs to pay.

**Approach:** Add the product's second (and only other) unauthenticated surface — a narrow `GET /i/[token]` route handler that matches `share_token` via the service-role client and STREAMS the frozen PDF bytes (I5), returning 404 for unknown/not-yet-frozen and 410 for void (I4). Add a client-island delivery bar on the issued view: native Web Share of the actual PDF file (falling back to sharing the `/i/[token]` link), Copy Link, Download PDF, and a desktop "Email invoice" that sends a strictly-transactional (CASL) Resend email with the PDF attached and reply-to the sending admin. Render the frozen Payment Instructions block on the issued view. No schema change; `share_token`/`pdf_path` are reused as-is.

## Boundaries & Constraints

**Always:**
- `/i/[token]` is a server route handler (`src/app/i/[token]/route.ts`) that looks up the invoice by exact `share_token` via the service-role client, reads the object at `pdf_path` from the private `invoice-pdfs` bucket, and STREAMS the bytes as `application/pdf` with `Content-Disposition: inline; filename="invoice-{number}.pdf"` and `Cache-Control: private, no-store` (I5). Never a redirect to a signed storage URL. Add `"i"` to `PUBLIC_TOP_LEVEL` in `src/middleware.ts` so the route is public; it exposes ONLY the PDF bytes, nothing else, and is reachable only with the token (non-enumerable).
- Status gating on the public route: unknown token or a matched invoice whose `pdf_path` is null → 404; a `void` invoice → 410 Gone (I4). Only `issued`/`paid`/`overdue` stream the PDF.
- Desktop email uses the Resend SDK `emails.send` (the app's first direct Resend send — mirror `scheza-marketing/src/lib/resend.ts`) with the frozen PDF attached (base64, filename `invoice-{number}.pdf`), `reply-to` = the acting admin's own email, subject + body resolved from the invoice's FROZEN `language` (not the viewer's cookie locale). Strictly transactional (CASL): no marketing copy, no unsubscribe/marketing footer, no tracking pixel. `from` = `RESEND_FROM_EMAIL`. Failures wrap in `AppError` (`502 sendFailed`) and never leak provider output.
- The email send route (`POST /api/invoices/[id]/send`) is Admin-gated (mirror the existing invoice API routes), reads the PDF bytes under the acting user's RLS client (never service-role, NFR-FC1), and calls `ensureInvoicePdf` first when `pdf_path` is null so a missing freeze is repaired before send.
- The delivery bar is a client island mounted on the issued view for `issued`/`paid`/`overdue` only (hidden for `draft` and `void`). Web Share uses `navigator.canShare({ files })` to share the actual PDF `File` (fetched from `/i/[token]`); when file-share is unsupported it falls back to `navigator.share({ url })` with the token link; Copy Link and Download PDF use that same token URL. Build the UI via the `/web-uiux-architect` skill: WCAG AA, `useReducedMotion` respected, reuse the existing `Button`/`Dialog`/Lucide primitives.
- The Payment Instructions block renders from the FROZEN `supplier_snapshot` (`payment_etransfer_email`, `payment_cheque_payable_to`, `payment_cheque_address`, `payment_card_link`) on the issued view (I6) — omitting fields that are null.
- All new user-facing copy (delivery labels, email subject/body, payment-instruction labels) added to `en.json` + `fr.json` with exact key parity, real French, straight apostrophes, no em-dashes.

**Never:**
- Never redirect `/i/[token]` to a signed storage URL, expose any invoice field beyond the PDF bytes there, or make it enumerable. Never render/read from live `records`/`business_profiles` post-issue (I6). Never use the service-role client for the owner's authed download/email actions.
- Never add marketing content, an unsubscribe link, or tracking to the invoice email (CASL transactional-only).
- Never re-mint or rotate `share_token`; never change the schema, the immutability trigger, or `ensureInvoicePdf`'s freeze logic.
- Never track payment or delivery status, persist a "sent" record, build credit notes (12.7/12.8), or integrate the WhatsApp Business API / an SMS gateway / owner-inbox (Phase 3). SMS is only the OS `sms:` / share-sheet carrying the `/i/[token]` link.

**Resolved decisions (from Open Questions):**
- Reply-to source: the acting admin's login email (`getCurrentUser().email`). `business_profiles` has no separate contact-email field, and the sender is the owner, so this is the only correct "owner's address."
- One serve path: the owner's Download PDF and Web-Share-file both fetch the public `/i/[token]` URL (the owner already holds the token) rather than a separate authenticated download route. `/i/[token]` renders inline; Download uses an anchor with the `download` attribute.
- Email recipient: the send dialog prefills a recipient from the customer snapshot ONLY when it holds an email-looking value, and the owner always confirms/edits before sending. Standalone invoices and email-less snapshots simply open with an empty, required recipient field. Never auto-send without the owner confirming the address.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Public link, frozen | `GET /i/{token}` for an issued invoice with `pdf_path` set | 200, streams the exact frozen PDF as `application/pdf`, inline filename | N/A |
| Unknown token | token matches no invoice | 404 | plain 404, no invoice data |
| Not yet frozen | matched invoice, `pdf_path` null | 404 (retryable once the owner re-triggers the freeze) | plain 404 |
| Void invoice | matched invoice, `status = void` | 410 Gone | plain 410 |
| Email send, happy | valid recipient, PDF exists | Resend send with attached PDF + reply-to admin; transactional; success | N/A |
| Email send, freeze missing | `pdf_path` null at send time | `ensureInvoicePdf` runs, then attaches; if still null → error | `500`, no send |
| Email send, bad recipient | recipient not a valid email | rejected before send | `400` validation |
| Email send, Resend fails | provider/SMTP error | no leak | `502 sendFailed` |
| Web Share unsupported | desktop, no `navigator.share` | Share button hidden; Email / Download / Copy shown | N/A |
| Copy Link | click | clipboard = `{origin}/i/{token}` | N/A |

</frozen-after-approval>

## Code Map

- `src/middleware.ts` -- ADD `"i"` to `PUBLIC_TOP_LEVEL` (line 26-35). `/i/*` is NOT matcher-excluded, so without this the route is treated as a protected tenant slug and bounced to `/login`.
- `src/app/i/[token]/route.ts` -- NEW public `GET` handler. Match `share_token` via `createAdminClient()`; branch 404 (unknown / null `pdf_path`) / 410 (`void`); download the object and stream it. Mirror the service-role read used in `src/app/demo/page.tsx`.
- `src/lib/data/invoices.ts` -- ADD `getInvoiceByShareToken(adminClient, token): Promise<InvoiceRow | null>` (`.eq("share_token", token).maybeSingle()`, mirroring the `finalizeClaim` token lookup in `src/lib/claim/claim.ts:161`). Do NOT touch RLS-scoped `getInvoiceWithLineItems` (line 69) for the public route.
- `src/lib/invoicing/storage.ts` -- ADD `downloadInvoicePdf(client, pdfPath): Promise<Uint8Array | null>` using `client.storage.from(INVOICE_PDF_BUCKET).download(pdfPath)` (mirror `downloadLogoDataUrl` in `src/lib/storage/logo.ts:106`). Reuse `INVOICE_PDF_BUCKET`; leave `uploadInvoicePdf`/`invoicePdfObjectKey` untouched.
- `src/lib/resend/send.ts` -- NEW `server-only`. `sendInvoiceEmail({ to, replyTo, language, invoiceNumber, pdfBytes, link })` via `new Resend(process.env.RESEND_API_KEY)` `emails.send` with `attachments: [{ filename, content }]` and `replyTo`. Model on `scheza-marketing/src/lib/resend.ts` (send shape) + `scheza-marketing/src/i18n/emails.ts` (html+text, localized). Wrap errors in `AppError`.
- `src/app/api/invoices/[id]/send/route.ts` -- NEW `POST`. Admin-gate via the existing `resolveAdminIdentity` pattern (`src/app/api/invoices/route.ts:63`); validate the recipient; load the invoice + snapshots under `identity.client`; `ensureInvoicePdf` if `pdf_path` null; `downloadInvoicePdf`; `sendInvoiceEmail(reply-to = getCurrentUser().email)`.
- `src/app/api/invoices/schemas.ts` -- ADD the send request schema (recipient email, zod-validated).
- `src/lib/data/invoices-client.ts` -- ADD `sendInvoice(slug, id, { to })` client fn (throws `InvoiceApiError`).
- `src/components/invoices/InvoiceDeliveryActions.tsx` -- NEW client island: Web Share (file→link fallback), Copy Link, Download PDF (anchor `download`), Email dialog. Props: `shareToken`, `invoiceNumber`, `language`, `customerEmailPrefill`. Reuse `src/components/ui/button.tsx`, `src/components/ui/dialog.tsx`, Lucide, `useReducedMotion`.
- `src/components/invoices/PaymentInstructionsBlock.tsx` -- NEW: render the frozen `supplier_snapshot.payment_*` fields; skip nulls.
- `src/components/invoices/IssuedInvoiceView.tsx` -- include `PaymentInstructionsBlock` (server component, reads the snapshot it already loads at lines 105-160).
- `src/app/[slug]/invoices/[id]/page.tsx` -- mount `InvoiceDeliveryActions` when `status` is `issued`/`paid`/`overdue` (line 22-61 branch).
- `src/lib/i18n/en.json` + `fr.json` -- ADD `InvoiceDelivery.*` (button/dialog labels, payment-instruction labels) and `InvoiceEmail.*` (subject, body, signature). Key parity, real French, no em-dashes.
- `.env.example` -- ADD `RESEND_FROM_EMAIL` (line ~19, near `RESEND_API_KEY`).
- Reference-only, do not modify: `src/lib/invoicing/pdf.tsx`, `src/lib/data/invoice-mutate.ts` (`ensureInvoicePdf`, `issueInvoice`), `src/lib/supabase/admin.ts`, `src/lib/auth/session.ts` (`getCurrentUser`). Confirm Resend SDK + route-handler streaming against `node_modules/next/dist/docs/` before coding.

## Tasks & Acceptance

**Execution:**
- [x] `src/middleware.ts` -- add `"i"` to `PUBLIC_TOP_LEVEL`.
- [x] `src/lib/data/invoices.ts` -- add `getInvoiceByShareToken`.
- [x] `src/lib/invoicing/storage.ts` -- add `downloadInvoicePdf`.
- [x] `src/app/i/[token]/route.ts` -- NEW public GET: token→PDF stream with 404/410 gating.
- [x] `src/lib/resend/send.ts` -- NEW `sendInvoiceEmail` (transactional, attachment, reply-to, localized).
- [x] `src/app/api/invoices/schemas.ts` + `src/app/api/invoices/[id]/send/route.ts` -- NEW admin-gated send route (validate recipient, ensure/download PDF, send).
- [x] `src/lib/data/invoices-client.ts` -- add `sendInvoice` client fn.
- [x] `src/components/invoices/InvoiceDeliveryActions.tsx` -- NEW delivery bar.
- [x] `src/components/invoices/PaymentInstructionsBlock.tsx` + `IssuedInvoiceView.tsx` -- render frozen payment instructions.
- [x] `src/app/[slug]/invoices/[id]/page.tsx` -- mount the delivery bar for issued/paid/overdue.
- [x] `src/lib/i18n/en.json` + `fr.json` -- add `InvoiceDelivery.*` + `InvoiceEmail.*` (parity, real French, no em-dashes).
- [x] `.env.example` -- add `RESEND_FROM_EMAIL`.
- [x] `tests/unit/invoice-email.test.ts` -- NEW: `sendInvoiceEmail` (Resend mocked) sends with the attachment, correct `replyTo`, and en/fr subject+body; a provider error surfaces as `AppError` with no leak.
- [x] `tests/integration/invoice-share-route-db.test.ts` -- NEW (real Supabase test project): issue+freeze an invoice, then `GET /i/{token}` streams a `%PDF`; an unknown token → 404; a null-`pdf_path` invoice → 404; a voided invoice → 410.

**Acceptance Criteria:**
- Given an issued invoice with a frozen PDF, when anyone opens `GET /i/{share_token}`, then the exact frozen PDF streams as `application/pdf` server-side with no redirect and no other data, and the route is public via `PUBLIC_TOP_LEVEL` (I5).
- Given an unknown token, a not-yet-frozen invoice, or a void invoice, when `/i/{token}` is requested, then the response is 404, 404, and 410 respectively (I4) — the void PDF is no longer reachable.
- Given the issued view on desktop, when the admin sends the invoice by email, then a strictly-transactional Resend email is sent to the chosen recipient with the frozen PDF attached and reply-to the admin's own address, in the invoice's frozen language, with no marketing content; a provider failure surfaces as a non-leaking `sendFailed` (CASL).
- Given the issued view, when it renders, then the frozen Payment Instructions block is shown (null fields omitted) and a delivery bar offers Web Share (PDF file, link fallback), Copy Link, and Download PDF — shown for issued/paid/overdue and hidden for draft/void, reading only the frozen snapshot + token (I6).

## Implementation Notes

- Public proxy `src/app/i/[token]/route.ts` (`runtime = "nodejs"`, `dynamic = "force-dynamic"`): matches `share_token` via `createAdminClient()` + `getInvoiceByShareToken` (no session on a customer device, so RLS can't apply — a documented narrow bootstrap read, same category as the pre-auth demo read), gates status (unknown/empty token or null `pdf_path` → plain data-free 404; `void` → 410; only issued/paid/overdue stream), reads bytes with `downloadInvoicePdf`, and returns them as a `Blob` with `Content-Type: application/pdf`, `Content-Disposition: inline; filename="invoice-{number}.pdf"`, `Content-Length`, and `Cache-Control: private, no-store`. NEVER a signed-URL redirect; exposes only PDF bytes. An unexpected error is reported and collapsed to a bare 404 (indistinguishable from an unknown token). Made public by adding `"i"` to `PUBLIC_TOP_LEVEL` in `src/middleware.ts`.
- `getInvoiceByShareToken(adminClient, token)` (`invoices.ts`): `.eq("share_token", token).maybeSingle()`, returns the full `InvoiceRow` or null (mirrors the `finalizeClaim` token lookup). `downloadInvoicePdf(client, pdfPath)` (`storage.ts`): best-effort private-bucket download → `Uint8Array | null` (mirrors `downloadLogoDataUrl`); used by BOTH the public proxy (admin client) and the owner's authed send (RLS client, NFR-FC1).
- `src/lib/resend/send.ts` (`server-only`, first direct Resend send): `sendInvoiceEmail({ to, replyTo, language, invoiceNumber, pdfBytes, link })` builds localized subject/body from the `InvoiceEmail.*` catalog picked by the FROZEN `language` (not the cookie locale), sends via `new Resend(RESEND_API_KEY).emails.send` with `from = RESEND_FROM_EMAIL`, `replyTo`, and `attachments: [{ filename: "invoice-{number}.pdf", content: <base64> }]`. Strictly transactional (CASL): no marketing copy, no unsubscribe/marketing footer, no tracking pixel. HTML is escaped; a plain-text alternative is included. Any provider error or thrown SDK call (or a missing `RESEND_FROM_EMAIL`) → `AppError(502, "sendFailed")` with no provider leak.
- Send route `POST /api/invoices/[id]/send` (`runtime = "nodejs"`): reuses the exact `resolveAdminIdentity` auth chain (401/403 before any DB access); validates `to` as an email (`Invoice.error.recipientInvalid`); loads the invoice under `identity.client` (never service-role); rejects non-issued/paid/overdue (`notDraft`/409); repairs a missing freeze via `ensureInvoicePdf` then re-reads `pdf_path`; downloads the PDF under RLS; sends with `reply-to = getCurrentUser().email` (the owner's login email — the only correct owner address; a missing email fails rather than sending unrepliable). Builds the `link` from `{origin}/i/{share_token}`.
- Delivery island `InvoiceDeliveryActions.tsx` (client, mounted in `page.tsx` for issued/paid/overdue only, hidden for draft/void; requires a `share_token`): Web Share fetches the PDF from `/i/{token}` and shares the `File` via `navigator.canShare({ files })`, falling back to `navigator.share({ url })`; the Share button is hidden entirely when `navigator.share` is absent. Copy Link + Download (anchor `download`) use the same `{origin}/i/{token}` URL. Email opens a dialog prefilling a recipient ONLY when the customer snapshot holds an email-looking value (regex heuristic in `page.tsx`), always owner-confirmed before send. Client/SSR mismatch avoided via a `useSyncExternalStore`-based `useIsClient()` (the hooks lint forbids setState-in-effect), so browser-only affordances light up post-hydration. WCAG AA: labelled controls, required recipient, `aria-live` feedback, `role="alert"` errors, motion gated by `useReducedMotion`, ≥44px tap targets. Reuses `Button`/`Dialog`/`Input`/`Label` + Lucide.
- `PaymentInstructionsBlock.tsx` (server): renders the frozen `supplier_snapshot.payment_*` fields (terms, e-transfer, cheque payable-to, cheque address, card link), omitting nulls; the whole block is omitted when none are set. Labels reuse the shared `InvoicePdf.*` namespace so the on-screen and printed labels agree. Mounted in `IssuedInvoiceView.tsx` after the totals.
- i18n: added `InvoiceDelivery.*` (button/dialog labels + `error.{recipientInvalid,sendFailed,genericError}`) and `InvoiceEmail.*` (subject/greeting/body/linkIntro/signature) to both `en.json` and `fr.json` with exact key parity; also added `recipientInvalid`/`sendFailed` to the existing `Invoices.error.*` (the send route returns those codes). Real French, straight apostrophes, no em-dashes. `.env.example` gained `RESEND_FROM_EMAIL`.
- No schema change: `share_token`/`pdf_path` reused as-is; no migration; `ensureInvoicePdf`'s freeze logic and the immutability trigger untouched.
- Matrix-audit closure (orchestrator pass, post-implementation): the email-route and delivery-UI matrix rows lacked covering tests, so two were added and a pure helper extracted. `src/lib/invoicing/share.ts` `invoiceShareUrl(origin, token)` now builds the `{origin}/i/{token}` link for BOTH the delivery bar and the send route (was inline in each). `tests/unit/route-invoice-send.test.ts` (9 cases, mirrors `route-invoices.test.ts`: happy send asserts reply-to = the admin's own email + the `/i/{token}` link; bad recipient -> 400; draft -> 409; freeze-missing-and-unrepairable -> 500; freeze repaired via `ensureInvoicePdf` -> 200; provider fail -> 502; 401/403 gating). `tests/unit/invoice-delivery-actions.test.tsx` (3 cases, SSR `renderToStaticMarkup` per repo convention: Email + Copy Link always render; the client-gated Web Share + Download controls are absent in the unsupported/first render = the "Web Share unsupported -> hidden" row; `invoiceShareUrl` value contract pins the Copy Link string). Re-verified: `tsc --noEmit` clean, `npm run lint` clean, `npm run build` exit 0, full suite 794 tests / 73 files green.
- Review iteration 1 patches (see Review Triage Log): added a `/i/[token]` public-pass-through case to `tests/unit/middleware.test.ts` [VG-1] and `Cache-Control: private, no-store` to the public route's 404/410 responses [BH-12]. Post-patch re-verification: `tsc --noEmit` clean, `npm run lint` clean, full suite 795 tests / 73 files green.
- Verification: `npx tsc --noEmit` clean; `npm run lint` clean; `npm run build` exit 0 (`/i/[token]` and `/api/invoices/[id]/send` appear in the route manifest; only the pre-existing OpenTelemetry/Sentry "critical dependency" warning). Full suite green: 782 tests / 71 files. New: `tests/unit/invoice-email.test.ts` (5 cases — en/fr subject+body from the frozen language, attachment base64 + `invoice-{number}.pdf` filename, `from`/`replyTo`, provider-error and thrown-SDK → `AppError(502, sendFailed)`, missing-`RESEND_FROM_EMAIL` fails with no send) and `tests/integration/invoice-share-route-db.test.ts` (4 real-DB cases against the test project — valid token streams `%PDF` as `application/pdf` inline/no-store; unknown token → 404; directly-inserted issued invoice with null `pdf_path` → 404; issued→void → 410).

## Spec Change Log

## Review Triage Log

Review iteration 1 (blind-hunter, edge-case-hunter, verification-gap). No intent_gap/bad_spec → no loopback. Two patches; the rest rejected (false or low).

**Patched:**
- `patch` · **verification gap** · No test drove the middleware with an `/i/` path, so dropping `"i"` from `PUBLIC_TOP_LEVEL` would 307 every customer invoice link to `/login` with a fully green suite (the integration test imports the route handler directly, bypassing middleware). Fix: added a `/i/[token]` unauthenticated pass-through case to `tests/unit/middleware.test.ts`. [VG-1]
- `low` · **patch** · The success PDF response sets `Cache-Control: private, no-store`, but the `notFound()` (404) and `void` (410) responses set no cache header, so an intermediary could cache a transient not-yet-frozen 404 past the freeze landing. Fix: added `Cache-Control: private, no-store` to both error responses. [BH-12]

**Rejected (false — verified the bad outcome cannot occur):**
- `false` · Send route builds a broken `{origin}/i/` link when `share_token` is null — unreachable: an issued/paid/overdue invoice always has a token minted at issue (I4), and the route 409s every non-deliverable status before the link is built; the `?? ""` is dead defensive code. [ECH-1]
- `false` · Public route could leak non-PDF invoice fields — structurally impossible: the handler only ever returns a PDF `Blob` or a plain-text 404/410; it never serializes any invoice field to any response. [BH-8]
- `false` · Content-Disposition header injection via the invoice number — `formatInvoiceNumber` yields only zero-padded digits or `""` (also confirmed null-safe by the edge-case layer), so no quote/CRLF can reach the header. [BH-9]
- `false` · An issued invoice shows no delivery UI at all — the bar gates on `share_token`, which is always present for an issued invoice (I4); the rare null-`pdf_path` case still shows the bar and is repaired by the email path's `ensureInvoicePdf`. [BH-3]

**Rejected (low — negligible harm and/or fix adds undemonstrated surface):**
- `low` · `notDraft` copy is imprecise for a void invoice on the send route — unreachable from the UI (the bar is hidden for void/draft); a distinct `notDeliverable` code adds i18n+code surface for a direct-API edge only. [BH-1]
- `low` · The delivery bar maps only `recipientInvalid`/`sendFailed`/`genericError`; other codes fall through to generic — the two everyday errors ARE mapped, the rest are rare, and "try again" is tolerable; fix adds i18n surface. [BH-2 / ECH-2]
- `low` · Recipient validation (400) runs before the admin check (403) — this is the EXACT house pattern of the sibling `/issue` and `/[id]` routes (authentication 401 still runs first); consistent, and the disclosure to an already-authenticated caller is just email-format validity. [ECH-3]
- `low` · The email link text `invoice-000123` is not localized — cosmetic; the surrounding `linkIntro` IS localized; fix adds an i18n key. [BH-4]
- `low` · No business name in the email body — the attached PDF carries full supplier identity and reply-to is the owner's address; adding it needs a new `sendInvoiceEmail` param + i18n. Polish, not a defect. [BH-5]
- `low` · A missing `RESEND_FROM_EMAIL` surfaces as `sendFailed` like a transient error — deploy-time only; the masked detail is logged via `reportError` for the operator to act on. [BH-6]
- `low` · The "`pdf_path` set but download fails → 404" branch is untested — a simple defensive degradation; the 200/404/404/410 matrix rows are covered; low value. [BH-7]
- `low` · Web Share has no loading state / size guard — the frozen PDFs are a few KB and fetch fast; adds complexity for no demonstrated need. [BH-10]
- `low` · `customerEmailPrefill` returns the first email-looking string — the frozen decision explicitly accepts a loose heuristic BECAUSE the owner always confirms before sending. [BH-11]
- `low` · `recipientInvalid`/`sendFailed` duplicated across i18n namespaces — a maintainability smell with no named runtime harm; dedup risks the other consumer. [BH-13]
- `low` · "Streams" vs buffers a Blob — the intent (a server proxy, never a signed-URL redirect) is satisfied; buffering a KB-sized PDF is fine; a `ReadableStream` adds complexity for no benefit. [ECH-5]
- `low` · `PaymentInstructionsBlock` renders `default_payment_terms` though the frozen Boundaries enumerated only the four `payment_*` fields — additive and clearly intended (payment terms are part of the profile, and the Impl Notes list it); removing it would be worse and a spec-only fix is barred. [ECH-6]
- `low` · Single-recipient only (`to` is not an array) — intended; no bulk-send requirement. [ECH-4]
- `low` · `PaymentInstructionsBlock` has no dedicated test — the verification-gap layer explicitly declined to classify this as a gap (brand-new component, no weakened prior coverage); deterministic null-filter, low regression risk. [VG-note]

## Design Notes

- Why stream through a server route rather than a signed URL (I5): revocation-on-void and non-enumerability must be enforced at request time. A signed storage URL would remain valid after a void and leak the storage layout; the proxy checks `status`/`pdf_path` on every hit and streams bytes the caller can never map back to a bucket path.
- Why the owner's Download/Web-Share reuse `/i/[token]` instead of a separate authed route: the owner already holds the token, the PDF is identical, and a single serve path avoids a second storage-read code path (and a second thing to keep in sync with the void/404 rules).
- Why Resend direct-send here when invites go through Supabase SMTP: an invite is an auth email GoTrue owns; an invoice email needs a PDF attachment, a per-invoice reply-to, and CASL-transactional framing that only a direct `emails.send` gives. This is the first such path; `scheza-marketing/src/lib/resend.ts` is the working reference.

## Verification

**Commands:**
- `npm run test -- tests/unit/invoice-email.test.ts tests/integration/invoice-share-route-db.test.ts` -- expected: pass; full suite stays green.
- `npx tsc --noEmit` -- expected: no new type errors.
- `npm run lint` -- expected: clean.
- `npm run build` -- expected: succeeds (route handler + Resend bundle in the Node runtime).

**Manual checks:**
- On the authed Admin fixture against the dev app: issue an invoice, open its issued view, confirm the Payment Instructions block and the delivery bar render. Copy Link → paste `/i/{token}` in a fresh (logged-out) browser → the PDF opens inline. Void handling and 404s are covered by the integration test. Email an invoice to a test address and confirm the PDF arrives attached, reply-to is the admin, and the copy is transactional; toggle `fr` and confirm real French with no em-dashes.

**Manual review (Playwright, post-commit) — verified.** On the authed Admin fixture `/session-1f4fa453` (registered-Ontario Business Profile "Maple Leaf Plumbing Ltd.") against the running dev app on `localhost:3000`, exercising the rich path (linked customer + logo + full payment instructions):
- Added the five Payment Instructions fields to the Business Profile (Net 30, e-transfer, cheque payable-to + mailing address, card link) and issued a NEW invoice **000005** linked to **Bytown Electrical**. The issued view rendered the frozen Payment Instructions block with all five rows (confirming the snapshot froze the fields and the block renders when populated — invoice 000004, issued before the fields existed, correctly shows no block), plus the delivery bar (Share / Email / Download PDF / Copy link).
- Public `GET /i/{token}` fetched cookieless (logged-out) returned **200 `application/pdf`**, `Content-Disposition: inline; filename="invoice-000004.pdf"`, `Cache-Control: private, no-store` (the review patch), and a valid `%PDF-1.3` body; an unknown token returned **404**. (Void→410 covered by the integration test — issuance is irreversible so no void invoice exists in the fixture.)
- **Copy link** wrote exactly `http://localhost:3000/i/{token}` to the clipboard (matches the Download href and `invoiceShareUrl`). The **Email** dialog opened prefilled with the linked customer's `hello@bytown.example` (the snapshot email-prefill decision); sending to Resend's simulated-success `delivered@resend.dev` returned success ("Invoice sent"), exercising the full route (RLS load → frozen-PDF download → Resend send with the PDF attached + reply-to the admin) against a live, verified `RESEND_FROM_EMAIL`. The `fr` email/PDF copy is covered deterministically by the unit tests. Note: issuance is irreversible by design, so this left a permanent issued **000005** in the dev fixture org.

**Manual review follow-up (branded logo on the sent invoice) — verified.** The first send (000005) used the fixture's 1x1 placeholder logo, so the PDF's embedded image was visually negligible. Re-verified with a real brand logo (`mark.png`, 1254x1254): replaced the Business Profile logo, then issued a NEW invoice **000006** (linked to Bytown Electrical) so its frozen snapshot + rendered PDF embed the new logo (an already-issued PDF is immutable, so only invoices issued after the logo change are branded). Cookieless `GET /i/{token}` returned the branded PDF at **426 KB with 3 `/Image` XObjects** (vs the placeholder invoice's ~3.3 KB / 1 image), confirming the real logo is baked into the header. Emailing 000006 to `delivered@resend.dev` returned **200** (`POST /api/invoices/[id]/send`), so the delivered transactional email carries the branded, logo-bearing PDF attached, reply-to the admin.
