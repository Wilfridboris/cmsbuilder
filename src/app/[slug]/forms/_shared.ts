import "server-only";

import { redirect } from "next/navigation";

import { AppError } from "@/types/api";
import type { FormRow } from "@/types/db";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { resolveOrgIdentity } from "@/lib/api/route-helpers";
import { getFormById } from "@/lib/data/forms";
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
 * re-runs the same predicate). Returns `null` when the form does not exist under this org
 * (RLS-hidden / unknown id). The publishability evaluation never throws; a form that
 * cannot be read is simply `null`.
 */
export async function loadFormForEditor(
  slug: string,
  formId: string,
): Promise<{
  form: FormRow;
  publishable: boolean;
  reason: PublishabilityReason;
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
    return { form, publishable, reason };
  } catch (err) {
    if (err instanceof AppError) {
      return null;
    }
    throw err;
  }
}
