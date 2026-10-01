# Epic 5 Context: Conversational Schema Editor (Append-Only, Guarded)

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic lets an Admin evolve an app's structure by chatting in plain language — add a column, add a table, or create a filtered/sorted view — without ever touching a configuration screen. It is deliberately isolated as its own epic because it is the product's highest-risk surface: the only place where LLM output drives changes to a tenant's structure. Every request is forced through a hardcoded Schema Validator (operation allowlist, restricted-keyword rejection, reserved-key collision checks) and every rejection is logged for audit. Changes are strictly append-only and non-destructive; unsupported operations (delete/rename) never run a destructive migration and instead return a reassuring, non-technical message plus a safe frontend visibility change. The feature reuses the Gemini client and Schema Validator from the generation pipeline and is Admin-only per the RBAC epic.

## Stories

- Story 5.1: Add a Column via Chat
- Story 5.2: Add a Table via Chat
- Story 5.3: Create a View via Chat
- Story 5.4: Schema Validator Guardrails & Rejection Handling
- Story 5.5: Safe Handling of Unsupported Operations

## Requirements & Constraints

- The editor supports exactly three operations at MVP: add a field to a table, add a new table, and add a view (a filtered/sorted presentation over an existing table). This additive-only scope is a deliberate product constraint, not a technical limit.
- All existing row data must be preserved when any schema change is applied. Schema changes are metadata edits only — no row migration occurs.
- Every editor request must pass synchronous validation before anything is persisted. Validation checks an operation allowlist (`add_table`, `add_field`, `add_view` only), rejects names colliding with reserved record columns, and rejects any name containing a restricted keyword or raw SQL. Attempts to touch `organization_id`, auth tables, or RLS are rejected.
- Restricted keyword rejection must be 100% reliable, including mixed-case and embedded occurrences. The user-facing rejection message is fixed plain-language copy ("That change isn't allowed. Try describing what you'd like to add instead.").
- Every validator rejection must be logged with the requesting org's identifier and the raw LLM output, for audit review.
- Validator unit tests must run in CI and cover the full allowlist, the full blocklist (all keywords, including mixed-case/embedded), and reserved-column collisions.
- The LLM must never be a dependency for core CRUD. If the LLM is slow or unavailable, the editor degrades gracefully with a translated message while record view/add/edit/delete remain fully available.
- No raw JSON, SQL, schema object, or error stack is ever shown to the user — not on success, rejection, or unsupported requests.
- Unsupported operations (delete column, delete table, rename) must not execute any destructive migration. A "delete/hide column" request is satisfied by setting an append-only frontend visibility flag; the underlying field definition and data stay intact.
- Success is measured by users completing schema changes without hitting the rejection fallback in the large majority of attempts.

## Technical Decisions

- **No SQL is ever generated.** The data layer is a shared JSONB record store with logical schemas held as metadata, so LLM output is a structured JSON metadata shape — never DDL. The validator's job is structural shape/allowlist checking, not SQL-injection defense. "No raw SQL" is itself a hard rule: any LLM response containing SQL is discarded as a security violation.
- **Authoritative schema metadata** lives in a per-org schema definition store. A field add, rename (label change), or hide is a metadata edit against this definition — no migration, no data movement. The dashboard renders from this definition.
- **Operation shape (LLM output, validated before persistence):** a discriminated union of `add_field` (table key + field), `add_table` (table key + field list + optional reason), and `add_view` (name + source table key + optional filters). Field definitions carry a normalized `key` (the JSONB key inside the record store), a type, a `hidden` flag for append-only soft-remove, and optional `reason`/`sensitive` metadata.
- **Validator internals:** a permitted-operations allowlist, a reserved-keys list (the record store's own columns such as `id`, `organization_id`, `table_key`, `data`, timestamps), and a blocked-keywords list. All table/field names are normalized before persistence. The validator returns a validity result with an optional error and a sanitized operation. It runs synchronously inside the API route path before any metadata write.
- **LLM access** goes through the shared timeout-wrapped Gemini helper, which always injects the hardened, non-overridable system prompt that constrains the model to describing table structure only, forbids viewing/modifying data, forbids SQL, and requires JSON-only output. Including this prompt on 100% of calls is a hard requirement.
- **Target inference:** when a field request omits a table, infer the target from the currently-viewed table only if unambiguous; otherwise ask a clarifying question in chat and write nothing until confirmed. Never silently guess.
- **Name collisions:** a proposed table or field name that collides with a reserved key or an existing table is normalized or safely disambiguated, never overwriting existing data.
- **Hide mechanism** reuses the same append-only frontend visibility flag used by the explainability "remove" override and record-management hide features — no destructive migration path exists.
- **Rejection flow:** validator rejection → audit log with org id + raw output → user-friendly plain-language message. LLM failure → silent single retry → graceful fallback, never an error screen.
- **Guardrail layering:** hardened system prompt → Schema Validator → tenant RLS → audit logging. This same fence is the template a future real-world action allowlist will follow, which is why the validator seam is kept clean.
- Conventions: utility functions are camelCase (e.g. the table-name normalizer, the system-prompt builder). The validator and prompts live under the schema lib.

## UX & Interaction Patterns

- A floating AI Assistant chat pill is fixed to the bottom-right of the dashboard, visible only to Admins (hidden for Members per RBAC).
- While a request is processing, show a "thinking…" bubble in an iMessage-style chat interface.
- Clarifying questions for ambiguous targets happen inline in the chat (e.g. "Which table should Price go on — Jobs, Invoices, or Clients?").
- On unsupported requests, respond reassuringly and non-technically (e.g. "To keep your data safe, I can't delete columns yet — but I've hidden [column] from your view. Your data is still protected."). Follow the no-em-dash copy rule for all user-facing text.

## Cross-Story Dependencies

- Story 5.4 (Schema Validator) is a blocking dependency for the entire editor — Stories 5.1–5.3 and 5.5 must all route through it, and the editor cannot ship without it.
- Reuses the Gemini client and Schema Validator established in the generation pipeline epic (Epic 1).
- Admin-only visibility and gating depend on the RBAC epic (Epic 2).
- Core CRUD and the realtime/data layer come from Epic 3; the editor must never become a dependency for those operations.
- The hide/visibility flag reuses the append-only hide mechanism shared with the explainability override and record-management features.
