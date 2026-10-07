import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Unit coverage for the shared cron staged-reminder helper (epic-8-retro F4), which
 * the trial-lifecycle (7.4) and offboarding (8.5) sweeps both delegate to. Pins the
 * invariant dance so a future caller inherits it:
 *   - no recipients          → false, no send, no stamp;
 *   - send to each admin      → stamp the column once, return true;
 *   - send failure            → false, no stamp, logged (never throws);
 *   - post-send stamp failure → true (duplicate beats dropped), logged.
 */

const resolveAdminEmails = vi.fn();
const resolveOrgLanguage = vi.fn();
const reportError = vi.fn();

vi.mock("@/lib/orgs/org-recipients", () => ({
  resolveAdminEmails,
  resolveOrgLanguage,
}));
vi.mock("@/lib/observability/report", () => ({ reportError }));

type UpdateCall = { patch: Record<string, unknown>; id: string };

function makeClient(stampError: { message: string } | null = null) {
  const updates: UpdateCall[] = [];
  const client = {
    from: (_table: string) => ({
      update: (patch: Record<string, unknown>) => ({
        eq: async (_col: string, id: string) => {
          updates.push({ patch, id });
          return { error: stampError };
        },
      }),
    }),
  };
  return { client, updates };
}

beforeEach(() => {
  vi.clearAllMocks();
  resolveAdminEmails.mockResolvedValue(["a@x.ca"]);
  resolveOrgLanguage.mockResolvedValue("en");
});

describe("sendReminderStage (shared cron helper)", () => {
  it("sends to each admin in the org language, stamps the column, returns true", async () => {
    resolveAdminEmails.mockResolvedValue(["a@x.ca", "b@x.ca"]);
    resolveOrgLanguage.mockResolvedValue("fr");
    const send = vi.fn().mockResolvedValue(undefined);
    const { client, updates } = makeClient();
    const { sendReminderStage } = await import("@/lib/cron/reminder-stage");

    const result = await sendReminderStage({
      adminClient: client as never,
      orgId: "org-1",
      column: "col_sent_at",
      route: "/api/cron/x",
      send,
    });

    expect(result).toBe(true);
    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenCalledWith("a@x.ca", "fr");
    expect(updates).toEqual([
      { patch: { col_sent_at: expect.any(String) }, id: "org-1" },
    ]);
  });

  it("no recipients: returns false, sends nothing, stamps nothing", async () => {
    resolveAdminEmails.mockResolvedValue([]);
    const send = vi.fn();
    const { client, updates } = makeClient();
    const { sendReminderStage } = await import("@/lib/cron/reminder-stage");

    const result = await sendReminderStage({
      adminClient: client as never,
      orgId: "org-1",
      column: "col_sent_at",
      route: "/api/cron/x",
      send,
    });

    expect(result).toBe(false);
    expect(send).not.toHaveBeenCalled();
    expect(updates).toHaveLength(0);
  });

  it("send failure: returns false, no stamp, logged (never throws)", async () => {
    const send = vi.fn().mockRejectedValue(new Error("resend down"));
    const { client, updates } = makeClient();
    const { sendReminderStage } = await import("@/lib/cron/reminder-stage");

    const result = await sendReminderStage({
      adminClient: client as never,
      orgId: "org-1",
      column: "col_sent_at",
      route: "/api/cron/x",
      send,
    });

    expect(result).toBe(false);
    expect(updates).toHaveLength(0);
    expect(reportError).toHaveBeenCalled();
  });

  it("post-send stamp failure: returns true (duplicate beats dropped), logged", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const { client } = makeClient({ message: "stamp boom" });
    const { sendReminderStage } = await import("@/lib/cron/reminder-stage");

    const result = await sendReminderStage({
      adminClient: client as never,
      orgId: "org-1",
      column: "col_sent_at",
      route: "/api/cron/x",
      send,
    });

    expect(result).toBe(true);
    expect(reportError).toHaveBeenCalled();
  });
});
