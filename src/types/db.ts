/**
 * Database row + logical-schema types for the shared-JSONB tenant model
 * (Story 1.2). Shared by the guarded write layer (`mutate.ts`), the read
 * layer (`records.ts`), the seed script, and the RLS isolation test.
 *
 * There is NO per-tenant physical table: a "table" is logical — a `table_key`
 * plus a `TableDefinition` in the org's `org_schemas.definition`.
 */

/** A single field within a logical table definition. */
export type FieldDefinition = {
  /** Normalized snake_case key used inside `records.data`. */
  key: string;
  /** Human-facing column label (rename edits this, not `key`). */
  label: string;
  /** Rendering/validation hint. `relation` is excluded from MVP. */
  type: "text" | "number" | "date" | "boolean" | "currency";
  /** Plain-language reason this field exists (FR46 explainability). */
  reason?: string;
  /** Append-only hide flag — a display concern, never a data delete. */
  hidden?: boolean;
  /** Marks PII for PIPEDA handling (FR40). */
  sensitive?: boolean;
};

/** A logical table: a normalized key + its ordered field definitions. */
export type TableDefinition = {
  /** Normalized snake_case logical-table key (matches `records.table_key`). */
  key: string;
  /** Human-facing table label. */
  label: string;
  /** Plain-language reason this table exists (FR46 explainability). */
  reason?: string;
  /** Ordered field definitions rendered as columns. */
  fields: FieldDefinition[];
};

/** The full authoritative logical schema stored in `org_schemas.definition`. */
export type SchemaDefinition = {
  tables: TableDefinition[];
};

// --- Row types (mirror the platform migration) -----------------------------

export type OrganizationRow = {
  id: string;
  name: string;
  slug: string;
  created_at: string;
  updated_at: string;
};

export type PrincipalType = "human" | "agent";
export type MemberRole = "admin" | "member";

export type OrgMemberRow = {
  id: string;
  organization_id: string;
  user_id: string;
  principal_type: PrincipalType;
  role: MemberRole;
  created_at: string;
};

export type RecordRow = {
  id: string;
  organization_id: string;
  table_key: string;
  data: Record<string, unknown>;
  actor_id: string | null;
  idempotency_key: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type OrgSchemaRow = {
  organization_id: string;
  definition: SchemaDefinition;
  created_at: string;
  updated_at: string;
};

/** The non-deleted-row `data` returned by the read layer, plus its identity. */
export type RecordData = {
  id: string;
  version: number;
  data: Record<string, unknown>;
};
