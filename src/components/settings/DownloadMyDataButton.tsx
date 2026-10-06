"use client";

import { useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Download, Loader2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { ApiResponse } from "@/types/api";

/**
 * DownloadMyDataButton (Story 8.4) — the Admin-only "Download My Data" trigger on
 * the Settings page. Mirrors the sibling settings components (`InviteForm`,
 * `BusinessProfileForm`): `useTranslations("DataExport")`, a shadcn `Button`, and
 * lucide icons.
 *
 * On click it fetches the single ZIP bundle from `GET /api/export?slug=`. On
 * `res.ok` it reads the response as a blob, creates a temporary object-URL,
 * triggers a programmatic `<a download>` click, and revokes the URL. On failure it
 * reads the `{ data, error }` envelope and shows the translated `error.<code>`
 * message (never a raw error). The Settings page is already Admin-gated and the
 * route independently re-enforces Admin + the slug cross-check server-side, so
 * frontend gating is never the sole gate.
 *
 * WCAG AA: a real labelled Button (not icon-only), the pending state disables the
 * button and shows a spinner plus a `role="status"` status line that is announced;
 * the decorative icons are `aria-hidden`. All copy resolves through the next-intl
 * `DataExport` namespace (EN + FR).
 */

/** Server error codes this button maps to a translated inline message. */
const ERROR_KEYS = new Set(["unauthorized", "forbidden", "genericError"]);

/**
 * Parse the filename from a `Content-Disposition` header, falling back to a sane
 * default. The server sends `attachment; filename="scheza-<slug>-<date>.zip"`.
 */
function filenameFromDisposition(
  header: string | null,
  fallback: string,
): string {
  if (!header) return fallback;
  const match = /filename="?([^"]+)"?/.exec(header);
  return match?.[1] ?? fallback;
}

export function DownloadMyDataButton({ slug }: { slug: string }) {
  const t = useTranslations("DataExport");
  const [status, setStatus] = useState<"idle" | "preparing">("idle");
  const [error, setError] = useState<string | null>(null);

  const statusId = useId();
  const errorId = useId();

  const resolveError = (code: string | null): string => {
    if (code && ERROR_KEYS.has(code)) {
      return t(`error.${code}`);
    }
    return t("error.genericError");
  };

  const handleClick = async () => {
    if (status === "preparing") return;
    setStatus("preparing");
    setError(null);

    try {
      const res = await fetch(`/api/export?slug=${encodeURIComponent(slug)}`);
      if (!res.ok) {
        // A failed export returns the JSON `{ data, error }` envelope, not a zip.
        let code: string | null = null;
        try {
          const body: ApiResponse<unknown> = await res.json();
          code = body.error;
        } catch {
          code = null;
        }
        setError(resolveError(code));
        setStatus("idle");
        return;
      }

      const blob = await res.blob();
      const filename = filenameFromDisposition(
        res.headers.get("Content-Disposition"),
        `scheza-${slug}.zip`,
      );
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      // Defer the revoke a tick: revoking synchronously right after click() can
      // cancel the download of a large blob in some browsers before it starts.
      setTimeout(() => URL.revokeObjectURL(url), 0);
      setStatus("idle");
    } catch {
      setError(resolveError(null));
      setStatus("idle");
    }
  };

  const isPreparing = status === "preparing";

  return (
    <div className="flex flex-col gap-3">
      <Button
        type="button"
        onClick={handleClick}
        disabled={isPreparing}
        aria-describedby={
          isPreparing ? statusId : error ? errorId : undefined
        }
        className="min-h-12 gap-2 self-start"
      >
        {isPreparing ? (
          <Loader2 aria-hidden="true" className="size-4 animate-spin" />
        ) : (
          <Download aria-hidden="true" className="size-4" />
        )}
        <span>{t("button")}</span>
      </Button>

      {isPreparing ? (
        <p
          id={statusId}
          role="status"
          className="text-sm text-muted-foreground"
        >
          {t("preparing")}
        </p>
      ) : null}

      {error ? (
        <p id={errorId} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
