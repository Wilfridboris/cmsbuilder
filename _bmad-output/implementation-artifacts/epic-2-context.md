# Epic 2 Context: Claim, Accounts & Team Access

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic converts an anonymous demo into a committed, live customer. A visitor claims their generated app via a passwordless magic link, accepts a mandatory privacy consent, and receives an isolated organization reachable at `snapbusy.ca/{slug}` with the synthetic demo data cleared and their pre-account schema overrides carried forward. The account creator becomes an Admin who can invite teammates by email and assign each an Admin or Member role. It delivers the complete authentication, org-provisioning, and role-based access control (RBAC) domain — the trust and access foundation every post-claim epic depends on. It also carries two generation-pipeline hardening fixes (2.5, 2.6) surfaced by the Epic 1 retrospective.

## Stories

- Story 2.1: Claim App via Magic Link ("Make it Real")
- Story 2.2: Passwordless Login for Returning Users
- Story 2.3: Invite Team Members with Roles
- Story 2.4: Role-Based Access Enforcement
- Story 2.5: Schema Validator — Stop False-Rejecting Legitimate Labels
- Story 2.6: Key Normalization — Preserve Accented / Non-ASCII Names (French Path)

## Requirements & Constraints

- Claiming requires a valid email plus an explicit, initially-unchecked privacy consent checkbox; the claim is hard-blocked and cannot proceed until consent is checked. Store a consent timestamp against the user on successful claim (PIPEDA obligation).
- Authentication is passwordless magic link only — no password is ever requested, for either first claim or returning login. Magic-link and account emails are delivered via Resend (as branded custom SMTP over the snapbusy.ca domain); token generation/verification stays with the auth provider.
- On successful claim: bootstrap the organization and its owning membership, assign the creator the Admin role, clear the synthetic demo data, provision a unique URL slug, and make the dashboard reachable under the org's tenant isolation. Pre-account schema overrides (fields the visitor removed/renamed pre-claim) must be carried into the live schema.
- Two roles only: Admin and Member. Member preselected by default at invite time. Members may view, add, and edit records but must not reach the Conversational Editor, Settings, Invite, or Billing surfaces. Admins have all surfaces; the creator retains Admin.
- RBAC must be enforced independently at the API, not only hidden in the UI: any schema-mutation, invite, billing, or settings route must verify the caller's role and reject a Member with a 403. Frontend hiding is never the sole enforcement.
- An invited member must be able to read the org's records immediately upon accepting, validating the invited-member isolation path.
- All traffic over TLS 1.2+; data encrypted at rest at the infrastructure level; tenant isolation active on all tenant data (verified by the RLS isolation gate).
- Hardening (2.5): the schema safety filter must accept ordinary business labels that merely contain a blocked keyword as a substring (e.g. "Grants", "Deleted?", "Drop-off time") and provision them as real (non-fallback) generations, while still rejecting genuine reserved-key collisions, unsupported/`relation` types, empty labels, and true blocked-keyword operations.
- Hardening (2.6): key normalization must convert accented/French names to readable ASCII keys (numéro→numero, coût→cout) without collapsing distinct names into false duplicate-key rejections, keep ASCII output byte-identical to today (no regression), and yield a deterministic non-empty `[a-z0-9_]` key for purely non-Latin input rather than rejecting on emptiness.

## Technical Decisions

- **Roles** are stored as `{ role: "admin" | "member" }` in the auth user's metadata, set at invite time; the account creator is always `admin`. Server-side role checks read the role from the JWT on every protected route.
- **Membership-based isolation:** tenant data lives in a shared JSONB `records` store with a single static RLS policy keyed on `organization_id` (a real FK to `organizations.id`, never a user UID). Isolation resolves through `auth_org_ids()` / an `org_members`-backed membership resolver, so invited members automatically gain read/write on their org's rows — this is why invites work without per-user grants. `org_members` carries a `principal_type` (`human | agent`) for a future non-human actor seam.
- **Session management:** post-claim sessions are cookie-based JWT sessions refreshed server-side in `src/middleware.ts` via `@supabase/ssr`; protected routes redirect unauthenticated users to the login entry point. Expired/invalid magic links must surface a clear, translated message with a re-request path — never an error screen.
- **Service-role discipline:** the service-role key is used only for the narrow claim-time org/membership bootstrap and other platform-bootstrap ops. All subsequent tenant writes go through the guarded mutation layer (`src/lib/data/mutate.ts`) under the user's RLS-scoped client. No tenant write may use the raw service-role key.
- **Anonymous → claim transition:** pre-claim demo state is held under an anonymous session; on claim it is re-keyed to the new organization and the demo data is cleared. Slug uniqueness is provisioned at claim time.
- **Relevant routes/surfaces:** claim (`/claim` page + POST route handling email→magic link→demo-to-live), invite POST route (sets role metadata), settings surface (invite/billing/export/offboarding). Follow the standard API contract: authenticate → validate input with Zod → business logic → `{ data, error }` envelope; never leak raw stacks/SQL/LLM output.
- **Hardening scope (2.5/2.6)** touches Epic 1 generation code (`src/lib/schema/validator.ts`, the key `normalizeTableName()` util) but ships under this epic; the real safety protections (reserved-key collision, unsupported/`relation` type, blocked-keyword operations, Sentry rejection logging) must remain unchanged.

## UX & Interaction Patterns

- **"Make it Real" claim handoff:** a prominent, high-contrast CTA on the demo dashboard triggers the magic-link claim. The consent checkbox is a hard blocker at this step and starts unchecked.
- All claim/login copy and validation messages resolve through the i18n layer (no hardcoded strings) and must be accessible; the flow never shows a raw error screen.

## Cross-Story Dependencies

- Depends on Epic 1: the data model (`records`/`org_schemas`), membership RLS + `auth_org_ids()`, the guarded `mutate.ts` write layer, and the pre-account schema-override mechanism (Story 1.7) that claim carries forward.
- Within the epic: Story 2.1 establishes the Admin creator and org that Stories 2.3–2.4 build on; 2.3 (invite) and 2.4 (enforcement) share the role model and the invited-member RLS path.
- Downstream: later epics rely on this epic's RBAC — e.g. the Conversational Editor and Billing surfaces are Admin-only per the enforcement established here; real-data CRUD (Epic 3) operates on the claimed, isolated org this epic provisions.
- Stories 2.5–2.6 are independent generation-pipeline fixes with no dependency on the auth/RBAC stories; they modify Epic 1 code and can proceed in parallel.
