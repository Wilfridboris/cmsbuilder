import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { kebabCase } from "@/lib/utils";
import { getSchema } from "@/lib/data/records";
import { visibleTables } from "@/lib/schema/overrides";
import { selectIntakeTable } from "@/lib/intake/target";
import { deriveFormSlug, ensureUniqueFormSlug } from "@/lib/forms/form-slug";
import { getFormById } from "@/lib/data/forms";
import { evaluateFormPublishability } from "@/lib/forms/publishability";

/**
 * Guarded Forms mutation layer (Epic 14, Story 14.1) — the single, targeted write seam
 * for create / rename / slug-edit / delete of an org's forms.
 *
 * Deliberately mirrors `business-profile-mutate.ts`'s identity-agnostic contract: the
 * caller supplies an RLS-scoped Supabase client and the acting identity, so this layer
 * never reads cookies and never touches the service-role key. Every write runs under
 * the caller's RLS client, so the `forms_tenant_isolation` policy scopes it to the
 * caller's own org — a cross-tenant write is impossible. This is NOT `mutate.ts` (that
 * layer is for the tenant JSONB `records` store only).
 *
 * Slug uniqueness: `ensureUniqueFormSlug` pre-checks, but the DB
 * `UNIQUE (organization_id, slug)` constraint is authoritative. On a 23505 unique
 * violation (a concurrent create won the race) the write retries with the next `-N`
 * suffix, mirroring the idempotency retry in `mutate.ts`.
 */

export type FormMutateIdentity = {
  /** RLS-scoped Supabase client (never the service-role admin client). */
  client: SupabaseClient;
  /** The acting user id, recorded in `actor_id`. */
  actorId: string;
  /** The org whose form is being written; scopes the write. */
  orgId: string;
};

/** The identity of a created/edited form returned to the route. */
export type FormMutateResult = { id: string; slug: string };

/** Postgres unique-violation SQLSTATE (the UNIQUE(organization_id, slug) backstop). */
const UNIQUE_VIOLATION = "23505";

/** Bounded retry budget for the slug-suffix race on a 23505 unique violation. */
const MAX_SLUG_RETRIES = 25;

/**
 * Create a form from a validated title. Derives the kebab-case slug, org-uniques it
 * with a `-N` suffix, and pre-fills `target_table_key` from the intake-term heuristic
 * (`selectIntakeTable` over the org's schema — null when the org has no visible tables).
 * `published` stays false and `field_config` stays `[]` (their column defaults). On a
 * 23505 unique violation (a concurrent create took the slug) the insert retries with the
 * next suffix. Returns the created id + slug.
 */
export async function createForm(
  identity: FormMutateIdentity,
  input: { title: string },
): Promise<ApiResponse<FormMutateResult>> {
  try {
    const { client, actorId, orgId } = identity;

    const title = input.title.trim();
    if (title === "") {
      // Defense in depth: the route's zod schema already rejects a blank title.
      throw new AppError(400, "Forms.error.titleRequired");
    }

    // Pre-fill the target table from the intake heuristic over the org's schema. A
    // missing/empty schema or no visible tables -> null target (publish stays blocked
    // in 14.3); a schema READ error is surfaced rather than silently nulling the target.
    let targetTableKey: string | null = null;
    const schemaResult = await getSchema(client, orgId);
    if (schemaResult.error) {
      throw new AppError(500, "writeFailed", schemaResult.error);
    }
    if (schemaResult.data) {
      targetTableKey = selectIntakeTable(schemaResult.data)?.key ?? null;
    }

    const base = deriveFormSlug(title);

    // Pre-check for a free slug, then insert; on a 23505 race retry with the next
    // suffix. `ensureUniqueFormSlug` re-queries each attempt so a retry resolves the
    // next gap, not a stale candidate.
    for (let retry = 0; retry < MAX_SLUG_RETRIES; retry += 1) {
      const slug = await ensureUniqueFormSlug(client, orgId, base);

      const { data, error } = await client
        .from("forms")
        .insert({
          organization_id: orgId,
          title,
          slug,
          target_table_key: targetTableKey,
          actor_id: actorId,
        })
        .select("id, slug")
        .single();

      if (error) {
        if (error.code === UNIQUE_VIOLATION) {
          // A concurrent create claimed this slug between the pre-check and insert.
          // Retry — ensureUniqueFormSlug will skip the now-taken candidate.
          continue;
        }
        throw new AppError(500, "writeFailed", error.message);
      }
      if (!data) {
        throw new AppError(500, "writeFailed");
      }

      return {
        data: { id: data.id as string, slug: data.slug as string },
        error: null,
      };
    }

    // Exhausted the retry budget (a pathological collision storm) — surface a write
    // failure rather than loop forever.
    throw new AppError(500, "writeFailed");
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Rename a form's title. The slug is NOT auto-changed (slug is edited separately via
 * {@link updateFormSlug}). A form id not in the caller's org is a 404 (RLS hides it).
 */
export async function renameForm(
  identity: FormMutateIdentity,
  input: { formId: string; title: string },
): Promise<ApiResponse<FormMutateResult>> {
  try {
    const { client, actorId, orgId } = identity;

    const title = input.title.trim();
    if (title === "") {
      throw new AppError(400, "Forms.error.titleRequired");
    }

    const { data, error } = await client
      .from("forms")
      .update({
        title,
        actor_id: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("id", input.formId)
      .select("id, slug")
      .maybeSingle();

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }
    if (!data) {
      // Unknown id or a cross-org id (RLS-hidden) — same outcome, no write.
      throw new AppError(404, "Forms.error.notFound");
    }

    return {
      data: { id: data.id as string, slug: data.slug as string },
      error: null,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Edit a form's slug (allowed while unpublished). The requested slug is NORMALIZED to
 * kebab-case; if it normalizes to empty it is rejected (`slugInvalid`). The normalized
 * slug is then uniqueness-checked within the org (excluding the form's own row). If it
 * collides with ANOTHER form's slug the edit is rejected (`slugTaken`) and nothing is
 * written — the collision is surfaced to the owner rather than silently suffixed, so an
 * explicit slug edit is predictable. A form id not in the caller's org is a 404.
 */
export async function updateFormSlug(
  identity: FormMutateIdentity,
  input: { formId: string; slug: string },
): Promise<ApiResponse<FormMutateResult>> {
  try {
    const { client, actorId, orgId } = identity;

    // The form must exist in the caller's org first (else 404), so a cross-org slug
    // edit cannot even probe for collisions.
    const existing = await getFormById(client, orgId, input.formId);
    if (!existing) {
      throw new AppError(404, "Forms.error.notFound");
    }

    // Publishing FREEZES the public URL (Story 14.3): a published form's slug may not
    // be edited. Reject before normalization so a published form's URL never changes.
    // The title rename path stays unaffected (the title never affects the link).
    if (existing.published) {
      throw new AppError(409, "Forms.error.slugLocked");
    }

    // A slug that kebab-cases to nothing (no Latin alphanumerics after diacritic fold)
    // is not a valid EXPLICIT choice — reject rather than silently fall back to `form`
    // (that create-time safety net is not appropriate for a deliberate slug edit).
    if (kebabIsEmpty(input.slug)) {
      throw new AppError(400, "Forms.error.slugInvalid");
    }
    const normalized = deriveFormSlug(input.slug);

    // Uniqueness within the org, EXCLUDING this form. A free (or same-as-current) slug
    // comes back unchanged; a slug taken by another form comes back with a `-N` suffix
    // — which signals the collision, so we reject rather than silently rename.
    const unique = await ensureUniqueFormSlug(
      client,
      orgId,
      normalized,
      input.formId,
    );
    if (unique !== normalized) {
      throw new AppError(409, "Forms.error.slugTaken");
    }

    const { data, error } = await client
      .from("forms")
      .update({
        slug: normalized,
        actor_id: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("id", input.formId)
      .select("id, slug")
      .maybeSingle();

    if (error) {
      // A concurrent create/edit took the slug after our check: the UNIQUE backstop
      // fires 23505 -> surface the same collision the owner needs to resolve.
      if (error.code === UNIQUE_VIOLATION) {
        throw new AppError(409, "Forms.error.slugTaken");
      }
      throw new AppError(500, "writeFailed", error.message);
    }
    if (!data) {
      throw new AppError(404, "Forms.error.notFound");
    }

    return {
      data: { id: data.id as string, slug: data.slug as string },
      error: null,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Set a form's `published` flag (Epic 14, Story 14.3) — the SOLE authority on whether a
 * form may be published.
 *
 * `published = true` is allowed ONLY when the form has a valid target table, re-evaluated
 * here under the caller's RLS client via {@link evaluateFormPublishability} (the exact
 * predicate the 14.2 public resolver requires to render), so a form can never be
 * published into an immediate "not available" state. A blocked publish is rejected with
 * `Forms.error.publishBlocked` and NO write. Unpublishing (`published = false`) is always
 * allowed. A form id not in the caller's org is a 404 (RLS hides it). `actor_id` and
 * `updated_at` are bumped on the write, exactly like {@link renameForm}.
 */
export async function publishForm(
  identity: FormMutateIdentity,
  input: { formId: string; published: boolean },
): Promise<ApiResponse<FormMutateResult>> {
  try {
    const { client, actorId, orgId } = identity;

    // The form must exist in the caller's org first (else 404), and we need its current
    // state to evaluate the publish gate against the authoritative target table.
    const existing = await getFormById(client, orgId, input.formId);
    if (!existing) {
      throw new AppError(404, "Forms.error.notFound");
    }

    // Publishing is gated; unpublishing is always allowed. Re-evaluate the gate
    // server-side so a frontend-only disable is never the sole authority.
    if (input.published) {
      const { publishable } = await evaluateFormPublishability(
        client,
        orgId,
        existing,
      );
      if (!publishable) {
        throw new AppError(409, "Forms.error.publishBlocked");
      }
    }

    const { data, error } = await client
      .from("forms")
      .update({
        published: input.published,
        actor_id: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("id", input.formId)
      .select("id, slug")
      .maybeSingle();

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }
    if (!data) {
      // Deleted between the read and the write (RLS-hidden) — same outcome, no write.
      throw new AppError(404, "Forms.error.notFound");
    }

    return {
      data: { id: data.id as string, slug: data.slug as string },
      error: null,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Choose a form's target table (Epic 14, Story 14.4) — the owner's explicit override of
 * the creation-time intake heuristic. The stored `target_table_key` is the sole runtime
 * authority for public rendering/submission (14.2); this write lets the Admin set it.
 *
 * Server-authoritative, mirroring {@link updateFormSlug}'s guard order:
 *   1. The form must exist in the caller's org (else 404, RLS-hidden) — read first so a
 *      cross-org change cannot even probe the schema.
 *   2. The target is LOCKED while the form is PUBLISHED (mirrors the 14.3 slug lock, so a
 *      live form never silently redirects where responses land): reject with
 *      `targetLocked` BEFORE validating the new key, so a published form's target can
 *      never move.
 *   3. The chosen `targetTableKey` must name a CURRENTLY-visible table of the org's schema
 *      (`visibleTables`) — a hidden / deleted / unknown / cross-org key is rejected with
 *      `targetInvalid` and NO write (no internals leaked).
 *
 * On a valid change, `field_config` is revalidated against the new table: entries whose
 * `key` is not a field of the new table are DROPPED (selective filter, not a wholesale
 * reset); matching entries are preserved. `field_config` is `[]` today (14.1), so this is
 * a no-op in practice, but the filter is implemented correctly for when 14.5 populates it.
 * The write bumps `actor_id` + `updated_at`, exactly like {@link renameForm}.
 */
export async function updateFormTarget(
  identity: FormMutateIdentity,
  input: { formId: string; targetTableKey: string },
): Promise<ApiResponse<FormMutateResult>> {
  try {
    const { client, actorId, orgId } = identity;

    // The form must exist in the caller's org first (else 404), so a cross-org target
    // change cannot even probe the schema for valid tables.
    const existing = await getFormById(client, orgId, input.formId);
    if (!existing) {
      throw new AppError(404, "Forms.error.notFound");
    }

    // The target is FROZEN while published (mirrors the slug lock, Story 14.3): a live
    // form must never silently redirect where its responses land. Reject BEFORE
    // validating the new key so a published form's target can never move.
    if (existing.published) {
      throw new AppError(409, "Forms.error.targetLocked");
    }

    // The chosen table must be a CURRENTLY-visible table of the org's schema. A schema we
    // cannot read cannot prove a valid target, so fail closed (reject). A hidden /
    // deleted / unknown / cross-org key names no visible table -> targetInvalid.
    const schemaResult = await getSchema(client, orgId);
    if (schemaResult.error || !schemaResult.data) {
      throw new AppError(400, "Forms.error.targetInvalid");
    }
    const table = visibleTables(schemaResult.data).find(
      (t) => t.key === input.targetTableKey,
    );
    if (!table) {
      throw new AppError(400, "Forms.error.targetInvalid");
    }

    // Revalidate field_config against the NEW table: drop entries whose field no longer
    // exists there, preserve matching ones. [] today, correct for when 14.5 populates it.
    const newTableFieldKeys = new Set(table.fields.map((field) => field.key));
    const filteredFieldConfig = existing.field_config.filter((entry) =>
      newTableFieldKeys.has(entry.key),
    );

    const { data, error } = await client
      .from("forms")
      .update({
        target_table_key: input.targetTableKey,
        field_config: filteredFieldConfig,
        actor_id: actorId,
        updated_at: new Date().toISOString(),
      })
      .eq("organization_id", orgId)
      .eq("id", input.formId)
      .select("id, slug")
      .maybeSingle();

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }
    if (!data) {
      // Deleted between the read and the write (RLS-hidden) — same outcome, no write.
      throw new AppError(404, "Forms.error.notFound");
    }

    return {
      data: { id: data.id as string, slug: data.slug as string },
      error: null,
    };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * Hard-delete a form. Scoped `id + org` under the caller's RLS client; a form id not in
 * the caller's org is a 404 (nothing deleted). Returns the deleted id.
 */
export async function deleteForm(
  identity: FormMutateIdentity,
  input: { formId: string },
): Promise<ApiResponse<{ id: string }>> {
  try {
    const { client, orgId } = identity;

    const { data, error } = await client
      .from("forms")
      .delete()
      .eq("organization_id", orgId)
      .eq("id", input.formId)
      .select("id")
      .maybeSingle();

    if (error) {
      throw new AppError(500, "writeFailed", error.message);
    }
    if (!data) {
      throw new AppError(404, "Forms.error.notFound");
    }

    return { data: { id: data.id as string }, error: null };
  } catch (err) {
    if (err instanceof AppError) {
      throw err;
    }
    throw new AppError(500, "writeFailed", (err as Error)?.message);
  }
}

/**
 * True when a raw slug input kebab-cases to nothing — it has no Latin alphanumerics
 * after diacritic folding (e.g. "", "   ", "!!!", a CJK-only string). Used only to
 * reject an EXPLICIT slug edit; `deriveFormSlug`'s `form` fallback is a create-time
 * safety net, not appropriate for a deliberate edit the owner typed.
 */
function kebabIsEmpty(input: string): boolean {
  return kebabCase(input).length === 0;
}
