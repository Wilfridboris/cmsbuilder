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
let trialOrgs: unknown[]; // the `subscription_status='trial'` scan result
let pastDueOrgs: unknown[]; // the overdue `past_due` escalation scan result [F1]
const orgUpdates: {
  patch: Record<string, unknown>;
  id: string;
  eqs: Record<string, unknown>;
}[] = [];
const adminMembers: { user_id: string }[] = [{ user_id: "admin-1" }];
let orgLanguage: string | null = "en";

function makeAdminClient() {
  return {
    from(table: string) {
      if (table === "organizations") {
        // A chainable, thenable query builder: the two scans both start
        // `select().eq("subscription_status", <v>)`; the captured status selects
        // which dataset resolves. `.not()`/`.lt()` are chainable no-ops.
        const makeScan = () => {
          let status: string | null = null;
          const builder = {
            eq: (col: string, val: string) => {
              if (col === "subscription_status") status = val;
              return builder;
            },
            not: () => builder,
            lt: () => builder,
            then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
              resolve({
                data: status === "past_due" ? pastDueOrgs : trialOrgs,
                error: null,
              }),
          };
          return builder;
        };
        return {
          select: () => makeScan(),
          update: (patch: Record<string, unknown>) => {
            const eqs: Record<string, unknown> = {};
            const eqBuilder = {
              eq: (col: string, val: string) => {
                eqs[col] = val;
                return eqBuilder;
              },
              then: (resolve: (r: { error: null }) => void) => {
                orgUpdates.push({ patch, id: eqs.id as string, eqs });
                resolve({ error: null });
              },
            };
            return eqBuilder;
          },
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
  pastDueOrgs = [];
  process.env.CRON_SECRET = SECRET;
  delete process.env.PAST_DUE_GRACE_DAYS;
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
    const flip = orgUpdates.find(
      (u) => u.patch.subscription_status === "read_only",
    );
    expect(flip).toBeDefined();
    // [F7] The flip is guarded on subscription_status='trial' so a concurrent
    // checkout->active landing mid-sweep cannot be clobbered back to read_only.
    expect(flip!.eqs.subscription_status).toBe("trial");
    expect(flip!.id).toBe("org-1");
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

  it("[F1] escalates a long-overdue past_due org to read_only (no email), guarded on past_due", async () => {
    pastDueOrgs = [{ id: "org-pd" }];
    const { GET } = await import("@/app/api/cron/trial-lifecycle/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ escalated: 1 });

    const esc = orgUpdates.find((u) => u.id === "org-pd");
    expect(esc).toBeDefined();
    expect(esc!.patch.subscription_status).toBe("read_only");
    expect(esc!.patch.past_due_since).toBeNull();
    // Guarded on past_due so a concurrent recovery to active is never clobbered.
    expect(esc!.eqs.subscription_status).toBe("past_due");
    // Stripe owns dunning mail — the escalation never emails.
    expect(sendTrialReminderEmail).not.toHaveBeenCalled();
  });

  it("[F1] does not escalate when no past_due org is beyond the grace window", async () => {
    pastDueOrgs = [];
    const { GET } = await import("@/app/api/cron/trial-lifecycle/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.data).toMatchObject({ escalated: 0 });
    expect(orgUpdates).toHaveLength(0);
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
