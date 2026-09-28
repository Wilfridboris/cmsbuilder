"use client";

import { useCallback, useMemo, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Loader2, RotateCcw } from "lucide-react";

import { ImportDropzone } from "@/components/import/ImportDropzone";
import { ColumnPreview } from "@/components/import/ColumnPreview";
import { MappingProposal } from "@/components/import/MappingProposal";
import { Button } from "@/components/ui/button";
import {
  proposeMapping,
  commitImport,
  ImportApiError,
  type ImportPreview,
} from "@/lib/data/import-client";
import type { CommitResult, FieldCatalog, ImportProposal } from "@/types/import";
import {
  initialDecisions,
  unresolvedColumns,
  isReadyToImport,
  type DecisionMap,
  type MappingDecision,
} from "@/lib/import/resolve";

/**
 * ImportView (Story 4.1 + 4.2 + 4.3) — the client shell that toggles the
 * analyze-phase surface between the upload dropzone and the parsed preview,
 * auto-fetches the AI-proposed column mapping once a preview resolves, and — new
 * in 4.3 — owns the per-column resolution decisions layered over the proposal and
 * gates the Import action on them.
 *
 * It holds the last successful preview plus the uploaded `file` and resolved
 * `sheet` (import is stateless — the propose call re-parses the same bytes/sheet
 * server-side, no fileId). When a proposal resolves it seeds the decision map from
 * it (confident columns start mapped; flagged columns start unresolved), and it
 * resets that map on every new proposal / retry. It renders the gated Import button
 * and the remaining-columns message below the editable mapping surface.
 *
 * New in 4.4: the Import button's click is wired to `/api/import/commit` (the
 * ONLY write). A stable `importId` is generated on the first Import click and held
 * in state so every Retry reuses it (per-row idempotency dedupes a retried commit).
 * The view owns commit state (`idle|committing|done|error`); on success it renders
 * a per-table summary with a "Go to dashboard" link and an "Import another" action
 * (no auto-redirect) and invalidates the records cache (`["records", slug]`); on
 * failure it surfaces a translated error with a Retry. "Start over" clears
 * everything back to the dropzone.
 */

type Session = {
  preview: ImportPreview;
  file: File;
  sheet: string | undefined;
};

/** The commit (write) phase state layered over the resolved 4.3 mapping. */
type CommitState =
  | { phase: "idle" }
  | { phase: "committing" }
  | { phase: "done"; result: CommitResult }
  | { phase: "error"; code: string | null };

export function ImportView({
  slug,
  fieldCatalog,
}: {
  slug: string;
  /** Client-safe non-hidden schema catalog for the target picker + labels (4.3). */
  fieldCatalog: FieldCatalog;
}) {
  const t = useTranslations("Import");
  const queryClient = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [proposal, setProposal] = useState<ImportProposal | null>(null);
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [commit, setCommit] = useState<CommitState>({ phase: "idle" });
  // Stable id generated on the FIRST Import click, reused on every Retry so a
  // retried commit dedupes to the same logical rows. Cleared on start-over.
  const [importId, setImportId] = useState<string | null>(null);

  const runPropose = useCallback(
    async (file: File, sheet: string | undefined, columns: string[]) => {
      setStatus("loading");
      setErrorCode(null);
      setProposal(null);
      setDecisions({});
      setCommit({ phase: "idle" });
      try {
        const result = await proposeMapping(slug, file, sheet);
        setProposal(result);
        // Seed (and reset) the decision map from the fresh proposal: confident
        // columns start mapped, flagged columns start unresolved.
        setDecisions(initialDecisions(result));
        setStatus("ready");
      } catch (err) {
        setErrorCode(err instanceof ImportApiError ? err.code : null);
        // Manual-mapping fallback: even when auto-mapping is unavailable the Admin
        // must still be able to map by hand, so seed every parsed column as
        // unresolved. The render path builds a matching all-unmapped proposal.
        const manual: DecisionMap = {};
        for (const col of columns) manual[col] = { kind: "unresolved" };
        setDecisions(manual);
        setStatus("error");
      }
    },
    [slug],
  );

  // Establish the preview session and immediately auto-fetch the proposal. This
  // runs from the dropzone's success event (not an effect), so the propose call
  // starts as a direct consequence of the upload resolving.
  const handlePreview = (
    preview: ImportPreview,
    file: File,
    sheet: string | undefined,
  ) => {
    setSession({ preview, file, sheet });
    void runPropose(file, sheet, preview.columns);
  };

  const handleStartOver = () => {
    setSession(null);
    setProposal(null);
    setDecisions({});
    setErrorCode(null);
    setStatus("loading");
    setCommit({ phase: "idle" });
    setImportId(null);
  };

  const handleDecisionChange = useCallback(
    (sourceColumn: string, decision: MappingDecision) => {
      setDecisions((prev) => ({ ...prev, [sourceColumn]: decision }));
    },
    [],
  );

  // The commit (write) call. Generates the stable importId on the first click and
  // reuses it on every Retry; on success invalidates the records cache so the
  // dashboard reflects the imported rows (no auto-redirect).
  const runCommit = useCallback(async () => {
    if (!session) return;
    // Guard crypto.randomUUID (unavailable in non-secure contexts, e.g. http on a
    // LAN IP) with the same fallback the dashboard hooks use, so the click never
    // throws before commit state is set.
    const id =
      importId ??
      (typeof crypto !== "undefined" && crypto.randomUUID
        ? crypto.randomUUID()
        : Math.random().toString(36).slice(2));
    if (importId === null) setImportId(id);
    setCommit({ phase: "committing" });
    try {
      const result = await commitImport(
        slug,
        session.file,
        decisions,
        id,
        session.sheet,
      );
      setCommit({ phase: "done", result });
      // Invalidate every table's records query for this org so the dashboard shows
      // the imported rows (prefix match on `["records", slug]`).
      void queryClient.invalidateQueries({ queryKey: ["records", slug] });
    } catch (err) {
      setCommit({
        phase: "error",
        code: err instanceof ImportApiError ? err.code : null,
      });
    }
  }, [session, importId, slug, decisions, queryClient]);

  // When auto-mapping is unavailable (mappingUnavailable or a transient/unknown
  // failure — NOT an auth or file error, where re-uploading / re-auth is the path),
  // fall back to a fully manual mapping: synthesize an all-unmapped proposal from the
  // parsed columns so the same editable surface + gate drive a by-hand mapping.
  const manualEligible =
    errorCode == null ||
    errorCode === "mappingUnavailable" ||
    errorCode === "Import.error.mappingUnavailable";
  const showManual = status === "error" && manualEligible && session != null;

  const manualProposal = useMemo<ImportProposal | null>(() => {
    if (!session) return null;
    return {
      rowCount: session.preview.rowCount,
      mappings: session.preview.columns.map((sourceColumn) => ({
        sourceColumn,
        target: null,
        confidence: 0,
      })),
      unmapped: session.preview.columns,
    };
  }, [session]);

  // The proposal driving the editable surface + gate: the AI's when ready, else the
  // synthesized manual one on the fallback path.
  const activeProposal =
    status === "ready" ? proposal : showManual ? manualProposal : null;

  const remaining = useMemo(
    () => (activeProposal ? unresolvedColumns(activeProposal, decisions) : []),
    [activeProposal, decisions],
  );
  const ready = useMemo(
    () => (activeProposal ? isReadyToImport(activeProposal, decisions) : false),
    [activeProposal, decisions],
  );

  // Resolve a target table's human label from the catalog for the summary; falls
  // back to the raw stored key when the table is absent (e.g. an empty catalog).
  const tableLabel = useCallback(
    (tableKey: string) =>
      fieldCatalog.find((entry) => entry.tableKey === tableKey)?.tableLabel ??
      tableKey,
    [fieldCatalog],
  );

  // Success surface (Decision 2026-09-28): a per-table summary with a
  // "Go to dashboard" link + "Import another" action. NO auto-redirect.
  if (session && commit.phase === "done") {
    return (
      <ImportSuccess
        slug={slug}
        result={commit.result}
        tableLabel={tableLabel}
        onImportAnother={handleStartOver}
        t={t}
      />
    );
  }

  if (session) {
    const retry = () =>
      void runPropose(session.file, session.sheet, session.preview.columns);
    return (
      <div className="flex flex-col gap-6">
        <ColumnPreview preview={session.preview} onStartOver={handleStartOver} />
        {showManual ? (
          <section
            role="alert"
            className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5"
          >
            <p className="text-sm text-destructive text-pretty">
              {t("error.mappingUnavailable")}
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-12 gap-2"
              onClick={retry}
            >
              <RotateCcw aria-hidden="true" className="size-4" />
              <span>{t("retry")}</span>
            </Button>
          </section>
        ) : null}
        <MappingProposal
          proposal={activeProposal}
          status={showManual ? "ready" : status}
          errorCode={errorCode}
          fieldCatalog={fieldCatalog}
          decisions={decisions}
          onDecisionChange={handleDecisionChange}
          onRetry={retry}
          manual={showManual}
        />
        {activeProposal ? (
          <ImportGate
            ready={ready}
            remaining={remaining}
            commit={commit}
            onImport={() => void runCommit()}
            t={t}
          />
        ) : null}
      </div>
    );
  }

  return <ImportDropzone slug={slug} onPreview={handlePreview} />;
}

/**
 * The Import action gate (4.3 + 4.4). Disabled while any flagged column is
 * unresolved, naming the remaining columns; enabled with a readiness message once
 * every flagged column is mapped or skipped. New in 4.4: the button click triggers
 * the commit; the section renders commit progress (a busy button + note) and, on
 * failure, a translated error with a Retry (reusing the same importId). The
 * `aria-live` region announces readiness / progress / errors as they change.
 */
function ImportGate({
  ready,
  remaining,
  commit,
  onImport,
  t,
}: {
  ready: boolean;
  remaining: string[];
  commit: CommitState;
  onImport: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  const committing = commit.phase === "committing";
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <p aria-live="polite" className="text-sm text-pretty">
        {committing ? (
          <span className="flex items-center gap-2 font-medium text-foreground">
            <Loader2
              aria-hidden="true"
              className="size-4 shrink-0 animate-spin text-primary"
            />
            {t("commit.committing")}
          </span>
        ) : ready ? (
          <span className="flex items-center gap-2 font-medium text-foreground">
            <CheckCircle2
              aria-hidden="true"
              className="size-4 shrink-0 text-primary"
            />
            {t("mapping.ready")}
          </span>
        ) : (
          <span className="text-muted-foreground">
            {t("mapping.remaining", {
              count: remaining.length,
              columns: remaining.join(", "),
            })}
          </span>
        )}
      </p>
      {committing ? (
        <p className="text-sm text-muted-foreground text-pretty">
          {t("commit.committingNote")}
        </p>
      ) : null}
      {commit.phase === "error" ? (
        <p role="alert" className="text-sm text-destructive text-pretty">
          {resolveCommitError(commit.code, t)}
        </p>
      ) : null}
      <Button
        type="button"
        className="min-h-12 gap-2 self-start"
        disabled={!ready || committing}
        onClick={onImport}
      >
        {committing ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : commit.phase === "error" ? (
          <RotateCcw aria-hidden="true" className="size-4" />
        ) : null}
        <span>
          {commit.phase === "error" ? t("retry") : t("mapping.importButton")}
        </span>
      </Button>
    </section>
  );
}

/**
 * The commit success surface (Decision 2026-09-28): a per-table imported-row
 * summary with a "Go to dashboard" link and an "Import another" action. There is
 * NO auto-redirect — the Admin chooses where to go next.
 */
function ImportSuccess({
  slug,
  result,
  tableLabel,
  onImportAnother,
  t,
}: {
  slug: string;
  result: CommitResult;
  tableLabel: (tableKey: string) => string;
  onImportAnother: () => void;
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <section
      role="status"
      className="flex flex-col gap-4 rounded-xl border bg-card p-6"
    >
      <div className="flex items-center gap-2">
        <CheckCircle2
          aria-hidden="true"
          className="size-5 shrink-0 text-primary"
        />
        <h2 className="text-lg font-semibold text-foreground">
          {t("commit.successHeading")}
        </h2>
      </div>
      <p className="text-sm text-muted-foreground text-pretty">
        {t("commit.successSummary", { count: result.importedCount })}
      </p>
      {result.tables.length > 0 ? (
        <ul className="flex flex-col gap-1 text-sm text-foreground">
          {result.tables.map((table) => (
            <li key={table.tableKey}>
              {t("commit.tableCount", {
                table: tableLabel(table.tableKey),
                count: table.count,
              })}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-wrap gap-3">
        <Button asChild className="min-h-12">
          <Link href={`/${slug}`}>{t("commit.goToDashboard")}</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          className="min-h-12"
          onClick={onImportAnother}
        >
          {t("commit.importAnother")}
        </Button>
      </div>
    </section>
  );
}

/** Commit error CODEs mapped to a translated `Import.error.*` message. */
const COMMIT_ERROR_KEYS = new Set([
  "unresolvedColumns",
  "schemaChanged",
  "tooManyRows",
  "commitFailed",
  "empty",
  "unreadable",
  "tooLarge",
  "noFile",
  "forbidden",
  "unauthorized",
  "genericError",
]);

/** Resolve a thrown commit error CODE to a translated message (default: commitFailed). */
function resolveCommitError(
  code: string | null,
  t: ReturnType<typeof useTranslations>,
): string {
  const raw = code ?? "commitFailed";
  const key = raw.startsWith("Import.error.")
    ? raw.slice("Import.error.".length)
    : raw;
  return COMMIT_ERROR_KEYS.has(key) ? t(`error.${key}`) : t("error.commitFailed");
}
