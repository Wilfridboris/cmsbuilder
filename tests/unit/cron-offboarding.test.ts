import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

/**
 * Unit coverage for `GET /api/cron/offboarding` (Story 8.5) WITHOUT a live DB or
 * Resend. The admin client, `sendOffboardingReminderEmail`, `cascadeDeleteOrganization`,
 * and `reportError` are mocked. Pins the frozen I/O & Edge-Case Matrix rows:
 *   - unauthorized (missing/invalid Bearer)   → 401, NO reads/writes;
 *   - day 1/7/25 reached, stamp null          → one send + stamp (no dup on re-run);
 *   - stage already stamped                    → no duplicate email;
 *   - day >= 30                                → cascade purge, no reminder;
 *   - already purged (never selected)          → skipped;
 *   - Resend failure                           → no stamp, sweep continues.
 */

const sendOffboardingReminderEmail = vi.fn();
const cascadeDeleteOrganization = vi.fn();
const reportError = vi.fn();

let graceOrgs: unknown[];
const orgUpdates: { patch: Record<string, unknown>; id: string }[] = [];
const adminMembers: { user_id: string }[] = [{ user_id: "admin-1" }];
let orgLanguage: string | null = "en";

function makeAdminClient() {
  return {
    from(table: string) {
      if (table === "organizations") {
        return {
          select: () => {
            const builder = {
              not: () => builder,
              is: () => builder,
              then: (resolve: (r: { data: unknown[]; error: null }) => void) =>
                resolve({ data: graceOrgs, error: null }),
            };
            return builder;
          },
          update: (patch: Record<string, unknown>) => ({
            eq: (_col: string, id: string) => ({
              then: (resolve: (r: { error: null }) => void) => {
                orgUpdates.push({ patch, id });
                resolve({ error: null });
              },
            }),
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

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));
vi.mock("@/lib/resend/offboarding-reminder", () => ({
  sendOffboardingReminderEmail,
}));
vi.mock("@/lib/offboarding/cascade-delete", () => ({
  cascadeDeleteOrganization,
}));
vi.mock("@/lib/observability/report", () => ({ reportError }));

function cronReq(authHeader: string | null): NextRequest {
  return {
    headers: {
      get: (name: string) => (name === "authorization" ? authHeader : null),
    },
    nextUrl: new URL("https://app.example.com/api/cron/offboarding"),
  } as unknown as NextRequest;
}

const SECRET = "test-cron-secret";
const daysAgo = (n: number) =>
  new Date(Date.now() - n * 24 * 60 * 60 * 1000).toISOString();

function graceOrg(overrides: Record<string, unknown>) {
  return {
    id: "org-1",
    slug: "acme",
    offboarding_initiated_at: daysAgo(2),
    offboarding_reminder_day1_sent_at: null,
    offboarding_reminder_day7_sent_at: null,
    offboarding_reminder_day25_sent_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  orgUpdates.length = 0;
  adminMembers.length = 0;
  adminMembers.push({ user_id: "admin-1" });
  orgLanguage = "en";
  graceOrgs = [];
  process.env.CRON_SECRET = SECRET;
  sendOffboardingReminderEmail.mockResolvedValue(undefined);
  cascadeDeleteOrganization.mockResolvedValue({ orgId: "org-1", logosRemoved: 1 });
});

describe("GET /api/cron/offboarding auth", () => {
  it("401 and no work when the Authorization header is missing", async () => {
    const { GET } = await import("@/app/api/cron/offboarding/route");
    const res = await GET(cronReq(null));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("unauthorized");
    expect(sendOffboardingReminderEmail).not.toHaveBeenCalled();
    expect(cascadeDeleteOrganization).not.toHaveBeenCalled();
    expect(orgUpdates).toHaveLength(0);
  });

  it("401 when the Bearer secret is wrong", async () => {
    const { GET } = await import("@/app/api/cron/offboarding/route");
    const res = await GET(cronReq("Bearer wrong"));
    expect(res.status).toBe(401);
    expect(cascadeDeleteOrganization).not.toHaveBeenCalled();
  });
});

describe("GET /api/cron/offboarding sweep", () => {
  it("day 1 reached, not sent: sends Day-1 and stamps day1 (no purge)", async () => {
    graceOrgs = [graceOrg({ offboarding_initiated_at: daysAgo(2) })];
    const { GET } = await import("@/app/api/cron/offboarding/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ processed: 1, emailed: 1, purged: 0 });

    expect(sendOffboardingReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "day1",
        to: "admin-1@example.com",
        language: "en",
      }),
    );
    // Day-1 stamp written, deletion date passed.
    expect(
      orgUpdates.some((u) => "offboarding_reminder_day1_sent_at" in u.patch),
    ).toBe(true);
    const sent = sendOffboardingReminderEmail.mock.calls[0]![0];
    expect(typeof sent.deletionDate).toBe("string");
    expect(sent.deletionDate.length).toBeGreaterThan(0);
    expect(cascadeDeleteOrganization).not.toHaveBeenCalled();
  });

  it("day 7 reached: sends day1 AND day7 when both are unsent", async () => {
    graceOrgs = [graceOrg({ offboarding_initiated_at: daysAgo(8) })];
    const { GET } = await import("@/app/api/cron/offboarding/route");
    await GET(cronReq(`Bearer ${SECRET}`));

    const stages = sendOffboardingReminderEmail.mock.calls.map(
      (c) => c[0].stage,
    );
    expect(stages).toContain("day1");
    expect(stages).toContain("day7");
    expect(stages).not.toContain("day25");
  });

  it("stage already stamped: no duplicate email", async () => {
    graceOrgs = [
      graceOrg({
        offboarding_initiated_at: daysAgo(2),
        offboarding_reminder_day1_sent_at: new Date().toISOString(),
      }),
    ];
    const { GET } = await import("@/app/api/cron/offboarding/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.data).toMatchObject({ emailed: 0 });
    expect(sendOffboardingReminderEmail).not.toHaveBeenCalled();
  });

  it("day >= 30: cascade purges the org, no reminder email", async () => {
    graceOrgs = [graceOrg({ offboarding_initiated_at: daysAgo(31) })];
    const { GET } = await import("@/app/api/cron/offboarding/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ purged: 1, emailed: 0 });
    expect(cascadeDeleteOrganization).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
    );
    expect(sendOffboardingReminderEmail).not.toHaveBeenCalled();
  });

  it("day == 30 boundary: purges (>= 30)", async () => {
    graceOrgs = [graceOrg({ offboarding_initiated_at: daysAgo(30) })];
    const { GET } = await import("@/app/api/cron/offboarding/route");
    await GET(cronReq(`Bearer ${SECRET}`));
    expect(cascadeDeleteOrganization).toHaveBeenCalledTimes(1);
  });

  it("Resend failure: no stamp written, sweep continues (emailed=0, still 200)", async () => {
    sendOffboardingReminderEmail.mockRejectedValue(new Error("resend down"));
    graceOrgs = [graceOrg({ offboarding_initiated_at: daysAgo(2) })];
    const { GET } = await import("@/app/api/cron/offboarding/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ emailed: 0 });
    expect(
      orgUpdates.some((u) => "offboarding_reminder_day1_sent_at" in u.patch),
    ).toBe(false);
    expect(reportError).toHaveBeenCalled();
  });

  it("cascade failure: logged, sweep still 200, purged=0 (retries next run)", async () => {
    cascadeDeleteOrganization.mockRejectedValue(new Error("purge boom"));
    graceOrgs = [graceOrg({ offboarding_initiated_at: daysAgo(31) })];
    const { GET } = await import("@/app/api/cron/offboarding/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.data).toMatchObject({ purged: 0 });
    expect(reportError).toHaveBeenCalled();
  });

  it("no grace orgs: processed 0, no work", async () => {
    graceOrgs = [];
    const { GET } = await import("@/app/api/cron/offboarding/route");
    const res = await GET(cronReq(`Bearer ${SECRET}`));
    const body = await res.json();
    expect(body.data).toMatchObject({ processed: 0, emailed: 0, purged: 0 });
  });

  it("FR org: resolves fr language from the business profile", async () => {
    orgLanguage = "fr";
    graceOrgs = [graceOrg({ offboarding_initiated_at: daysAgo(2) })];
    const { GET } = await import("@/app/api/cron/offboarding/route");
    await GET(cronReq(`Bearer ${SECRET}`));
    expect(sendOffboardingReminderEmail).toHaveBeenCalledWith(
      expect.objectContaining({ language: "fr" }),
    );
  });
});
