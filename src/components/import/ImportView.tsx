"use client";

import { useCallback, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { CheckCircle2, RotateCcw } from "lucide-react";

import { ImportDropzone } from "@/components/import/ImportDropzone";
import { ColumnPreview } from "@/components/import/ColumnPreview";
import { MappingProposal } from "@/components/import/MappingProposal";
import { Button } from "@/components/ui/button";
import {
  proposeMapping,
  ImportApiError,
  type ImportPreview,
} from "@/lib/data/import-client";
import type { FieldCatalog, ImportProposal } from "@/types/import";
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
 * There is still no write path here: the Import button's enabled/disabled gate is
 * 4.3's; wiring its click to `/api/import/commit` is 4.4 (the `onImport` seam).
 * "Start over" clears everything back to the dropzone.
 */

type Session = {
  preview: ImportPreview;
  file: File;
  sheet: string | undefined;
};

export function ImportView({
  slug,
  fieldCatalog,
}: {
  slug: string;
  /** Client-safe non-hidden schema catalog for the target picker + labels (4.3). */
  fieldCatalog: FieldCatalog;
}) {
  const t = useTranslations("Import");
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [proposal, setProposal] = useState<ImportProposal | null>(null);
  const [decisions, setDecisions] = useState<DecisionMap>({});
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const runPropose = useCallback(
    async (file: File, sheet: string | undefined, columns: string[]) => {
      setStatus("loading");
      setErrorCode(null);
      setProposal(null);
      setDecisions({});
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
  };

  const handleDecisionChange = useCallback(
    (sourceColumn: string, decision: MappingDecision) => {
      setDecisions((prev) => ({ ...prev, [sourceColumn]: decision }));
    },
    [],
  );

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
          <ImportGate ready={ready} remaining={remaining} t={t} />
        ) : null}
      </div>
    );
  }

  return <ImportDropzone slug={slug} onPreview={handlePreview} />;
}

/**
 * The Import action gate (4.3). Disabled while any flagged column is unresolved,
 * naming the remaining columns; enabled with a readiness message once every flagged
 * column is mapped or skipped. The `aria-live` region announces the remaining count
 * as it changes. The button click is a no-op seam here — 4.4 wires it to commit.
 */
function ImportGate({
  ready,
  remaining,
  t,
}: {
  ready: boolean;
  remaining: string[];
  t: ReturnType<typeof useTranslations>;
}) {
  return (
    <section className="flex flex-col gap-3 rounded-xl border bg-card p-5">
      <p aria-live="polite" className="text-sm text-pretty">
        {ready ? (
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
      <Button type="button" className="min-h-12 self-start" disabled={!ready}>
        {t("mapping.importButton")}
      </Button>
    </section>
  );
}
