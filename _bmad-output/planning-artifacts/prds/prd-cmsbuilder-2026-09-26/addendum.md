# Addendum — Relationships & Lookups (for downstream: architecture, epics)

Depth captured during the 2026-09-26 PRD update that belongs downstream, not in the PRD body.

## Storage model (for architecture)
- Data lives in the shared `public.records` table (`organization_id` + `table_key` + `data` JSONB); there are no physical per-tenant tables and no DB-level foreign keys.
- A relationship value is stored inside `records.data` as the **target record's UUID** (`cardinality:'one'`, scalar string) or a **UUID array** (`'many'`, multi-select, Growth FR79). Store the ID, resolve the display label at read time — never store the label (it breaks on rename).
- `SchemaField` gains `relationConfig { targetTable, cardinality }` (**field-level**). `displayField` is **table-level** on the `org_schemas` table entry (one canonical label per table), NOT inside relationConfig — it backs FR75. It defaults to the first non-hidden text field and cannot be hidden/removed while a relation targets that table.
- Referential integrity is **app-layer only** (Zod + the `src/lib/data/mutate.ts` guarded layer). The FR76 delete guard enumerates referencing `(table_key, field)` pairs from `org_schemas`, counts via containment (capped, e.g. "500+"), warns, then soft-deletes (`deleted_at`); referencing rows render the target as "archived". On every relation *write*, the layer also verifies each id exists under the same org + `targetTable` (stops a planted foreign/dangling id — RLS only guards reads).

## Querying (for architecture)
- Index: one `GIN (data jsonb_path_ops)` on `records`. Forward resolution (labels in tables/cards, FR73): batched `id IN (...)` lookup for the rendered page — avoid N+1.
- Reverse related list (FR77) and the delete-guard count use **containment only**: scalar → `data @> jsonb_build_object(field, to_jsonb(id))`; array → `data @> jsonb_build_object(field, jsonb_build_array(id))`. Never `->>` text-extraction (won't use the GIN index → seq scan at 50k rows).
- Validator is two-pass (collect all batch `table_key`s, then validate `targetTable` against the full set); self-reference and cycles are legal. Phase/source gating (`validate(op, {phase, source})`) enforces multi-select and editor-created relations as Growth-only.
- Picker typeahead (FR72) and related lists must be server-side/paginated to satisfy NFR-P9 at 50k rows.

## Security (for architecture)
- RLS is a single org-scoped policy on the one `records` table, so both sides of a relationship are already inside the same tenant boundary — cross-table lookups within an org need **no new policy**.
- Widening the Schema Validator to accept a `relation` op (NFR-S7) is the largest LLM-attack-surface change. MVP accepts relation shapes on the **strict-JSON generation path**; the **open-ended Conversational Editor** relation path is Growth (FR80). Restricted-keyword rejection (NFR-S4) and NFR-S5 hardened prompt are unchanged.
- Update Gemini's hardened system prompt to *permit* relation proposals at generation time while retaining all existing rejections.

## Rejected / deferred alternatives
- **Store the display label instead of the UUID** — rejected: breaks on target rename, recreates the "spelled three ways" chaos.
- **All-in MVP (full parity)** and **all-in Growth (defer everything)** — both rejected in favour of the split (see `.memlog.md`): core in MVP because the product *promises* "relational"; advanced in Growth to protect solo-founder bandwidth and the validator surface.
- **Relation picker on public intake forms** — rejected (FR78): would leak the tenant's client list to anonymous submitters (PIPEDA).

## Open nuance for architecture (also an Open Question in the PRD)
- MVP import (Tier 1) into a relationship field: proposed behaviour is exact display-label match reusing the FR49–FR51 confirm/flag flow, with fuzzy + create-if-missing matching deferred to FR81 (Growth). Confirm before building the import mapper against relationship targets.
