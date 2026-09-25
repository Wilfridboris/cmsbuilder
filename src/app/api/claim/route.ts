import "server-only";

import { cookies } from "next/headers";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import type { SchemaDefinition } from "@/types/db";
import { createAdminClient } from "@/lib/supabase/admin";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import {
  SESSION_COOKIE_NAME,
  decodeSessionValue,
} from "@/lib/generation/session";
import { createPendingClaim, ClaimError } from "@/lib/claim/claim";
import { deriveSlug } from "@/lib/claim/slug";
import { reportError } from "@/lib/observability/report";

/**
 * `POST /api/claim` (Story 2.1) — the "Make it Real" magic-link dispatch.
 *
 * Flow: Zod-validate `{ email, consent:true, schema, intent }` → resolve +
 * verify the signed `sb_gen_session` cookie → org id → hard-block if consent is
 * not literally `true` → persist the overridden schema + a `pending_claims` row
 * (service-role, bootstrap) → `signInWithOtp` (delivered via Supabase→Resend
 * SMTP) with the claim token embedded in `emailRedirectTo` → return the
 * `{ data:{ sent:true }, error }` envelope.
 *
 * PKCE is same-browser: `signInWithOtp` runs through the RLS-scoped SERVER
 * client so the PKCE verifier cookie is written onto THIS response (the same
 * browser that will later exchange the code on the callback). Opening the link
 * on a different device is the accepted, out-of-scope MVP constraint.
 *
 * Never leaks stacks/SQL/provider output — every failure resolves to a
 * translated user message via the `{ data, error }` envelope.
 */

// Request-time only: reads/sets cookies + hits the auth provider.
export const dynamic = "force-dynamic";

/** The privacy/terms version the consent checkbox accepts. Bump on policy change. */
export const CURRENT_POLICY_VERSION = "2026-09-24";

export type ClaimResponse = { sent: true };

/** Structural schema-definition validator — the overridden schema round-trips as-is. */
const fieldSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.string().min(1),
  reason: z.string().optional(),
  hidden: z.boolean().optional(),
  sensitive: z.boolean().optional(),
});

const tableSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  reason: z.string().optional(),
  hidden: z.boolean().optional(),
  fields: z.array(fieldSchema),
});

const schemaDefinitionSchema = z.object({
  tables: z.array(tableSchema).min(1),
  isFallback: z.boolean().optional(),
});

/**
 * Body contract. `consent` MUST be the literal `true` (a hard server-side gate,
 * mirroring the disabled-until-checked client control). `intent` (trade + city)
 * drives the auto-derived slug; it is optional so a claim can still proceed with
 * a safe fallback slug if the client could not supply it.
 */
const claimBodySchema = z.object({
  email: z.string().trim().email(),
  consent: z.literal(true),
  schema: schemaDefinitionSchema,
  intent: z
    .object({
      tradeType: z.string().min(1),
      city: z.string().min(1),
    })
    .optional(),
});

function json(
  body: ApiResponse<ClaimResponse>,
  status: number,
): NextResponse<ApiResponse<ClaimResponse>> {
  return NextResponse.json(body, { status });
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<ClaimResponse>>> {
  try {
    // 1. Parse + validate the body. A bad body / missing consent is a 400 with a
    // translated message (the client keeps submit disabled until consent).
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "invalidBody");
    }
    const parsed = claimBodySchema.safeParse(raw);
    if (!parsed.success) {
      // Consent literal failure surfaces the same 400; the client gate already
      // prevents it, so this is the server-side backstop.
      const consentIssue = parsed.error.issues.some((i) =>
        i.path.includes("consent"),
      );
      const emailIssue = parsed.error.issues.some((i) =>
        i.path.includes("email"),
      );
      if (consentIssue) throw new AppError(400, "consentRequired");
      if (emailIssue) throw new AppError(400, "invalidEmail");
      throw new AppError(400, "invalidBody");
    }
    const body = parsed.data;

    // 2. Resolve + verify the signed session cookie → org id. Nothing to claim
    // without a valid session org.
    const orgId = decodeSessionValue(
      req.cookies.get(SESSION_COOKIE_NAME)?.value,
    );
    if (!orgId) {
      throw new AppError(400, "noSession");
    }

    // 3. Persist the overridden schema + pending claim (service-role bootstrap).
    const admin = createAdminClient();
    const slugBase = deriveSlug({
      tradeType: body.intent?.tradeType ?? "",
      city: body.intent?.city ?? "",
    });

    let token: string;
    try {
      const created = await createPendingClaim(
        {
          sessionOrgId: orgId,
          email: body.email,
          schema: body.schema as SchemaDefinition,
          consentAt: new Date(),
          policyVersion: CURRENT_POLICY_VERSION,
          slugBase,
        },
        admin,
      );
      token = created.token;
    } catch (err) {
      if (err instanceof ClaimError) {
        reportError(err, { route: "/api/claim", stage: "createPendingClaim" });
        throw new AppError(500, "genericError");
      }
      throw err;
    }

    // 4. Dispatch the magic link via the RLS-scoped SERVER client so the PKCE
    // verifier cookie lands on THIS response (same-browser exchange). The link
    // itself is sent by Supabase Auth over the project's Resend SMTP.
    const cookieStore = await cookies();
    const supabase = createServerSupabaseClient(cookieStore);

    const origin = req.nextUrl.origin;
    const redirectTo = `${origin}/auth/callback?claim_token=${encodeURIComponent(token)}`;

    const { error: otpError } = await supabase.auth.signInWithOtp({
      email: body.email,
      options: {
        shouldCreateUser: true,
        emailRedirectTo: redirectTo,
        data: { role: "admin" },
      },
    });

    if (otpError) {
      // Delivery / provider failure. The pending claim is left to expire; a
      // retry issues a fresh claim + link. Never leak the provider message.
      reportError(new Error(otpError.message), {
        route: "/api/claim",
        stage: "signInWithOtp",
      });
      throw new AppError(502, "sendFailed");
    }

    return json({ data: { sent: true }, error: null }, 200);
  } catch (err) {
    if (err instanceof AppError) {
      return json({ data: null, error: err.userMessage }, err.statusCode);
    }
    reportError(err, { route: "/api/claim" });
    return json({ data: null, error: "genericError" }, 500);
  }
}
