"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useSwipeable } from "react-swipeable";

import type { RecordData, TableDefinition } from "@/types/db";
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
import { cn } from "@/lib/utils";

/**
 * RecordsView (Story 3.1) — the read-only responsive records surface for the
 * authenticated tenant dashboard (`/[slug]`).
 *
 * Shows ONE logical table at a time, chosen via an accessible tablist switcher
 * (hidden when the org has a single visible table). The active table renders as
 * a semantic shadcn `<Table>` on desktop (`md+`) and a card list on mobile
 * (`<md`); on mobile a horizontal `react-swipeable` gesture moves between tables
 * (clamped at the ends, no wrap), staying in sync with the switcher.
 *
 * Display only: no CRUD, filter/sort, column-hide, detail dialog, or real-time
 * sync — those are Stories 3.2–3.6. Values render through the shared typed
 * `formatCell`, driven by the org's VISIBLE schema field definitions. Initial
 * data is server-fetched by the page and passed in as props; this is a client
 * component only because the switcher state + swipe gesture need the client.
 */

/**
 * Clamp a target table index to `[0, count - 1]` — no wraparound, so the ends of
 * the switcher/swipe feel like ends. With a single table (`count === 1`) every
 * move resolves back to `0`, making swipe a no-op. Pure + exported for tests.
 */
export function clampTableIndex(index: number, count: number): number {
  return Math.max(0, Math.min(index, count - 1));
}

type RecordsViewProps = {
  /** Visible logical tables (already filtered via `visibleTables`). */
  tables: TableDefinition[];
  /** Rows per table key, from `listRecords`. */
  recordsByTable: Record<string, RecordData[]>;
  /** Locale-dependent cell strings for `formatCell`. */
  cellStrings: CellStrings;
};

export function RecordsView({
  tables,
  recordsByTable,
  cellStrings,
}: RecordsViewProps) {
  const t = useTranslations("SlugDashboard");
  const [activeIndex, setActiveIndex] = useState(0);

  // Clamp defensively: the caller only renders us with >=1 visible table, but a
  // re-render with fewer tables must never index past the end.
  const safeIndex = Math.min(activeIndex, tables.length - 1);
  const activeTable = tables[safeIndex];
  const rows = recordsByTable[activeTable.key] ?? [];
  const hasSwitcher = tables.length > 1;

  const goTo = (index: number) => {
    setActiveIndex(clampTableIndex(index, tables.length));
  };

  // Mobile: horizontal swipe navigates between tables, clamped (no wraparound)
  // so the ends feel like ends. Vertical panning stays with the page (the
  // `touch-pan-y` class below hands vertical gestures back to the browser).
  const swipeHandlers = useSwipeable({
    onSwipedLeft: () => goTo(safeIndex + 1),
    onSwipedRight: () => goTo(safeIndex - 1),
    trackMouse: false,
  });

  return (
    <div className="flex flex-col gap-4">
      {hasSwitcher ? (
        <div
          role="tablist"
          aria-label={t("switcherLabel")}
          aria-orientation="horizontal"
          className="flex flex-wrap items-center gap-2 border-b border-border pb-px"
        >
          {tables.map((table, index) => {
            const selected = index === safeIndex;
            return (
              <button
                key={table.key}
                type="button"
                role="tab"
                id={`records-tab-${table.key}`}
                aria-selected={selected}
                aria-controls={`records-panel-${table.key}`}
                tabIndex={selected ? 0 : -1}
                onClick={() => goTo(index)}
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
                  goTo(next);
                  document.getElementById(`records-tab-${tables[next].key}`)?.focus();
                }}
                className={cn(
                  "relative min-h-12 min-w-12 rounded-t-md px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                  selected
                    ? "text-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {table.label}
                {selected ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-2 -bottom-px h-0.5 rounded-full bg-primary"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      ) : null}

      <section
        // Tab semantics only when there is a switcher owning this panel — a lone
        // table has no tablist, so a `role="tabpanel"` + `tabIndex` here would be
        // an unnamed, purposeless focus stop for screen-reader users.
        {...(hasSwitcher
          ? {
              role: "tabpanel" as const,
              id: `records-panel-${activeTable.key}`,
              "aria-labelledby": `records-tab-${activeTable.key}`,
              tabIndex: 0,
            }
          : {})}
        className="flex flex-col gap-4 focus-visible:outline-none"
      >
        {/* Desktop: semantic shadcn table (wide schemas scroll within the panel,
            never the page). */}
        <div className="hidden md:block">
          {rows.length === 0 ? (
            <EmptyTable message={t("emptyTable")} />
          ) : (
            <RecordsTable
              table={activeTable}
              rows={rows}
              cellStrings={cellStrings}
              caption={t("tableCaption", { table: activeTable.label })}
            />
          )}
        </div>

        {/* Mobile: card list. The swipe handlers wrap the whole mobile area (not
            just the cards) so an empty table can still be swiped away. */}
        <div {...swipeHandlers} className="touch-pan-y md:hidden">
          {rows.length === 0 ? (
            <EmptyTable message={t("emptyTable")} />
          ) : (
            <ul
              aria-label={t("cardListLabel", { table: activeTable.label })}
              className="flex list-none flex-col gap-3 p-0"
            >
              <RecordsCards
                table={activeTable}
                rows={rows}
                cellStrings={cellStrings}
              />
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function EmptyTable({ message }: { message: string }) {
  return <p className="text-sm text-muted-foreground">{message}</p>;
}

/** Desktop: every visible field is a column; read-only. */
function RecordsTable({
  table,
  rows,
  cellStrings,
  caption,
}: {
  table: TableDefinition;
  rows: RecordData[];
  cellStrings: CellStrings;
  caption: string;
}) {
  const fields = table.fields.filter((field) => !field.hidden);

  return (
    <div className="overflow-hidden rounded-lg border">
      <Table>
        <caption className="sr-only">{caption}</caption>
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
            <TableRow key={row.id}>
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

/** Mobile: one read-only card per record; first two visible fields headline it. */
function RecordsCards({
  table,
  rows,
  cellStrings,
}: {
  table: TableDefinition;
  rows: RecordData[];
  cellStrings: CellStrings;
}) {
  const fields = table.fields.filter((field) => !field.hidden);
  const [primaryField, secondaryField, ...restFields] = fields;

  return (
    <>
      {rows.map((row) => (
        <li key={row.id}>
          <Card className="gap-0 py-4">
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
        </li>
      ))}
    </>
  );
}
