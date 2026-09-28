"use client";

import { useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { Loader2, RotateCcw, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  analyzeSpreadsheet,
  needsSheetSelection,
  ImportApiError,
  type ImportPreview,
} from "@/lib/data/import-client";

/**
 * ImportDropzone (Story 4.1) — the Admin-only upload surface for the analyze
 * phase. It owns the whole client interaction: an accessible drag-and-drop zone
 * wrapping a REAL labelled `<input type="file">` (never placeholder-only), the
 * server round-trip to `/api/import/analyze`, the multi-sheet picker (when the
 * workbook needs one), a translated retryable error, and — on success — lifting
 * the parsed preview up to the page via `onPreview`.
 *
 * Read-only by contract: it uploads bytes and renders what the server read back;
 * it never writes anything. Every failure resolves the server's error CODE to a
 * translated, non-technical message with a retry path and leaves no state behind.
 *
 * Built to the web-uiux-architect standard: Tailwind v4 (`size-*`), ≥48px targets,
 * a labelled dropzone that is keyboard-operable (the label IS the trigger, so
 * Space/Enter open the picker natively), visible focus rings, `aria-hidden`
 * decorative icons, an `aria-live` status region, and CSS-first motion (Framer
 * Motion only for the error's enter/exit via `AnimatePresence`). Copy resolves
 * through the `Import` next-intl namespace (EN + FR).
 */

/** Client error CODEs mapped to a translated `Import.error.*` message. */
const ERROR_KEYS = new Set([
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

type Status = "idle" | "analyzing" | "sheetSelect" | "error";

export function ImportDropzone({
  slug,
  onPreview,
}: {
  slug: string;
  /** Called with the parsed preview when a sheet resolves successfully. */
  onPreview: (preview: ImportPreview) => void;
}) {
  const t = useTranslations("Import");
  const prefersReducedMotion = useReducedMotion();

  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const sheetId = useId();
  const inputRef = useRef<HTMLInputElement>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // The file kept in hand so a multi-sheet re-analyze can re-send its bytes.
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [sheetNames, setSheetNames] = useState<string[]>([]);
  const [chosenSheet, setChosenSheet] = useState<string>("");

  const resolveError = (code: string | null): string => {
    const key = code ? toErrorCode(code) : "genericError";
    return ERROR_KEYS.has(key) ? t(`error.${key}`) : t("error.genericError");
  };

  const reset = () => {
    setStatus("idle");
    setError(null);
    setPendingFile(null);
    setSheetNames([]);
    setChosenSheet("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const runAnalyze = async (file: File, sheet?: string) => {
    setStatus("analyzing");
    setError(null);
    try {
      const result = await analyzeSpreadsheet(slug, file, sheet);
      if (needsSheetSelection(result)) {
        setPendingFile(file);
        setSheetNames(result.sheetNames);
        setChosenSheet(result.sheetNames[0] ?? "");
        setStatus("sheetSelect");
        return;
      }
      onPreview(result);
      reset();
    } catch (err) {
      const code = err instanceof ImportApiError ? err.code : null;
      setError(resolveError(code));
      setStatus("error");
    }
  };

  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    void runAnalyze(file);
  };

  const analyzing = status === "analyzing";

  return (
    <div className="flex flex-col gap-4">
      {/* The dropzone: a <label> wrapping a real file input. The label is the
          keyboard-operable trigger (Space/Enter open the native picker), so no
          custom key handling is needed and the input stays the a11y source of
          truth. Drag events decorate it; the click/keyboard path is native. */}
      <label
        htmlFor={inputId}
        onDragOver={(e) => {
          e.preventDefault();
          if (!analyzing) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!analyzing) handleFiles(e.dataTransfer.files);
        }}
        className={cn(
          "group relative flex min-h-48 cursor-pointer flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed p-8 text-center transition-colors duration-200",
          "focus-within:outline-none focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2",
          dragging
            ? "border-primary bg-primary/5"
            : "border-border bg-muted/30 hover:border-primary/60 hover:bg-muted/50",
          analyzing && "pointer-events-none opacity-70",
        )}
      >
        <span
          aria-hidden="true"
          className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20"
        >
          {analyzing ? (
            <Loader2 className="size-6 animate-spin" />
          ) : (
            <Upload className="size-6" />
          )}
        </span>
        <span className="text-base font-medium text-foreground text-balance">
          {analyzing
            ? t("analyzing")
            : dragging
              ? t("dropzoneActive")
              : t("dropzoneLabel")}
        </span>
        <span id={hintId} className="max-w-md text-sm text-muted-foreground text-pretty">
          {t("dropzoneHint")}
        </span>
        <span
          className={cn(
            "mt-1 inline-flex min-h-12 items-center rounded-md border bg-background px-4 text-sm font-medium shadow-xs transition-colors group-hover:bg-accent group-hover:text-accent-foreground",
          )}
        >
          {t("dropzoneButton")}
        </span>
        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept=".csv,.xls,.xlsx"
          disabled={analyzing}
          aria-describedby={cn(hintId, error ? errorId : undefined)}
          onChange={(e) => handleFiles(e.target.files)}
          className="sr-only"
        />
      </label>

      {/* Multi-sheet picker: the workbook has >1 sheet and none is chosen yet.
          Choosing one re-analyzes that sheet with the file still in hand. */}
      {status === "sheetSelect" && pendingFile ? (
        <div className="flex flex-col gap-3 rounded-xl border bg-card p-5">
          <label htmlFor={sheetId} className="text-sm font-medium text-foreground text-pretty">
            {t("sheetPickerLabel")}
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Select value={chosenSheet} onValueChange={setChosenSheet}>
              <SelectTrigger id={sheetId} className="min-h-12 w-full sm:w-72">
                <SelectValue placeholder={t("sheetPickerPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {sheetNames.map((name) => (
                  <SelectItem key={name} value={name}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              type="button"
              className="min-h-12"
              disabled={chosenSheet === ""}
              onClick={() => void runAnalyze(pendingFile, chosenSheet)}
            >
              {t("sheetPickerButton")}
            </Button>
          </div>
        </div>
      ) : null}

      {/* Translated, retryable error — never a raw parser message. */}
      <AnimatePresence>
        {status === "error" && error ? (
          <motion.div
            key="import-error"
            initial={prefersReducedMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 p-5"
          >
            <p id={errorId} role="alert" className="text-sm text-destructive text-pretty">
              {error}
            </p>
            <Button type="button" variant="outline" className="min-h-12 gap-2" onClick={reset}>
              <RotateCcw aria-hidden="true" className="size-4" />
              <span>{t("retry")}</span>
            </Button>
          </motion.div>
        ) : null}
      </AnimatePresence>

      {/* Polite status region for assistive tech during the analyze round-trip. */}
      <p aria-live="polite" className="sr-only">
        {analyzing ? t("analyzing") : ""}
      </p>
    </div>
  );
}
