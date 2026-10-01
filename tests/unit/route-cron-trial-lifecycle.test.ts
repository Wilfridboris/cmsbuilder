import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `GET /api/cron/trial-lifecycle` (Story 7.4) WITHOUT a live DB or
 * Resend. The service-role admin client, `sendTrialReminderEmail`, and `reportError`
 * are mocked. Pins the frozen I/O & Edge-Case Matrix rows:
 *   - unauthorized (missing/invalid Bearer)   → 401, NO reads/writes;
 *   - expired trial                           → flip to read_only + Day-14 send + stamp;
 *   - 2 days left, not sent                    → Day-12 send + stamp;
 *   - already stamped                          → no re-send;
 *   - Resend failure                           → no stamp, sweep continues (summary).
 */

const sendTrialReminderEmail = vi.fn();
const reportError = vi.fn();

// --- Configurable admin-client state --------------------------------------
let trialOrgs: unknown[]; // the organizations scan result
const orgUpdates: { patch: Record<string, unknown>; id: string }[] = [];
const adminMembers: { user_id: string }[] = [{ user_id: "admin-1" }];
let orgLanguage: string | null = "en";

function makeAdminClient() {
  return {
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => ({
            eq: () => ({
              not: async () => ({ data: trialOrgs, error: null }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async (_col: string, id: string) => {
              orgUpdates.push({ patch, id });
              return { error: null };
            },
          }),
        };
      }
      if (table === "org_members") {
        return {
          select: () => ({
            eq: () => ({
              eq: async () => ({ data: adminMembers, error: null }),
            }),
          }),
        };
      }
      if (table === "business_profiles") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: orgLanguage ? { default_language: orgLanguage } : null,
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
    auth: {
      admin: {
        getUserById: async (id: string) => ({
          data: { user: { id, email: `${id}@example.com` } },
          error: null,
        }),
      },
    },
  };
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeAdminClient() }));
vi.mock("@/lib/resend/trial-reminder", () => ({ sendTrialReminderEmail }));
vi.mock("@/lib/observability/report", () => ({ reportError }));

function cronReq(authHeader: string | null): NextRequest {
  return {
    headers: { get: (name: string) => (name === "authorization" ? authHeader : null) },
    nextUrl: new URL("https://app.example.com/api/cron/trial-lifecycle"),
  } as unknown as NextRequest;
}

const SECRET = "test-cron-secret";
const PAST = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
const IN_1_DAY = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000).toISOString();
const IN_10_DAYS = new Date(Date.now() + 10 * 24 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  vi.clearAllMocks();
  orgUpdates.length = 0;
  adminMembers.length = 0;
  adminMembers.push({ user_id: "admin-1" });
  orgLanguage = "en";
  trialOrgs = [];
  process.env.CRON_SECRET = SECRET;
  sendTrialReminderEmail.mockResolvedValue(undefined);
});

describe("GET /api/cron/trial-lifecycle auth", () => {
  it("401 and no work when the Authorization header is missing", async () => {
    const { GET } = await import("@/app/api/cron/trial-lifecycle/route");
    const res = await GET(cronReq(null));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(sendTrialReminderEmail).not.toHaveBeenCalled();
    expect(orgUpdates).toHaveLength(0);
  });

  it("401 when the Bearer secret is wrong", async () => {
    const { GET } = await import("@/app/api/cron/trial-lifecycle/route");
    const res = await GET(cronReq("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(sendTrialReminderEmail).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/trial-lifecycle sweep", () => {
  it("expired trial: flips to read_only, sends Day-14, stamps day14", async () => {
    trialOrgs = [
      {
        id: "org-1",
        slug: "acme",
        trial_expires_at: PAST,
        trial_reminder_day12_sent_at: null,
        trial_reminder_day14_sent_at: null,
      },
    ];
    const { GET } = await import("@/app/api/cron/trial-lifecycle/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ processed: 1, flipped: 1, emailed: 1 });

    // The flip to read_only happened.
    expect(orgUpdates.some((u) => u.patch.subscription_status === "read_only")).toBe(true);
    // Day-14 email sent.
    expect(sendTrialReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "day14", to: "admin-1@example.com", language: "en" }),
    );
    // Day-14 stamp written.
    expect(orgUpdates.some((u) => "trial_reminder_day14_sent_at" in u.patch)).toBe(true);
  });

  it("2 days left, not sent: sends Day-12 and stamps day12 (no flip)", async () => {
    trialOrgs = [
      {
        id: "org-2",
        slug: "beta",
        trial_expires_at: IN_1_DAY,
        trial_reminder_day12_sent_at: null,
        trial_reminder_day14_sent_at: null,
      },
    ];
    const { GET } = await import("@/app/api/cron/trial-lifecycle/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));

    const body = await res.json();
    expect(body.data).toMatchObject({ processed: 1, flipped: 0, emailed: 1 });
    expect(sendTrialReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ stage: "day12" }),
    );
    expect(orgUpdates.some((u) => "trial_reminder_day12_sent_at" in u.patch)).toBe(true);
    // No read_only flip for a non-expired trial.
    expect(orgUpdates.some((u) => u.patch.subscription_status === "read_only")).toBe(false);
  });

  it("more than 2 days left: no email, no flip", async () => {
    trialOrgs = [
      {
        id: "org-3",
        slug: "gamma",
        trial_expires_at: IN_10_DAYS,
        trial_reminder_day12_sent_at: null,
        trial_reminder_day14_sent_at: null,
      },
    ];
    const { GET } = await import("@/app/api/cron/trial-lifecycle/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.data).toMatchObject({ processed: 1, flipped: 0, emailed: 0 });
    expect(sendTrialReminderEmail).not.toHaveBeenCalled();
  });

  it("already stamped (day14): flips but does not re-send", async () => {
    trialOrgs = [
      {
        id: "org-4",
        slug: "delta",
        trial_expires_at: PAST,
        trial_reminder_day12_sent_at: null,
        trial_reminder_day14_sent_at: new Date().toISOString(),
      },
    ];
    const { GET } = await import("@/app/api/cron/trial-lifecycle/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.data).toMatchObject({ flipped: 1, emailed: 0 });
    expect(sendTrialReminderEmail).not.toHaveBeenCalled();
  });

  it("already stamped (day12): no re-send within the window", async () => {
    trialOrgs = [
      {
        id: "org-5",
        slug: "epsilon",
        trial_expires_at: IN_1_DAY,
        trial_reminder_day12_sent_at: new Date().toISOString(),
        trial_reminder_day14_sent_at: null,
      },
    ];
    const { GET } = await import("@/app/api/cron/trial-lifecycle/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.data).toMatchObject({ emailed: 0 });
    expect(sendTrialReminderEmail).not.toHaveBeenCalled();
  });

  it("Resend failure: no stamp written, sweep continues (emailed=0, still 200)", async () => {
    sendTrialReminderEmail.mockRejectedValue(new Error("resend down"));
    trialOrgs = [
      {
        id: "org-6",
        slug: "zeta",
        trial_expires_at: IN_1_DAY,
        trial_reminder_day12_sent_at: null,
        trial_reminder_day14_sent_at: null,
      },
    ];
    const { GET } = await import("@/app/api/cron/trial-lifecycle/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ emailed: 0 });
    // No day12 stamp — it retries next run.
    expect(orgUpdates.some((u) => "trial_reminder_day12_sent_at" in u.patch)).toBe(false);
    // The failure was logged, not thrown.
    expect(reportError).toHaveBeenCalled();
  });

  it("FR org: resolves fr language from the business profile", async () => {
    orgLanguage = "fr";
    trialOrgs = [
      {
        id: "org-7",
        slug: "eta",
        trial_expires_at: PAST,
        trial_reminder_day12_sent_at: null,
        trial_reminder_day14_sent_at: null,
      },
    ];
    const { GET } = await import("@/app/api/cron/trial-lifecycle/route");
    await GET(cronReq(`Bearer ${SECRET}`));
    expect(sendTrialReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ language: "fr" }),
    );
  });
});
