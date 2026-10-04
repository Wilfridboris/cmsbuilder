# Epic 14 Context: Owner-Controlled Intake Forms

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Turn the single auto-generated public intake form into an owner-managed, multi-form lead-capture tool. An Admin can create one or more public forms per dashboard, each with a title (which generates an editable, org-scoped slug), an explicitly chosen target table, per-field public customization, business branding, and a publish toggle that is off by default. This serves real campaign use — for example a plumber sharing a branded "Job Request" link whose submissions land straight in the Jobs table. The epic builds on the existing public-form foundation (resolution and submission handling are migrated, not rewritten), reuses the business profile's operating name and logo for branding, and preserves the hard invariant that relationship/lookup fields never reach a public form.

## Stories

- Story 14.1: Forms Data Model & Admin Form Creation
- Story 14.2: Multi-Form Public Route & Form-Keyed Submission
- Story 14.3: Publish Toggle & Share Surface
- Story 14.4: Choose Target Table Per Form
- Story 14.5: Per-Field Public Customization
- Story 14.6: Branded Public Form
- Story 14.7: Abuse Protection on Public Intake

## Requirements & Constraints

- A claimed dashboard can host multiple public intake forms. Each form has a title; its public slug is slugified from the title, unique within the org, and editable before publishing (collision resolves with a `-2` style suffix). Forms are unpublished by default and only become reachable once an Admin publishes them and a valid target table is set.
- Admins can create, rename, and delete forms, and manage them from the dashboard: copy the live link (with confirmation feedback), display a scannable QR code, and preview the form as an external visitor sees it.
- Each form targets exactly one table, chosen explicitly by the Admin. An intake-term heuristic supplies a suggested default at creation time, but the owner's explicit choice is always authoritative at runtime. Changing the target table revalidates per-field config and drops fields that no longer exist.
- Per form, an Admin controls which fields appear publicly (independent of the dashboard column-hide flag), with a public label, optional help text, and custom field order. Both rendering and submission writes honor this config.
- Relationship/lookup fields are never shown and never accepted in a submission payload, regardless of any toggle — this invariant holds across field-config editing, rendering, and server-side write allowlisting.
- Each public form shows the business's operating name and logo (reused from the business profile) plus an optional short, owner-authored intro/info message. Branding degrades gracefully when logo or operating name is missing (no broken image).
- The public intake endpoint must resist automated abuse (honeypot field plus per-IP / per-slug rate limiting) without ever blocking or dropping a legitimate submission's data capture.
- Unknown or unpublished URLs return a single data-free "form not available" state with no provider internals exposed.
- Form management is Admin-only; Members never see the Forms controls.
- Submitted records appear in the owner's table in real time. UI must meet minimum touch-target and accessible-label standards; copy is mobile-first and uses no em-dash. Offboarding cascade deletes `forms` rows (no statutory retention, unlike invoices).

## Technical Decisions

- **New shared platform table `forms`** (one migration, org-scoped, not per-tenant): `id`, `organization_id` (FK, ON DELETE CASCADE), `title`, `slug`, `target_table_key` (a logical table_key in the org schema), `published` (default false), `intro_text`, `field_config` JSONB (array of `{field_key, visible, public_label?, help_text?, order}`), timestamps, `UNIQUE (organization_id, slug)`, index on `organization_id`.
- **RLS**: org members read/write their own org's form rows (same pattern as the org schema table). The public resolver reads only via the service-role admin client, mirroring the existing public token/slug routes.
- **Public route** `scheza.com/forms/{orgSlug}/{formSlug}`: resolve org-by-slug, then form-by-`(org_id, slug)` where `published = true`; dynamic rendering on the Node.js runtime; data-free failure state. The POST handler re-resolves the form server-side (never trusting the client for table or fields), then writes through the guarded mutation layer under the intake actor identity, allowlisted to the form's visible non-relation fields.
- **Legacy single-form route** migrates onto the form entity: `/forms/{slug}` resolves to the org's primary published form if one exists, otherwise the "not available" state. The existing public page and submission handler are migrated, not rewritten.
- **Target-table heuristic** is demoted to a creation-time suggested default only; the stored `target_table_key` is authoritative at runtime.
- **Logo rendering (server-proxied)**: a published-gated public image route fetches the private storage object with the admin client and streams it with a long cache header. This preserves the private-bucket posture — no public bucket, no signed-URL fork.
- **Abuse protection** extends the per-route rate-limit seam already reserved in the edge middleware (the same IP rate-limit pattern used for generation endpoints): honeypot hidden field plus per-IP and per-slug token-bucket limiting, implemented non-blocking so capture is never dropped.
- New dependency to confirm at build: a QR-code component. New `Forms` i18n namespace (EN + FR) and extended intake-form namespace; no new strings may be hardcoded. No CI, deploy, or infrastructure changes; data residency unchanged.

## UX & Interaction Patterns

- Admin-only **Forms** area: a list view at `/{slug}/forms` and an editor at `/{slug}/forms/{formId}` with a live preview, plus a Forms link in the dashboard nav.
- **Share surface**: copy-link with confirmation, QR code, and preview-as-visitor; a prefilled owner-friendly "send to a client" message.
- **Publish toggle**: a switch primitive, off by default, with publishing gated (and the control disabled with a clear reason) until a valid target table is set.
- **Per-field editor**: drag-to-reorder, show-on-form toggle, public label, and help text; relation fields are shown disabled with a lock affordance and an "excluded from public forms" explanation.
- **Branded public form**: mobile-first, logo + operating name + optional intro text above the fields, large touch targets, accessible inline validation, and a warm owner-named confirmation.

## Cross-Story Dependencies

- Depends on the existing public-form foundation (prior intake epic) — stories 14.1–14.2 migrate that public page and submission handler onto the new `forms` entity.
- Reuses the business profile's operating name and logo (invoicing epic) for form branding in 14.6.
- Reuses the real-time sync and guarded mutation layer (core data epic) so submissions surface live in the owner's table.
- Admin-only gating relies on the existing RBAC model.
- Light coupling to the single-select field type: list-of-values fields must render correctly on the public form (already covered by the intake story of that epic).
- The offboarding cascade (localization/compliance epic) must include `forms` rows.
- Internal ordering: 14.1 (data model + creation) is the walking skeleton; 14.2 adds the public route and keyed submission; 14.3 adds publish + share; 14.4–14.6 layer target-table choice, field customization, and branding; 14.7 adds abuse protection.
