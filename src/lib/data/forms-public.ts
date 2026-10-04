import "server-only";

import type { SchemaDefinition, TableDefinition } from "@/types/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSchema } from "@/lib/data/records";
import {
  getPublishedFormBySlug,
  getPrimaryPublishedForm,
} from "@/lib/data/forms";
import {
  applyFieldConfig,
  intakeFields,
  type PublicIntakeField,
} from "@/lib/intake/target";
import { visibleTables } from "@/lib/schema/overrides";
import { reportError } from "@/lib/observability/report";

/**
 * The single public-form authority (Epic 14, Story 14.2) shared by the per-form page,
 * the legacy bare-org page, and both submission handlers.
 *
 * Story 6.1/6.2 derived the public form from the org's schema via the Epic-6 intake
 * heuristic (`selectIntakeTable`). Epic 14 makes each `forms` row independently
 * reachable: the server re-resolves the form from `(orgSlug, formSlug?)`, treats the
 * form's stored `target_table_key` as authoritative, and reuses the existing
 * field-allowlist machinery. There is NO heuristic fallback on any public route —
 * resolution is STRICT (published-only), so every unavailable case (unknown org/form,
 * unpublished, null/stale target table, no eligible fields) collapses to `null`, which
 * the page renders as "form not available" and the handler as a generic 400.
 *
 * There is no session on a public visitor's device, so org resolution and the schema
 * read run through the SERVICE-ROLE admin client (RLS-bypassing). It NEVER throws
 * provider/DB internals to the caller — any failure collapses to `null`.
 */

/**
 * The server-resolved intake target for a public form. The SINGLE authority on which
 * org, which logical table, and which eligible non-relation fields a public submission
 * may touch — shared by the read pages and the write handlers. The write handler NEVER
 * trusts the client for the table or column set; it re-derives them here, so the client
 * payload can only ever land in this resolved `table` under this `orgId`, writing only
 * these `fields`.
 */
export type IntakeTarget = {
  /** The resolved org id — the write's `orgId` scope (never client-supplied). */
  orgId: string;
  /**
   * The org's slug — used ONLY to build the owner-dashboard CTA link in the
   * best-effort notification email (`{appOrigin}/{orgSlug}`). Never the form slug:
   * the dashboard link is the org's, identical on the keyed and bare-org routes.
   */
  orgSlug: string;
  /** The business name shown as the card eyebrow. */
  orgName: string;
  /** The logical table the form collects into (`mutate` `tableKey`). */
  table: TableDefinition;
  /**
   * The eligible, non-relation fields AFTER the form's per-field config is applied
   * (Story 14.5): visibility/label/help/order resolved here, once. The sole server-side
   * write allowlist — excluding a field in the config removes it from both render and
   * accepted payload.
   */
  fields: PublicIntakeField[];
  /**
   * The org's full resolved schema, read once here. The write handler passes it into
   * `mutate` so the referential-integrity guard reuses it instead of reading
   * `org_schemas` a second time per POST (epic-3 retro item 21).
   */
  schema: SchemaDefinition;
};

/**
 * Resolve a public form to its intake target, or `null` when there is nothing to
 * collect.
 *
 * The strict, published-only resolver: `orgSlug` -> org (service-role admin client)
 * -> form (keyed `getPublishedFormBySlug` when `formSlug` is given, else the primary
 * `getPrimaryPublishedForm` for the bare-org route) -> `getSchema` -> the table named
 * by the form's `target_table_key` within `visibleTables` -> `intakeFields`.
 *
 * Returns `null` (never throws) for EVERY unavailable case — an unknown/absent org or
 * form slug, no published form, a `target_table_key` that is null or names a
 * deleted/hidden table, or a table whose only fields are hidden/relation. There is NO
 * heuristic fallback. Any unexpected provider error is reported and collapses to `null`
 * so no DB/provider internals leak.
 */
export async function resolvePublicFormTarget({
  orgSlug,
  formSlug,
}: {
  orgSlug: string;
  formSlug?: string;
}): Promise<IntakeTarget | null> {
  if (!orgSlug) {
    return null;
  }
  // A keyed route with an empty form slug is unavailable, not a bare-org fallback.
  if (formSlug !== undefined && !formSlug) {
    return null;
  }

  try {
    const admin = createAdminClient();

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id, name")
      .eq("slug", orgSlug)
      .maybeSingle();

    // Unknown org slug or a provider error -> unavailable (no data leaked).
    if (orgError || !org) {
      return null;
    }

    const orgId = org.id as string;

    // Keyed route resolves THAT form by slug; bare-org route resolves the org's
    // primary (oldest published) form. Both are published-gated — no fallback.
    const form =
      formSlug !== undefined
        ? await getPublishedFormBySlug(admin, orgId, formSlug)
        : await getPrimaryPublishedForm(admin, orgId);

    // No published form (the default state until 14.3), or a form that is not
    // published / not under this org -> unavailable.
    if (!form) {
      return null;
    }

    // The form's stored target table is authoritative. A null `target_table_key`
    // (org had no visible tables at create) collapses to unavailable.
    if (!form.target_table_key) {
      return null;
    }

    const schemaResult = await getSchema(admin, orgId);
    if (schemaResult.error || !schemaResult.data) {
      return null;
    }

    // The target table must still be a CURRENTLY-visible table. A stale key naming a
    // deleted or now-hidden table collapses to unavailable (`visibleTables` excludes
    // hidden tables).
    const table = visibleTables(schemaResult.data).find(
      (t) => t.key === form.target_table_key,
    );
    if (!table) {
      return null;
    }

    // Apply the form's per-field config (Story 14.5) over the base intake fields — the
    // SINGLE resolution authority for visibility/label/help/order. An empty config
    // passes the base through unchanged (pre-14.5 behavior).
    const fields = applyFieldConfig(intakeFields(table), form.field_config);
    // The target table's only fields are hidden/relation, or the config excludes them
    // all -> nothing to collect (same "not available" state as zero-eligible).
    if (fields.length === 0) {
      return null;
    }

    return {
      orgId,
      orgSlug,
      orgName: (org.name as string) ?? "",
      table,
      fields,
      schema: schemaResult.data,
    };
  } catch (err) {
    // Never leak provider/DB output to the public surface. Report and degrade to the
    // unavailable state (indistinguishable from an unknown slug to the caller).
    reportError(err, { route: "/forms/[slug]" });
    return null;
  }
}
