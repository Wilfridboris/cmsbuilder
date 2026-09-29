---
title: Adversarial Architecture Review — Scheza Marketing Site
type: architecture-review
lens: adversarial (compatibility-under-obedience)
target: ARCHITECTURE-SPINE.md (architecture-marketing-site-2026-09-28)
reviewer: adversarial architecture reviewer
created: 2026-09-28
verdict: MAJOR — the spine is coherent at the "layer" altitude but the Lead-capture contract (AD-4/AD-5) is under-specified enough that two independently built, fully AD-compliant units create real security and data-integrity holes.
---

# Adversarial Architecture Review — Scheza Marketing Site

## Method

The spine is the only contract two builders share. Each "unit" below is built one level down (e.g. `islands/ReferralLink.tsx`, `lib/leads.ts`, `pages/api/send-invoice.ts`, the RLS policy, the i18n copy deck). For each scenario I assume **every builder obeys every AD to the letter** — no AD is violated — and then show the units still combine into a bug, an incompatibility, or a security hole. Each such gap is a hole in the *architecture*, not in a builder, and is closed with a new or tightened AD.

The recurring root cause: **AD-4/AD-5 make the browser the sole author of a trust-bearing record via an insert-only anon key, but never say which fields are trusted, how identity/dedupe is enforced, or who validates the insert.** "Insert-only RLS + publishable key" is a capability, not a contract. Several ADs then quietly assume a server-side authority (dedupe, opt-in integrity, attribution) that AD-5 has explicitly designed *out* of the write path ("no custom function is used for plain capture").

---

## H1 — [critical] The insert-only anon key lets the browser forge every trust-bearing field on the Lead

**Units (both AD-compliant):**
- Unit A: `lib/leads.ts` — the browser→Supabase insert-only client (AD-5). Obeys AD-4 (writes the exact `Lead` shape), AD-5 (insert-only, publishable key), AD-6 (only the anon key ships).
- Unit B: the RLS policy migration — grants `anon` **insert** on `leads`, denies select/update/delete. Exactly what AD-5 mandates: "insert-only RLS policy … no select, update, or delete for anon."

**Why they combine into a hole:** An insert-only RLS policy authorizes *the operation*, not *the values*. The publishable anon key is, by design, in every visitor's browser and in every bot's HTTP client. Nothing in AD-4/AD-5 constrains the column values, so any actor with the (public) anon key + table name can `POST` arbitrary rows:

- `source` — forge `source=referral` or `source=demo` on a bot insert, poisoning SM-1 (named waitlist) and SM-4 (pilot pipeline) counts and the follow-up queues those `source` values route to.
- `marketing_opt_in = true` — **forge consent.** This is the CASL hole (see H4): a row can assert opt-in the human never gave, and there is no server that witnessed the checkbox.
- `referrer_id = <any uuid>` — forge attribution / self-refer / stuff a competitor (see H3).
- `email` — insert anyone's email (enumeration of "is X on the list" is blocked by no-select, but writing bogus/other-people's emails is not).
- `created_at`, `locale`, `trade`, `city` — all free-form.

AD-10 says "the public lead insert … [is] protected by Cloudflare Turnstile + rate limiting." But **RLS cannot see a Turnstile token.** A raw insert with the anon key goes straight to PostgREST; Turnstile is only enforced if a *server* checks it *before* the write. AD-5 forbids exactly that server ("no custom function is used for plain capture; the browser inserts leads directly"). So AD-5 and AD-10 are in direct tension: **AD-10's guarantee is unenforceable given AD-5's write path.** A compliant builder of the RLS policy has no hook to require Turnstile; a compliant builder of the island can add Turnstile in the UI, but it protects nothing at the data layer.

**Proposed fix — tighten AD-5 + AD-10 (new AD-15):**

> **AD-15 — Public lead writes go through a validating capture endpoint, not raw PostgREST.** The browser does **not** hold a general insert grant. `anon` gets **no** direct DML on `leads`. All captures POST to a single edge endpoint (`api/capture-lead`) that (a) verifies the Turnstile token, (b) validates the payload against the `Lead` schema and rejects unknown/forbidden fields, (c) **derives** `source` from the endpoint call context and **ignores any client-sent `source`, `referrer_id`, `created_at`**, (d) sets `marketing_opt_in` only from an explicit boolean it re-validates, then (e) writes using a scoped server credential. This supersedes AD-5's "browser→Supabase direct insert." AD-5 is amended: "insert-only" now describes the *endpoint's* capability, and the client never receives insert rights.

This is the smallest change that makes AD-10 actually enforceable. It costs one more endpoint — which AD-3 forbids ("endpoints exist only for secrets"). So **AD-3 must also be amended**: an endpoint is justified by a server-held secret **or an integrity/abuse guarantee that cannot be enforced client-side.** (Turnstile verification, dedupe, and consent integrity are exactly that.) Note the endpoint already effectively exists: `send-invoice` is a write path with a secret and Turnstile; generalizing the pattern is cheap. If the owner insists on keeping raw insert for cost/simplicity, the fallback is a Postgres `BEFORE INSERT` trigger/`CHECK`/RLS `WITH CHECK` that pins `source` per key and forbids client `referrer_id`/`marketing_opt_in` — but that cannot verify Turnstile, so it does not close the abuse vector. The endpoint is the correct fix.

---

## H2 — [critical] Dedupe is promised by the PRD but architected out of existence

**Units (both AD-compliant):**
- Unit A: waitlist island → `lib/leads` insert. FR-2 consequence: "Duplicate email does not create a duplicate Lead; it updates the existing record."
- Unit B: calculator island → `lib/leads` insert with `source=calculator`. Same person, same email, later.

**Why they combine into a bug:** AD-5 grants the client **insert only** — explicitly *no update*. FR-2 requires an **upsert** ("updates the existing record"). These are contradictory: a builder obeying AD-5 *cannot* implement FR-2's dedupe, because upsert = update, which anon is denied. AD-5 even says dedupe "[is] handled server-side out of band, never by granting the client more than insert." "Out of band" means *after the fact* — so at write time, two capture points for the same human create **two rows** with different `source`. Consequences:

- SM-1 counts "named waitlist size" — double-counts anyone who used both the waitlist and the calculator.
- SM-2 referral coefficient (referred signups ÷ referring leads) is computed over a table with duplicate humans → inflated/garbage.
- Consent state is now split across ≥2 rows: row 1 (`waitlist`, `marketing_opt_in=false`), row 2 (`calculator`, `marketing_opt_in=true`). **Which row is authoritative for "may we email this person marketing?"** is undefined. An unsubscribe (AD-9) that flips one row leaves the other saying opt-in=true → CASL violation by construction (see H4).

The "out of band" dedupe job also has no defined merge/consent-precedence rule, so two builders (the insert path and the batch dedupe job) each obey their ADs and still disagree on the truth.

**Proposed fix — new AD-16 (identity + consent precedence), enabled by AD-15's endpoint:**

> **AD-16 — Email is the Lead identity; consent is monotonic and merge-defined.** `leads.email` (normalized: trimmed, lowercased) has a unique constraint. The capture endpoint (AD-15) performs an atomic upsert keyed on email. Merge rules are fixed here, not per-job: `marketing_opt_in` is **true iff the latest explicit opt-in is true and no later unsubscribe exists** (never silently downgraded by a later transactional-only capture, never upgraded without an explicit checkbox); `referrer_id` is **write-once** (first non-null wins; see H3); `source` accumulates as a set or keeps first-touch (owner-defined, but defined). Without AD-15's endpoint this AD is unimplementable (anon cannot upsert), so AD-16 depends on AD-15.

---

## H3 — [high] Referral attribution: self-referral, replay, and referrer forgery all pass every AD

**Units (both AD-compliant):**
- Unit A: `islands/ReferralLink.tsx` — generates the invite link for a Lead (FR-11). To build a link it needs a stable per-Lead identifier in the URL. The only identifier the `Lead` shape offers is `id` (a UUID). So the link is `?ref=<lead uuid>`.
- Unit B: the arriving-visitor capture island — reads `?ref=` and writes `referrer_id = <that uuid>` with `source=referral` (FR-11 consequence: "referred signups are attributed … referrer id recorded"). Fully AD-4/AD-5 compliant.

**Why they combine into holes:**

1. **Referrer id is a guessable/forgeable capability.** If the link carries the raw `lead.id` UUID, then (a) any value in `?ref=` is accepted and written (H1), and (b) the referrer's `id` is now exposed in a URL the referrer texts around — combined with H1's forge-any-`referrer_id`, an attacker can attribute thousands of fake signups to a chosen referrer to farm perks, or to a *rival* to trip anti-abuse and get them penalized. AD-4 says `referrer_id` is a `uuid` FK to `leads` — it does not say it must be *unforgeable* or *server-issued*.
2. **Self-referral.** Nothing forbids `referrer_id == (the new row's own identity)` or a two-account loop (same person, two emails, refer each other). AD-4/AD-5 are silent; the Deferred section even says "self-referral/abuse rules are owner-defined" — i.e. the *architecture explicitly punts*, so two compliant builders ship a loop that mints perks.
3. **Replay / over-counting.** FR-11 wants a "referral coefficient." With client-authored inserts (H1) and no idempotency (H2), one referred human who submits twice, or a script that replays the insert N times, counts as N referrals. AD-10's rate-limit is per-IP/time and does not dedupe identities.
4. **Attribution before consent.** A `source=referral` row can be written with `marketing_opt_in=true` forged (H1+H4), so the perk-granting *and* the marketing list are both poisoned in one insert.

**Proposed fix — new AD-17 (referral integrity):**

> **AD-17 — Referral tokens are server-issued, opaque, single-subject, and non-self.** The invite link carries an **opaque referral token** (not the raw `lead.id`) minted by the capture/referral endpoint and mapped server-side to the referrer. On a referred signup the endpoint (AD-15) resolves the token → `referrer_id`; the client never sets `referrer_id` directly. The endpoint **rejects self-referral** (resolved referrer == the new lead's email/identity) and enforces **one attribution per referred email** (idempotent on AD-16's unique email). Perk-eligible counting is defined over distinct attributed emails, not raw rows. Fraud-perk *fulfillment* stays deferred, but *attribution integrity* is fixed here so the deferred work builds on sound data.

---

## H4 — [critical] CASL consent has no witness — opt-in and unsubscribe are both corruptible

**Units (both AD-compliant):**
- Unit A: waitlist/calculator islands — render the "unticked-by-default" opt-in checkbox (AD-9) and send `marketing_opt_in` + a timestamp on insert. Perfectly obeys AD-9's UI rule.
- Unit B: the marketing-email sender (out-of-band per AD-5/AD-9) — reads `marketing_opt_in` from `leads` to build the audience, and honors unsubscribes ("unsubscribes propagate to the Leads Store").

**Why they combine into a hole:** AD-9's rule is entirely about the **checkbox UI** — "unticked-by-default … only a checked opt-in sets marketing_opt_in=true." It says nothing about *who is trusted to report the checkbox state*. Because AD-5 makes the browser the author (H1), `marketing_opt_in=true` is a **client-asserted claim with no server witness and no stored proof of the actual consent event.** A bot, or the visitor's own tampering, or a buggy second island, can set it true. Then Unit B faithfully emails a person who never consented — a CASL violation produced by two units that each obeyed their AD.

Worse, unsubscribe integrity fails on the duplicate-rows problem (H2): "unsubscribes propagate to the Leads Store" is undefined across multiple rows for one email, and AD-5 gives the *client* no update capability, so the unsubscribe path *must* be the out-of-band server — but that server's authority over the rows the client wrote is never established (no email uniqueness, no precedence rule). Result: a person can unsubscribe and still be mailable via a sibling row.

AD-9 also stores "consent value + timestamp" but not **what** they consented to, in which **locale/language** (H5), or **proof** the request was human (Turnstile token/IP/time). For a PIPEDA/CASL posture that is thin.

**Proposed fix — tighten AD-9 (leaning on AD-15/AD-16):**

> **AD-9 (amended) — Consent is server-witnessed and single-sourced.** `marketing_opt_in` may only be set true by the capture endpoint (AD-15) after it (a) validated a Turnstile token and (b) received an explicit `true`; the endpoint stamps `consent_at`, `consent_locale`, and a `consent_evidence` (Turnstile outcome + IP + the exact consent-copy version/id shown). Consent lives on **one** row per email (AD-16); unsubscribe flips that single row and is idempotent. The client is never the authority for `marketing_opt_in`.

---

## H5 — [high] EN and FR can diverge on the one thing that must not differ: the consent statement

**Units (both AD-compliant):**
- Unit A: EN route + EN Copy Deck slot for the opt-in label / privacy text (AD-14: copy is owner-supplied, externalized, per-locale).
- Unit B: `/fr/**` route + FR Copy Deck slot for the same opt-in.

**Why they combine into a hole:** AD-14 guarantees *structural* bilingualism (i18n routing, externalized slots, hreflang) but treats every string as an **independent, owner-supplied slot.** Consent copy is legally load-bearing and CASL-regulated in **both** languages (Quebec/Bill 96 makes the FR version not optional). Two compliant builders/owners can ship:
- an EN opt-in whose text matches the stored consent scope and an FR opt-in that says something materially different (or is a placeholder, which AD/FR-COPY explicitly *permits*: "FR copy can ship with owner-provided placeholders … without blocking build");
- an FR route missing the unsubscribe/sender-ID footer that the EN route has;
- an FR calculator whose "not tax advice" / "as of" disclaimer (AD-7) is absent or stale relative to EN.

Nothing in AD-9 or AD-14 ties the *consent record* to the *language/version actually shown*, nor requires legal-copy slots to be present (non-placeholder) in **both** locales before a capture point is enabled. So a FR visitor can be captured under an English or placeholder consent string — consent that arguably isn't valid — while both builders are fully AD-compliant.

**Proposed fix — tighten AD-14 (+ hook into AD-9):**

> **AD-14 (amended) — Legally-binding slots are locale-complete and version-pinned.** A defined subset of slots is **compliance-critical**: the marketing-opt-in statement, privacy/consent text, unsubscribe + sender-ID footer, and the calculator "not tax advice"/"as of" disclaimer. These may **not** ship as placeholders and a capture point / page is **disabled in a locale until its compliance-critical slots are present in that locale.** Each carries a version id; the consent record stores which version (and locale) was shown (AD-9 amended). General marketing copy retains the placeholder freedom.

---

## H6 — [high] "Email the PDF": the server must not trust a client-sent PDF, but AD-7 pushes generation client-side

**Units (both AD-compliant):**
- Unit A: `islands/InvoiceCalculator.tsx` + `lib/pdf.ts` — generates the invoice PDF **in the browser** (AD-7: "PDF generation … run in the browser"). For the email path it POSTs to `api/send-invoice`. The natural, AD-7-obedient move is to POST the **already-generated PDF bytes** (or a data URL), since the client is the sole owner of `pdf.ts` output.
- Unit B: `pages/api/send-invoice.ts` — validates payload, attaches, sends via Resend (AD-3/AD-6/AD-10). AD-10: "validates its payload server-side before calling Resend."

**Why they combine into holes:**

1. **Attachment-as-payload = spam/malware relay + cost amplification.** If the endpoint accepts a client-supplied file to attach and a client-supplied recipient, it is an **open email relay that sends attacker-chosen bytes to attacker-chosen recipients from Scheza's domain** — devastating for deliverability/reputation and a malware vector. AD-10's "validate the payload" does not say the endpoint must **re-generate** the PDF from structured data, nor that the recipient is constrained. Turnstile raises the cost per send but (a) tokens can be farmed/solved and (b) each solved token still yields an attacker-controlled email from your domain. This is a *cost-and-reputation* amplifier even at low volume.
2. **Recipient not constrained.** Even if the server re-generates the PDF, if it emails whatever address the client sends, it's a **cost-amplification / harassment vector** (send N invoices to a victim; run up Resend spend). AD-10 caps rate but doesn't bound *who* gets mailed relative to *who requested it*.
3. **Preview/PDF mismatch trust.** FR-8 requires "the rendered PDF matches the preview." If the server re-generates (correct posture) it must share the calc/pdf logic with the client. But AD-12 forbids importing app code and AD-7 places `calc.ts`/`pdf.ts` in `src/lib` (client). Two builders can end up with the endpoint re-implementing tax math independently → **the emailed PDF diverges from the on-screen preview** (different rounding/rates), i.e. FR-7/FR-8 broken while both obey their ADs.

**Proposed fix — tighten AD-3/AD-7/AD-10 (new AD-18):**

> **AD-18 — The email endpoint regenerates from validated data and only self-sends.** `api/send-invoice` accepts **structured invoice data only (never a client-supplied file/HTML/attachment bytes)**, re-runs the **shared** `lib/calc` + `lib/pdf` (the same modules the island uses, so preview == emailed PDF by construction — closing the FR-8 gap without app-code import), and sends **only to the email captured for this request** (the transactional recipient), rate-limited and Turnstile-verified per send. No client-chosen recipient, no client-supplied bytes. This makes AD-7's "client-side generation" a UX/offline optimization, not a trust boundary.

---

## H7 — [medium] Two capture-point owners, one Lead shape, no single enum/validation authority

**Units (both AD-compliant):** the waitlist island, the calculator island, the demo/partner form, and the referral capture — four independently built capture points, each writing "the same `Lead` shape" (AD-4).

**Why they combine into drift:** AD-4 declares the shape but names **no single module that owns validation/normalization** of it. Four builders each obey AD-4 yet: normalize `email` differently (breaking H2's dedupe — `Tim@x.com` vs `tim@x.com`), send `locale` as `en`/`en-CA`/`EN`, send `trade` as free text vs the FR-1 enum, or set `city` unnormalized. AD-4 says "a new field is a schema change owned here" — but says nothing about *value normalization* being owned in one place. The DB has no enforcement (AD-5 client insert bypasses any TS type at runtime). So the "one canonical Lead" is canonical in **shape** but divergent in **values** across four writers — which silently breaks dedupe (H2), attribution matching (H3), and analytics/UTM joins (NFR-6).

**Proposed fix — tighten AD-4:**

> **AD-4 (amended) — One shape and one validator.** All capture points construct the `Lead` through a single `lib/leads` builder that **normalizes and validates** (email lowercased/trimmed, `locale`/`source`/`trade` from fixed enums, `city` trimmed) against a shared schema (e.g. a zod schema also used by the AD-15 endpoint and mirrored by DB `CHECK`/enum constraints). Capture points may not hand-assemble the row. DB-level constraints (enum types, unique email, `WITH CHECK`) are the backstop.

---

## H8 — [medium] Analytics/UTM capture (NFR-6) is a second, unspined writer of Lead-adjacent PII

**Units:** the consent-aware analytics island (NFR-6: "UTM on capture events," "preview built / waitlist submit / calculator complete / referral used" events) vs. the Lead capture path.

**Why it's a hazard:** NFR-6 introduces a **second data pipeline that captures the same funnel events and UTM/PII**, but the spine defers the tool choice and gives it no AD. So one builder wires PostHog (US) client-side firing on the same events that carry email/trade/city context → **personal data leaves Canada**, violating AD-11's spirit, while *no AD is technically broken* (AD-11 binds "Lead data" at rest in Supabase; a third-party analytics capture is a different store the spine never governed). AD-11's own note ("Any analytics tool handling personal data must respect this (see Deferred)") acknowledges the gap but leaves it as prose, not a binding rule — so a compliant build can ship a residency violation.

**Proposed fix — promote AD-11's note to a rule:**

> **AD-11 (amended) — Residency binds every store of personal data, including analytics.** Any analytics/instrumentation that captures personal or re-identifiable data (email, IP tied to identity, or UTM joined to a Lead) must keep that data in Canada or be consent-gated and PII-stripped before leaving. The event schema for NFR-6 must be defined to carry **no** direct identifiers to any non-Canadian processor. Until the tool is chosen (Deferred), capture points must not embed a client-side analytics SDK that transmits identifiers.

---

## H9 — [low] Blog build-time fetch has no integrity/sanitization contract (stored XSS risk)

**Units:** `lib/persona.ts` (build-time PersonaPress fetch, AD-8) → `blog/[...slug].astro` renders it as static HTML with Article structured data.

**Why it's a hazard:** AD-8 governs *availability* (degrade-safe, token server-side) but says nothing about **trusting the content body**. If PersonaPress content is rendered as raw HTML (natural for a headless blog), a compromised/mistaken PersonaPress post injects script into a same-origin page that also hosts the capture islands and the anon Supabase key context → **stored XSS on `scheza.com`**, which in this architecture means access to the capture path and any client-visible config. Two compliant builders (persona fetch + blog template) ship it because no AD requires sanitization or a trust boundary on external content. Static rendering reduces but does not eliminate this (the HTML is still attacker-influenced).

**Proposed fix — tighten AD-8:**

> **AD-8 (amended) — External blog content is untrusted input.** PersonaPress HTML is sanitized at build time against an allowlist; a strict CSP is emitted on all pages (no inline script, constrained connect-src to Supabase/Resend/Turnstile origins) so a content injection cannot exfiltrate to attacker origins or script the capture path.

---

## Cross-cutting finding: the "no-server capture" decision (AD-5) is the single point of failure

H1, H2, H3, H4, H6, H7 all trace back to **AD-5's choice to let the browser be the sole, unmediated author of Lead rows via a public key.** That one decision makes Turnstile (AD-10) unenforceable at the data layer, dedupe (FR-2) impossible, consent (AD-9) unwitnessed, and attribution (FR-11) forgeable — even when every downstream builder is perfectly obedient. The proposed AD-15 (a single validating capture endpoint) is the keystone fix: it re-homes the trust boundary on the server, and AD-16/AD-17/AD-9-amended/AD-18 all become implementable once it exists. Adopting AD-15 requires amending AD-3 (endpoints may exist for integrity guarantees, not only secrets) and AD-5 (insert-only describes the endpoint, not the client).

## Summary table

| # | Sev | Hole (both units obey their ADs) | Fix |
| --- | --- | --- | --- |
| H1 | critical | Anon insert-only key lets browser/bots forge `source`, `marketing_opt_in`, `referrer_id`, email; Turnstile (AD-10) can't gate a raw RLS insert | New **AD-15**: single validating capture endpoint; amend AD-3 (integrity endpoints allowed) + AD-5 |
| H2 | critical | AD-5 forbids client update, FR-2 requires upsert dedupe → duplicate humans, split consent | New **AD-16**: email = identity (unique), atomic upsert, defined consent precedence |
| H3 | high | Referral token = raw lead id; self-referral, forged `referrer_id`, replay all pass | New **AD-17**: server-issued opaque token, reject self-referral, one attribution per email |
| H4 | critical | `marketing_opt_in` is a client claim with no witness; unsubscribe undefined across dup rows | Amend **AD-9**: server-witnessed consent, evidence + version + locale, single row |
| H5 | high | EN/FR consent + disclaimer slots can diverge or be placeholders | Amend **AD-14**: compliance-critical slots locale-complete, version-pinned, gate capture |
| H6 | high | Email endpoint may accept client PDF/recipient → open relay / cost amp; preview≠emailed PDF | New **AD-18**: regenerate from data via shared lib, self-send only |
| H7 | medium | Four capture points obey shape but drift on value normalization | Amend **AD-4**: one shared validator/normalizer + DB constraints |
| H8 | medium | NFR-6 analytics = second PII writer, no residency AD | Amend **AD-11**: residency binds analytics; no identifiers off-Canada |
| H9 | low | External blog HTML rendered untrusted → stored XSS on capture origin | Amend **AD-8**: sanitize + strict CSP |
