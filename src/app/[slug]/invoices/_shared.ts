import "server-only";

import { redirect } from "next/navigation";

import { AppError } from "@/types/api";
import type { InvoiceLanguage } from "@/types/db";
import { getCurrentUser } from "@/lib/auth/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/auth/rbac";
import { resolveOrgIdentity } from "@/lib/api/route-helpers";
import { getSchema } from "@/lib/data/records";
import { visibleTables } from "@/lib/schema/overrides";
import { isRegistrationEffective } from "@/lib/invoicing/tax";

/**
 * Shared server-side gate + context loader for the Admin-gated `/{slug}/invoices`
 * pages (Story 12.2). Mirrors the settings / import page convention: a non-member,
 * Member, or cross-org Admin is redirected to `/{slug}` (a UX gate; the API routes
 * independently re-enforce Admin server-side). Returns the caller's RLS-scoped
 * identity plus the client-safe context the draft pages need.
 */

/** A client-safe org table (key + label) for the linked-record picker (FR82). */
export type OrgTableOption = { key: string; label: string };

export type InvoicePageContext = {
  slug: string;
  /** Non-hidden tables the picker can link against, `{ key, label }` only. */
  tables: OrgTableOption[];
  /** Province default: Business Profile jurisdiction, falling back to ON. */
  defaultProvince: string;
  /** Language default: Business Profile default_language, falling back to en. */
  defaultLanguage: InvoiceLanguage;
  /**
   * Whether the business's GST/HST registration is effective as of TODAY (Story
   * 12.3): a `gst_hst_number` is present AND `isRegistrationEffective` against
   * today's date. Passed to the form so its live tax preview matches the server's
   * provisional reference date for a draft. False when unregistered or future-dated.
   */
  taxRegistered: boolean;
};

/**
 * Enforce the Admin gate and load the invoice-page context. Redirects to `/{slug}`
 * on any auth failure (unauthenticated → `/login`). Reads the org schema + Business
 * Profile defaults under the caller's RLS-scoped client (never the service role).
 */
export async function loadInvoicePageContext(
  slug: string,
): Promise<InvoicePageContext> {
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

  // RLS-scoped context: the org's non-hidden tables (for the picker) + the Business
  // Profile province/language defaults. Both degrade gracefully.
  let tables: OrgTableOption[] = [];
  let defaultProvince = "ON";
  let defaultLanguage: InvoiceLanguage = "en";
  let taxRegistered = false;
  try {
    const { client, orgId } = await resolveOrgIdentity(slug, user.id);

    const schemaResult = await getSchema(client, orgId);
    if (schemaResult.data) {
      tables = visibleTables(schemaResult.data).map((table) => ({
        key: table.key,
        label: table.label,
      }));
    }

    const { data: profile } = await client
      .from("business_profiles")
      .select(
        "jurisdiction, default_language, gst_hst_number, gst_hst_effective_date",
      )
      .eq("organization_id", orgId)
      .maybeSingle();
    if (profile) {
      const jurisdiction = (profile.jurisdiction as string | null)?.trim();
      if (jurisdiction) {
        defaultProvince = jurisdiction;
      }
      const lang = profile.default_language as InvoiceLanguage | null;
      if (lang === "en" || lang === "fr") {
        defaultLanguage = lang;
      }
      // Registration is effective when a number is present AND its effective date
      // is on or before TODAY (the same provisional reference a draft save uses).
      // Uses the SHARED predicate (I3) so the preview matches the stored figures.
      const hasNumber =
        typeof profile.gst_hst_number === "string" &&
        profile.gst_hst_number.trim() !== "";
      const referenceDate = new Date().toISOString().slice(0, 10);
      taxRegistered =
        hasNumber &&
        isRegistrationEffective(
          (profile.gst_hst_effective_date as string | null) ?? null,
          referenceDate,
        );
    }
  } catch {
    // Degrade to defaults (empty tables / ON / en / no tax) — the pages still render.
  }

  return { slug, tables, defaultProvince, defaultLanguage, taxRegistered };
}
