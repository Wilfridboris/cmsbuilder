import "server-only";

import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { getCurrentUser } from "@/lib/auth/session";
import { inviteMember } from "@/lib/invite/invite";
import { reportError } from "@/lib/observability/report";

/**
 * `POST /api/invite` (Story 2.3) — the Admin-only team-invite dispatch.
 *
 * Flow: `getCurrentUser()` (JWT-validated) → 401 if none → Zod-validate
 * `{ email, role: 'admin' | 'member' }` (→ 400 invalidEmail / invalidRole) →
 * `inviteMember` (resolves the caller's org, asserts Admin server-side, creates
 * the invitee account + `org_members` row, sends the branded invite email) →
 * map `AppError` codes onto the `{ data, error }` envelope; success →
 * `{ data:{ sent:true }, error:null }`.
 *
 * Authorization is server-enforced in `inviteMember`: it independently reads the
 * caller's membership + role from their JWT-proven identity and rejects a
 * non-admin / non-member with a 403 — frontend hiding is never the sole gate.
 *
 * Never leaks provider output, stacks, or SQL — every failure resolves to a
 * translated code via the envelope.
 */

// Request-time only: reads the session + hits the admin API / DB.
export const dynamic = "force-dynamic";

export type InviteResponse = { sent: true };

const inviteBodySchema = z.object({
  email: z.string().trim().email(),
  role: z.enum(["admin", "member"]),
});

function json(
  body: ApiResponse<InviteResponse>,
  status: number,
): NextResponse<ApiResponse<InviteResponse>> {
  return NextResponse.json(body, { status });
}

export async function POST(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<InviteResponse>>> {
  try {
    // 1. Identify the caller. No session → 401 (the Settings page itself is
    // bounced to /login by middleware; this is the API-layer backstop).
    const user = await getCurrentUser();
    if (!user) {
      throw new AppError(401, "unauthorized");
    }

    // 2. Validate the body. A malformed email → 400 invalidEmail; a role outside
    // {admin, member} → 400 invalidRole. Rejected before any create/send.
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      throw new AppError(400, "invalidEmail");
    }
    const parsed = inviteBodySchema.safeParse(raw);
    if (!parsed.success) {
      const roleIssue = parsed.error.issues.some((i) => i.path.includes("role"));
      throw new AppError(400, roleIssue ? "invalidRole" : "invalidEmail");
    }
    const { email, role } = parsed.data;

    // 3. Provision the invite (admin-gate + account/membership bootstrap + email).
    await inviteMember({
      inviterUserId: user.id,
      email,
      role,
      adminClient: createAdminClient(),
      origin: req.nextUrl.origin,
    });

    return json({ data: { sent: true }, error: null }, 200);
  } catch (err) {
    if (err instanceof AppError) {
      // Log the server-side detail (never surfaced) for the operational codes
      // (5xx, including the 502 send-failure).
      if (err.statusCode >= 500) {
        reportError(err, { route: "/api/invite" });
      }
      return json({ data: null, error: err.userMessage }, err.statusCode);
    }
    reportError(err, { route: "/api/invite" });
    return json({ data: null, error: "genericError" }, 500);
  }
}
