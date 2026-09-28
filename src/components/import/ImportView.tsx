"use client";

import { useCallback, useState } from "react";

import { ImportDropzone } from "@/components/import/ImportDropzone";
import { ColumnPreview } from "@/components/import/ColumnPreview";
import { MappingProposal } from "@/components/import/MappingProposal";
import {
  proposeMapping,
  ImportApiError,
  type ImportPreview,
} from "@/lib/data/import-client";
import type { ImportProposal } from "@/types/import";

/**
 * ImportView (Story 4.1 + 4.2) — the client shell that toggles the analyze-phase
 * surface between the upload dropzone and the parsed preview, and — new in 4.2 —
 * auto-fetches the AI-proposed column mapping once a preview resolves and renders
 * it below the preview.
 *
 * It holds the last successful preview plus the uploaded `file` and resolved
 * `sheet` (import is stateless — the propose call re-parses the same bytes/sheet
 * server-side, no fileId). When a preview resolves it auto-calls `proposeMapping`
 * and drives `MappingProposal`'s own loading / ready / error state. "Start over"
 * clears everything back to the dropzone.
 *
 * There is still no write path here: a proposal is the terminal state of 4.2
 * (editing is 4.3, commit is 4.4).
 */

type Session = {
  preview: ImportPreview;
  file: File;
  sheet: string | undefined;
};

export function ImportView({ slug }: { slug: string }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [proposal, setProposal] = useState<ImportProposal | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);

  const runPropose = useCallback(
    async (file: File, sheet: string | undefined) => {
      setStatus("loading");
      setErrorCode(null);
      setProposal(null);
      try {
        const result = await proposeMapping(slug, file, sheet);
        setProposal(result);
        setStatus("ready");
      } catch (err) {
        setErrorCode(err instanceof ImportApiError ? err.code : null);
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
    void runPropose(file, sheet);
  };

  const handleStartOver = () => {
    setSession(null);
    setProposal(null);
    setErrorCode(null);
    setStatus("loading");
  };

  if (session) {
    return (
      <div className="flex flex-col gap-6">
        <ColumnPreview preview={session.preview} onStartOver={handleStartOver} />
        <MappingProposal
          proposal={proposal}
          status={status}
          errorCode={errorCode}
          onRetry={() => void runPropose(session.file, session.sheet)}
        />
      </div>
    );
  }

  return <ImportDropzone slug={slug} onPreview={handlePreview} />;
}
