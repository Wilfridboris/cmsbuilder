import "server-only";

import { type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { mutate, INTAKE_ACTOR_ID } from "@/lib/data/mutate";
import { coerceAddValue } from "@/lib/forms/field-input";
import { matchSelectValue } from "@/lib/forms/select-input";
import {
  resolveAdminEmails,
  resolveOrgLanguage,
} from "@/lib/orgs/org-recipients";
import { sendIntakeSubmissionEmail } from "@/lib/resend/intake-notification";
import { reportError } from "@/lib/observability/report";
import type { IntakeTarget } from "@/lib/data/forms-public";
import { intakeBodySchema } from "@/app/api/intake/[slug]/schemas";

/**
 * The shared public-intake WRITE path (Epic 14, Story 14.2), extracted verbatim from
 * the Story 6.2 `/api/intake/[slug]` handler so the legacy bare-org route and the keyed
 * `/api/intake/[slug]/[formSlug]` route share ONE code path rather than two that can
 * drift (the 14.1 retro flagged exactly this class of untested divergence).
 *
 * The caller re-resolves `target` server-side via `resolvePublicFormTarget` and is the
 * sole authority on org, table, and field allowlist — never the client. This helper:
 *   - parses + shape-validates the body (`intakeBodySchema`), rejecting a bad body with
 *     a generic 400;
 *   - builds the write payload ONLY from `target.fields` (the server-resolved,
 *     non-relation allowlist), re-coercing every value and silently dropping any other
 *     submitted key;
 *   - rejects a fully-empty submission and any coercion error with a generic 400;
 *   - writes exactly one record through the guarded `mutate.ts` under the dedicated
 *     anonymous `INTAKE_ACTOR_ID`, scoped to the resolved org, with the resolved schema
 *     and the client's stable `idempotencyKey`;
 *   - emails every resolvable admin a best-effort summary (FR28) AFTER the write,
 *     iterating only the non-relation `target.fields`.
 *
 * It NEVER leaks DB/provider internals — every failure collapses to a generic error.
 * The caller wraps it in `handleError` with its own `routeLabel`.
 */
export async function submitToTarget(
  req: NextRequest,
  target: IntakeTarget,
  routeLabel: string,
): Promise<{ ok: true }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    throw new AppError(400, "genericError");
  }
  const parsed = intakeBodySchema.safeParse(raw);
  if (!parsed.success) {
    throw new AppError(400, "genericError");
  }
  const { values, idempotencyKey } = parsed.data;

  // Build the write payload ONLY from the server-resolved allowlist. Every key not on
  // it (extra fields, a relation field, anything the client invented) is silently
  // dropped — it never reaches the record.
  const data: Record<string, unknown> = {};
  for (const field of target.fields) {
    const submitted = values[field.key];

    if (field.type === "boolean") {
      // A boolean is never "blank": the toggle supplies a real boolean. Accept a
      // boolean or its "true"/"false" string form; anything else is false.
      data[field.key] = submitted === true || submitted === "true";
      continue;
    }

    if (field.type === "select") {
      // A select cell must resolve to one of the field's NON-archived option tokens
      // (Story 13.6). The shared matcher is the authority: blank → omit, a valid
      // active option → write its canonical `value`, anything else (a forged token,
      // an archived option's value) → reject the whole write with the generic 400
      // (no per-field leak on the public surface).
      const match = matchSelectValue(field.options, String(submitted ?? ""));
      if (match.kind === "invalid") {
        throw new AppError(400, "genericError");
      }
      if (match.kind === "ok") {
        data[field.key] = match.value;
      }
      // `omit` → left out of `data`.
      continue;
    }

    // A scalar value must be a primitive. `values` is typed `unknown`, so a client
    // could post an object/array; `String({})` would otherwise write "[object
    // Object]" / "1,2" verbatim. Reject that outright rather than store garbage.
    if (submitted !== null && typeof submitted === "object") {
      throw new AppError(400, "genericError");
    }

    // Scalar: coerce from the trimmed string form (the client sends strings; be
    // defensive for numbers too). Blank → omitted; bad number → reject.
    const rawText =
      submitted === undefined || submitted === null ? "" : String(submitted);
    const result = coerceAddValue(field.type, rawText);
    if (result.kind === "error") {
      // A format error that slipped past the client — reject the whole write with a
      // generic 400 (no per-field leak on the public surface).
      throw new AppError(400, "genericError");
    }
    if (result.kind === "ok") {
      data[field.key] = result.value;
    }
    // `omit` → left out of `data`.
  }

  // A fully-empty submission (no field filled) is rejected — the client blocks it too,
  // but the server is the authority. Booleans always write a value, so a form that has
  // any boolean field can never be "empty"; a scalar-only form can.
  //
  // Accepted deviation (epic-6 retro [S1]): because a boolean always writes, this "at
  // least one field" guard is vacuous on any boolean-bearing intake form — an all-blank
  // submission still persists `{boolean: false}` and emails the owner. Low-impact and
  // left as-is by design; a meaningful-submission threshold belongs with the deferred
  // Epic-14 anti-abuse work (rate-limiting / honeypot), not here.
  if (Object.keys(data).length === 0) {
    throw new AppError(400, "genericError");
  }

  // Hoist the admin client so the write and the downstream notification share one
  // service-role instance (both are platform-ops reads/writes, no user session).
  const adminClient = createAdminClient();

  const result = await mutate(
    { client: adminClient, actorId: INTAKE_ACTOR_ID, orgId: target.orgId },
    "insert",
    target.table.key,
    data,
    // Pass the schema already resolved by `resolvePublicFormTarget` so the relation
    // referential-integrity guard reuses it instead of re-reading `org_schemas` a
    // second time on this unauthenticated endpoint (epic-3 retro item 21).
    { idempotencyKey, schema: target.schema },
  );
  if (result.error || !result.data) {
    throw new AppError(500, "genericError");
  }

  // Best-effort notification (Story 6.4, FR28): AFTER the write succeeds, email every
  // resolvable Admin a summary of the submission. This is downstream of persistence and
  // NEVER a precondition — any failure (no admins, no resolvable email, missing Resend
  // env, a provider error) is logged and swallowed so the submitter always gets 200 and
  // the record is always saved. Awaited in-handler because serverless can kill
  // post-response work; the one Resend round-trip of latency is accepted. FR78: the
  // summary iterates only `target.fields` (which excludes relation fields), so no
  // relationship/lookup data can appear. The dashboard CTA link always uses the ORG
  // slug (identical on the keyed and bare-org routes), never the form slug.
  try {
    const recipients = await resolveAdminEmails(adminClient, target.orgId);
    if (recipients.length > 0) {
      const language = await resolveOrgLanguage(adminClient, target.orgId);
      for (const to of recipients) {
        await sendIntakeSubmissionEmail({
          to,
          language,
          orgName: target.orgName,
          tableLabel: target.table.label,
          slug: target.orgSlug,
          fields: target.fields,
          data,
          appOrigin: req.nextUrl.origin,
        });
      }
    }
  } catch (notifyErr) {
    reportError(notifyErr, { route: routeLabel });
  }

  return { ok: true as const };
}
