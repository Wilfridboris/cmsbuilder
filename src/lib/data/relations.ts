import type { SchemaDefinition } from "@/types/db";
import { normalizeTableName } from "@/lib/utils";

/**
 * Pure, client-safe relation enumeration (Story 3.8 → extracted in 3.9).
 *
 * Moved here from `records.ts` so the reverse related list (Story 3.9) can
 * enumerate inbound `(table, field)` pairs on the CLIENT without pulling in the
 * server-only `records.ts` module (which imports the Supabase client types and is
 * used only from server routes / RSC). This module imports only
 * `normalizeTableName` + types, so it is safe in a `"use client"` component.
 *
 * `records.ts` re-exports both symbols, so existing importers (the references
 * route, `countReferencingRecords`, and the safe-delete tests) keep working
 * unchanged.
 */

/** One `(table_key, field)` pair whose relation field targets a given table. */
export type InboundRelation = { tableKey: string; fieldKey: string };

/**
 * Pure: enumerate every `(tableKey, fieldKey)` pair in the org schema whose
 * `relation` field points at `targetTableKey` (Story 3.8 delete guard + Story 3.9
 * reverse list). A table that references the target through several relation fields
 * yields one pair PER field; a self-referencing table is included (its own relation
 * field can point back at it). `targetTableKey` is normalized so a caller passing an
 * un-normalized key still matches the stored `relationConfig.targetTable` (which
 * provisioning/`validateRelationField` store normalized).
 */
export function enumerateInboundRelations(
  schema: SchemaDefinition,
  targetTableKey: string,
): InboundRelation[] {
  const normalizedTarget = normalizeTableName(targetTableKey);
  const pairs: InboundRelation[] = [];
  for (const table of schema.tables) {
    for (const field of table.fields) {
      if (
        field.type === "relation" &&
        field.relationConfig &&
        normalizeTableName(field.relationConfig.targetTable) === normalizedTarget
      ) {
        pairs.push({ tableKey: table.key, fieldKey: field.key });
      }
    }
  }
  return pairs;
}
