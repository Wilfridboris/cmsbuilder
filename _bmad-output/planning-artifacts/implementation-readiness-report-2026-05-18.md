---
stepsCompleted: ["step-01-document-discovery", "step-02-prd-analysis", "step-03-epic-coverage-validation", "step-04-ux-alignment", "step-05-epic-quality-review", "step-06-final-assessment"]
documentsIncluded:
  - prd: "_bmad-output/planning-artifacts/prd.md"
  - architecture: "_bmad-output/planning-artifacts/architecture.md"
  - epics: "_bmad-output/planning-artifacts/epics.md"
  - ux: "_bmad-output/planning-artifacts/ux-design-specification.md"
---

# Implementation Readiness Assessment Report

**Date:** 2026-05-18
**Project:** cmsbuilder (Scheza)

---

## PRD Analysis

### Functional Requirements

FR1: Visitor can describe their business using a guided structured prompt (trade type, city, and what they track) without creating an account
FR2: The system generates a relational database schema from the user's prompt input within 45 seconds
FR3: The system populates generated tables with hyper-contextual, Ontario-localized synthetic data at generation time
FR4: The system automatically deploys a hardcoded Universal Field Service Template when LLM generation fails twice consecutively, without displaying an error screen
FR5: Visitor can browse, interact with, and edit the generated dashboard before creating an account
FR6: User can view records in a table as a data table (desktop) or swipeable card list (mobile)
FR7: User can add new records to any table via an auto-generated form with input types matching the column data types
FR8: User can edit existing records inline without navigating to a separate screen
FR9: User can delete individual records from any table
FR10: User can filter and sort records within any table view
FR11: Admin can hide a column from all views without deleting the column or its stored data
FR12: Multiple team members can view and edit records concurrently with changes reflected in real time
FR13: Admin can add a new column to an existing table by describing the change in natural language
FR14: Admin can add a new table by describing it in natural language
FR15: Admin can request a new filtered or sorted view of an existing table in natural language
FR16: The system preserves all existing row data when schema changes are executed via the Conversational Editor
FR17: The system responds with a safe, non-technical message when a user requests an unsupported operation (column delete, table delete, rename), and applies a frontend visibility change where applicable
FR18: Visitor can claim a generated app by providing their email address and authenticating via a magic link
FR19: User can authenticate to an existing account via magic link without a password
FR20: Admin can invite team members to their dashboard by email address
FR21: Admin can assign a role (Admin or Member) to each invited team member before the invitation is sent
FR22: The system automatically assigns the Admin role to the account creator
FR23: Member can view, add, and edit records
FR24: Member cannot access the Conversational Editor, Settings, Invite, or Billing features
FR25: The system automatically generates a public intake form URL for every claimed dashboard
FR26: External visitors can submit records via the public intake form without creating an account
FR27: Intake form submissions appear in the dashboard owner's data table in real time
FR28: Admin receives a notification when a new intake form submission is received
FR29: User can begin a 14-day free trial without providing payment information
FR30: Admin can upgrade to a paid subscription via a Stripe-hosted checkout page
FR31: Admin can manage their subscription (update payment method, view invoices, cancel) via the Stripe Customer Portal
FR32: The system transitions an account to read-only mode when the trial period expires or the subscription lapses
FR33: Admin receives email notifications at Day 12 and Day 14 of the trial period prompting them to add billing
FR34: User can switch the dashboard UI language between English and French without a page reload
FR35: The system generates French-language synthetic data when the user's prompt is submitted in French
FR36: The system displays a mandatory, unchecked privacy consent checkbox at account claim that must be checked before the account is created
FR37: Admin can export all their organization's data as a CSV or JSON file
FR38: The system places an account in a 30-day read-only grace period upon cancellation, then performs a hard cascade delete of all organization data
FR39: Admin receives email notifications at Days 1, 7, and 25 of the offboarding grace period
FR40: The system displays a field-level indicator on columns flagged as storing sensitive or personally identifiable data
FR41: The system prompts mobile users to install the dashboard as a PWA on their home screen
FR42: All schema modification requests from the Conversational Editor are validated against a permitted-operations allowlist before being executed
FR43: The system rejects schema change requests containing restricted keywords and returns a user-facing plain-language error message
FR44: Each organization's data is strictly isolated such that no authenticated user can read or write another organization's records
FR45: All Schema Validator rejections are logged with the user's organization ID and raw LLM output for platform monitoring

**Total FRs: 45**

---

### Non-Functional Requirements

**Performance:**
NFR-P1: Prompt submission to interactive, populated dashboard < 45 seconds at p95
NFR-P2: Supabase DB provisioning from validated JSON schema < 5 seconds
NFR-P3: Dashboard page load for authenticated returning user < 2 seconds at p95 on mobile LTE
NFR-P4: Inline record edits appear immediately (optimistic rendering); server confirmation within 1 second
NFR-P5: Real-time record updates sync to all active shared dashboard members within 2 seconds
NFR-P6: EN/FR language toggle applies in < 300ms with no page reload

**Security:**
NFR-S1: All data in transit encrypted using TLS 1.2 or higher
NFR-S2: All data at rest encrypted at infrastructure level (AES-256 or equivalent)
NFR-S3: Row-Level Security policies active on 100% of tenant-generated tables — verified by automated test before any table is exposed to frontend
NFR-S4: Schema Validator must reject 100% of requests containing restricted keywords (DROP, GRANT, TRUNCATE, DELETE, EXEC, --, ;, /*)
NFR-S5: 100% of LLM API calls must include the hardened identity-masking system prompt
NFR-S6: Supabase service role key must never appear in client-side code — enforced by CI lint rule that fails build if key is detected in frontend bundles

**Scalability:**
NFR-SC1: Architecture must support 200 concurrent active organizations without manual infrastructure changes
NFR-SC2: Vercel serverless functions must auto-scale to handle traffic spikes without manual intervention
NFR-SC3: Each organization's generated schema may contain up to 20 tables and 50,000 rows within MVP tier; growth beyond this triggers Admin upgrade prompt

**Accessibility:**
NFR-A1: All UI text and interactive elements must meet WCAG AA color contrast ratios minimum; WCAG AAA where achievable (AODA obligations)
NFR-A2: All interactive elements must have a minimum touch target of 48×48px
NFR-A3: AI-generated UI components must include ARIA role labels derived from schema context
NFR-A4: All form fields must have associated visible or screen-reader-accessible labels

**Reliability:**
NFR-R1: Core dashboard CRUD operations must remain available during LLM API outages
NFR-R2: Platform uptime target: 99.5% monthly for MVP; 99.9% monthly for Growth phase
NFR-R3: LLM API timeout threshold: 15 seconds; Hard Fallback Schema triggered automatically — no user-facing timeout or error screen
NFR-R4: Stripe webhook processing failures must not affect user dashboard access — subscription status cached in Supabase as fallback source of truth

**Total NFRs: 22**

---

### Additional Requirements & Constraints

- **Data Residency:** 100% of user data on Canadian-region infrastructure (AWS ca-central-1); verified before production deployment
- **PIPEDA Consent:** Mandatory unchecked checkbox at claim; consent timestamp stored on user record
- **Multi-Tenant Isolation:** organization_id on every generated table; RLS enforces auth.uid() = organization_id on all operations; automated cross-tenant isolation test required as provisioning gate
- **No Direct SQL Rule:** LLM output must be JSON only; any SQL in LLM response is a security violation and must be discarded
- **Schema Validator:** Blocking dependency for Conversational Editor; must validate against permitted-operations allowlist, reject restricted keywords, log all rejections to Sentry
- **Identity Masking:** Hardened system prompt on every LLM API call constraining model to JSON schema output only
- **Conversational Editor Scope:** Append-Only in V1 — add column, add table, add view only; delete/rename deferred to Growth
- **Prompt Quality (3-Layer):** Mad Libs structured UI → Prompt Inflation (backend wrapping) → Hard Fallback Template
- **Self-Service Offboarding:** 30-day read-only grace period; cascade delete at day 30; email warnings at day 1, 7, 25
- **Data Portability:** Download My Data (CSV/JSON) required before beta exit
- **Stripe Integration:** Day 1 requirement; Checkout + Customer Portal + Webhook handler (checkout.session.completed, customer.subscription.deleted, invoice.payment_failed)
- **RBAC:** Two hardcoded roles (Admin/Member); role stored as metadata in Supabase Auth; API routes must independently verify admin role

### PRD Completeness Assessment

The PRD is exceptionally well-structured and complete. It contains 45 clearly numbered FRs, 22 NFRs across 5 categories, explicit domain constraints, a risk register, and scoped phasing. All five user journeys map clearly to specific requirements. No ambiguities were detected that would block implementation. The PRD is **ready for traceability validation**.

---

## Epic Coverage Validation

### Coverage Matrix

| FR | PRD Requirement (Short) | Epic Coverage | Status |
|----|------------------------|---------------|--------|
| FR1 | Guided structured prompt, no account | Epic 2 — Story 2.1 | ✓ Covered |
| FR2 | Schema generation within 45s | Epic 2 — Story 2.2 | ✓ Covered |
| FR3 | Ontario-localized synthetic data injection | Epic 2 — Story 2.3 | ✓ Covered |
| FR4 | Universal Fallback Template on double LLM failure | Epic 2 — Story 2.2, 2.4 | ✓ Covered |
| FR5 | Pre-auth dashboard browse/interact/edit | Epic 2 — Story 2.5 | ✓ Covered |
| FR6 | Desktop DataTable / mobile swipeable card list | Epic 3 — Story 3.2, 3.3 | ✓ Covered |
| FR7 | Add records via auto-generated form | Epic 3 — Story 3.4 | ✓ Covered |
| FR8 | Inline record editing without separate screen | Epic 3 — Story 3.4 | ✓ Covered |
| FR9 | Delete individual records | Epic 3 — Story 3.2, 3.4 | ✓ Covered |
| FR10 | Filter and sort records | Epic 3 — Story 3.2 | ✓ Covered |
| FR11 | Admin column hide (frontend flag, no DDL) | Epic 3 — Story 3.2 | ✓ Covered |
| FR12 | Real-time multi-user data sync | Epic 3 — Story 3.5 | ✓ Covered |
| FR13 | Conversational add-column | Epic 5 — Story 5.2, 5.3 | ✓ Covered |
| FR14 | Conversational add-table | Epic 5 — Story 5.2, 5.3 | ✓ Covered |
| FR15 | Conversational add-view | Epic 5 — Story 5.2, 5.3 | ✓ Covered |
| FR16 | Row preservation on schema changes | Epic 5 — Story 5.3 | ✓ Covered |
| FR17 | Safe plain-language response for unsupported ops | Epic 5 — Story 5.2 | ✓ Covered |
| FR18 | Claim app via email + magic link | Epic 4 — Story 4.1 | ✓ Covered |
| FR19 | Returning user passwordless magic link auth | Epic 4 — Story 4.2 | ✓ Covered |
| FR20 | Admin invites team members by email | Epic 4 — Story 4.3 | ✓ Covered |
| FR21 | Admin assigns role before invite is sent | Epic 4 — Story 4.3 | ✓ Covered |
| FR22 | Account creator auto-assigned Admin role | Epic 4 — Story 4.1 | ✓ Covered |
| FR23 | Member can view, add, and edit records | Epic 4 — Story 4.4 | ✓ Covered |
| FR24 | Member cannot access Editor/Settings/Invite/Billing | Epic 4 — Story 4.4 | ✓ Covered |
| FR25 | Auto-generated public intake form URL | Epic 6 — Story 6.1 | ✓ Covered |
| FR26 | External visitor submits intake without account | Epic 6 — Story 6.1 | ✓ Covered |
| FR27 | Intake submission appears in dashboard in real time | Epic 6 — Story 6.2 | ✓ Covered |
| FR28 | Admin notified on new intake submission | Epic 6 — Story 6.2 | ✓ Covered |
| FR29 | 14-day free trial without payment info | Epic 7 — Story 7.1 | ✓ Covered |
| FR30 | Upgrade via Stripe-hosted Checkout | Epic 7 — Story 7.2 | ✓ Covered |
| FR31 | Manage subscription via Stripe Customer Portal | Epic 7 — Story 7.3 | ✓ Covered |
| FR32 | Account transitions to read-only on trial/sub expiry | Epic 7 — Story 7.4 | ✓ Covered |
| FR33 | Trial expiry emails at Day 12 and Day 14 | Epic 7 — Story 7.4 | ✓ Covered |
| FR34 | EN/FR UI toggle without page reload | Epic 8 — Story 8.1 | ✓ Covered |
| FR35 | French synthetic data when prompt is in French | Epic 8 — Story 8.1 | ✓ Covered |
| FR36 | Mandatory unchecked PIPEDA consent checkbox at claim | Epic 4 — Story 4.1 | ✓ Covered |
| FR37 | Admin data export as CSV or JSON | Epic 8 — Story 8.3 | ✓ Covered |
| FR38 | 30-day grace period then cascade delete on cancellation | Epic 8 — Story 8.4 | ✓ Covered |
| FR39 | Offboarding emails at Day 1, 7, 25 | Epic 8 — Story 8.4 | ✓ Covered |
| FR40 | Field-level sensitivity indicator on PII columns | Epic 8 — Story 8.2 | ✓ Covered |
| FR41 | PWA install prompt for mobile users | Epic 9 — Story 9.1 | ✓ Covered |
| FR42 | Schema Validator allowlist gate on all mutations | Epic 5 — Story 5.2, 5.3 | ✓ Covered |
| FR43 | Schema Validator keyword blocklist + plain-language reject | Epic 5 — Story 5.2 | ✓ Covered |
| FR44 | RLS cross-tenant isolation (CI blocking gate) | Epic 1 — Story 1.3 | ✓ Covered |
| FR45 | Sentry logging of Schema Validator rejections | Epic 5 — Story 5.2 | ✓ Covered |

### Missing Requirements

**None.** All 45 PRD Functional Requirements have complete, traceable coverage in the epics and stories.

### Coverage Statistics

- Total PRD FRs: 45
- FRs covered in epics: 45
- **Coverage: 100%**

### NFR Coverage Notes

NFRs are addressed within story Acceptance Criteria rather than an explicit NFR coverage map:
- NFR-P1, P2: Story 2.2 | NFR-P4: Story 3.4, 3.5 | NFR-P5: Story 3.5 | NFR-P6: Story 8.1
- NFR-S1–S6: Epic 1 (Story 1.2–1.6) | NFR-SC1, SC2: Epic 1 infrastructure
- NFR-SC3: Additional Requirements / Story 1.2 schema constraints
- NFR-A1–A4: Epic 9 (Story 9.5) | NFR-R1: Story 3.5 | NFR-R3: Story 1.5 | NFR-R4: Story 7.3
- NFR-P3: Implied by Vercel SSG/caching, not explicitly tested in a story AC
- NFR-R2: Uptime target (99.5%) — declared but no dedicated monitoring/alerting story exists

---

## UX Alignment Assessment

### UX Document Status

**Found** — `ux-design-specification.md` (88 KB, 1480 lines). Complete specification covering: executive summary, target users, key design challenges, emotional journey, UX pattern analysis, design system foundation, user journey flows (all 5), component strategy (8 custom components), UX consistency patterns, responsive design, and accessibility strategy.

### UX ↔ PRD Alignment

**Aligned:**
- All 5 PRD user journeys (Tim, Marco, Sarah, Priya, Tim edge case) fully represented in UX spec with flowcharts
- All 45 FRs have corresponding UX design treatment in the specification
- PIPEDA sensitivity indicator, bilingual toggle, claim flow PIPEDA consent all consistent between PRD and UX
- Mad Libs prompt builder, Generative Glow Skeleton, Chat Bubble, deferred auth all consistently specified
- shadcn/ui + Tailwind mandate from PRD honored in UX design system choice
- Off-the-shelf mandate respected — no custom design system proposed

**Misalignments / Gaps:**

1. ⚠️ **Photo upload in intake form (UX Journey 4):** The UX spec describes an optional "Photo of issue? → Native camera opens → Photo attached" step in Priya's intake form journey. This capability has no corresponding FR in the PRD, no UX-DR requirement, and no epic story or acceptance criteria. It exists only in the journey flowchart. **Risk:** If implemented without a formal FR, it is un-scoped and could introduce unexpected file storage, security, and form complexity requirements at implementation time.

2. ℹ️ **PIPEDA compliance summary PDF export (UX Journey 3):** Sarah's journey mentions "Exports PIPEDA compliance summary PDF for client files." FR37 and Story 8.3 define only CSV/JSON export. This appears to be aspirational journey copy, not a formal requirement — however it creates an expectation mismatch with actual deliverables.

### UX ↔ Architecture Alignment

**Aligned:**
- Architecture uses shadcn/ui + Tailwind CSS (confirmed, matches UX design system selection)
- Framer Motion v12 + react-swipeable v7 in architecture (matches swipe card + animation requirements)
- next-intl v4 for EN/FR toggle (matches UX-DR9 and NFR-P6 < 300ms)
- Bottom sheet with snap points architected (`JobDetailSheet.tsx` in project structure)
- PWA manifest + service workers included in architecture
- Maps deep-link for address fields covered in Story 3.3 and 3.4
- Dark mode hardcoded for Marco's field worker surface (architecture: "field worker surface always dark, bypasses theme token")
- Generation Arc hardcoded light (confirmed in architecture)
- CSS custom properties on `[data-theme]` at `<html>` root (architecture confirms)
- Geist + Inter font system (architecture references `next/font`)

**Misalignments / Gaps:**

1. 🔴 **Push notifications infrastructure is missing (FR28):** The PRD states "Admin receives a notification (push/email)" and UX spec testing section explicitly calls for testing "Push notifications on both iOS 16.4+ and Android Chrome." However, the architecture has NO web push infrastructure — no VAPID keys, no push subscription management, no `PushManager` API documented. Story 6.2 implements only email notifications via Resend. The architecture's `usePWAInstall.ts` handles install prompt only, not push subscriptions. **Impact: FR28 says "notification" which the PRD-level text says should include push — but this is only partially fulfilled (email only). This is an architecture gap that needs a decision: either explicitly scope FR28 to email-only, or add push notification infrastructure.**

2. ⚠️ **`relation` column type missing from ColumnType definition:** The UX spec's form field mapping table includes `relation → Searchable Select with record lookup`. The architecture defines `ColumnType` as `'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'email' | 'phone' | 'currency'` — no `relation` type. If relation columns are generated by Gemini, the Schema Validator will reject them as unsupported. **Impact: relational lookups between tables (e.g., Jobs referencing Clients by ID) cannot be represented.**

3. ⚠️ **Sort/filter state session persistence not in story ACs:** The UX spec states "Sort + filter state persists across sessions for Admin (stored in user preferences)." Story 3.2 only addresses column hide persistence. No story explicitly implements sort/filter preference storage in the user settings record. This is a minor UX inconsistency that should either be added to Story 3.2 or acknowledged as deferred.

4. ℹ️ **Stale UX-DR reference in Story 2.1:** Story 2.1 acceptance criteria reference "UX-DR23" which does not exist in the UX-DR registry (UX-DR1–UX-DR20 are the defined requirements). This is likely a typo for UX-DR1 (Mad Libs prompt builder). No functional impact, but should be corrected.

### Warnings

- **Critical decision needed:** FR28 push notification scope — clarify whether email-only satisfies the requirement or if push must be implemented for MVP
- **Action needed:** Either add `relation` to ColumnType (with schema support) or explicitly exclude relational column types from MVP scope
- **Minor action:** Correct UX-DR23 reference in Story 2.1 to UX-DR1
- NFR-P3 (dashboard page load < 2s) has no dedicated test or story AC — needs a performance benchmark story or explicit acceptance in architecture
- NFR-R2 (99.5% uptime) has no monitoring story — Sentry covers errors but not uptime alerting

---

## Epic Quality Review

### Best Practices Compliance Matrix

| Epic | User Value | Independence | Story Sizing | ACs Quality | Verdict |
|------|-----------|--------------|--------------|-------------|---------|
| Epic 1: Project Foundation | ⚠️ Technical | ✓ | ✓ | ✓ | See note |
| Epic 2: Generative App Creation | ✓ | ✓ | ✓ | ✓ | PASS |
| Epic 3: Dashboard & Data Management | ✓ | 🔴 Forward dep | ✓ | ✓ | FAIL |
| Epic 4: Auth, Claim & Team Access | ✓ | ✓ | ✓ | ✓ | PASS |
| Epic 5: Conversational Schema Editor | ✓ | ✓ | ✓ | ✓ | PASS |
| Epic 6: Public Intake Forms | ✓ | ✓ | ✓ | ✓ | PASS |
| Epic 7: Billing & Subscription | ✓ | ✓ | ✓ | ✓ | PASS |
| Epic 8: Localization, PIPEDA & Offboarding | ✓ | ✓ | ✓ | ✓ | PASS |
| Epic 9: PWA, Accessibility & Polish | ⚠️ Cross-cutting | ✓ | ✓ | ✓ | See note |

---

### 🔴 Critical Violations

**VIOLATION 1: Epic 3 has a forward dependency on Epic 4 (Authentication)**

Epic 3 (Dashboard & Data Management) is sequenced BEFORE Epic 4 (Authentication), yet multiple Epic 3 stories reference authenticated concepts that cannot exist until Epic 4 is complete:

- Story 3.1 AC: *"Given an authenticated user navigates to /dashboard"* — requires Supabase session (Epic 4)
- Story 3.1 AC: *"Given the authenticated user is a Member"* — requires role metadata set at invite (Epic 4)
- Story 3.2 AC: *"Given an Admin opens the column action menu"* — requires Admin role (Epic 4)
- Story 3.5 AC: *"org-{organizationId} Supabase Realtime channel"* — requires `organization_id` from claimed org (Epic 4 claim flow)

**Impact:** Every Story 3.x acceptance criterion referencing "Admin," "Member," or `organizationId` is untestable until Epic 4 is complete. Epic 3 stories cannot technically be completed before Epic 4 stories, violating the Epic N cannot require Epic N+1 rule.

**Remediation Options:**
1. *(Preferred)* Reorder the epics: 1 → 2 → 4 → 3 → 5 → 6 → 7 → 8 → 9. Epic 4 (Auth/Claim) enables the authenticated context that Epic 3 stories require.
2. Split Epic 3: Story 3.x for pre-auth anonymous CRUD (usable from Epic 2 shell) completes before Epic 4; full authenticated CRUD stories complete after Epic 4.

---

### 🟠 Major Issues

**ISSUE 1: Epic 1 is a technical milestone with no direct user value**

Epic 1 ("Project Foundation & Developer Infrastructure") describes purely developer-facing work: project initialization, Supabase setup, RLS policies, Schema Validator, Gemini client, CI/CD pipeline. Users receive zero value from this epic — no feature, no UI, no interaction is available after Epic 1 completes.

*Mitigating context:* Epic 1's blocking gates (RLS isolation test, Schema Validator) are non-negotiable security requirements that every subsequent epic depends on. This justifies the sequencing. Additionally, Story 1.3 directly implements FR44 (RLS isolation) which is a hard PRD security requirement. The epic functions as a mandatory pre-condition, not a product increment.

*Recommendation:* Acknowledge Epic 1 as a technical prerequisite sprint rather than a product delivery, and ensure it does not consume user-story velocity. Consider labeling it "Sprint 0" to set correct expectations with stakeholders.

**ISSUE 2: Epic 9 deferred accessibility creates retroactive cross-cutting work**

Epic 9 introduces `jest-axe` CI accessibility gates, semantic HTML landmark structure, bilingual ARIA, and reduced motion support — all of which require modifying components built in Epics 2–8. Story 9.3 explicitly states: *"when src/app/dashboard/layout.tsx and marketing layouts are audited and updated..."* — this is retroactive work against already-completed epics.

Additionally, Story 9.5 introduces a `jest-axe` CI gate that *blocks all future PRs* on accessibility violations. If components from Epics 2–8 haven't been built with accessibility in mind, this gate will block the entire team at the point Epic 9 is implemented.

*Recommendation:* Add a minimal accessibility definition of done to each epic (48×48px touch targets, visible form labels, ARIA roles on key components) rather than deferring all accessibility to Epic 9. Epic 9 can remain for the CI gate and bilingual ARIA, but each epic should not ship components that would fail the future axe gate.

**ISSUE 3: Organizations schema migration split across non-sequential epics**

The `organizations` table is created in Story 1.2 (Epic 1) with base columns. Epic 7 Story 7.1 then adds: `subscription_status`, `trial_ends_at`, `stripe_customer_id`, `stripe_subscription_id`, `canceled_at`, `trial_reminder_12_sent`, `trial_reminder_14_sent`. Epic 8 Story 8.4 further adds: `grace_period_ends_at`, `offboarding_day1_sent`, `offboarding_day7_sent`, `offboarding_day25_sent`, `data_deleted_at`.

Each "migration" spans a different epic. If a developer implements Epic 7 Story 7.1 before implementing Epic 1 Story 1.2 (which shouldn't happen, but the migrations themselves have implicit ordering), or if a migration is missed, downstream code will fail silently with missing columns.

*Recommendation:* Consolidate the full final `organizations` schema into a single migration in Story 1.2, even if columns are initially unused. Alternative: the story ACs for 7.1 and 8.4 should explicitly state "run migration `YYYYMMDD_add_billing_columns.sql`" to make the migration step unambiguous.

---

### 🟡 Minor Concerns

**CONCERN 1: Story 2.1 references non-existent UX-DR23**

Story 2.1 Acceptance Criteria: *"the Mad Libs prompt builder must guide users (FR1, UX-DR23)"* — UX-DR23 does not exist. The UX Design Requirements in the epics are numbered UX-DR1 through UX-DR20. This is a documentation error; the intended reference is UX-DR1 (Mad Libs prompt builder).

*Fix:* Change `UX-DR23` to `UX-DR1` in Story 2.1.

**CONCERN 2: Epic 1 story count and size**

Epic 1 has 6 stories with considerable complexity. Story 1.6 (CI/CD Pipeline) alone covers lint gates, type-check, unit tests, integration test enforcement, Vercel integration, and README setup. These are 4–5 distinct deliverables bundled into one story. For a solo technical founder context this is acceptable, but it carries risk: if Story 1.6 is partially done, the CI gate doesn't exist and the blocking protection is lost.

*Recommendation:* Consider splitting Story 1.6 into (a) CI pipeline with lint + type-check + test gates and (b) Vercel deployment automation.

**CONCERN 3: Story 3.5 real-time sync assumes Epic 4 org context**

Story 3.5's Acceptance Criteria creates a Supabase Realtime channel named `org-{organizationId}` — but `organizationId` doesn't exist until the claim flow in Epic 4 Story 4.1. Pre-auth anonymous users (from Epic 2) only have a `session_id`, not an `organizationId`. The story needs a clause covering the anonymous session case or explicit scoping to post-auth sessions only.

**CONCERN 4: `SubscriptionContext` referenced across multiple epics without a single creation story**

`src/context/SubscriptionContext.tsx` is referenced in Story 7.1, 7.2, 7.3, and 7.4. However, the creation of this context is implied by Story 7.1 but not explicitly defined with an AC. Since multiple stories depend on it, it should have an explicit "Create SubscriptionContext" AC in Story 7.1 to avoid the context being partially implemented by different developers.

---

### Quality Assessment Summary

- **7 of 9 epics** fully pass quality review with no violations
- **1 critical violation**: Epic 3 forward dependency on Epic 4 — requires epic reordering or story restructuring before implementation begins
- **2 major issues**: Technical Epic 1 (accepted with caveats), deferred accessibility in Epic 9 (requires mitigation strategy)
- **4 minor concerns**: Fixable in-place without restructuring

**Overall Epic Quality:** CONDITIONALLY ACCEPTABLE — the forward dependency between Epic 3 and Epic 4 must be resolved before the implementation sprint sequence is finalized.

---

## Summary and Recommendations

### Overall Readiness Status

**NEEDS WORK**

The Scheza planning artifacts demonstrate exceptional thoroughness — 45 FRs with 100% traceability, a complete architecture, a detailed UX specification, and 35+ stories with BDD acceptance criteria. However, two blocking issues prevent a clean "READY" verdict: one makes the sprint sequence technically unexecutable as written, and the other requires an architectural decision before a feature can be correctly scoped.

Both issues have clear remediation paths that do not require reworking the core product vision. They can be resolved in a focused half-day planning correction.

---

### Critical Issues Requiring Immediate Action

**CRITICAL 1 — Epic sequence is unexecutable as written (Epic 3 → Epic 4 forward dependency)**

Epic 3 cannot be completed before Epic 4 because 4 of its 5 stories require authenticated sessions, Admin/Member roles, and `organizationId` — none of which exist until Epic 4's claim flow runs. Attempting to implement Epic 3 first will produce untestable stories and code that cannot be integration-tested.

- **Action:** Reorder the implementation sequence to: **1 → 2 → 4 → 3 → 5 → 6 → 7 → 8 → 9**
- **Files to update:** `epics.md` — change Epic 3 and Epic 4 sequence numbers, or add an explicit "Implementation Order" note overriding the document order
- **Effort:** 30 minutes to reorder and verify no other cross-epic dependency violations are introduced

**CRITICAL 2 — FR28 "Admin notification on intake submission" has no push infrastructure (architecture gap)**

The PRD-level text specifies "push/email" notification. The UX spec requires testing "Push notifications on iOS 16.4+ and Android Chrome." The architecture implements email only (Resend). There are no VAPID keys, no `PushManager` API, no push subscription table, and no web push service worker integration documented anywhere.

This is a decision that must be made before implementation of Story 6.2:

- **Option A (Recommended — email-only for MVP):** Update FR28 in the PRD to read "Admin receives an email notification when a new intake form submission is received." Remove push testing requirements from UX spec. This is consistent with MVP scope and saves 2–4 sprint days. Push notifications can be added in Growth phase.
- **Option B (Push + email):** Add to architecture: VAPID key pair generation, `push_subscriptions` table in Supabase, `web-push` npm package, service worker `push` event handler in `public/sw.js`, `usePushNotifications.ts` hook. Estimated effort: 8–12 hours of additional architecture and implementation work.

A decision on this must be made and documented in both the PRD and architecture before a developer begins Story 6.2.

---

### Recommended Next Steps

1. **Reorder implementation epics** — Update `epics.md` to reflect the corrected sprint sequence (1→2→4→3→5→6→7→8→9). Update any cross-references that mention "Epic 3 before Epic 4."

2. **Decide and document FR28 notification scope** — Choose Option A (email-only, update PRD + UX spec) or Option B (email + push, update architecture). Write the decision into both `prd.md` and `architecture.md` before Sprint 1 planning.

3. **Add `relation` to ColumnType or explicitly exclude it from MVP** — The architecture's ColumnType definition (`'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'email' | 'phone' | 'currency'`) does not include `relation`. The UX spec maps `relation` to a searchable select component. Without this type, Gemini-generated relational columns will be rejected by the Schema Validator. Either: (a) add `'relation'` to `ColumnType` in `architecture.md` and add `add_relation` to the Schema Validator allowlist with the join-column convention, or (b) add a story AC note that Gemini's system prompt must not generate relation columns until Growth phase.

4. **Add per-epic accessibility baseline to Definition of Done** — Before Epics 2–8 generate components, define a minimal a11y checklist in each epic's DoD: 48×48px touch targets, visible form labels, ARIA roles on interactive components. This prevents the Epic 9 `jest-axe` CI gate from blocking an already-full component library.

5. **Resolve five editorial corrections (no impact on implementation, but fix before developer handoff):**
   - Fix `UX-DR23` → `UX-DR1` in Story 2.1
   - Add "anonymous session pre-auth" clause to Story 3.5 Realtime channel naming (covers pre-claim users)
   - Add explicit "Create SubscriptionContext" AC to Story 7.1
   - Clarify Story 1.6: split into (a) CI lint/type-check/test gates and (b) Vercel deployment automation
   - Clarify photo upload in UX Journey 4 (Priya): either add as FR, or annotate the flowchart as "Growth phase feature — not in MVP"

---

### Issue Count Summary

| Severity | Count | Details |
|----------|-------|---------|
| 🔴 Critical | 2 | Epic 3/4 sequence violation; FR28 push infrastructure gap |
| 🟠 Major | 3 | Epic 1 technical milestone; Epic 9 deferred a11y; Organizations schema split |
| 🟡 Minor | 4 | UX-DR23 typo; Story 1.6 oversized; Story 3.5 pre-auth channel; SubscriptionContext creation |
| ℹ️ Informational | 4 | Photo upload scope; PIPEDA PDF expectation; relation type gap; sort/filter persistence |
| **Total** | **13** | Across 4 categories |

### Strengths Worth Noting

Before proceeding, it is worth acknowledging what this planning work gets right — because it gets most things right:

- **FR traceability is exceptional.** All 45 FRs have named epic + story coverage. The epics document contains an explicit FR Coverage Map — a practice rarely seen in MVP-stage planning. This will save significant debugging time during implementation.
- **Security posture is thorough.** The Schema Validator, identity masking system prompt, RLS CI gate, and service key lint rule are all specified with concrete enforcement mechanisms, not aspirational statements.
- **The deferred auth pattern is well-scoped.** Anonymous localStorage session → claim → Supabase Auth is a complex flow that many PRDs leave ambiguous. This one specifies it cleanly at every layer.
- **PIPEDA compliance is first-class.** Consent timestamp, Canadian data residency, grace-period cascade delete, and data portability are all explicit requirements with story coverage — not afterthoughts.
- **The Hard Fallback Schema is a good product decision.** FR4 (Universal Field Service Template on double LLM failure) is a simple, effective reliability pattern. Its coverage in Story 2.4 is concrete.

---

### Final Note

This assessment identified **13 issues across 4 categories**. Two are critical and must be resolved before the implementation sprint sequence can be finalized. The remaining issues are addressable in-place with targeted edits to the planning artifacts — no rework of the core product vision is required.

The planning artifact set (PRD, Architecture, UX Spec, Epics) is of high quality and demonstrates that the product requirements are well understood. With the two critical items resolved, the project can proceed to Phase 4 implementation with confidence.

---

*Assessment performed: 2026-05-18*
*Assessor: Claude Code (BMAD Implementation Readiness Skill)*
*Documents assessed: prd.md (671 lines), architecture.md (800+ lines), ux-design-specification.md (1480 lines), epics.md (126 KB)*
