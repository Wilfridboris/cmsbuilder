import "server-only";

import { redirect } from "next/navigation";

import { AppError } from "@/types/api";
import type { FormRow } from "@/types/db";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { resolveOrgIdentity } from "@/lib/api/route-helpers";
import { getFormById } from "@/lib/data/forms";

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
