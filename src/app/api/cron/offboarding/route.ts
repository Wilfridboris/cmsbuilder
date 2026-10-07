import "server-only";

import { NextResponse, type NextRequest } from "next/server";

import { AppError } from "@/types/api";
import type { ApiResponse } from "@/types/api";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendOffboardingReminderEmail } from "@/lib/resend/offboarding-reminder";
import { cascadeDeleteOrganization } from "@/lib/offboarding/cascade-delete";
import { sendReminderStage } from "@/lib/cron/reminder-stage";
import { json, handleError, authorizeCron } from "@/lib/api/route-helpers";
import { reportError } from "@/lib/observability/report";

/**
 * `GET /api/cron/offboarding` — the daily offboarding sweep (Story 8.5, FR38/FR39),
 * run by Vercel Cron (see `vercel.json`). It drives the 30-day grace lifecycle for
 * every org whose voluntary cancellation stamped `offboarding_initiated_at` and that
 * has not yet been purged.
 *
 * Protected by `Authorization: Bearer ${CRON_SECRET}` via the shared `authorizeCron`:
 * a missing/invalid header does NO work and returns 401. All reads/writes go through
 * the service-role admin client (no user session) because the sweep acts across every
 * org, not one caller's RLS scope — a platform-ops path.
 *
 * For each grace org, by whole-days since `offboarding_initiated_at`:
 *   - day >= 1  → send the Day-1 warning if its stamp is null (stamp on success);
 *   - day >= 7  → send the Day-7 warning if its stamp is null;
 *   - day >= 25 → send the Day-25 warning if its stamp is null;
 *   - day >= 30 → run `cascadeDeleteOrganization` (purge user-data + logo, tombstone).
 *
 * Idempotent: each warning stamps its per-stage `*_sent_at` ONLY after Resend
 * succeeds, so a repeated run never re-sends; a Resend failure is logged via
 * `reportError`, leaves the stamp unset (retries next run), and never aborts the rest
 * of the sweep. The cascade is re-entrant and only runs while `offboarding_purged_at`
 * is null (the partial index + the select both scope to not-yet-purged orgs).
 */

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The grace window: the org is hard-deleted this many days after cancellation. */
const GRACE_PERIOD_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

/** The reminder stages and the day-threshold each fires on or after. */
const REMINDER_STAGES = [
  { stage: "day1", day: 1, column: "offboarding_reminder_day1_sent_at" },
  { stage: "day7", day: 7, column: "offboarding_reminder_day7_sent_at" },
  { stage: "day25", day: 25, column: "offboarding_reminder_day25_sent_at" },
] as const;

type OffboardingOrg = {
  id: string;
  slug: string;
  offboarding_initiated_at: string | null;
  offboarding_reminder_day1_sent_at: string | null;
  offboarding_reminder_day7_sent_at: string | null;
  offboarding_reminder_day25_sent_at: string | null;
};

export type OffboardingSweepSummary = {
  /** How many grace orgs the sweep examined. */
  processed: number;
  /** How many warning emails were sent this run (across all stages). */
  emailed: number;
  /** How many orgs were cascade-purged + tombstoned this run. */
  purged: number;
};

export async function GET(
  req: NextRequest,
): Promise<NextResponse<ApiResponse<OffboardingSweepSummary>>> {
  try {
    // 1. Authorize via the shared cron secret (read at call time). No valid header
    //    → 401 with NO reads/writes.
    authorizeCron(req);

    const adminClient = createAdminClient();
    const now = new Date();
    const appOrigin = req.nextUrl.origin;

    // 2. Load every org with a started, not-yet-purged grace clock. The partial index
    //    organizations_offboarding_sweep_idx backs this scan.
    const { data: orgs, error } = await adminClient
      .from("organizations")
      .select(
        "id, slug, offboarding_initiated_at, offboarding_reminder_day1_sent_at, offboarding_reminder_day7_sent_at, offboarding_reminder_day25_sent_at",
      )
      .not("offboarding_initiated_at", "is", null)
      .is("offboarding_purged_at", null);
    if (error) {
      throw new AppError(500, "genericError", error.message);
    }

    const graceOrgs = (orgs ?? []) as OffboardingOrg[];
    let emailed = 0;
    let purged = 0;

    for (const org of graceOrgs) {
      if (!org.offboarding_initiated_at) {
        continue;
      }
      const initiatedMs = new Date(org.offboarding_initiated_at).getTime();
      const daysSince = Math.floor((now.getTime() - initiatedMs) / DAY_MS);

      // --- Day-30 purge: irreversibly cascade-delete, then tombstone. ---
      if (daysSince >= GRACE_PERIOD_DAYS) {
        try {
          await cascadeDeleteOrganization(adminClient, org.id);
          purged += 1;
        } catch (purgeErr) {
          // A purge failure is logged and does NOT abort the sweep; the tombstone
          // never landed, so offboarding_purged_at stays null and it retries next run.
          reportError(purgeErr, {
            route: "/api/cron/offboarding",
            orgId: org.id,
          });
        }
        // Purged (or will retry) — skip the reminder stages for this org.
        continue;
      }

      // --- Staged warning emails (Day 1 / 7 / 25), each at most once. ---
      // The deletion date is initiated + 30d, localized per the org's language below.
      const deletionDateMs = initiatedMs + GRACE_PERIOD_DAYS * DAY_MS;
      for (const { stage, day, column } of REMINDER_STAGES) {
        if (daysSince < day) {
          continue;
        }
        if (org[column]) {
          continue; // already sent — no duplicate.
        }
        const sent = await sendReminderStage({
          adminClient,
          orgId: org.id,
          column,
          route: "/api/cron/offboarding",
          send: (to, language) =>
            sendOffboardingReminderEmail({
              to,
              language,
              stage,
              slug: org.slug,
              deletionDate: formatDeletionDate(deletionDateMs, language),
              appOrigin,
            }),
        });
        if (sent) {
          emailed += 1;
        }
      }
    }

    return json<OffboardingSweepSummary>(
      { data: { processed: graceOrgs.length, emailed, purged }, error: null },
      200,
    );
  } catch (err) {
    return handleError<OffboardingSweepSummary>(err, "/api/cron/offboarding");
  }
}

/** Format the deletion date for the org's language (e.g. "November 4, 2026"). */
function formatDeletionDate(ms: number, language: "en" | "fr"): string {
  return new Intl.DateTimeFormat(language === "fr" ? "fr-CA" : "en-CA", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(ms));
}
