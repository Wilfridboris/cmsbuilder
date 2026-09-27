"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";

import type {
  FieldDefinition,
  RecordData,
  SchemaDefinition,
  TableDefinition,
} from "@/types/db";
import { type CellStrings, formatCell } from "@/lib/format";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { InlineEditCell } from "@/components/dashboard/InlineEditCell";
import { RelatedRecordsList } from "@/components/dashboard/RelatedRecordsList";
import { useRelationLabels } from "@/components/dashboard/useRelationLabels";
import { enumerateInboundRelations } from "@/lib/data/relations";
import { resolvedDisplayFieldKey } from "@/lib/schema/relations";

/**
 * RecordReverseListDialog (Story 3.9) — the open-a-record surface for the
 * authenticated dashboard. A Radix `Dialog` (mirrors `RecordDetail`) that opens the
 * "account" for one record:
 *   - TITLE = the record's display label (resolved via its table's `displayField`,
 *     falling back to a translated generic label when blank);
 *   - a compact READ-ONLY summary of the opened record's own visible fields;
 *   - below that, a REVERSE RELATED LIST per inbound `(table, field)` relation pair
 *     — every table/field in the org schema whose `relation` points AT this record's
 *     table — each list a `RelatedRecordsList` (its own filter/sort, read-only rows).
 *
 * When a referencing table appears via more than one field, the section heading is
 * disambiguated by field label. When there are no inbound pairs, a translated global
 * empty state ("nothing references this record yet") shows — never an error.
 *
 * All copy resolves through `SlugDashboard`; every row is read-only (editing stays
 * on the main table surface).
 */

type RecordReverseListDialogProps = {
  /** Open when a record is being viewed; `null` record closes the dialog. */
  open: boolean;
  /** The table the opened record belongs to. */
  table: TableDefinition;
  /** The opened record, or `null` when the dialog is closed. */
  record: RecordData | null;
  /** All visible logical tables — the source for inbound-relation enumeration. */
  tables: TableDefinition[];
  /** Route slug — keys the reverse-list queries and scopes API calls. */
  slug: string;
  /** Locale-dependent cell strings for the read-only own-fields summary. */
  cellStrings: CellStrings;
  /** Close handler — Radix calls this on Esc / overlay / close button. */
  onClose: () => void;
};

export function RecordReverseListDialog({
  open,
  table,
  record,
  tables,
  slug,
  cellStrings,
  onClose,
}: RecordReverseListDialogProps) {
  const t = useTranslations("SlugDashboard");

  // A schema view over the visible tables, so `enumerateInboundRelations` can find
  // every relation field that points at the opened record's table.
  const schema = useMemo<SchemaDefinition>(() => ({ tables }), [tables]);
  const tableByKey = useMemo(() => {
    const map = new Map<string, TableDefinition>();
    for (const tbl of tables) map.set(tbl.key, tbl);
    return map;
  }, [tables]);

  const inboundPairs = useMemo(
    () => enumerateInboundRelations(schema, table.key),
    [schema, table.key],
  );

  // Which referencing tables are reached via MORE THAN ONE field — those sections
  // must disambiguate their heading by field label.
  const tableFieldCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const pair of inboundPairs) {
      counts.set(pair.tableKey, (counts.get(pair.tableKey) ?? 0) + 1);
    }
    return counts;
  }, [inboundPairs]);

  // The opened record's own display label for the title (resolved via its table's
  // displayField), with a translated generic fallback when blank/unresolvable.
  const displayKey = useMemo(() => resolvedDisplayFieldKey(table), [table]);
  const title = useMemo(() => {
    if (!record || !displayKey) return t("recordLabelFallback");
    const raw = record.data[displayKey];
    if (raw === null || raw === undefined || String(raw).trim() === "") {
      return t("recordLabelFallback");
    }
    return String(raw);
  }, [record, displayKey, t]);

  const ownFields = useMemo(
    () => table.fields.filter((field) => !field.hidden),
    [table],
  );

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        closeLabel={t("close")}
        className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl"
      >
        <DialogHeader>
          <DialogTitle className="text-balance">{title}</DialogTitle>
          <DialogDescription className="text-pretty">
            {t("reverseListSubtitle")}
          </DialogDescription>
        </DialogHeader>

        {record ? (
          <OwnFieldsSummary
            slug={slug}
            record={record}
            table={table}
            fields={ownFields}
            cellStrings={cellStrings}
          />
        ) : null}

        {/* Reverse related lists — one per inbound (table, field) pair. */}
        {record ? (
          inboundPairs.length === 0 ? (
            <p
              role="status"
              className="rounded-lg border border-dashed border-border p-6 text-sm text-muted-foreground text-pretty"
            >
              {t("reverseListEmpty")}
            </p>
          ) : (
            <div className="flex flex-col gap-6">
              {inboundPairs.map((pair) => {
                const refTable = tableByKey.get(pair.tableKey);
                if (!refTable) return null;
                const field = refTable.fields.find(
                  (f) => f.key === pair.fieldKey,
                );
                const needsFieldDisambiguation =
                  (tableFieldCounts.get(pair.tableKey) ?? 0) > 1;
                const heading =
                  needsFieldDisambiguation && field
                    ? t("reverseSectionHeadingField", {
                        table: refTable.label,
                        field: field.label,
                      })
                    : t("reverseSectionHeading", { table: refTable.label });
                return (
                  <RelatedRecordsList
                    key={`${pair.tableKey}.${pair.fieldKey}`}
                    slug={slug}
                    refTable={refTable}
                    fieldKey={pair.fieldKey}
                    targetId={record.id}
                    heading={heading}
                    cellStrings={cellStrings}
                  />
                );
              })}
            </div>
          )
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

/**
 * The compact READ-ONLY summary of the opened record's own visible fields. Relation
 * cells still resolve to a label / "archived" / skeleton via `useRelationLabels`.
 */
function OwnFieldsSummary({
  slug,
  record,
  table,
  fields,
  cellStrings,
}: {
  slug: string;
  record: RecordData;
  table: TableDefinition;
  fields: FieldDefinition[];
  cellStrings: CellStrings;
}) {
  // Resolve the opened record's own relation cells (a client's own lookups, etc.).
  const resolveRelation = useRelationLabels({
    slug,
    table,
    rows: useMemo(() => [record], [record]),
  });

  if (fields.length === 0) return null;

  return (
    <dl className="flex flex-col divide-y divide-border rounded-lg border border-border px-4">
      {fields.map((field) => (
        <div
          key={field.key}
          className="flex items-baseline justify-between gap-3 py-3 text-sm first:pt-3 last:pb-3"
        >
          <dt className="shrink-0 text-muted-foreground">{field.label}</dt>
          <dd className="min-w-0 flex-1 text-right text-foreground">
            {field.type === "relation" ? (
              <InlineEditCell
                field={field}
                value={record.data[field.key]}
                cellStrings={cellStrings}
                editable={false}
                pending={false}
                slug={slug}
                resolveRelation={resolveRelation}
                onCommit={() => {}}
              />
            ) : (
              <span className="min-w-0 break-words text-pretty">
                {formatCell(record.data[field.key], field.type, cellStrings)}
              </span>
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
