import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { RecordData, SchemaDefinition } from "@/types/db";
import { generationIntentBodySchema } from "@/lib/generation/intent";
import {
  buildGenerationPrompt,
  GENERATION_RESPONSE_SCHEMA,
} from "@/lib/gemini/prompts";
import { callGeminiWithTimeout } from "@/lib/gemini/client";
import { validateGeneratedSchema } from "@/lib/schema/validator";
import { provisionGeneration } from "@/lib/generation/provision";
import {
  FALLBACK_SEED_ROWS,
  UNIVERSAL_FIELD_SERVICE_TEMPLATE,
} from "@/lib/generation/fallback";
import {
  SESSION_COOKIE_MAX_AGE_SECONDS,
  SESSION_COOKIE_NAME,
  decodeSessionValue,
  encodeSessionValue,
} from "@/lib/generation/session";
import { createAdminClient } from "@/lib/supabase/admin";
import { getSchema, listRecords } from "@/lib/data/records";
import { reportError } from "@/lib/observability/report";

/**
 * `POST /api/generate` (Story 1.4) — the anonymous generation endpoint.
 *
 * Flow: parse → Zod-validate body → inflate prompt → ONE structured Gemini call
 * (retry EXACTLY once on timeout / invalid JSON / validator rejection) → validate
 * → provision (mint session org + org_schemas + seed via mutate.ts under the
 * admin client) → set a signed httpOnly session cookie → return `ApiResponse`
 * with the schema + seeded rows for the read-only reveal.
 *
 * Idempotent per session: if the session cookie already resolves to a provisioned
 * org, that org is reused rather than minting another.
 *
 * On double-failure (Story 1.5) it provisions the hardcoded
 * `UNIVERSAL_FIELD_SERVICE_TEMPLATE` (Clients/Jobs/Invoices) pre-seeded with
 * generic Ontario data, marks it `isFallback: true`, and returns it exactly like
 * a successful generation (200, populated read-only reveal) — never an error
 * screen. Only if the fallback provisioning ITSELF throws (e.g. total DB outage)
 * does it degrade to the pre-1.5 non-leaking graceful 502 → `/generate` "start
 * over" (the honest limit of "never an error screen", scoped to generation
 * failure). It NEVER leaks a stack, SQL, org_schemas JSON, or raw LLM output to
 * the client (AR13).
 */

// Request-time only: needs cookies + the Gemini/Supabase env, never prerendered.
export const dynamic = "force-dynamic";

/** The payload the reveal renders: the schema plus each table's seeded rows. */
export type GenerateResponse = {
  schema: SchemaDefinition;
  records: Record<string, RecordData[]>;
  /**
   * True when the hardcoded fallback template was provisioned (Story 1.5) —
   * drives the subtle "starter template" banner on `/generate`. Omitted (falsy)
   * for a real generation.
   */
  isFallback?: boolean;
};

/** Shape returned by the single Gemini call. */
type GeminiGenerationOutput = {
  schema?: unknown;
  seedRows?: unknown;
};

function json(
  body: ApiResponse<GenerateResponse>,
  status: number,
): NextResponse<ApiResponse<GenerateResponse>> {
  return NextResponse.json(body, { status });
}

/**
 * Run one full generation attempt: one Gemini call + validation. Throws on any
 * failure (timeout, invalid JSON, validator rejection) so the caller can retry.
 * Returns the sanitized schema + the raw seedRows for provisioning.
 */
async function attemptGeneration(
  prompt: string,
  sessionId: string | undefined,
): Promise<{ schema: SchemaDefinition; seedRows: unknown }> {
  const output = await callGeminiWithTimeout<GeminiGenerationOutput>(
    prompt,
    GENERATION_RESPONSE_SCHEMA,
  );

  const validation = validateGeneratedSchema(output, {
    id: sessionId,
    rawOutput: output,
  });
  if (!validation.valid) {
    throw new AppError(422, validation.error, "schema validation rejected");
  }

  // `seedRows` comes back as a JSON string (see GENERATION_RESPONSE_SCHEMA). Parse
  // it tolerantly — a malformed blob degrades to no rows, never a failed schema.
  let seedRows: unknown = output.seedRows;
  if (typeof seedRows === "string") {
    try {
      seedRows = JSON.parse(seedRows);
    } catch {
      seedRows = undefined;
    }
  }

  return { schema: validation.sanitized, seedRows };
}

/**
 * The shared success tail: provision (mint/reuse org + org_schemas + seed) →
 * read back through the admin client → set the signed session cookie → return
 * the 200 reveal payload. Identical for a real generation and the Story 1.5
 * fallback — the ONLY differences are the schema source (LLM vs hardcoded) and
 * `isFallback`. Routing both through here keeps the reveal, session, and Story
 * 1.6 render uniform (1.6 renders whatever was provisioned, no special-casing).
 */
async function provisionAndReveal(
  existingOrgId: string | undefined,
  schema: SchemaDefinition,
  seedRows: unknown,
  isFallback: boolean,
): Promise<NextResponse<ApiResponse<GenerateResponse>>> {
  // Provision (mint/reuse org + org_schemas + seed) — no runtime DDL. For the
  // fallback, `schema` already carries `isFallback: true`, which persists into
  // `org_schemas.definition` (the provisioner stores the definition verbatim).
  const { orgId } = await provisionGeneration({
    orgId: existingOrgId ?? undefined,
    schema,
    seedRows,
    // Distinct idempotency-key prefix for the fallback so its seed rows can never
    // collide with a prior real generation's `gen-seed-*` keys in a reused org.
    idempotencyPrefix: isFallback ? "fallback" : undefined,
  });

  // Read back through the admin client scoped to this session org. A read
  // failure here (post-provision) must not surface as an error screen — we fall
  // back to the just-provisioned schema / empty rows — but it MUST leave an
  // observability trail so a silently-degraded reveal is diagnosable.
  const admin = createAdminClient();
  const schemaResult = await getSchema(admin, orgId);
  if (schemaResult.error) {
    reportError(new Error(schemaResult.error), {
      id: orgId,
      stage: "read-back:getSchema",
    });
  }
  const definition = schemaResult.data ?? schema;

  const records: Record<string, RecordData[]> = {};
  for (const table of definition.tables) {
    const rows = await listRecords(admin, orgId, table.key);
    if (rows.error) {
      reportError(new Error(rows.error), {
        id: orgId,
        stage: "read-back:listRecords",
        tableKey: table.key,
      });
    }
    records[table.key] = rows.data ?? [];
  }

  // Set the signed httpOnly session cookie + return the reveal payload.
  const response = json(
    { data: { schema: definition, records, isFallback }, error: null },
    200,
  );
  response.cookies.set(SESSION_COOKIE_NAME, encodeSessionValue(orgId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
  });
  return response;
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<GenerateResponse>>> {
  try {
    // 1. Parse + Zod-validate the body (mirror of the stored intent).
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      throw new AppError(422, "Please describe your business and try again.");
    }
    const parsed = generationIntentBodySchema.safeParse(body);
    if (!parsed.success) {
      throw new AppError(422, "Please describe your business and try again.");
    }
    const intent = parsed.data;

    // 2. Resolve an existing session org (idempotent per session).
    const existingOrgId = decodeSessionValue(
      req.cookies.get(SESSION_COOKIE_NAME)?.value,
    );

    // 3. Inflate the prompt + generate, retrying EXACTLY once on failure.
    const prompt = buildGenerationPrompt(intent);
    let generation: { schema: SchemaDefinition; seedRows: unknown };
    try {
      generation = await attemptGeneration(prompt, existingOrgId ?? undefined);
    } catch (firstErr) {
      reportError(firstErr, { id: existingOrgId ?? undefined, attempt: 1 });
      try {
        generation = await attemptGeneration(prompt, existingOrgId ?? undefined);
      } catch (secondErr) {
        reportError(secondErr, { id: existingOrgId ?? undefined, attempt: 2 });
        // Double failure → provision the hardcoded fallback template (Story 1.5)
        // instead of an error screen. It runs the SAME success tail with
        // `isFallback: true`. Last-resort safety: if the fallback provisioning
        // ITSELF throws (e.g. total DB outage — beyond the LLM failure this story
        // guards), keep the pre-1.5 non-leaking graceful 502.
        try {
          return await provisionAndReveal(
            existingOrgId ?? undefined,
            { ...UNIVERSAL_FIELD_SERVICE_TEMPLATE, isFallback: true },
            FALLBACK_SEED_ROWS,
            true,
          );
        } catch (fallbackErr) {
          reportError(fallbackErr, {
            id: existingOrgId ?? undefined,
            stage: "fallback-provision",
          });
          return json(
            {
              data: null,
              error:
                "We couldn't build your dashboard just now. Please try again.",
            },
            502,
          );
        }
      }
    }

    // 4. Success path → provision the generated schema + reveal (isFallback false).
    return await provisionAndReveal(
      existingOrgId ?? undefined,
      generation.schema,
      generation.seedRows,
      false,
    );
  } catch (err) {
    if (err instanceof AppError) {
      return json({ data: null, error: err.userMessage }, err.statusCode);
    }
    reportError(err, { route: "/api/generate" });
    return json({ data: null, error: "Internal server error" }, 500);
  }
}
