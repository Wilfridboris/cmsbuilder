import "server-only";

import type { NextRequest } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { SubscriptionStatus } from "@/types/db";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { resolveOrgIdentity } from "@/lib/api/route-helpers";
import { parseSpreadsheet, ParseError, type ParseResult } from "@/lib/import/parse";

/**
 * Shared scaffolding for the import API routes — analyze (4.1), propose (4.2), and
 * commit (4.4) — which all repeat the same three seams: the Admin auth chain, the
 * matrix-key→status map, and the server-side re-parse. They lived copy-pasted in
 * each route (the duplication the Epic-4 retro flagged as [A1], the same pattern the
 * Epic-3 retro extracted for the records routes); this collapses them to one source.
 *
 * `import "server-only"`: these touch auth, cookies, and the admin client and must
 * never enter a client bundle.
 */

/** The Admin-resolved import request: the form plus the caller's RLS-scoped identity. */
export type ImportRequestContext = {
  /** The parsed multipart body (file, slug, sheet, and per-route extras). */
  form: FormData;
  /** The addressed org slug (trimmed, non-empty). */
  slug: string;
  /** The caller's RLS-scoped Supabase client (never the service role for tenant data). */
  client: SupabaseClient;
  /** The acting user id, written to `records.actor_id` on any commit. */
  actorId: string;
  /** The resolved organization id for `slug`. */
  orgId: string;
  /** The org's cached access state (Story 7.4). The commit route — the only write
   * phase — asserts writability over these; analyze/propose (reads) ignore them. */
  subscriptionStatus: SubscriptionStatus;
  trialExpiresAt: string | null;
};

/**
 * Authenticate and authorize an import request, returning the multipart form and
 * the caller's RLS-scoped identity. The chain — identical across analyze/propose/
 * commit and run BEFORE any parse, AI, or write:
 *
 *   1. `getCurrentUser()` → 401 if no JWT-validated session;
 *   2. read `formData` (a malformed body → 400 genericError);
 *   3. require a non-empty `slug` form field (→ 400 genericError);
 *   4. `resolveOrgIdentity(slug, user.id)` resolves the org UNDER RLS — a non-member
 *      (or bad slug) sees no row → 403 forbidden — and yields the RLS client + orgId;
 *   5. `requireAdmin` re-checks the role authoritatively from `org_members` (a Member
 *      → 403), and a `membership.slug === slug` check rejects a cross-org Admin (403).
 *
 * The service-role client is used ONLY for `requireAdmin`'s narrow membership read,
 * never for tenant data.
 */
export async function resolveImportRequest(
  req: NextRequest,
): Promise<ImportRequestContext> {
  const user = await getCurrentUser();
  if (!user) {
    throw new AppError(401, "unauthorized");
  }

  // The addressed org travels as a `slug` form field alongside the file, so the
  // whole request is a single multipart POST (no query string on an upload).
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new AppError(400, "genericError");
  }

  const slugRaw = form.get("slug");
  if (typeof slugRaw !== "string" || slugRaw.trim() === "") {
    throw new AppError(400, "genericError");
  }
  const slug = slugRaw.trim();

  // Resolve the org UNDER RLS (non-member → 403), then re-enforce Admin
  // authoritatively (a Member → 403); reject a cross-org Admin whose most-recent
  // membership isn't this slug. All BEFORE any parse / AI / write.
  const { client, actorId, orgId, subscriptionStatus, trialExpiresAt } =
    await resolveOrgIdentity(slug, user.id);
  const membership = await requireAdmin(user, createAdminClient());
  if (membership.slug !== slug) {
    throw new AppError(403, "forbidden");
  }

  return { form, slug, client, actorId, orgId, subscriptionStatus, trialExpiresAt };
}

/**
 * Map a frozen matrix translation KEY to an `AppError` with the matrix status, so
 * file/parse failures resolve to the same translated keys in every import route.
 */
export function importErrorForKey(key: string): AppError {
  switch (key) {
    case "Import.error.tooLarge":
      return new AppError(413, "Import.error.tooLarge");
    case "Import.error.empty":
      return new AppError(400, "Import.error.empty");
    case "Import.error.noFile":
      return new AppError(400, "Import.error.noFile");
    case "Import.error.unreadable":
    default:
      return new AppError(400, "Import.error.unreadable");
  }
}

/**
 * Re-parse an uploaded file strictly SERVER-SIDE (client-parsed rows are never
 * trusted). Reads the bytes, runs `parseSpreadsheet`, and maps a `ParseError` to its
 * matrix key via {@link importErrorForKey}; any other parser throw is masked as a
 * generic `unreadable` (raw parser output never leaks). Callers handle the
 * multi-sheet result (`sheetNames` present) themselves — analyze returns a picker
 * payload, while propose/commit reject it — so this helper does not decide that.
 */
export async function parseUpload(
  file: File,
  chosenSheet: string | undefined,
): Promise<ParseResult> {
  const buffer = Buffer.from(await file.arrayBuffer());
  try {
    return parseSpreadsheet(buffer, file.name, chosenSheet);
  } catch (err) {
    if (err instanceof ParseError) {
      throw importErrorForKey(err.key);
    }
    throw new AppError(400, "Import.error.unreadable");
  }
}
