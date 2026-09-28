"use client";

import { useState } from "react";

import { ImportDropzone } from "@/components/import/ImportDropzone";
import { ColumnPreview } from "@/components/import/ColumnPreview";
import type { ImportPreview } from "@/lib/data/import-client";

/**
 * ImportView (Story 4.1) — the client shell that toggles the analyze-phase
 * surface between the upload dropzone and the parsed preview. It holds the single
 * piece of state (the last successful preview) so the server page can stay a
 * static RSC that just gates on Admin and mounts this island.
 *
 * There is no write path here: a preview is the terminal state of 4.1. "Start
 * over" simply clears the preview and returns to the dropzone (mapping/commit are
 * 4.2–4.4).
 */
export function ImportView({ slug }: { slug: string }) {
  const [preview, setPreview] = useState<ImportPreview | null>(null);

  if (preview) {
    return (
      <ColumnPreview preview={preview} onStartOver={() => setPreview(null)} />
    );
  }

  return <ImportDropzone slug={slug} onPreview={setPreview} />;
}
