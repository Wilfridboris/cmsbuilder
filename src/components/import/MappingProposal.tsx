"use client";

import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, RotateCcw, Sparkles, TriangleAlert } from "lucide-react";

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { ColumnMapping, ImportProposal } from "@/types/import";

/**
 * MappingProposal (Story 4.2) — the read-only "shows its work" mapping table.
 *
 * For each source column it shows the proposed target field, a confidence
 * indicator, and the one-line reason, visibly flagging every column that still
 * needs resolution (a null target OR a below-threshold confidence — the server's
 * `unmapped` set) and summarizing how many remain. It owns three states: a loading
 * state while the proposal is fetched, an "auto-mapping unavailable" error state
 * with a Retry (from `Import.error.mappingUnavailable`), and the resolved proposal.
 *
 * Read-only by contract: this renders a proposal and writes nothing (editing is
 * 4.3, commit is 4.4). It mirrors ColumnPreview's responsive pattern — a semantic
 * `<Table>` with an sr-only `<caption>` on desktop and a `<dl>` card list on
 * mobile — and meets the platform a11y baseline (WCAG AA, ≥48px controls,
 * `aria-live` for the async proposal). Copy resolves through the `Import` namespace
 * (EN + FR). Built to the web-uiux-architect standard.
 */
export function MappingProposal({
  proposal,
  status,
  errorCode,
  onRetry,
}: {
  /** The resolved proposal (present only when `status === "ready"`). */
  proposal: ImportProposal | null;
  status: "loading" | "ready" | "error";
  /** The translated error CODE to resolve (present only when `status === "error"`). */
  errorCode: string | null;
  /** Re-run the propose call (loading + error states). */
  onRetry: () => void;
}) {
  const t = useTranslations("Import");
  const prefersReducedMotion = useReducedMotion();

  if (status === "loading") {
    return (
      <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20"
          >
            <Loader2 className="size-5 animate-spin" />
          </span>
          <p className="text-sm text-muted-foreground text-pretty">
            {t("mapping.loading")}
          </p>
        </div>
        <p aria-live="polite" className="sr-only">
          {t("mapping.loading")}
        </p>
      </section>
    );
  }

  if (status === "error") {
    return (
      <AnimatePresence>
        <motion.section
          key="mapping-error"
          initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5"
        >
          <div className="flex items-start gap-3">
            <span
              aria-hidden="true"
              className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-destructive/10 text-destructive ring-1 ring-destructive/20"
            >
              <TriangleAlert className="size-5" />
            </span>
            <p role="alert" className="text-sm text-destructive text-pretty">
              {resolveMappingError(errorCode, t)}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-12 gap-2"
            onClick={onRetry}
          >
            <RotateCcw aria-hidden="true" className="size-4" />
            <span>{t("retry")}</span>
          </Button>
        </motion.section>
      </AnimatePresence>
    );
  }

  if (!proposal) return null;

  const { mappings, unmapped } = proposal;
  const flagged = new Set(unmapped);

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 rounded-xl border bg-card p-5">
        <div className="flex items-start gap-3">
          <span
            aria-hidden="true"
            className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20"
          >
            <Sparkles className="size-5" />
          </span>
          <div className="flex flex-col gap-1">
            <h3 className="text-lg font-semibold tracking-tight text-balance">
              {t("mapping.heading")}
            </h3>
            <p className="text-sm text-muted-foreground text-pretty">
              {t("mapping.summary")}
            </p>
          </div>
        </div>
        <p
          aria-live="polite"
          className="text-sm font-medium text-foreground text-pretty"
        >
          {t("mapping.unmappedSummary", { count: unmapped.length })}
        </p>
      </div>

      {/* Desktop: a semantic table with an sr-only caption. */}
      <div className="hidden overflow-hidden rounded-lg border md:block">
        <Table>
          <caption className="sr-only">{t("mapping.caption")}</caption>
          <TableHeader>
            <TableRow>
              <TableHead scope="col" className="px-3">
                {t("mapping.sourceHeader")}
              </TableHead>
              <TableHead scope="col" className="px-3">
                {t("mapping.targetHeader")}
              </TableHead>
              <TableHead scope="col" className="px-3">
                {t("mapping.confidenceHeader")}
              </TableHead>
              <TableHead scope="col" className="px-3">
                {t("mapping.reasonHeader")}
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {mappings.map((mapping) => (
              <MappingRow
                key={mapping.sourceColumn}
                mapping={mapping}
                isFlagged={flagged.has(mapping.sourceColumn)}
              />
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Mobile: one card per source column, each a definition list. */}
      <ul
        aria-label={t("mapping.caption")}
        className="flex list-none flex-col gap-3 p-0 md:hidden"
      >
        {mappings.map((mapping) => (
          <li key={mapping.sourceColumn}>
            <MappingCard
              mapping={mapping}
              isFlagged={flagged.has(mapping.sourceColumn)}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The confidence as a rounded whole-percent for the indicator. */
function confidencePercent(confidence: number): number {
  return Math.round(confidence * 100);
}

/** Desktop row: source column → target field, confidence, reason, flag badge. */
function MappingRow({
  mapping,
  isFlagged,
}: {
  mapping: ColumnMapping;
  isFlagged: boolean;
}) {
  const t = useTranslations("Import");
  return (
    <TableRow className={isFlagged ? "bg-destructive/5" : undefined}>
      <TableCell className="px-3 font-medium">
        <span className="flex flex-wrap items-center gap-2">
          <span className="truncate">{mapping.sourceColumn}</span>
          {isFlagged ? (
            <Badge variant="destructive" className="gap-1">
              <TriangleAlert aria-hidden="true" className="size-3" />
              {t("mapping.flaggedBadge")}
            </Badge>
          ) : null}
        </span>
      </TableCell>
      <TableCell className="px-3">
        {mapping.target ? (
          <span className="truncate">{mapping.target.field}</span>
        ) : (
          <span className="text-muted-foreground/70">
            {t("mapping.notMapped")}
          </span>
        )}
      </TableCell>
      <TableCell className="px-3 tabular-nums">
        {mapping.target
          ? t("mapping.confidenceValue", {
              percent: confidencePercent(mapping.confidence),
            })
          : t("cellEmpty")}
      </TableCell>
      <TableCell className="px-3 text-muted-foreground text-pretty">
        {mapping.reason ?? t("mapping.reasonEmpty")}
      </TableCell>
    </TableRow>
  );
}

/** Mobile card: the same fields as MappingRow, as a definition list. */
function MappingCard({
  mapping,
  isFlagged,
}: {
  mapping: ColumnMapping;
  isFlagged: boolean;
}) {
  const t = useTranslations("Import");
  return (
    <Card
      className={
        isFlagged
          ? "gap-0 border-destructive/30 bg-destructive/5 py-4"
          : "gap-0 py-4"
      }
    >
      <CardContent className="px-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <span className="font-medium">{mapping.sourceColumn}</span>
          {isFlagged ? (
            <Badge variant="destructive" className="gap-1">
              <TriangleAlert aria-hidden="true" className="size-3" />
              {t("mapping.flaggedBadge")}
            </Badge>
          ) : null}
        </div>
        <dl className="flex flex-col gap-1.5 text-sm">
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 font-medium text-muted-foreground">
              {t("mapping.targetHeader")}
            </dt>
            <dd className="min-w-0 flex-1 text-right">
              {mapping.target ? (
                mapping.target.field
              ) : (
                <span className="text-muted-foreground/70">
                  {t("mapping.notMapped")}
                </span>
              )}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 font-medium text-muted-foreground">
              {t("mapping.confidenceHeader")}
            </dt>
            <dd className="min-w-0 flex-1 text-right tabular-nums">
              {mapping.target
                ? t("mapping.confidenceValue", {
                    percent: confidencePercent(mapping.confidence),
                  })
                : t("cellEmpty")}
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 font-medium text-muted-foreground">
              {t("mapping.reasonHeader")}
            </dt>
            <dd className="min-w-0 flex-1 text-right text-muted-foreground text-pretty">
              {mapping.reason ?? t("mapping.reasonEmpty")}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}

/** Client CODEs mapped to a translated `Import.error.*` message. */
const MAPPING_ERROR_KEYS = new Set([
  "mappingUnavailable",
  "empty",
  "unreadable",
  "tooLarge",
  "noFile",
  "forbidden",
  "unauthorized",
  "genericError",
]);

/** Strip the `Import.error.` prefix a thrown key may carry, else pass through. */
function toErrorCode(raw: string): string {
  return raw.startsWith("Import.error.")
    ? raw.slice("Import.error.".length)
    : raw;
}

/** Resolve a thrown error CODE to a translated message (default: mappingUnavailable). */
function resolveMappingError(
  code: string | null,
  t: ReturnType<typeof useTranslations>,
): string {
  const key = code ? toErrorCode(code) : "mappingUnavailable";
  return MAPPING_ERROR_KEYS.has(key)
    ? t(`error.${key}`)
    : t("error.mappingUnavailable");
}
