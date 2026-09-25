"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { motion, useReducedMotion } from "framer-motion";
import { Sparkles } from "lucide-react";

import type {
  RecordData,
  SchemaDefinition,
  TableDefinition,
} from "@/types/db";
import type { GenerateResponse } from "@/app/api/generate/route";
import { formatCell, type CellStrings } from "@/lib/format";
import {
  canHideTable,
  hideField,
  hideTable,
  renameField,
  renameTable,
  visibleTables,
} from "@/lib/schema/overrides";
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
import { OverrideControl } from "@/components/dashboard/OverrideControl";
import { Button } from "@/components/ui/button";
import { ClaimModal } from "@/components/claim/ClaimModal";

/**
 * DemoDashboard (Story 1.6 + 1.7) — the interactive, anonymous demo dashboard.
 *
 * A PURE CONSUMER of the `POST /api/generate` response (`{ schema, records,
 * isFallback }`) — it makes no new fetch. It delivers the frozen "grow into
 * dashboard" moment, the pre-account browse/edit experience (1.6), and schema
 * explainability + one-tap overrides (1.7):
 *
 * - Skeleton placeholders "grow" into the populated layout via Framer Motion
 *   (opacity + slight rise), gated by `useReducedMotion` → an instant/opacity
 *   reveal when the visitor prefers reduced motion. No spinner, no loading bar.
 * - Tab browse across the schema's VISIBLE tables (ARIA `tablist`).
 * - Responsive: a semantic `<Table>` on desktop, a `Card` list on mobile.
 * - Row / card → opens the accessible `RecordDetail` dialog (focus-trapped).
 * - A basic in-place edit updates client-side session state ONLY (optimistic).
 * - Every table (tablist) and field (column header + detail) with a `reason`
 *   exposes an `OverrideControl`: it reveals the reason and offers one-tap
 *   Rename (label only) + Remove (append-only `hidden`). Overrides mutate a
 *   session-only copy of the schema (lifted here, mirroring the records copy),
 *   never the DB — lost on hard reload. The last visible table can't be removed.
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
  const tExplain = useTranslations("Explainability");
  const tGenerate = useTranslations("Generate");
  const tClaim = useTranslations("Claim");
  const prefersReducedMotion = useReducedMotion();

  // "Make it Real" claim modal (Story 2.1). Opens the passwordless magic-link
  // claim, carrying the CURRENT overridden schema state into the round trip.
  const [claimOpen, setClaimOpen] = useState(false);

  // Session-only, optimistic copies of the seeded schema + records. Edits and
  // overrides mutate THESE, never the DB — lost on hard reload (which re-POSTs
  // /generate and regenerates). The parent (`/generate`) mounts this component
  // fresh per generation, so the initial response is the single source.
  const [schema, setSchema] = useState<SchemaDefinition>(
    () => response.schema,
  );
  const [records, setRecords] = useState<RecordsState>(() => response.records);

  // The tables the tablist renders — hidden ones drop out (1.7).
  const tables = useMemo(() => visibleTables(schema), [schema]);

  const [activeTableKey, setActiveTableKey] = useState<string>(
    () => visibleTables(response.schema)[0]?.key ?? "",
  );

  const activeTable = useMemo(
    () => tables.find((table) => table.key === activeTableKey) ?? tables[0],
    [tables, activeTableKey],
  );

  // The open record for the detail dialog, tracked by id so an edit reflects
  // live in the dialog after session state updates.
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);

  // Set when a table is removed: the removed tab owns the popover trigger Radix
  // would restore focus to, but that tab unmounts on the same update — so focus
  // would fall to <body>. After the removal render lands we move focus to the
  // active tab instead (WCAG 2.4.3). Ordinary tab switches manage their own
  // focus, so this fires only on a removal.
  const pendingTabFocusRef = useRef(false);
  useEffect(() => {
    if (!pendingTabFocusRef.current) return;
    pendingTabFocusRef.current = false;
    document.getElementById(`tab-${activeTableKey}`)?.focus();
  }, [tables, activeTableKey]);

  const cellStrings: CellStrings = {
    empty: tGenerate("cellEmpty"),
    yes: tGenerate("cellYes"),
    no: tGenerate("cellNo"),
  };

  // Remove is blocked while only one table is visible (dashboard never empties).
  const canRemoveTable = canHideTable(schema);

  const handleRenameTable = (tableKey: string, label: string) => {
    setSchema((prev) => renameTable(prev, tableKey, label));
  };

  const handleRemoveTable = (tableKey: string) => {
    // Move focus to the active tab after the removal render (see the effect).
    pendingTabFocusRef.current = true;
    setSchema((prev) => {
      const next = hideTable(prev, tableKey);
      // If the active table was the one removed, fall back to the first table
      // still visible and close any open detail (its record may have vanished).
      if (tableKey === activeTableKey) {
        const remaining = visibleTables(next);
        setActiveTableKey(remaining[0]?.key ?? "");
        setOpenRecordId(null);
      }
      return next;
    });
  };

  const handleRenameField = (fieldKey: string, label: string) => {
    if (!activeTable) return;
    setSchema((prev) => renameField(prev, activeTable.key, fieldKey, label));
  };

  const handleRemoveField = (fieldKey: string) => {
    if (!activeTable) return;
    setSchema((prev) => hideField(prev, activeTable.key, fieldKey));
  };

  const handleEdit = (fieldKey: string, value: unknown) => {
    if (!activeTable) return;
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

  if (!activeTable) {
    // Defensive: a schema with zero visible tables should never occur (the
    // last-table guard blocks it; 1.4/1.5 always seed at least one).
    return (
      <p className="text-base text-muted-foreground">{t("emptyDashboard")}</p>
    );
  }

  const activeRows = records[activeTable.key] ?? [];
  const openRecord =
    openRecordId === null
      ? null
      : (activeRows.find((row) => row.id === openRecordId) ?? null);

  // Reduced motion → instant/opacity reveal; otherwise a gentle grow.
  const reveal = prefersReducedMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 } }
    : {
        initial: { opacity: 0, y: 12 },
        animate: { opacity: 1, y: 0 },
      };

  return (
    <div className="flex flex-col gap-6">
      {/* "Make it Real" claim handoff (Story 2.1, UX-DR9): a prominent,
          high-contrast CTA that opens the magic-link claim, passing the current
          overridden schema state. */}
      <div className="flex flex-col gap-3 rounded-xl border border-primary/25 bg-primary/5 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-col gap-1">
          <p className="text-base font-semibold text-foreground text-pretty">
            {tClaim("ctaHeadline")}
          </p>
          <p className="text-sm text-muted-foreground text-pretty">
            {tClaim("ctaSubtext")}
          </p>
        </div>
        <Button
          type="button"
          size="lg"
          onClick={() => setClaimOpen(true)}
          className="min-h-12 shrink-0 gap-2"
        >
          <Sparkles aria-hidden="true" className="size-4" />
          <span>{tClaim("cta")}</span>
        </Button>
      </div>

      <ClaimModal open={claimOpen} onOpenChange={setClaimOpen} schema={schema} />

      {/* Tab browse across generated (visible) tables. */}
      <div
        role="tablist"
        aria-label={t("tablistLabel")}
        aria-orientation="horizontal"
        className="flex flex-wrap items-center gap-2 border-b border-border pb-px"
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
            <div key={table.key} className="flex items-center">
              <button
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
              {/* Table explainability + override (1.7): only when it has a reason. */}
              {table.reason ? (
                <OverrideControl
                  label={table.label}
                  reason={table.reason}
                  infoLabel={tExplain("infoFor", { item: table.label })}
                  renameLabel={tExplain("renameTable", { table: table.label })}
                  removeLabel={tExplain("removeTable", { table: table.label })}
                  onRename={(label) => handleRenameTable(table.key, label)}
                  onRemove={() => handleRemoveTable(table.key)}
                  removeDisabledReason={
                    canRemoveTable ? undefined : tExplain("lastTable")
                  }
                />
              ) : null}
            </div>
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
                onRenameField={handleRenameField}
                onRemoveField={handleRemoveField}
              />
            </div>

            {/* Mobile: card list. Field overrides live in the record detail. */}
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
        onRenameField={handleRenameField}
        onRemoveField={handleRemoveField}
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
  onRenameField,
  onRemoveField,
}: {
  table: TableDefinition;
  rows: RecordData[];
  cellStrings: CellStrings;
  onOpen: (id: string) => void;
  openLabel: string;
  onRenameField: (fieldKey: string, label: string) => void;
  onRemoveField: (fieldKey: string) => void;
}) {
  const t = useTranslations("Dashboard");
  const tExplain = useTranslations("Explainability");
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
                <span className="inline-flex items-center gap-1">
                  <span>{field.label}</span>
                  {/* Field explainability + override (1.7): only with a reason. */}
                  {field.reason ? (
                    <OverrideControl
                      label={field.label}
                      reason={field.reason}
                      infoLabel={tExplain("infoFor", { item: field.label })}
                      renameLabel={tExplain("renameField", {
                        field: field.label,
                      })}
                      removeLabel={tExplain("removeField", {
                        field: field.label,
                      })}
                      onRename={(label) => onRenameField(field.key, label)}
                      onRemove={() => onRemoveField(field.key)}
                    />
                  ) : null}
                </span>
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
