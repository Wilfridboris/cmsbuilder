# Epic 4 Context: Data Import — CSV/Excel with AI Column Mapping

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

This epic delivers the product's primary activation event: letting a claimed account import its real business history from a spreadsheet instead of starting on empty tables. Because claiming an account clears the synthetic demo data, a user who cannot import lands on blank tables and bounces — so this must ship in immediate sequence after Core Data (Epic 3), not behind Editor/Intake/Billing. The user uploads a CSV or Excel file, receives an AI-proposed column-to-field mapping that "shows its work," edits any mapping, is forced to resolve columns the AI could not confidently map, then confirms — non-destructively replacing any remaining synthetic rows with real records while preserving all previously imported or manually entered real data. It reuses the Gemini generation intelligence and Schema Validator from Epic 1 and writes through Epic 3's guarded mutation layer; it depends on no future epic.

## Stories

- Story 4.1: Upload & Parse a Spreadsheet
- Story 4.2: AI-Proposed Column Mapping (Shown Before Any Write)
- Story 4.3: Edit Mapping & Resolve Flagged Columns
- Story 4.4: Confirm Import (Non-Destructive Replace)

## Requirements & Constraints

- Accept `.csv`, `.xls`, and `.xlsx` uploads; parse into columns and rows and show a preview of detected columns with sample values.
- The pipeline is strictly two-phase: an analyze phase (parse + propose mapping) writes nothing to tenant data; only an explicit user confirm triggers the commit/write phase.
- Propose a source-column → target-field mapping and display it as a visible, editable mapping table with per-match reasoning; every proposed match is overridable, and a column can be remapped, pointed at a new field, or skipped.
- Columns the AI cannot confidently map (below a confidence threshold) must be flagged, never silently guessed, and the user must resolve each (map or skip) before the Import action becomes available; attempting to proceed with unresolved columns is blocked with a clear indication of which columns remain.
- On confirm, any remaining synthetic/demo rows for the affected logical tables are cleared and replaced by imported real records with zero loss of existing real data.
- Import is unmetered by design — flat tiers include unlimited records and unlimited import; the only bound is the performance/size limit, enforced server-side for safety, not billing.
- Performance: the column-mapping preview renders within 5 seconds of upload; an import of up to 5,000 rows completes in under 60 seconds.
- Error handling: unreadable, empty, oversized, or non-spreadsheet files produce a translated, non-technical error with a retry path and no partial state; a mid-import failure must leave no half-corrupted table and surface a translated status, never a raw error.
- All user-facing strings resolve through the translation layer (no hardcoded copy).

## Technical Decisions

- **Server-side parsing only.** Use `papaparse` for CSV and `xlsx`/SheetJS for Excel. Never trust client-parsed rows; bound malformed or oversized files server-side.
- **Two API routes.** `POST /api/import/analyze` handles multipart upload → parse → Gemini-proposed mapping and returns an `ImportProposal`. `POST /api/import/commit` takes the confirmed mapping → clears synthetic rows → bulk-inserts. Nothing is written before commit.
- **Reuse the generation lib.** Mapping is the same "understand messy input, map to structure" problem as generation. Call Gemini through the shared `callGeminiWithTimeout()` with `HARDENED_SYSTEM_PROMPT`. Mapping output is structure-only and never emits DDL.
- **Schema Validator gate.** Any newly proposed field must pass the shared Schema Validator (append-only allowlist, restricted-keyword rejection) before it is offered in the mapping.
- **Guarded writes.** All row inserts flow through the guarded mutation layer (`src/lib/data/mutate.ts`) under the caller's RLS-scoped client. Identity is passed explicitly (the layer never reads request cookies); the service-role key is never used for import. Pass an `idempotencyKey` so a retried commit cannot double-write.
- **Write strategy on confirm.** Soft-delete synthetic `records` for the affected `table_key`s, then bulk-insert the mapped rows in one transaction; only synthetic data is replaced, real data is untouched. Invalidate the TanStack Query cache after commit.
- **Data model.** Tenant rows live in the shared JSONB `records` store keyed by `table_key`; a logical "table"/field is defined in `org_schemas`. There is no runtime DDL — importing into a new field is a metadata change plus row inserts. Apply `normalizeTableName()` to any user-provided table/field names before persistence.
- **Import types.** `ColumnMapping { sourceColumn, target: {table, field} | null, confidence, reason? }` and `ImportProposal { fileId, rowCount, mappings, unmapped }`. A `null` target means unmapped and must be resolved; `unmapped` blocks commit until cleared. API bodies use `snake_case`, TypeScript uses `camelCase`, dates are ISO 8601.
- **Response contract.** Routes authenticate the session, validate input with Zod, and return the `{ data, error }` envelope; never expose raw stacks, SQL, schema JSON, or LLM output to the client.

## UX & Interaction Patterns

- **Visible, editable import mapping ("shows its work").** The core surface is a mapping table of source-column → target-field, each row editable, with unmappable columns visibly flagged for resolution before any commit — the same trust surface as schema generation. Suggested components: an upload dropzone, the editable mapping preview, and a commit progress indicator (synthetic cleared → real rows inserted).
- Accessibility carries over from the platform baseline: minimum 48×48px touch targets, real (non-placeholder-only) form labels, and WCAG AA contrast.

## Cross-Story Dependencies

- Depends on **Epic 1** (shared JSONB data model, `org_schemas`, Gemini client + `HARDENED_SYSTEM_PROMPT`, Schema Validator) and **Epic 3** (guarded `mutate.ts` write layer, real claimed org data). Also depends on **Epic 2** (a claimed account; import is an Admin action).
- Overlap with Epic 5 (Conversational Editor) is incidental lib-layer sharing of the Gemini + Validator utilities, not shared UI — Epic 5 is not required.
- Relationship-aware CSV import (matching source values to existing referenced records) is deferred to Growth (Epic 9) and out of scope here.
- Internal story order: 4.1 (upload/parse) → 4.2 (propose mapping) → 4.3 (edit/resolve) → 4.4 (confirm/commit), each building on the prior story's output.
