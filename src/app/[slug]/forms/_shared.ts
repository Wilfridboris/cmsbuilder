import "server-only";

import { redirect } from "next/navigation";

import { AppError } from "@/types/api";
import type { FormRow } from "@/types/db";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { resolveOrgIdentity } from "@/lib/api/route-helpers";
import { getFormById } from "@/lib/data/forms";
import { getSchema } from "@/lib/data/records";
import { visibleTables } from "@/lib/schema/overrides";
import { eligibleFields } from "@/lib/data/filter-sort";
import {
  evaluateFormPublishability,
  type PublishabilityReason,
} from "@/lib/forms/publishability";

/**
 * Shared server-side gate + context loader for the Admin-gated `/{slug}/forms` pages
 * (Epic 14, Story 14.1). Mirrors `invoices/_shared.ts`: a non-member, Member, or
 * cross-org Admin is redirected to `/{slug}` (a UX gate; the `/api/forms` routes
 * independently re-enforce Admin server-side, so frontend hiding is never the sole
 * gate). An unauthenticated caller goes to `/login`.
 */

/**
 * Enforce the Admin gate for the Forms area. Redirects to `/{slug}` on any auth failure
 * (unauthenticated → `/login`). Returns the resolved `slug` (the list itself is fetched
 * client-side via `/api/forms`, exactly like the invoices list).
 */
export async function loadFormsPageContext(
  slug: string,
): Promise<{ slug: string }> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?auth=required");
  }

  // Admin gate (UX): a non-member / Member / cross-org Admin bounces to `/{slug}`.
  try {
    const membership = await requireAdmin(user, createAdminClient());
    if (membership.slug !== slug) {
      redirect(`/${slug}`);
    }
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/${slug}`);
    }
    throw err;
  }

  return { slug };
}

/**
 * Load a single form for the `/{slug}/forms/[formId]` editor so it renders server-side
 * with the form already resolved. Runs the SAME Admin gate as
 * {@link loadFormsPageContext} (redirects on any auth failure), then reads the form
 * under the caller's RLS client. Returns `null` when the form does not exist under this
 * org (RLS-hidden cross-org id or unknown id) so the page can render a not-found state.
 * A read error degrades to null rather than crashing.
 */
export async function loadFormForPage(
  slug: string,
  formId: string,
): Promise<FormRow | null> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?auth=required");
  }

  try {
    const membership = await requireAdmin(user, createAdminClient());
    if (membership.slug !== slug) {
      redirect(`/${slug}`);
    }
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/${slug}`);
    }
    throw err;
  }

  // The redirects above run before this block, so no redirect() control flow is caught.
  try {
    const { client, orgId } = await resolveOrgIdentity(slug, user.id);
    return await getFormById(client, orgId, formId);
  } catch (err) {
    if (err instanceof AppError) {
      return null;
    }
    throw err;
  }
}

/**
 * The editor loader for `/{slug}/forms/[formId]` (Epic 14, Story 14.3). Runs the SAME
 * Admin gate as {@link loadFormForPage}, reads the form under the caller's RLS client,
 * and additionally evaluates the server-side publish gate
 * ({@link evaluateFormPublishability}) so the editor can render the publish toggle
 * disabled with a reason — frontend disabling is never the only gate (the mutation
 * re-runs the same predicate). Also returns the org's VISIBLE tables (`{key,label}`) so
 * the editor's target-table picker (Story 14.4) can offer them. Returns `null` when the
 * form does not exist under this org (RLS-hidden / unknown id). The publishability
 * evaluation never throws; a form that cannot be read is simply `null`. A schema read
 * failure degrades the tables list to empty rather than crashing the page.
 */
export async function loadFormForEditor(
  slug: string,
  formId: string,
): Promise<{
  form: FormRow;
  publishable: boolean;
  reason: PublishabilityReason;
  tables: { key: string; label: string }[];
  editorFields: {
    key: string;
    label: string;
    type: string;
    isRelation: boolean;
  }[];
} | null> {
  const user = await getCurrentUser();
  if (!user) {
    redirect("/login?auth=required");
  }

  try {
    const membership = await requireAdmin(user, createAdminClient());
    if (membership.slug !== slug) {
      redirect(`/${slug}`);
    }
  } catch (err) {
    if (err instanceof AppError) {
      redirect(`/${slug}`);
    }
    throw err;
  }

  // The redirects above run before this block, so no redirect() control flow is caught.
  try {
    const { client, orgId } = await resolveOrgIdentity(slug, user.id);
    const form = await getFormById(client, orgId, formId);
    if (!form) {
      return null;
    }
    const { publishable, reason } = await evaluateFormPublishability(
      client,
      orgId,
      form,
    );
    // The target-table picker (Story 14.4) offers exactly the org's VISIBLE tables,
    // labelled by their human `label`. A schema read failure degrades to an empty list
    // (the picker then shows its placeholder) rather than crashing the admin page.
    const schemaResult = await getSchema(client, orgId);
    const visible = schemaResult.data ? visibleTables(schemaResult.data) : [];
    const tables = visible.map((t) => ({ key: t.key, label: t.label }));

    // The per-field editor (Story 14.5) lists the form's CURRENT target table's non-hidden
    // fields, each flagged `isRelation` so the editor renders relation rows locked and never
    // emits them into the saved config (FR78). A null/stale/hidden target or an unreadable
    // schema degrades to an empty list (the card then shows its "no fields" state).
    const targetTable = form.target_table_key
      ? visible.find((t) => t.key === form.target_table_key)
      : undefined;
    const editorFields = targetTable
      ? eligibleFields(targetTable.fields).map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          isRelation: field.type === "relation",
        }))
      : [];

    return { form, publishable, reason, tables, editorFields };
  } catch (err) {
    if (err instanceof AppError) {
      return null;
    }
    throw err;
  }
}
