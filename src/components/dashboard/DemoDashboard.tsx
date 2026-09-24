"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";

import type { RecordData, TableDefinition } from "@/types/db";
import type { GenerateResponse } from "@/app/api/generate/route";
import { formatCell, type CellStrings } from "@/lib/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { RecordDetail } from "@/components/dashboard/RecordDetail";

/**
 * DemoDashboard (Story 1.6) — the interactive, anonymous demo dashboard.
 *
 * A PURE CONSUMER of the `POST /api/generate` response (`{ schema, records,
 * isFallback }`) — it makes no new fetch. It delivers the frozen "grow into
 * dashboard" moment and the pre-account browse/edit experience:
 *
 * - Skeleton placeholders "grow" into the populated layout via Framer Motion
 *   (opacity + slight rise), gated by `useReducedMotion` → an instant/opacity
 *   reveal when the visitor prefers reduced motion. No spinner, no loading bar.
 * - Tab browse across `schema.tables` (ARIA `tablist`), first table active.
 * - Responsive: a semantic `<Table>` on desktop, a `Card` list on mobile.
 * - Row / card → opens the accessible `RecordDetail` dialog (focus-trapped).
 * - A basic in-place edit updates client-side session state ONLY (optimistic):
 *   it reflects immediately in both the list and the open detail, creates no
 *   account, writes to no DB/API, and is lost on a hard reload.
 *
 * The Story 1.5 fallback banner is rendered by the parent (`/generate`) above
 * this component, unchanged. All strings resolve through next-intl.
 */

type DemoDashboardProps = {
  response: GenerateResponse;
};

/** Local, session-only record store keyed by `table_key`. */
type RecordsState = Record<string, RecordData[]>;

export function DemoDashboard({ response }: DemoDashboardProps) {
  const t = useTranslations("Dashboard");
  const tGenerate = useTranslations("Generate");
  const prefersReducedMotion = useReducedMotion();

  const tables = response.schema.tables;

  // Session-only, optimistic copy of the seeded records. Edits mutate THIS,
  // never the DB — lost on hard reload (which re-POSTs /generate). The parent
  // (`/generate`) mounts this component fresh per generation, so the initial
  // seed is the single source; no effect-driven resync is needed.
  const [records, setRecords] = useState<RecordsState>(() => response.records);

  const [activeTableKey, setActiveTableKey] = useState<string>(
    () => tables[0]?.key ?? "",
  );
  const activeTable = useMemo(
    () => tables.find((table) => table.key === activeTableKey) ?? tables[0],
    [tables, activeTableKey],
  );

  // The open record for the detail dialog, tracked by table + id so an edit
  // reflects live in the dialog after session state updates.
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);

  const cellStrings: CellStrings = {
    empty: tGenerate("cellEmpty"),
    yes: tGenerate("cellYes"),
    no: tGenerate("cellNo"),
  };

  if (!activeTable) {
    // Defensive: a schema with zero tables should never occur (1.4/1.5 seed it).
    return (
      <p className="text-base text-muted-foreground">{t("emptyDashboard")}</p>
    );
  }

  const activeRows = records[activeTable.key] ?? [];
  const openRecord =
    openRecordId === null
      ? null
      : (activeRows.find((row) => row.id === openRecordId) ?? null);

  const handleEdit = (fieldKey: string, value: unknown) => {
    setRecords((prev) => {
      const rows = prev[activeTable.key] ?? [];
      return {
        ...prev,
        [activeTable.key]: rows.map((row) =>
          row.id === openRecordId
            ? { ...row, data: { ...row.data, [fieldKey]: value } }
            : row,
        ),
      };
    });
  };

  // Reduced motion → instant/opacity reveal; otherwise a gentle grow.
  const reveal = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <div className="flex flex-col gap-6">
      {/* Tab browse across generated tables. */}
      <div
        role="tablist"
        aria-label={t("tablistLabel")}
        aria-orientation="horizontal"
        className="flex flex-wrap gap-2 border-b border-border pb-px"
      >
        {tables.map((table, index) => {
          const selected = table.key === activeTable.key;
          const activate = (key: string) => {
            setActiveTableKey(key);
            // Close any open detail so a stale record can't linger across
            // tables (record ids are unique per table).
            setOpenRecordId(null);
          };
          return (
            <button
              key={table.key}
              type="button"
              role="tab"
              id={`tab-${table.key}`}
              aria-selected={selected}
              aria-controls={`panel-${table.key}`}
              tabIndex={selected ? 0 : -1}
              onClick={() => activate(table.key)}
              onKeyDown={(event) => {
                // ARIA tablist keyboard contract (WAI-ARIA APG, horizontal):
                // Arrow keys roving-navigate + activate; Home/End jump to ends.
                // Without this, non-selected tabs (tabIndex -1) are unreachable
                // by keyboard, so a keyboard/AT user could never switch tables.
                const count = tables.length;
                let next: number | null = null;
                if (event.key === "ArrowRight") next = (index + 1) % count;
                else if (event.key === "ArrowLeft")
                  next = (index - 1 + count) % count;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = count - 1;
                if (next === null) return;
                event.preventDefault();
                const nextKey = tables[next].key;
                activate(nextKey);
                document.getElementById(`tab-${nextKey}`)?.focus();
              }}
              className={cn(
                "relative min-h-12 rounded-t-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                selected
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {table.label}
              {selected ? (
                <motion.span
                  layoutId={prefersReducedMotion ? undefined : "active-tab"}
                  className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                />
              ) : null}
            </button>
          );
        })}
      </div>

      <motion.section
        // Re-run the grow whenever the active table changes (key forces remount).
        key={activeTable.key}
        role="tabpanel"
        id={`panel-${activeTable.key}`}
        aria-labelledby={`tab-${activeTable.key}`}
        tabIndex={0}
        initial={reveal.initial}
        animate={reveal.animate}
        transition={
          prefersReducedMotion
            ? { duration: 0.2 }
            : { type: "spring", bounce: 0.15, duration: 0.5 }
        }
        className="flex flex-col gap-4 focus-visible:outline-none"
      >
        {activeRows.length === 0 ? (
          <p className="text-base text-muted-foreground">{t("emptyTable")}</p>
        ) : (
          <>
            {/* Desktop: semantic table. */}
            <div className="hidden md:block">
              <TableView
                table={activeTable}
                rows={activeRows}
                cellStrings={cellStrings}
                onOpen={setOpenRecordId}
                openLabel={t("openRecord")}
              />
            </div>

            {/* Mobile: card list. */}
            <div className="flex flex-col gap-3 md:hidden">
              <CardList
                table={activeTable}
                rows={activeRows}
                cellStrings={cellStrings}
                onOpen={setOpenRecordId}
                openLabel={t("openRecord")}
                prefersReducedMotion={Boolean(prefersReducedMotion)}
              />
            </div>
          </>
        )}
      </motion.section>

      <RecordDetail
        table={activeTable}
        record={openRecord}
        onClose={() => setOpenRecordId(null)}
        onEdit={handleEdit}
      />
    </div>
  );
}

/** Desktop table: every visible field is a column; a row opens the detail. */
function TableView({
  table,
  rows,
  cellStrings,
  onOpen,
  openLabel,
}: {
  table: TableDefinition;
  rows: RecordData[];
  cellStrings: CellStrings;
  onOpen: (id: string) => void;
  openLabel: string;
}) {
  const t = useTranslations("Dashboard");
  const fields = table.fields.filter((field) => !field.hidden);

  return (
    <div className="overflow-x-auto rounded-lg border">
      <Table>
        <caption className="sr-only">
          {t("tableCaption", { table: table.label })}
        </caption>
        <TableHeader>
          <TableRow>
            {fields.map((field) => (
              <TableHead key={field.key} scope="col">
                {field.label}
              </TableHead>
            ))}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) => (
            <TableRow
              key={row.id}
              tabIndex={0}
              role="button"
              aria-label={openLabel}
              onClick={() => onOpen(row.id)}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  onOpen(row.id);
                }
              }}
              className="cursor-pointer transition-colors hover:bg-muted/60 focus-visible:bg-muted/60 focus-visible:outline-none"
            >
              {fields.map((field) => (
                <TableCell key={field.key}>
                  {formatCell(row.data[field.key], field.type, cellStrings)}
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Mobile card list: each record is a tappable card; opens the detail. */
function CardList({
  table,
  rows,
  cellStrings,
  onOpen,
  openLabel,
  prefersReducedMotion,
}: {
  table: TableDefinition;
  rows: RecordData[];
  cellStrings: CellStrings;
  onOpen: (id: string) => void;
  openLabel: string;
  prefersReducedMotion: boolean;
}) {
  const fields = table.fields.filter((field) => !field.hidden);
  // The first two visible fields headline the card; the rest are detail rows.
  const [primaryField, secondaryField, ...restFields] = fields;

  return (
    <>
      {rows.map((row) => (
        <Card
          key={row.id}
          role="button"
          tabIndex={0}
          aria-label={openLabel}
          onClick={() => onOpen(row.id)}
          onKeyDown={(event) => {
            if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              onOpen(row.id);
            }
          }}
          className={cn(
            "cursor-pointer gap-0 py-4 transition-all hover:border-primary/40 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            !prefersReducedMotion && "active:scale-[0.99]",
          )}
        >
          <CardContent className="flex flex-col gap-2 px-4">
            {primaryField ? (
              <p className="text-base font-medium text-foreground text-pretty">
                {formatCell(
                  row.data[primaryField.key],
                  primaryField.type,
                  cellStrings,
                )}
              </p>
            ) : null}
            {secondaryField ? (
              <p className="text-sm text-muted-foreground text-pretty">
                {formatCell(
                  row.data[secondaryField.key],
                  secondaryField.type,
                  cellStrings,
                )}
              </p>
            ) : null}
            {restFields.length > 0 ? (
              <dl className="mt-1 flex flex-col gap-1">
                {restFields.map((field) => (
                  <div
                    key={field.key}
                    className="flex items-baseline justify-between gap-3 text-sm"
                  >
                    <dt className="shrink-0 text-muted-foreground">
                      {field.label}
                    </dt>
                    <dd className="min-w-0 break-words text-right text-foreground">
                      {formatCell(row.data[field.key], field.type, cellStrings)}
                    </dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </CardContent>
        </Card>
      ))}
    </>
  );
}

/**
 * Skeleton placeholders laid out in the FINAL dashboard grid, so the Framer
 * Motion reveal grows these into the populated layout (rather than a spinner).
 * Exported for `/generate` to render during the `generating`/`initializing`
 * phases. Honors reduced motion at the app/CSS level (the pulse is CSS-driven).
 */
export function DashboardSkeleton() {
  return (
    <div className="flex flex-col gap-6" aria-hidden="true">
      <div className="flex gap-2 border-b border-border pb-2">
        {[0, 1, 2].map((tab) => (
          <Skeleton key={tab} className="h-9 w-28 rounded-md" />
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border">
        <div className="flex gap-4 border-b bg-muted/40 px-4 py-3">
          {[0, 1, 2, 3].map((col) => (
            <Skeleton key={col} className="h-4 flex-1" />
          ))}
        </div>
        <div className="flex flex-col">
          {[0, 1, 2, 3, 4].map((rowIndex) => (
            <div
              key={rowIndex}
              className="flex gap-4 border-b px-4 py-4 last:border-b-0"
            >
              {[0, 1, 2, 3].map((col) => (
                <Skeleton key={col} className="h-4 flex-1" />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
