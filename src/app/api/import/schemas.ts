import { z } from "zod";

import type { DecisionMap } from "@/lib/import/resolve";

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

/**
 * The server-side data-row cap for a single import (Story 4.4), matching the epic
 * performance guarantee (up to 5,000 rows). A parsed file whose data-row count
 * exceeds this is rejected before any write with `Import.error.tooManyRows` (413).
 * Enforced in the route after parse (the row count is only known post-parse), not
 * here — this module bounds only the upload identity/size/extension.
 */
export const MAX_IMPORT_ROWS = 5000;

/**
 * One source column's confirmed decision on the wire (Story 4.4). Mirrors the
 * client `MappingDecision` union: `map` carries the target `{table, field}` keys,
 * `skip` excludes the column, `unresolved` is rejected by the planner (the route's
 * gate should never let it through). Parsed from the `decisions` JSON string.
 */
const mappingDecisionSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("map"),
    table: z.string().trim().min(1),
    field: z.string().trim().min(1),
  }),
  z.object({ kind: z.literal("skip") }),
  z.object({ kind: z.literal("unresolved") }),
]);

/** The confirmed per-column decision map, keyed by the exact source-column string. */
const decisionMapSchema = z.record(z.string(), mappingDecisionSchema);

/**
 * Validate the commit `formData` parts (Story 4.4). Reuses the analyze file
 * identity/size/extension guard (same ≤5 MB + extension rules, same error KEYs),
 * adds the optional `sheet`, the confirmed `decisions` (a JSON STRING parsed into a
 * `DecisionMap`), and a non-empty `import_id` (the client's stable idempotency
 * seed). A malformed `decisions` JSON string, or one whose parsed shape is invalid,
 * is rejected as `Import.error.unreadable` (the route maps it to 400) rather than
 * leaking a parse error. The route still re-parses the file bytes and re-validates
 * every decision target against the live schema — this only shapes the request.
 */
export const commitInputSchema = z
  .object({
    file: z.unknown(),
    sheet: z.string().trim().min(1).optional(),
    decisions: z.string(),
    import_id: z.string().trim().min(1, "Import.error.unreadable"),
  })
  .superRefine((value, ctx) => {
    const file = value.file;
    if (!(file instanceof File) || file.size < 0 || file.name === "") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file"],
        message: "Import.error.noFile",
      });
      return;
    }
    if (file.size === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file"],
        message: "Import.error.empty",
      });
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file"],
        message: "Import.error.tooLarge",
      });
      return;
    }
    const ext = extensionOf(file.name);
    if (ext === null || !ACCEPTED_EXTENSIONS.includes(ext as never)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["file"],
        message: "Import.error.unreadable",
      });
      return;
    }
    // Parse + shape-check the decisions JSON. Any failure → unreadable (400).
    let parsedDecisions: unknown;
    try {
      parsedDecisions = JSON.parse(value.decisions);
    } catch {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisions"],
        message: "Import.error.unreadable",
      });
      return;
    }
    const result = decisionMapSchema.safeParse(parsedDecisions);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["decisions"],
        message: "Import.error.unreadable",
      });
    }
  });

export type CommitInput = {
  file: File;
  sheet?: string;
  decisions: string;
  import_id: string;
};

/**
 * Parse the already-guarded `decisions` JSON string into a typed `DecisionMap`.
 * Assumes `commitInputSchema` has passed (so the string parses and matches shape);
 * returns the typed map for the planner.
 */
export function parseDecisions(decisions: string): DecisionMap {
  return decisionMapSchema.parse(JSON.parse(decisions)) as DecisionMap;
}
