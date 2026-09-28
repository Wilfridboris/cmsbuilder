import { z } from "zod";

/**
 * Zod validators for the `/api/import/analyze` route (Story 4.1), factored into a
 * plain module (NOT the route file) so Next's route type-generator doesn't reject
 * them as unexpected non-handler exports — and so they're importable by pure
 * schema-shape unit tests with no HTTP harness. Mirrors `api/records/schemas.ts`.
 *
 * This guards the multipart upload BEFORE any parse work: a file must be present,
 * within the size bound, and carry an accepted spreadsheet extension. The optional
 * `sheet` field names which sheet of a multi-sheet workbook to parse.
 */

/** The upload size bound, enforced server-side before parsing (frozen: reject > 5 MB). */
export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

/** Accepted spreadsheet extensions (lower-cased, no dot). */
export const ACCEPTED_EXTENSIONS = ["csv", "xls", "xlsx"] as const;

/** Lower-cased extension (no dot) of a filename, or `null` when there is none. */
export function extensionOf(filename: string): string | null {
  const base = filename.split(/[\\/]/).pop() ?? filename;
  const dot = base.lastIndexOf(".");
  if (dot <= 0 || dot === base.length - 1) return null;
  return base.slice(dot + 1).toLowerCase();
}

/**
 * Validate a `formData` `file` part plus an optional `sheet` name. The route reads
 * these out of the multipart body and hands them here; the schema never touches
 * the file BYTES (that is the pure parser's job) — it only bounds identity, size,
 * and extension so an oversized or non-spreadsheet upload is rejected before parse.
 *
 * Each failure path maps to a distinct frozen matrix error KEY via a `.superRefine`
 * message, so the route can turn a rejection into the right translated error/status.
 */
export const analyzeInputSchema = z
  .object({
    file: z.unknown(),
    sheet: z.string().trim().min(1).optional(),
  })
  .superRefine((value, ctx) => {
    const file = value.file;
    // A missing / non-File part → "no file" (400).
    if (!(file instanceof File) || file.size < 0 || file.name === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file"],
        message: "Import.error.noFile",
      });
      return;
    }
    // Empty upload → "empty file" (400). (Extension may still be valid.)
    if (file.size === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file"],
        message: "Import.error.empty",
      });
      return;
    }
    // Over the bound → "too large" (413), checked before any parse.
    if (file.size > MAX_UPLOAD_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file"],
        message: "Import.error.tooLarge",
      });
      return;
    }
    // Wrong extension / not a spreadsheet → "unreadable/unsupported" (400).
    const ext = extensionOf(file.name);
    if (ext === null || !ACCEPTED_EXTENSIONS.includes(ext as never)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file"],
        message: "Import.error.unreadable",
      });
    }
  });

export type AnalyzeInput = { file: File; sheet?: string };
