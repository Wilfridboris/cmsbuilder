"use client";

import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import {
  CheckCircle2,
  Loader2,
  RotateCcw,
  Sparkles,
  TriangleAlert,
} from "lucide-react";

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ColumnMapping, FieldCatalog, ImportProposal } from "@/types/import";
import { resolveFieldLabel } from "@/lib/import/resolve";
import type { DecisionMap, MappingDecision } from "@/lib/import/resolve";

/**
 * MappingProposal (Story 4.2 + 4.3) — the editable, resolvable "shows its work"
 * mapping surface.
 *
 * For each source column it shows an editable target picker (existing non-hidden
 * fields grouped by table + a "skip" item), a confidence indicator, and the
 * one-line reason. Targets render as their human LABEL (resolved from the catalog
 * by key), never the raw key. Every flagged column (one the AI could not confidently
 * map — the server's `unmapped` set) that is still unresolved is visibly flagged;
 * the flag clears once the Admin maps or skips it. It owns three states: a loading
 * state while the proposal is fetched, an "auto-mapping unavailable" error state
 * with a Retry, and the resolved, editable proposal.
 *
 * Decisions live in the parent (`ImportView`) — this component reads the per-column
 * `decisions` map and reports changes via `onDecisionChange`; it writes NOTHING to
 * tenant data (commit is 4.4). It mirrors ColumnPreview's responsive pattern — a
 * semantic `<Table>` with an sr-only `<caption>` on desktop and a card list on
 * mobile — and meets the platform a11y baseline (WCAG AA, ≥48px controls, labeled
 * pickers, `aria-live` for the async proposal). Copy resolves through the `Import`
 * namespace (EN + FR).
 */

/** The Select value used for the "skip this column" option. */
const SKIP_VALUE = "__skip__";

/** Encode a `{table, field}` target as a stable Select item value. */
function targetValue(table: string, field: string): string {
  return `${table}::${field}`;
}

/** The current Select value for a column's decision (skip / target / none). */
function decisionValue(decision: MappingDecision | undefined): string {
  if (!decision) return "";
  if (decision.kind === "skip") return SKIP_VALUE;
  if (decision.kind === "map") return targetValue(decision.table, decision.field);
  return "";
}

/** Turn a chosen Select value back into a `MappingDecision`. */
function valueToDecision(value: string): MappingDecision {
  if (value === SKIP_VALUE) return { kind: "skip" };
  const [table, field] = value.split("::");
  if (table && field) return { kind: "map", table, field };
  return { kind: "unresolved" };
}

export function MappingProposal({
  proposal,
  status,
  errorCode,
  fieldCatalog,
  decisions,
  onDecisionChange,
  onRetry,
  manual = false,
}: {
  /** The resolved proposal (present only when `status === "ready"`). */
  proposal: ImportProposal | null;
  status: "loading" | "ready" | "error";
  /** The translated error CODE to resolve (present only when `status === "error"`). */
  errorCode: string | null;
  /** Client-safe non-hidden schema catalog for the picker options + labels. */
  fieldCatalog: FieldCatalog;
  /** Per-column resolution decisions, owned by the parent. */
  decisions: DecisionMap;
  /** Report a column's new decision (map to a field, or skip) to the parent. */
  onDecisionChange: (sourceColumn: string, decision: MappingDecision) => void;
  /** Re-run the propose call (loading + error states). */
  onRetry: () => void;
  /**
   * Manual-mapping fallback (4.3): when the AI proposal is unavailable the parent
   * synthesizes an all-unmapped proposal and renders this surface so the Admin can
   * still map every column by hand. Swaps the heading/summary to manual-mode copy;
   * the editable rows, picker, and gate are identical.
   */
  manual?: boolean;
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
  const flaggedSet = new Set(unmapped);
  // A column is shown flagged only while it is BOTH flagged by the server AND still
  // unresolved — the flag clears once the Admin maps or skips it.
  const isRowFlagged = (col: string) =>
    flaggedSet.has(col) && decisions[col]?.kind === "unresolved";
  const remainingCount = mappings.filter((m) =>
    isRowFlagged(m.sourceColumn),
  ).length;

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
              {t(manual ? "mapping.manualHeading" : "mapping.heading")}
            </h3>
            <p className="text-sm text-muted-foreground text-pretty">
              {t(manual ? "mapping.manualSummary" : "mapping.summary")}
            </p>
          </div>
        </div>
        <p
          aria-live="polite"
          className="text-sm font-medium text-foreground text-pretty"
        >
          {t("mapping.unmappedSummary", { count: remainingCount })}
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
                isFlagged={isRowFlagged(mapping.sourceColumn)}
                decision={decisions[mapping.sourceColumn]}
                fieldCatalog={fieldCatalog}
                onDecisionChange={onDecisionChange}
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
              isFlagged={isRowFlagged(mapping.sourceColumn)}
              decision={decisions[mapping.sourceColumn]}
              fieldCatalog={fieldCatalog}
              onDecisionChange={onDecisionChange}
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

/**
 * The editable target picker for a column: existing non-hidden fields grouped by
 * table (rendered as labels) + a "skip" item. Selecting an option reports a
 * `MappingDecision` up; the current decision drives the shown value. An empty
 * catalog offers only "skip" (all columns are still resolvable).
 */
function TargetPicker({
  sourceColumn,
  decision,
  fieldCatalog,
  onDecisionChange,
  triggerClassName,
}: {
  sourceColumn: string;
  decision: MappingDecision | undefined;
  fieldCatalog: FieldCatalog;
  onDecisionChange: (sourceColumn: string, decision: MappingDecision) => void;
  triggerClassName?: string;
}) {
  const t = useTranslations("Import");
  return (
    <Select
      value={decisionValue(decision)}
      onValueChange={(value) =>
        onDecisionChange(sourceColumn, valueToDecision(value))
      }
    >
      <SelectTrigger
        aria-label={t("mapping.pickerLabel", { column: sourceColumn })}
        className={triggerClassName ?? "min-h-12 w-full"}
      >
        <SelectValue placeholder={t("mapping.chooseField")}>
          {decision?.kind === "map"
            ? resolveFieldLabel(fieldCatalog, decision.table, decision.field)
            : decision?.kind === "skip"
              ? t("mapping.skip")
              : undefined}
        </SelectValue>
      </SelectTrigger>
      <SelectContent>
        {fieldCatalog.map((table) => (
          <SelectGroup key={table.tableKey}>
            <SelectLabel>{table.tableLabel}</SelectLabel>
            {table.fields.map((field) => (
              <SelectItem
                key={`${table.tableKey}::${field.key}`}
                value={targetValue(table.tableKey, field.key)}
              >
                {field.label}
              </SelectItem>
            ))}
          </SelectGroup>
        ))}
        <SelectItem value={SKIP_VALUE}>{t("mapping.skip")}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** Small "skipped" marker shown alongside a column whose decision is skip. */
function SkippedMarker() {
  const t = useTranslations("Import");
  return (
    <Badge variant="secondary" className="gap-1">
      {t("mapping.skipped")}
    </Badge>
  );
}

/** Desktop row: source column → editable target picker, confidence, reason, flag. */
function MappingRow({
  mapping,
  isFlagged,
  decision,
  fieldCatalog,
  onDecisionChange,
}: {
  mapping: ColumnMapping;
  isFlagged: boolean;
  decision: MappingDecision | undefined;
  fieldCatalog: FieldCatalog;
  onDecisionChange: (sourceColumn: string, decision: MappingDecision) => void;
}) {
  const t = useTranslations("Import");
  const isSkipped = decision?.kind === "skip";
  const isResolvedMap = decision?.kind === "map";
  // The AI's confidence + reason describe its PROPOSED target; show them only while
  // the current decision still points at that exact target. Once the Admin remaps
  // or skips (or a flagged column is untouched), the AI metadata no longer applies.
  const showsAiTarget =
    decision?.kind === "map" &&
    !!mapping.target &&
    decision.table === mapping.target.table &&
    decision.field === mapping.target.field;
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
          {isSkipped ? <SkippedMarker /> : null}
          {isResolvedMap && !isFlagged ? (
            <CheckCircle2
              aria-hidden="true"
              className="size-4 shrink-0 text-primary"
            />
          ) : null}
        </span>
      </TableCell>
      <TableCell className="px-3">
        <TargetPicker
          sourceColumn={mapping.sourceColumn}
          decision={decision}
          fieldCatalog={fieldCatalog}
          onDecisionChange={onDecisionChange}
          triggerClassName="min-h-12 w-full min-w-44"
        />
      </TableCell>
      <TableCell className="px-3 tabular-nums">
        {showsAiTarget
          ? t("mapping.confidenceValue", {
              percent: confidencePercent(mapping.confidence),
            })
          : t("cellEmpty")}
      </TableCell>
      <TableCell className="px-3 text-muted-foreground text-pretty">
        {showsAiTarget
          ? (mapping.reason ?? t("mapping.reasonEmpty"))
          : t("mapping.reasonEmpty")}
      </TableCell>
    </TableRow>
  );
}

/** Mobile card: the same fields as MappingRow, as a definition list + picker. */
function MappingCard({
  mapping,
  isFlagged,
  decision,
  fieldCatalog,
  onDecisionChange,
}: {
  mapping: ColumnMapping;
  isFlagged: boolean;
  decision: MappingDecision | undefined;
  fieldCatalog: FieldCatalog;
  onDecisionChange: (sourceColumn: string, decision: MappingDecision) => void;
}) {
  const t = useTranslations("Import");
  const isSkipped = decision?.kind === "skip";
  // See MappingRow: AI confidence/reason apply only while the current decision still
  // points at the AI's proposed target.
  const showsAiTarget =
    decision?.kind === "map" &&
    !!mapping.target &&
    decision.table === mapping.target.table &&
    decision.field === mapping.target.field;
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
          ) : isSkipped ? (
            <SkippedMarker />
          ) : null}
        </div>
        <dl className="flex flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1.5">
            <dt className="font-medium text-muted-foreground">
              {t("mapping.targetHeader")}
            </dt>
            <dd>
              <TargetPicker
                sourceColumn={mapping.sourceColumn}
                decision={decision}
                fieldCatalog={fieldCatalog}
                onDecisionChange={onDecisionChange}
              />
            </dd>
          </div>
          <div className="flex items-baseline justify-between gap-3">
            <dt className="shrink-0 font-medium text-muted-foreground">
              {t("mapping.confidenceHeader")}
            </dt>
            <dd className="min-w-0 flex-1 text-right tabular-nums">
              {showsAiTarget
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
              {showsAiTarget
                ? (mapping.reason ?? t("mapping.reasonEmpty"))
                : t("mapping.reasonEmpty")}
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
