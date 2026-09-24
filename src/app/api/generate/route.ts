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
 * On double-failure it degrades gracefully — a 502 with a translated-safe generic
 * message and `data: null`; `/generate` shows its "start over" path (the Story 1.5
 * fallback-template seam). It NEVER leaks a stack, SQL, org_schemas JSON, or raw
 * LLM output to the client (AR13).
 */

// Request-time only: needs cookies + the Gemini/Supabase env, never prerendered.
export const dynamic = "force-dynamic";

/** The payload the reveal renders: the schema plus each table's seeded rows. */
export type GenerateResponse = {
  schema: SchemaDefinition;
  records: Record<string, RecordData[]>;
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

  return { schema: validation.sanitized, seedRows: output.seedRows };
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
        // Double failure → graceful degrade (Story 1.5 fallback-template seam).
        // No partial data has been persisted (provisioning has not run).
        return json(
          {
            data: null,
            error: "We couldn't build your dashboard just now. Please try again.",
          },
          502,
        );
      }
    }

    // 4. Provision (mint/reuse org + org_schemas + seed) — no runtime DDL.
    const { orgId } = await provisionGeneration({
      orgId: existingOrgId ?? undefined,
      schema: generation.schema,
      seedRows: generation.seedRows,
    });

    // 5. Read back through the admin client scoped to this session org. A read
    //    failure here (post-provision) must not surface as an error screen — we
    //    fall back to the just-generated schema / empty rows — but it MUST leave
    //    an observability trail so a silently-degraded reveal is diagnosable.
    const admin = createAdminClient();
    const schemaResult = await getSchema(admin, orgId);
    if (schemaResult.error) {
      reportError(new Error(schemaResult.error), {
        id: orgId,
        stage: "read-back:getSchema",
      });
    }
    const definition = schemaResult.data ?? generation.schema;

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

    // 6. Set the signed httpOnly session cookie + return the reveal payload.
    const response = json({ data: { schema: definition, records }, error: null }, 200);
    response.cookies.set(SESSION_COOKIE_NAME, encodeSessionValue(orgId), {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_COOKIE_MAX_AGE_SECONDS,
    });
    return response;
  } catch (err) {
    if (err instanceof AppError) {
      return json({ data: null, error: err.userMessage }, err.statusCode);
    }
    reportError(err, { route: "/api/generate" });
    return json({ data: null, error: "Internal server error" }, 500);
  }
}
