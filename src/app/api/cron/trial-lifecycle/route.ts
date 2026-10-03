import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTrialReminderEmail } from "@/lib/resend/trial-reminder";
import {
  resolveAdminEmails,
  resolveOrgLanguage,
} from "@/lib/orgs/org-recipients";
import { json, handleError, authorizeCron } from "@/lib/api/route-helpers";
import { reportError } from "@/lib/observability/report";

/**
 * `GET /api/cron/trial-lifecycle` — the daily trial-lifecycle sweep (Story 7.4),
 * run by Vercel Cron (see `vercel.json`). One cohesive route owns both the
 * trial-expiry flip and the two reminder stages.
 *
 * Protected by `Authorization: Bearer ${CRON_SECRET}`: a missing/invalid header
 * does NO work and returns 401 (the secret is read at call time, mirroring the
 * lazy env pattern of `stripe/client.ts` / `billing/tiers.ts`). All reads/writes go
 * through the service-role admin client (no user session) because the sweep acts on
 * every org, not one caller's RLS scope — this is a platform-ops path.
 *
 * For each `trial` org with a non-null `trial_expires_at`:
 *   - expired (`<= now`)  → flip `subscription_status` to `read_only`, then send the
 *     Day-14 email if `trial_reminder_day14_sent_at` is null (stamp on success);
 *   - 2 days left (`now >= expiry - 2d`, not yet expired) → send the Day-12 email if
 *     `trial_reminder_day12_sent_at` is null (stamp on success).
 *
 * Idempotent: the flip is a no-op on an already-flipped row (the scan is scoped to
 * `trial`), and each stage stamps a per-stage timestamp ONLY after a successful send
 * so a repeated run never re-sends. A Resend failure is logged via `reportError` and
 * leaves the stamp unset (retries next run) WITHOUT aborting the rest of the sweep.
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The reminder window: the Day-12 email fires once within 2 days of expiry. */
const DAY12_WINDOW_MS = 2 * 24 * 60 * 60 * 1000;

/**
 * [F1] Grace window before a long-overdue `past_due` org is escalated to `read_only`.
 * Defaults to 21 days — deliberately >= Stripe's longest smart-retry/dunning schedule,
 * so a customer Stripe is still legitimately retrying is NEVER locked out (NFR-R4).
 * Configurable via `PAST_DUE_GRACE_DAYS`.
 */
const DEFAULT_PAST_DUE_GRACE_DAYS = 21;

function pastDueGraceMs(): number {
  const raw = Number(process.env.PAST_DUE_GRACE_DAYS);
  const days =
    Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PAST_DUE_GRACE_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

type TrialOrg = {
  id: string;
  slug: string;
  trial_expires_at: string | null;
  trial_reminder_day12_sent_at: string | null;
  trial_reminder_day14_sent_at: string | null;
};

export type TrialLifecycleSummary = {
  /** How many trial orgs the sweep examined. */
  processed: number;
  /** How many expired trials were flipped to read_only. */
  flipped: number;
  /** How many reminder emails were sent this run (Day-12 + Day-14). */
  emailed: number;
  /** How many long-overdue past_due orgs were escalated to read_only [F1]. */
  escalated: number;
};

export async function GET(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<TrialLifecycleSummary>>> {
  try {
    // 1. Authorize via the shared cron secret (read at call time). No valid header
    //    → 401 with NO reads/writes.
    authorizeCron(req);

    const adminClient = createAdminClient();
    const now = new Date();
    const appOrigin = req.nextUrl.origin;

    // 2. Load every trial org with a started clock. The partial index on
    //    (trial_expires_at WHERE subscription_status='trial') backs this scan.
    const { data: orgs, error } = await adminClient
      .from("organizations")
      .select(
        "id, slug, trial_expires_at, trial_reminder_day12_sent_at, trial_reminder_day14_sent_at",
      )
      .eq("subscription_status", "trial")
      .not("trial_expires_at", "is", null);
    if (error) {
      throw new AppError(500, "genericError", error.message);
    }

    const trialOrgs = (orgs ?? []) as TrialOrg[];
    let flipped = 0;
    let emailed = 0;

    for (const org of trialOrgs) {
      if (!org.trial_expires_at) {
        continue;
      }
      const expiry = new Date(org.trial_expires_at).getTime();
      const nowMs = now.getTime();

      if (expiry <= nowMs) {
        // --- Expired: persist the read_only flip, then send Day-14 (once). ---
        // [F7] Guard the flip on `subscription_status='trial'` so a concurrent
        // checkout->active landing between this sweep's scan and this UPDATE is NOT
        // clobbered back to read_only (which would lock out a customer who just paid
        // — NFR-R4). Mirrors the `.is(null)` idempotency guard the claim stamp uses.
        const { error: flipError } = await adminClient
          .from("organizations")
          .update({
            subscription_status: "read_only",
            updated_at: now.toISOString(),
          })
          .eq("id", org.id)
          .eq("subscription_status", "trial");
        if (flipError) {
          // Log and continue — a flip failure must not stop the whole sweep.
          reportError(flipError, { route: "/api/cron/trial-lifecycle" });
        } else {
          flipped += 1;
        }

        if (!org.trial_reminder_day14_sent_at) {
          if (await sendStage(adminClient, org, "day14", 0, appOrigin)) {
            emailed += 1;
          }
        }
      } else if (nowMs >= expiry - DAY12_WINDOW_MS) {
        // --- Within 2 days of expiry (not yet expired): send Day-12 (once). ---
        if (!org.trial_reminder_day12_sent_at) {
          const daysRemaining = Math.max(
            1,
            Math.ceil((expiry - nowMs) / (24 * 60 * 60 * 1000)),
          );
          if (
            await sendStage(adminClient, org, "day12", daysRemaining, appOrigin)
          ) {
            emailed += 1;
          }
        }
      }
    }

    // 3. [F1] Safety net: escalate long-overdue `past_due` orgs to `read_only`.
    //    The PRIMARY mechanism is Stripe canceling an exhausted subscription (which
    //    fires `customer.subscription.deleted` -> read_only). This backstops a Stripe
    //    account configured to leave the subscription uncollectible-but-active: an org
    //    whose `past_due_since` predates the grace window is flipped. No email (Stripe
    //    owns dunning mail). The flip is guarded on `past_due` so a concurrent recovery
    //    to `active` is never clobbered.
    const graceCutoff = new Date(now.getTime() - pastDueGraceMs()).toISOString();
    let escalated = 0;
    const { data: overdue, error: overdueError } = await adminClient
      .from("organizations")
      .select("id")
      .eq("subscription_status", "past_due")
      .not("past_due_since", "is", null)
      .lt("past_due_since", graceCutoff);
    if (overdueError) {
      throw new AppError(500, "genericError", overdueError.message);
    }
    for (const org of (overdue ?? []) as { id: string }[]) {
      const { error: escError } = await adminClient
        .from("organizations")
        .update({
          subscription_status: "read_only",
          past_due_since: null,
          updated_at: now.toISOString(),
        })
        .eq("id", org.id)
        .eq("subscription_status", "past_due");
      if (escError) {
        reportError(escError, {
          route: "/api/cron/trial-lifecycle",
          orgId: org.id,
        });
      } else {
        escalated += 1;
      }
    }

    return json<TrialLifecycleSummary>(
      {
        data: { processed: trialOrgs.length, flipped, emailed, escalated },
        error: null,
      },
      200,
    );
  } catch (err) {
    return handleError<TrialLifecycleSummary>(
      err,
      "/api/cron/trial-lifecycle",
    );
  }
}

/**
 * Send one reminder stage to the org's admins and, on success, stamp the per-stage
 * `*_sent_at` so it is never re-sent. A send/stamp failure is logged (never aborts
 * the sweep) and leaves the stamp unset so the stage retries next run. Returns true
 * when the email was sent AND the stamp advanced.
 */
async function sendStage(
  adminClient: ReturnType<typeof createAdminClient>,
  org: TrialOrg,
  stage: "day12" | "day14",
  daysRemaining: number,
  appOrigin: string,
): Promise<boolean> {
  try {
    const emails = await resolveAdminEmails(adminClient, org.id);
    if (emails.length === 0) {
      // No recipient to notify — nothing to stamp; retry next run in case an admin
      // email becomes resolvable.
      return false;
    }
    const language = await resolveOrgLanguage(adminClient, org.id);

    for (const to of emails) {
      await sendTrialReminderEmail({
        to,
        language,
        stage,
        daysRemaining,
        slug: org.slug,
        appOrigin,
      });
    }

    const column =
      stage === "day12"
        ? "trial_reminder_day12_sent_at"
        : "trial_reminder_day14_sent_at";
    const { error: stampError } = await adminClient
      .from("organizations")
      .update({ [column]: new Date().toISOString() })
      .eq("id", org.id);
    if (stampError) {
      // The email went out but the stamp failed — log it. The next run may re-send
      // (acceptable: a duplicate reminder beats a silently dropped one).
      reportError(stampError, { route: "/api/cron/trial-lifecycle" });
      return true;
    }
    return true;
  } catch (sendErr) {
    // Resend failure: log and leave the stamp unset so it retries next run.
    reportError(sendErr, { route: "/api/cron/trial-lifecycle" });
    return false;
  }
}
