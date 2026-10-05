# Epic 8 Context: Localization, PWA & Compliance/Offboarding

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Epic 8 delivers the Ontario-specific trust-and-reach layer plus the PIPEDA data-lifecycle obligations that make Scheza safe and credible for small-business owners and their bilingual teams and clients. It provides an instant, no-reload English/French UI toggle, PWA "Add to Home Screen" installability, a field-level sensitivity indicator that reassures users about how private data is handled, self-serve "Download My Data" export (CSV and JSON), and self-service offboarding with a 30-day read-only grace period, staged email warnings, and an irreversible cascade delete. These are small-surface features with outsized conversion-trust and retention payoff, and they close the legal/compliance loop that a Canadian product must honor. The epic depends only on Epics 1–2 (data model, RLS, real claimed accounts); it has no forward dependency.

## Stories

- Story 8.1: Instant EN/FR UI Toggle (No Reload)
- Story 8.2: PWA Install ("Add to Home Screen")
- Story 8.3: Field-Level Sensitivity Indicator
- Story 8.4: Download My Data (CSV / JSON)
- Story 8.5: Self-Service Offboarding (Grace + Cascade Delete)

## Requirements & Constraints

- The EN/FR UI toggle must switch all labels, navigation, and column/field names with no page reload, applying in under 300ms. The language choice persists in `localStorage` and restores on next visit with no API call required. Toggling re-labels UI and column headers only; stored data values are never re-translated (the language of stored content follows how it was entered or generated).
- The app must ship a web app manifest and service worker so it is installable as a PWA. Mobile users on supported browsers are prompted to install; once installed it launches standalone and opens directly to the user's dashboard respecting the existing session. The install prompt should be deferred until a post-"aha" intent signal rather than shown immediately.
- Columns flagged as sensitive/PII show a field-level indicator (padlock) in both table and card views, with a plain-language, PIPEDA-reassuring tooltip. This is backed by encryption at rest and Canadian data residency.
- "Download My Data" exports all of the organization's records as both CSV and JSON, scoped strictly to the caller's organization under RLS, covering all logical tables and never exposing another org's data.
- Offboarding: on cancellation the account enters a 30-day read-only grace period (data visible, no new entries), with the data export prominently surfaced throughout. Email warnings are sent at Day 1, Day 7, and Day 25. At Day 30 a hard cascade delete removes all org records and schema, irreversibly.
- All UI in either language must meet WCAG AA color-contrast minimums (AAA where achievable); no light-grey-on-white text. Form fields need real labels, not placeholder-only.

## Technical Decisions

- i18n uses next-intl with client-side, pre-loaded bundles (no page reload). Pattern: `const { locale, setLocale } = useLocale()`; translations via `useTranslations('<namespace>')`. The no-hardcoded-strings rule is enforced from the first component (seam established in Epic 1); this epic adds the FR translation catalog and the toggle UI. French *synthetic-data* generation (FR35) is NOT in this epic — it lives in the Epic 1 generation pipeline.
- PWA is implemented via `public/manifest.json` + a service worker (`public/sw.js`, generated at build) with PWA icons (192/512). The field-worker surface is always dark (bypasses the theme token).
- The sensitivity indicator is driven by a `sensitive?: boolean` on the field definition in `org_schemas`; render it via a shared `SensitivityBadge` component (padlock + PIPEDA tooltip). Offboarding grace warnings render via a `GracePeriodBanner` component. Settings (export, offboarding) live on the admin settings page.
- Data export reads tenant records through the normal RLS-scoped query path, strictly scoped by `organization_id`.
- Offboarding staged emails (Day 1/7/25) and trial reminders are driven by Vercel Cron lifecycle sweeps hitting cron-secret-protected `/api/cron/*` routes (declared in `vercel.json`); all mail is sent via Resend and is strictly transactional (CASL). There is no usage-reporting cron (flat tiers carry no metered usage).
- The Day-30 cascade delete is one of the few narrow, allowlisted operations permitted to use elevated (service-role) privileges — service role is bootstrap/platform-op only, never runtime writes or DDL. Writes otherwise flow through the guarded `mutate.ts` layer under RLS.
- **Statutory retention override (critical):** the offboarding hard-delete must EXCLUDE `invoices`, `credit_notes`, `invoice_payments` and their frozen PDFs while under the six-year invoice-retention obligation — legal retention wins over the 30-day cascade. (Public `forms` rows, by contrast, ARE included in the cascade — no statutory retention.)
- Data residency is Supabase ca-central-1 (PIPEDA); never change region. At-rest encryption is at the infrastructure level (NFR-S2).

## UX & Interaction Patterns

- Language toggle sits top-right and flips labels, column names, and already-generated data headers seamlessly (UX-DR11).
- PWA install uses the "Add to Home Screen" affordance for a native-feeling icon, bypassing app stores (UX-DR10).
- Sensitivity indicator is a padlock/lock affordance with a reassuring, plain-language PIPEDA tooltip (e.g., "Stored encrypted. Canadian servers only (PIPEDA).") (UX-DR12).
- Throughout the grace period, surface the "Download My Data" export prominently so users can recover or export before deletion.
- The "Spatial Clean" visual language is satisfied for MVP by the shadcn/ui New York / zinc theme already applied app-wide; the bespoke palette/typography is a Growth-phase polish, not MVP work (no dedicated story).

## Cross-Story Dependencies

- Depends only on Epics 1–2: the i18n seam, shared JSONB data model, membership-based RLS, and real claimed accounts. No forward dependency on later epics.
- The offboarding cascade (Story 8.5) must coordinate with Epic 12's invoice retention rules: the delete logic must honor the six-year-retention exclusion list for invoice-related tables and PDFs. Implement the exclusion when writing the cascade so it is correct the first time.
- FR40 (sensitivity indicator) and FR41 (PWA install) are pull-forward candidates — no hard dependency on the rest of this epic — and can ship earlier if capacity allows.
