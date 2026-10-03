# Sprint Change Proposal — Owner-Controlled Intake Forms

- **Date:** 2026-10-02
- **Author:** Boris (with Dev agent, Correct Course workflow)
- **Trigger story:** 6.2 (No-Auth External Submission)
- **Scope classification:** Major (new epic + PRD amendment) → ratify, then implement
- **Mode:** Incremental (all proposals approved)
- **Note:** Filename suffixed `-intake-forms` to avoid clobbering the existing `sprint-change-proposal-2026-10-02.md` (Epic 13 / FR96-99).

---

## Section 1 — Issue Summary

**Problem statement.** Epic 6 ships an auto-generated, always-live public intake form at `scheza.com/forms/{slug}` whose target table, fields, branding, and very existence are entirely system-controlled. An owner cannot:
- discover or share the form link from the app,
- choose which table is exposed,
- control which fields appear or how they are labelled/ordered,
- brand the form (logo, business name, intro message), or
- decide whether the form is public at all.

This blocks real campaign / lead-capture use. The motivating case: a plumber who wants to send a client a branded "Job Request" link so the client's request lands straight in the Jobs table.

**Discovery & evidence.**
- `_bmad-output/implementation-artifacts/deferred-work.md` carries two explicit deferrals from `spec-6-2` ("Owner-driven public intake form management…" and "Add abuse protection…"), plus a `source_spec: none` entry ("No first-class way to capture or edit an organization's business/display name").
- The spec-6-2 deferral states this work "needs product sign-off and its own planning (PRD/epic) before building."
- Code map confirms: `selectIntakeTable` (`src/lib/intake/target.ts`) is a regex heuristic with no owner override; `/forms/{slug}` is always live; the header shows only `organizations.name`; there is no management UI in Settings or the dashboard nav; the public POST (`/api/intake/[slug]`) has no abuse protection (review flag BH9).

**Category:** New requirement emerged from stakeholder.

---

## Section 2 — Impact Analysis

### Epic impact
- **Epic 6** (6.1-6.5) stays as planned; it is the correct foundation and must **not** be reopened/rescoped. Status at time of change: 6.1-6.3 `review`, 6.4-6.5 `backlog`.
- **New Epic 14 — Owner-Controlled Intake Forms** is added (next free number after Epic 13).
- This **pulls the "multiple named forms" item out of Growth into MVP** — the owner decided a form should be a first-class, titled, multi-per-org entity.

### Story impact
- No existing story is modified. Stories 6.1/6.2's public page and submission handler are **migrated** (not rewritten) onto the new `forms` entity by Epic 14 stories 14.1-14.2.

### Artifact conflicts
- **PRD:** FR25 amended (opt-in, multi-form, title → slug); FR100-FR104 added. FR78 invariant (relation fields never public) upheld.
- **Architecture:** new shared platform table `forms`; demotion of `selectIntakeTable` to a creation-time default; a public-safe logo rendering decision (Option B, server-proxied); the rate-limit seam already reserved in `src/middleware.ts`.
- **UI/UX:** net-new Admin "Forms" area + branded public form. Detailed design deferred to each story's spec during bmad build (web-uiux-architect at spec time).
- **Secondary:** new `forms` table migration; a QR dependency (`qrcode.react`); new `Forms` i18n namespace + extended `IntakeForm` namespace; new tests. No CI/deploy/IaC changes. Data residency unchanged (Supabase ca-central-1, PIPEDA).

### Dependencies
- Hard deps all done: **Epic 12** (`business_profiles.operating_name` + `logo_path` + logo upload/signing) for branding; **Epic 3** (realtime + guarded `mutate.ts`); **Epic 6** (public-form foundation).
- Light coupling to **Epic 13** (single-select fields must render on the public form; 13-6 already covers intake).
- **Epic 8** offboarding cascade must include `forms` rows (no retention obligation — do NOT add them to the Epic 12 invoice retention-exclusion list).

---

## Section 3 — Recommended Approach

**Selected: Hybrid — new Epic 14 (add-epic) + targeted PRD amendment (FR25).**

| Option | Verdict | Effort / Risk |
|--------|---------|---------------|
| 1. Direct adjustment (extend in-flight Epic 6) | Viable but undesirable — muddies Epic 6's frozen scope | Med / Med |
| 2. Rollback | Not applicable — shipped form is the correct foundation | Low / Low |
| 3. PRD MVP review | Relevant only for the FR25 opt-in amendment; not a scope reduction | Low / Low |
| **Hybrid (chosen)** | **New Epic 14 + FR25 amendment** | **Med / Low** |

**Rationale:** keeps Epic 6 clean and shippable, gives the new capability its own ratified plan, and surfaces the single behavioral change (opt-in / off-by-default) explicitly. Reuses existing infrastructure (Epic 12 branding, Epic 3 realtime/mutate, the existing field-visibility model) rather than building new.

**Owner decisions recorded:**
1. Mode: **Incremental**.
2. Default form state: **Opt-in / off by default** (a form is deliberately published, not silently public).
3. Scope: **Full epic** (all five capabilities).
4. **Multiple forms per org**, each with an owner-chosen **title** that generates an editable, **org-scoped slug**; URL `scheza.com/forms/{orgSlug}/{formSlug}`.
5. Logo rendering: **Option B** (server-proxied, published-gated) — keeps Epic 12's private-bucket posture.

---

## Section 4 — Detailed Change Proposals

### 4.1 PRD (`planning-artifacts/prd.md`)

**Amend FR25:**
```
OLD:
- FR25: The system automatically generates a public intake form URL for
  every claimed dashboard

NEW:
- FR25: A claimed dashboard can have one or more public intake forms. An
  Admin creates each form with a title; the public slug is generated from
  the title (slugified, unique within the org, editable before publishing).
  Each form is unpublished by default and becomes reachable at
  scheza.com/forms/{orgSlug}/{formSlug} only after the Admin publishes it
  and confirms a target table. An unknown or unpublished URL returns the
  same data-free "form not available" state.
```

**Add FRs:**
```
- FR100: An Admin can create, rename, and delete intake forms, and manage
  them from the dashboard: view/copy/share each live link (copy-to-clipboard
  + scannable QR code) and preview the form as an external visitor sees it.
- FR101: Each form targets exactly one table, chosen explicitly by the
  Admin. The intake-term heuristic supplies the suggested default at
  creation; the owner's choice always overrides it.
- FR102: Per form, an Admin can control which fields appear on the public
  surface (independent of the dashboard column-hide flag) and set a public
  label, optional help text, and field order. Relationship/lookup fields
  remain excluded regardless of any toggle (FR78 invariant).
- FR103: Each public form displays the business's branding (operating name
  and logo, reused from the Epic 12 business profile) plus an optional short,
  per-form owner-authored intro/info message.
- FR104: The public intake endpoint is protected against automated abuse
  (honeypot + per-IP / per-slug rate limiting), and protection must never
  block a legitimate submission's data capture.
```
*(Confirm FR100+ is the next free block; the prior proposal used up to FR99.)*

### 4.2 Epics (`planning-artifacts/epics.md`)

Add after Epic 13:
```
### Epic 14: Owner-Controlled Intake Forms
Turn the auto-generated MVP form into an owner-managed, multi-form lead-capture
tool. An Admin can create one or more public forms per dashboard, each with a
title (which generates an editable, org-scoped slug), an explicitly chosen
target table, per-field public customization, business branding, and a publish
toggle (off by default). Serves real campaign use (e.g. a plumber sharing a
branded "Job Request" link with a client). Builds on Epic 6's public-form
foundation; reuses Epic 12 branding and Epic 3 realtime/mutate.
**FRs covered:** FR25 (amended), FR100, FR101, FR102, FR103, FR104 (FR78 invariant upheld)
**NFRs woven in:** NFR-A2, NFR-A4, NFR-P5, PIPEDA data-min

> Pulls "multiple named forms" out of Growth into MVP. A form = {title, slug,
> target table, field config, branding, published}. Depends on Epic 6 (6.1-6.5)
> and Epic 12 (business_profiles logo/operating_name).
```

**Stories (7 + retro, build order):**

| Story | Goal | FRs |
|-------|------|-----|
| 14.1 Forms data model & Admin form creation (walking skeleton) | New `forms` table + org-scoped RLS + guarded create/list/rename/delete mutators; create flow (title → slugified org-unique editable slug, `-2` collision suffix; target table heuristic-defaulted); bare dashboard forms list. No public behavior change. | FR25, FR100 |
| 14.2 Multi-form public route & form-keyed submission | `/forms/{orgSlug}/{formSlug}` resolves a published form → renders its target table's eligible fields; POST keyed to the form (writes to its target table, server-derived allowlist). Legacy `/forms/{slug}` → primary published form else "not available". Migrates 6.1/6.2 onto the form entity. | FR25, FR26 |
| 14.3 Publish toggle & share surface | Publish/unpublish (off by default); management card with live link, copy, QR code, preview-as-visitor. | FR25, FR100 |
| 14.4 Choose target table per form | Explicit per-form target-table selector; heuristic only a default; changing target revalidates field config. | FR101 |
| 14.5 Per-field public customization | Per-field show-on-form toggle (decoupled from dashboard column-hide), public label, help text, ordering — enforced in render + payload; relation fields excluded (FR78). | FR102, FR78 |
| 14.6 Branded public form | Render business `operating_name` + logo (Option B proxied) + optional per-form intro text. | FR103 |
| 14.7 Abuse protection on public intake | Honeypot + per-IP / per-slug rate limiting on the public POST; never blocks legitimate capture. | FR104 |
| 14-retrospective | optional | — |

**Sequencing:** 14.1 → 14.2 (walking skeleton). 14.3-14.6 parallelize after 14.2. 14.7 independent after 14.2.

### 4.3 Architecture (`planning-artifacts/architecture.md`)

**New platform table `forms`** (shared, not per-tenant; one migration):
```
forms
  id               uuid pk
  organization_id  uuid fk → organizations(id) ON DELETE CASCADE
  title            text not null
  slug             text not null              -- slugified from title, editable
  target_table_key text not null              -- logical table_key in org_schemas
  published        boolean not null default false
  intro_text       text                       -- optional per-form info message
  field_config     jsonb not null default '[]'-- [{field_key, visible, public_label?, help_text?, order}]
  created_at / updated_at  timestamptz
  UNIQUE (organization_id, slug)
  INDEX (organization_id)
```
- **RLS:** org members read/write their org rows (as `org_schemas`); public resolver reads via the service-role admin client only (mirrors `/forms/{slug}`, `/i/[token]`).
- **Offboarding (Epic 8):** `forms` rows ARE included in the cascade delete (no statutory retention — unlike invoices; do NOT add to the Epic 12 retention-exclusion list).
- **Resolution/submission:** page resolves org-by-slug → form-by-`(org_id, slug)` where `published = true`; `force-dynamic`, `runtime="nodejs"`, data-free failure. POST re-resolves server-side, writes via guarded `mutate.ts` under `INTAKE_ACTOR_ID`, allowlisted to the form's visible non-relation fields.
- **`selectIntakeTable` demoted** to a creation-time suggested default; the form row's `target_table_key` is authoritative at runtime.
- **Logo (Option B):** public image route (e.g. `/forms/{orgSlug}/{formSlug}/logo`) fetches the private object with the admin client and streams it with long `Cache-Control`, only when the form is published. Keeps Epic 12's private-bucket posture; no storage fork. (Alternatives A public-bucket and C signed-URL rejected.)
- **Abuse-protection seam:** implement the per-route rate limit the `src/middleware.ts` comment reserves — honeypot hidden field + per-IP + per-slug token bucket; non-blocking of capture (consistent with Epic 6's non-blocking-email rule).

### 4.4 UI/UX

Detailed component design is produced **per-story during bmad build** (spec time, via web-uiux-architect), not now. Captured direction only:
- Admin-only **Forms** area: `/{slug}/forms` (list) + `/{slug}/forms/{formId}` (editor with live preview); a "Forms" link in `DashboardNav`.
- **Share surface:** copy link + QR code + preview-as-visitor; a plumber-flavored "Send to a client" prefilled text.
- **Publish toggle:** `switch` primitive, off by default, enabling gated on a valid target table.
- **Per-field editor:** drag-reorder + show-on-form toggle + public label + help text; relation fields disabled with a lock + "Excluded from public forms".
- **Branded public form:** mobile-first, logo + operating name + intro text, 48px targets, accessible inline validation, warm owner-named confirmation (no em-dash).
- New deps to confirm at build: `qrcode.react`; a `Forms` i18n namespace (en + fr).

### 4.5 Bookkeeping (`implementation-artifacts/deferred-work.md`)

- spec-6-2 "Owner-driven public intake form management" → `status: SCHEDULED — Epic 14 (14.1-14.6)`.
- spec-6-2 "Add abuse protection…" → `status: SCHEDULED — Epic 14 Story 14.7`.
- source_spec: none "No first-class business/display name" → `status: PARTIALLY ADDRESSED — Epic 14 Story 14.6 surfaces operating_name + logo on public forms; a general Settings org-rename control remains deferred`.

### 4.6 Sprint status (`implementation-artifacts/sprint-status.yaml`)

Add after the `epic-13` block:
```yaml
  # ── Epic 14: Owner-Controlled Intake Forms ───────────────────────────────
  # Added via sprint-change-proposal-2026-10-02-intake-forms.md (FR25 amended; FR100-104)
  epic-14: backlog
  14-1-forms-data-model-admin-form-creation: backlog
  14-2-multi-form-public-route-form-keyed-submission: backlog
  14-3-publish-toggle-share-surface: backlog
  14-4-choose-target-table-per-form: backlog
  14-5-per-field-public-customization: backlog
  14-6-branded-public-form: backlog
  14-7-abuse-protection-on-public-intake: backlog
  epic-14-retrospective: optional
```

---

## Section 5 — Implementation Handoff

**Scope classification: Major** (new epic + PRD amendment + new persisted config).

| Recipient | Responsibility | Deliverables |
|-----------|----------------|--------------|
| **Product Manager** | Ratify the FR25 amendment + FR100-104; confirm multiple-forms-into-MVP trade and FR numbering. | Updated `prd.md` |
| **Architect** | Confirm `forms` table + RLS, logo Option B, and the rate-limit seam placement. | Updated `architecture.md` |
| **Product Owner / Dev** | Apply the `epics.md` Epic 14 block + stories; update `sprint-status.yaml`; annotate `deferred-work.md`. | Updated epics/status/ledger |
| **Dev (bmad build)** | Build 14.1 → 14.7 per spec; each story's spec owns its UI/UX design (web-uiux-architect) and tests. | Shipped stories |

**Success criteria:** an Admin can create a titled form, pick its target table, customize/brand it, publish it, and share a working `scheza.com/forms/{orgSlug}/{formSlug}` link; an external visitor submits and the row appears in the owner's table in real time; relation fields never appear on any form; the public endpoint resists basic spam without ever dropping a legitimate submission.

**Next step:** on approval, apply the planning-doc edits above and set Epic 14 to `backlog` in `sprint-status.yaml`, then hand 14.1 to bmad build.
