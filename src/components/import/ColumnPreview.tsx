"use client";

import { useTranslations } from "next-intl";
import { FileSpreadsheet, RotateCcw } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import type { ImportPreview } from "@/lib/data/import-client";

/**
 * ColumnPreview (Story 4.1) — the read-only preview of a parsed sheet: the
 * detected columns and up to the first sample rows the server returned. This is
 * the analyze-phase trust surface: it shows the user exactly what the system read
 * BEFORE anything is committed (mapping/commit are 4.2–4.4). It renders nothing
 * writable and makes clear nothing was saved.
 *
 * Reuses the records preview shape: a semantic `<Table>` with a screen-reader
 * `<caption>` on desktop and a card list on mobile, both driven by the same
 * `columns`/`sampleRows`. Built to the web-uiux-architect standard (Tailwind v4
 * `size-*`, `text-balance`/`text-pretty`, visible focus rings, `aria-hidden`
 * decorative icons, ≥48px control). Copy resolves through the `Import` namespace.
 */
export function ColumnPreview({
  preview,
  onStartOver,
}: {
  preview: ImportPreview;
  onStartOver: () => void;
}) {
  const t = useTranslations("Import");
  const { columns, rowCount, sampleRows, sheetName } = preview;

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20"
          >
            <FileSpreadsheet className="size-5" />
          </span>
          <div className="flex flex-col gap-1">
            <h2 className="text-lg font-semibold tracking-tight text-balance">
              {t("previewTitle")}
            </h2>
            <p className="text-sm text-muted-foreground text-pretty">
              {t("previewSummary", {
                columns: columns.length,
                rows: rowCount,
                sheet: sheetName,
              })}
            </p>
          </div>
        </div>
        <p className="text-sm text-muted-foreground text-pretty">
          {t("previewNote")}
        </p>
      </div>

      <h3 className="text-sm font-medium text-foreground">
        {t("sampleRowsHeading")}
      </h3>

      {/* Desktop: a semantic table with an sr-only caption. */}
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <caption className="sr-only">
            {t("previewCaption", { sheet: sheetName })}
          </caption>
          <TableHeader>
            <TableRow>
              {columns.map((col) => (
                <TableHead key={col} scope="col" className="px-3">
                  <span className="truncate">{col}</span>
                </TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {sampleRows.map((row, i) => (
              <TableRow key={i}>
                {columns.map((col) => (
                  <TableCell key={col} className="px-3">
                    {row[col] === "" ? (
                      <span className="text-muted-foreground/60">
                        {t("cellEmpty")}
                      </span>
                    ) : (
                      row[col]
                    )}
                  </TableCell>
                ))}
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: one card per sample row, each a definition list of the columns. */}
      <ul
        aria-label={t("previewCaption", { sheet: sheetName })}
        className="flex list-none flex-col gap-3 p-0 md:hidden"
      >
        {sampleRows.map((row, i) => (
          <li key={i}>
            <Card className="gap-0 py-4">
              <CardContent className="px-4">
                <dl className="flex flex-col gap-1.5">
                  {columns.map((col) => (
                    <div
                      key={col}
                      className="flex items-baseline justify-between gap-3 text-sm"
                    >
                      <dt className="shrink-0 font-medium text-muted-foreground">
                        {col}
                      </dt>
                      <dd className="min-w-0 flex-1 text-right text-foreground">
                        {row[col] === "" ? (
                          <span className="text-muted-foreground/60">
                            {t("cellEmpty")}
                          </span>
                        ) : (
                          row[col]
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>

      <div>
        <Button
          type="button"
          variant="outline"
          className="min-h-12 gap-2"
          onClick={onStartOver}
        >
          <RotateCcw aria-hidden="true" className="size-4" />
          <span>{t("startOver")}</span>
        </Button>
      </div>
    </section>
  );
}
