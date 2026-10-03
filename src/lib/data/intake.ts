import "server-only";

import type { FieldDefinition, TableDefinition } from "@/types/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSchema } from "@/lib/data/records";
import { selectIntakeTable, intakeFields } from "@/lib/intake/target";
import { reportError } from "@/lib/observability/report";

/**
 * Server-only data function for the PUBLIC intake form at `/forms/{slug}` (Story 6.1).
 *
 * There is no session on a public visitor's device, so slug->org resolution and the
 * schema read run through the SERVICE-ROLE admin client (RLS-bypassing), exactly as
 * the `/i/[token]` public proxy does. The form is derived entirely from the org's
 * existing `org_schemas.definition` — no new table, column, or migration.
 *
 * This is the 6.1 READ side only: it resolves the org, selects the intake table, and
 * returns the fields to render. The submission write, confirmation, and validation are
 * Story 6.2. It NEVER throws provider/DB internals to the caller — any failure (unknown
 * slug, missing schema, provider error) collapses to `null`, which the page renders as
 * the friendly "form not available" state (never an error screen).
 */

/** The shape the public page needs to render the form (or `null` when unavailable). */
export type PublicIntakeForm = {
  /** The business name shown as the card eyebrow. */
  orgName: string;
  /** The selected intake table's authored label (the form heading context). */
  tableLabel: string;
  /** The eligible, non-relation fields to render as inputs, in definition order. */
  fields: FieldDefinition[];
};

/**
 * The server-resolved intake target for a slug (Story 6.2). The SINGLE authority on
 * which org, which logical table, and which eligible non-relation fields a public
 * submission may touch — shared by the read page (`getPublicIntakeForm`) and the write
 * handler (`/api/intake/[slug]`). The write handler NEVER trusts the client for the
 * table or column set; it re-derives them here, so the client payload can only ever
 * land in this resolved `table` under this `orgId`, writing only these `fields`.
 */
export type IntakeTarget = {
  /** The resolved org id — the write's `orgId` scope (never client-supplied). */
  orgId: string;
  /** The business name shown as the card eyebrow. */
  orgName: string;
  /** The logical table the form collects into (`mutate` `tableKey`). */
  table: TableDefinition;
  /** The eligible, non-relation fields: the server-side write allowlist. */
  fields: FieldDefinition[];
};

/**
 * Resolve `slug` -> the intake target, or `null` when there is nothing to collect.
 *
 * The shared resolver: slug -> org (service-role admin client, RLS-bypassing, exactly
 * as the public page needs) -> schema -> `selectIntakeTable` -> `intakeFields`. Returns
 * `null` (never throws) for every unavailable case — an unknown/absent slug, a missing
 * or empty schema, no visible tables, or an intake table whose only fields are
 * hidden/relation. An empty slug short-circuits before any query. Any unexpected
 * provider error is reported and collapses to `null` so no DB/provider internals leak.
 */
export async function getIntakeTarget(
  slug: string,
): Promise<IntakeTarget | null> {
  if (!slug) {
    return null;
  }

  try {
    const admin = createAdminClient();

    const { data: org, error: orgError } = await admin
      .from("organizations")
      .select("id, name")
      .eq("slug", slug)
      .maybeSingle();

    // Unknown slug or a provider error -> unavailable (no data leaked).
    if (orgError || !org) {
      return null;
    }

    const schemaResult = await getSchema(admin, org.id as string);
    if (schemaResult.error || !schemaResult.data) {
      return null;
    }

    const table = selectIntakeTable(schemaResult.data);
    if (!table) {
      return null;
    }

    const fields = intakeFields(table);
    // The intake table's only fields are hidden/relation -> nothing to collect.
    if (fields.length === 0) {
      return null;
    }

    return {
      orgId: org.id as string,
      orgName: (org.name as string) ?? "",
      table,
      fields,
    };
  } catch (err) {
    // Never leak provider/DB output to the public surface. Report and degrade to the
    // unavailable state (indistinguishable from an unknown slug to the caller).
    reportError(err, { route: "/forms/[slug]" });
    return null;
  }
}

/**
 * Resolve `slug` -> the public intake form, or `null` when there is nothing to show.
 *
 * Delegates to {@link getIntakeTarget} (the single slug->org->schema->table resolver)
 * and projects to the page's render shape. Keeps the `null`-on-any-failure contract so
 * the caller degrades to friendly copy uniformly.
 */
export async function getPublicIntakeForm(
  slug: string,
): Promise<PublicIntakeForm | null> {
  const target = await getIntakeTarget(slug);
  if (!target) {
    return null;
  }

  return {
    orgName: target.orgName,
    tableLabel: target.table.label,
    fields: target.fields,
  };
}
