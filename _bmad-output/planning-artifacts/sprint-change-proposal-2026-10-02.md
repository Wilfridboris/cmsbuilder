# Sprint Change Proposal — Epic 5 Gaps & List-of-Values Field Type

- **Date:** 2026-10-02
- **Author:** Boris (with Dev agent)
- **Trigger epic:** Epic 5 — Conversational Schema Editor (Append-Only, Guarded)
- **Status at trigger:** Epic 5 stories 5.1–5.4 `done`, 5.5 `review` (epic effectively complete)
- **Change scope classification:** **Major** — adds one new MVP epic, four new FRs, and data-model changes to the architecture. Implementation of each individual story is Moderate; the planning-artifact surface is what makes this Major.

---

## Section 1 — Issue Summary

While reviewing Epic 5 at completion, four issues were raised. Three are genuine gaps in the current plan; one is already mostly covered and is being deliberately scoped out.

1. **No way to remove a view.** Story 5.3 lets an Admin *create* a view, but no story lets them *remove* one. Because a view is pure metadata (a saved filter/sort over existing rows — it stores no data of its own), removal is inherently non-destructive. Views currently accumulate with no cleanup path.

2. **No safe way to clear away a table.** Table deletion is correctly blocked by the Append-Only constraint (it would lose data). But there is no non-destructive alternative, so a table added by mistake (e.g. via chat) is stuck on the dashboard forever.

3. **Empty records can be saved.** Story 3.2's Add form has no non-empty validation. A completely blank record can be written. Separately, there is no clear notion of which fields are *required*.

4. **No single-select / list-of-values ("picklist") field type.** The PRD's own user journeys assume dropdowns exist — "selects *Service Complete* from a dropdown" (prd.md:181), "Type of Issue (dropdown: No Heat / No Cooling / …)" (prd.md:217) — and Story 3.2 says forms render "text, number, date, **dropdown**, etc." (epics.md:827). **But the data model has no such type:** `FieldType = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'email' | 'phone' | 'currency' | 'relation'` (architecture.md:982), and `SchemaField` has no `options`. The dropdown the product promises has nothing behind it, so a "status" field today is just free text ("paid", "Paid!!", "pd").

**Evidence base:** PRD §"Conversational Editor — Append-Only Constraint" (prd.md:612–629); `FieldType`/`SchemaField`/`SchemaOperation` (architecture.md:960–993); Epic 5 Stories 5.1–5.5 (epics.md:1085–1198); Epic 3 Story 3.2 (epics.md:817–839); sprint-status.yaml Epic 5 all `done`/`review`.

---

## Section 2 — Impact Analysis

### Guiding principle
The product's core promise is **Append-Only, Guarded: the editor may only do things that cannot lose data** (prd.md:612–629, FR16/FR17). Every decision below is tested against that rule:

- **Removing a view is permitted** precisely because a view holds *no rows* — the append-only guarantee is about *data*, and views have none.
- **A table is never truly deleted**; it is *hidden* (reversible), reusing the append-only visibility mechanism already built for column-hide (Story 3.5 / 5.5).
- **A list value in use is never deleted**; it is *archived* — old records keep it, new records can't pick it. Same append-only idea, applied to a value set.

### Epic impact
| Epic | Impact |
|------|--------|
| **Epic 5** (Conversational Editor) | Two new additive stories: delete-view, hide-table. |
| **Epic 3** (Core Data) | One new validation story (non-empty + required). |
| **NEW Epic 13** (List-of-Values field) | New MVP epic housing the cross-cutting single-select field type. |
| **Epic 1** (Generation) | AI generation + hard-fallback template can emit `select` fields (handled inside Epic 13). |
| **Epic 4** (CSV import) & **Epic 6** (Intake forms) | `select` renders as a dropdown on both surfaces — additive (handled inside Epic 13). |
| **Epic 12** (Invoicing) | No change. Invoice auto-numbering (FR86) already exists — see out-of-scope note. |

### Artifact conflicts
- **PRD:** add FR96–FR99; update the Append-Only Constraint section and the capabilities table (prd.md:599).
- **Architecture:** extend `FieldType`, `SchemaField`, `SchemaOperation`; add `SelectOption`; extend the Schema Validator allowlist; add a changelog entry.
- **UX:** view-tab overflow menu + Undo toast; "Hidden tables" restore surface; dropdown cell + value manager; required-field marker + inline errors.

### Technical impact
- `org_schemas` tables gain a table-level `hidden?: boolean` (mirrors the field-level `hidden?`).
- No row migration anywhere — all changes are additive metadata edits, consistent with the JSONB `records` store.
- Validator: new op names (`remove_view`, `hide_table`, `add_select_option`, `rename_select_option`, `archive_select_option`) contain **none** of the 8 restricted keywords, so the blocklist is unchanged; new allowlist rules must ensure each op only touches its intended object type.

---

## Section 3 — Recommended Approach

**Selected path: Direct Adjustment + one new epic (Hybrid).** Nothing already built is rolled back or thrown away; every change is additive, matching the append-only philosophy. The single-select field type is cross-cutting, so it gets its own epic (the same pattern used to isolate Relationships) rather than reopening finished epics.

- **Effort:** Medium (one new ~6-story epic + 3 small stories).
- **Risk:** Low. All changes are additive; no destructive migrations; no rework of shipped code.
- **Timeline:** Fits as a follow-on sprint; no existing MVP commitment is invalidated.

### Decisions locked with the user
| Topic | Decision |
|-------|----------|
| Delete a view | **Yes** — add a safe, non-destructive remove-view op with Undo. |
| Delete a table | **No real delete** — keep unsupported; add reversible **hide table** + restore. |
| List field colors | **Plain, no colored pills.** |
| List field cardinality | **Single-select only** (no multi-select). |
| List field setup | **Via AI chat** — "add a status field with Paid, Unpaid, Rejected" creates field + values in one go; "add a value Partially Paid" later. |
| Inline value add | **Yes** — an Admin-only "+ Add value" inside the dropdown for quick in-context additions (reuses `add_select_option`). |
| Removing a list value in use | **Archive, not delete** — existing records keep it; not selectable for new records. |
| Empty records | **Block a fully-empty row only.** |
| Required fields | **Deferred** — no per-field required enforcement for now (keeps fast mobile entry frictionless). |
| Auto-increment (INV01…) | **Out of scope for MVP** (see below). |

### Out of scope / deferred
- **General auto-increment field type** (Job #, Quote #, etc.): deferred to **Growth**. Invoice numbering (FR86, Epic 12) already covers the primary case. A gapless, race-safe, per-tenant sequence is disproportionate engineering for MVP and nothing in MVP requires it.
- **Multi-select** list values: deferred to Growth (mirrors the relation one/many split).
- **Colored value pills / per-value styling:** deferred (user chose plain).

---

## Section 4 — Detailed Change Proposals

### 4A. PRD — new functional requirements

```
NEW:
- FR96: A field can be a single-select "list of values" (picklist). Its value set is
  created and managed through the Conversational Editor (add a value, rename a value's
  label, archive a value). Removing a value that is already used archives it
  non-destructively — existing records keep the value; it is no longer selectable for
  new records. Single-select only (multi-select is Growth).
- FR97: Admin can remove a view through the Conversational Editor. Removal is
  non-destructive because a view stores no rows; an Undo is offered.
- FR98: When a user requests deletion of a table, the system does not delete it; it
  offers a non-destructive "hide table" (append-only visibility). Hidden tables retain
  all rows and can be restored at any time.
- FR99: The Add/Edit form rejects a completely empty record (every field blank) with an
  inline, non-technical message and no write. (Per-field required enforcement is deferred.)
```
*Rationale:* FR96 backs the dropdowns the PRD already promises; FR97/FR98 close the create-but-never-remove / no-safe-cleanup gaps within the append-only rule; FR99 closes the minimum data-quality gap without adding mobile-entry friction.

### 4B. PRD — Append-Only Constraint section (prd.md:612–629)

```
OLD:
**What the AI CAN do in V1:**
- Add a new column to an existing table
- Add a new table
- Generate a new view (filtered or sorted presentation of existing data)

**What the AI CANNOT do in V1:**
- Delete a table
- Delete a column
- Rename an existing column or table

NEW:
**What the AI CAN do in V1:**
- Add a new column to an existing table (including single-select list-of-values fields)
- Add a new table
- Generate a new view, and REMOVE a view (safe — a view stores no rows)
- Manage list-of-values on a single-select field: add a value, rename a value's label,
  archive a value (archive, never delete, when the value is already in use)
- HIDE a table or column (non-destructive, restorable) in place of deletion

**What the AI CANNOT do in V1:**
- Delete a table or column (offers a non-destructive HIDE instead)
- Rename an existing column or table key (labels may be renamed; the stored key is stable)

Note: removing a view is the one removal that is permitted, precisely because the
Append-Only guarantee protects *data* and a view has none.
```

### 4C. PRD — capabilities table (prd.md:599)

```
OLD:
| Conversational Editor | **Append-Only** — add tables, add columns, generate views only |

NEW:
| Conversational Editor | **Append-Only** — add tables/columns (incl. single-select lists), generate & remove views, manage list values (add/rename/archive), hide (not delete) tables/columns |
```

### 4D. Architecture — type model (architecture.md:960–993)

```
OLD:
type SchemaOperation =
  | { type: 'add_field'; tableKey: string; field: SchemaField }
  | { type: 'add_table'; tableKey: string; fields: SchemaField[]; reason?: string }
  | { type: 'add_view'; name: string; sourceTableKey: string; filters?: Filter[] };

type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'email' | 'phone' | 'currency' | 'relation';

NEW:
type SchemaOperation =
  | { type: 'add_field'; tableKey: string; field: SchemaField }
  | { type: 'add_table'; tableKey: string; fields: SchemaField[]; reason?: string }
  | { type: 'add_view'; name: string; sourceTableKey: string; filters?: Filter[] }
  | { type: 'remove_view'; name: string }                                  // FR97 — safe (no rows)
  | { type: 'hide_table'; tableKey: string }                               // FR98 — non-destructive
  | { type: 'add_select_option'; tableKey: string; fieldKey: string; option: SelectOption }    // FR96
  | { type: 'rename_select_option'; tableKey: string; fieldKey: string; value: string; label: string }  // FR96
  | { type: 'archive_select_option'; tableKey: string; fieldKey: string; value: string };      // FR96

type FieldType = 'text' | 'number' | 'boolean' | 'date' | 'datetime' | 'email' | 'phone' | 'currency' | 'relation' | 'select';

// A 'select' field is a single-choice list of values (FR96). Its value in records.data is
// one option `value`. Managed via the Conversational Editor; multi-select is Growth.
type SelectOption = {
  value: string;        // stable stored key written into records.data (normalized)
  label: string;        // display text; rename = edit this, stored value is unchanged
  archived?: boolean;   // append-only "archive": kept for existing rows, not selectable for new
};
```

And extend `SchemaField`:

```
OLD:
  relationConfig?: RelationConfig; // required when dataType === 'relation' (FR70–FR72)

NEW:
  relationConfig?: RelationConfig; // required when dataType === 'relation' (FR70–FR72)
  options?: SelectOption[];        // required when dataType === 'select' (FR96)
```

And the logical-table shape gains a table-level hide flag:

```
NEW (org_schemas table metadata):
  hidden?: boolean;   // append-only table hide (FR98) — mirrors field-level hidden; rows retained
```

### 4E. Architecture — Schema Validator allowlist

```
OLD (allowlist): add_table, add_field, add_view
NEW (allowlist): add_table, add_field (incl. dataType 'select' + options),
                 add_view, remove_view, hide_table,
                 add_select_option, rename_select_option, archive_select_option

Validator rules to add:
- remove_view targets only an existing view name; never a table or field.
- hide_table sets the table-level hidden flag only; never drops rows or touches another table.
- add/rename/archive_select_option target only an existing field whose dataType === 'select'.
- archive_select_option NEVER removes the option object (sets archived:true) — guarantees
  existing records.data values stay valid (append-only).
- Blocklist unchanged: none of the new op names contain DROP/GRANT/TRUNCATE/DELETE/EXEC/--/;//*.
```

### 4F. Architecture — changelog entry (top of architecture.md, alongside the relation entry at :32)

```
NEW:
changes: 'Added single-select list-of-values field type (§List-of-Values); FieldType gains
''select'' + SelectOption + SchemaField.options. SchemaOperation gains remove_view (FR97),
hide_table (FR98), and add/rename/archive_select_option (FR96). org_schemas tables gain a
table-level hidden flag. Validator allowlist extended; blocklist unchanged. MVP FR96–FR99.'
```

### 4G. Epics — new Epic 13

```
NEW:
## Epic 13: List-of-Values (Single-Select) Field Type

A single-choice "picklist" field (e.g. Status: Paid / Unpaid / Rejected), created and
managed entirely through the Conversational Editor, rendered as a dropdown everywhere data
is entered. Plain (no colors), single-select only. Value management is append-only: add a
value, rename a value's label, and archive (never delete) a value that is in use. Reuses the
Gemini client + Schema Validator (Epic 1) and the guarded mutate.ts layer (Epic 3).

*(Covers FR96. NFRs: NFR-S4/S5 unchanged. UX: dropdown controls, value manager.)*

### Story 13.1: Single-Select Field in the Data Model & Validator
- FieldType gains 'select'; SchemaField gains options: SelectOption[]; SelectOption added.
- Validator accepts add_field with dataType 'select' + non-empty options; rejects malformed
  option sets; normalizes/dedupes option values; reserved-key rules unchanged.
- Unit tests: select add_field accepted; empty/duplicate options rejected; blocklist unchanged.

### Story 13.2: Render & Edit Single-Select Across Views & Forms
- Table + card views render a select value as plain text of its label (archived values still
  render for existing rows).
- Add/Edit forms render a dropdown of non-archived options (Story 3.2 control set).
- Inline edit (Story 3.3 pattern) uses the dropdown; optimistic + rollback preserved.
- The dropdown shows an Admin-only "+ Add value" affordance at the bottom (hidden for
  Members per Epic 2 RBAC); it calls the same validated add_select_option path (see 13.4).

### Story 13.3: Create a Single-Select Field (with Values) via Chat
- "add a status field with Paid, Unpaid, Rejected" produces a validated add_field op with
  dataType 'select' and the three options in one operation (FR96).
- Target-table inference/clarification reuses Story 5.1 behavior; writes nothing until target
  is confirmed.

### Story 13.4: Manage Single-Select Values (Chat + Inline, Append-Only)
- Add value: "add a value Partially Paid" → add_select_option. Also available as an Admin-only
  "+ Add value" inline in the dropdown (Story 13.2), using the same validated op; a value added
  inline is immediately selectable and persisted to org_schemas.
- Rename value label: rename_select_option edits label only; stored value key is stable.
- Remove value: archive_select_option — if the value is in use it is archived (existing rows
  keep it, not selectable for new); an unused value may be hard-removed. User-facing message
  explains the archive behavior; no row migration (FR96, aligns FR16).

### Story 13.5: Generation & Fallback Emit Select Fields
- AI schema generation (Epic 1) may propose select fields where appropriate (e.g. a Status
  on Jobs/Invoices) with a plain-language reason (FR46).
- The Universal Field Service hard-fallback template uses a select Status field.

### Story 13.6: Single-Select on Intake Forms & CSV Import
- Public intake form (Epic 6) renders a select field as a dropdown of non-archived options.
- CSV import (Epic 4) maps a source column onto a select field, flagging values that match no
  option for the user to resolve before import (reuses the FR49–FR51 confirm/flag flow).
```

### 4H. Epics — new Epic 5 stories

```
NEW:
### Story 5.6: Remove a View via Chat
As an Admin, I want to remove a view I no longer need, so my view list stays tidy.
- "remove the Unpaid view" → validated remove_view op (allowlisted); the view definition is
  removed from org_schemas. No rows are affected (a view stores no data) (FR97).
- The view-tab overflow menu also exposes "Remove view"; removal shows a confirm toast with
  Undo. No raw JSON/SQL/errors ever surfaced.

### Story 5.7: Hide a Table via Chat (in place of Delete)
As an Admin, I want a mistaken or unused table out of my way without losing its data.
- A "delete this table" request is answered with a safe message and an offer to HIDE it;
  on confirmation a hide_table op sets the table-level hidden flag (append-only). All rows
  are retained (FR98, aligns FR17/FR16).
- Hidden tables are listed in a restore surface (Settings) and can be unhidden unchanged.
- True deletion remains unsupported. (Supersedes the table-delete branch of Story 5.5's
  "safe message only" — 5.5's column-hide behavior is unchanged.)
```

### 4I. Epics — new Epic 3 story

```
NEW:
### Story 3.10: Non-Empty Validation on Add/Edit
As a team member, I want the form to stop me saving a completely blank record, so my data
stays usable.
- A completely empty record (every field blank) is rejected before any write to mutate.ts,
  with a translated, non-technical message (FR99).
- Applies to both the Add form and inline edit; failures never surface a raw error.
- Per-field required enforcement is deferred (not in this story) to keep fast mobile entry
  frictionless.
```

---

## Section 5 — Implementation Handoff

**Scope: Major** (new epic + PRD + architecture changes).

1. **Product Manager (PRD):** apply 4A–4C — add FR96–FR99, update the Append-Only section and capabilities table.
2. **Architect (architecture.md):** apply 4D–4F — type model, validator allowlist/rules, changelog entry.
3. **Product Owner:** apply 4G–4I to epics.md (new Epic 13 + Stories 5.6, 5.7, 3.10); add entries to sprint-status.yaml with status `backlog`; sequence Epic 13 after the Epic 5 close-out stories.
4. **Developer:** implement in order — Story 13.1 (model + validator) first (unblocks the rest), then 5.6 / 5.7 / 3.10 (small, independent), then 13.2 → 13.6. Run the post-commit Playwright manual review per project convention.

**Success criteria**
- A single-select field can be created and its values managed entirely from chat; dropdowns render on table/card, Add/Edit, inline edit, intake forms, and CSV import.
- Archiving an in-use value preserves existing records' values.
- A view can be removed (with Undo); a table can be hidden and restored; neither loses data.
- A fully-empty record cannot be saved; AI-marked required fields are enforced inline.
- Schema Validator CI covers the new ops; blocklist tests unchanged and still pass.

---

## Appendix — sprint-status.yaml additions (for PO)

```yaml
# Epic 5 close-out additions
  5-6-remove-a-view-via-chat: backlog
  5-7-hide-a-table-via-chat: backlog
# Epic 3 addition
  3-10-non-empty-validation-on-add-edit: backlog
# New Epic 13
  epic-13: backlog
  13-1-single-select-field-in-data-model-validator: backlog
  13-2-render-edit-single-select-across-views-forms: backlog
  13-3-create-single-select-field-with-values-via-chat: backlog
  13-4-manage-single-select-values-via-chat: backlog
  13-5-generation-fallback-emit-select-fields: backlog
  13-6-single-select-on-intake-forms-csv-import: backlog
```
