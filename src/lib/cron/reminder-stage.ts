import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  resolveAdminEmails,
  resolveOrgLanguage,
} from "@/lib/orgs/org-recipients";
import { reportError } from "@/lib/observability/report";

/**
 * Send one staged reminder email to every admin of an org and, on success, stamp the
 * per-stage `*_sent_at` column so it is never re-sent. Shared by the trial-lifecycle
 * (Story 7.4) and offboarding (Story 8.5) cron sweeps, which previously carried
 * byte-identical private copies of this dance (epic-7-retro-item-54 / epic-8-retro F4).
 *
 * The org's language is resolved here and handed to the caller's `send(to, language)`
 * callback so stage-specific, per-language content (e.g. a localized deletion date)
 * can be composed by the caller while this helper owns the invariant parts:
 *   - resolve the admin recipients; on an EMPTY set stamp nothing and return false
 *     (retry next run in case an admin email becomes resolvable);
 *   - send to each recipient, then stamp the column once;
 *   - a SEND failure logs via `reportError`, leaves the stamp unset, returns false
 *     (the stage retries next run) and NEVER throws — the caller's sweep continues;
 *   - a post-send STAMP failure logs and returns true (the mail went out; a duplicate
 *     reminder beats a silently dropped one, so a possible re-send is accepted).
 *
 * Returns true when the email was sent (whether or not the stamp advanced).
 */
export async function sendReminderStage(params: {
  adminClient: SupabaseClient;
  orgId: string;
  column: string;
  route: string;
  send: (to: string, language: "en" | "fr") => Promise<void>;
}): Promise<boolean> {
  const { adminClient, orgId, column, route, send } = params;
  try {
    const emails = await resolveAdminEmails(adminClient, orgId);
    if (emails.length === 0) {
      // No recipient to notify — nothing to stamp; retry next run in case an admin
      // email becomes resolvable.
      return false;
    }
    const language = await resolveOrgLanguage(adminClient, orgId);

    for (const to of emails) {
      await send(to, language);
    }

    const { error: stampError } = await adminClient
      .from("organizations")
      .update({ [column]: new Date().toISOString() })
      .eq("id", orgId);
    if (stampError) {
      // The email went out but the stamp failed — log it. The next run may re-send
      // (acceptable: a duplicate reminder beats a silently dropped one).
      reportError(stampError, { route });
      return true;
    }
    return true;
  } catch (sendErr) {
    // Resend failure: log and leave the stamp unset so it retries next run.
    reportError(sendErr, { route });
    return false;
  }
}
