import { beforeEach, describe, expect, it, vi } from "vitest";

import { AppError } from "@/types/api";

/**
 * Page-boundary coverage for the Settings admin gate (`/{slug}/settings`),
 * added in review pass 1 to lock the redirect wiring the Story 2.4 refactor
 * introduced (`try requireAdmin → catch AppError → redirect`, re-throw of a
 * non-AppError, and the separate slug-mismatch bounce). `rbac.test.ts` pins the
 * guard in isolation and `route-invite.test.ts` pins the invite call site, but
 * nothing exercised the page's own gate — so a future edit could expose Settings
 * to a non-admin / cross-org caller without failing the suite.
 *
 * `SettingsPage` is an async Server Component; we invoke it directly (node env,
 * no DOM). `redirect` is mocked to THROW (as Next's real `redirect` does, to halt
 * rendering) so a bounce is observable as a rejection carrying the target URL.
 */

class RedirectError extends Error {
  constructor(public url: string) {
    super("NEXT_REDIRECT");
  }
}

const redirect = vi.fn((url: string) => {
  throw new RedirectError(url);
});
const getCurrentUser = vi.fn();
const requireAdmin = vi.fn();

// The org `subscription_status` read the Billing branch performs (Story 7.3),
// driven per-test. The admin client is shared by `requireAdmin` and this read.
let billingRead: { data: unknown; error: unknown } = {
  data: { subscription_status: "trial" },
  error: null,
};
function makeAdminClient() {
  return {
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => billingRead }) }),
      };
    },
  };
}

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => makeAdminClient() }));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
// Client component — stub so the node test never pulls its client deps; a
// recognizable marker so we can assert it renders for a same-org Admin.
const InviteFormStub = () => null;
vi.mock("@/components/settings/InviteForm", () => ({ InviteForm: InviteFormStub }));
// Likewise stub the Business Profile form (Story 12.1) so this node test never
// pulls its client deps (framer-motion / next-intl client); a recognizable marker
// lets us assert it renders for a same-org Admin.
const BusinessProfileFormStub = () => null;
vi.mock("@/components/settings/BusinessProfileForm", () => ({
  BusinessProfileForm: BusinessProfileFormStub,
}));
// Stub both billing surfaces so the node test never pulls their client deps, and
// so the branch (Story 7.3) is observable by which stub type renders.
const BillingStartStub = () => null;
vi.mock("@/components/settings/BillingStart", () => ({
  BillingStart: BillingStartStub,
}));
const BillingManageStub = () => null;
vi.mock("@/components/settings/BillingManage", () => ({
  BillingManage: BillingManageStub,
}));

async function importPage() {
  const mod = await import("@/app/[slug]/settings/page");
  return mod.default;
}

const params = (slug: string) => Promise.resolve({ slug });

/** Collect every element `type` in a rendered tree (to find the InviteForm). */
function collectTypes(node: unknown, out: unknown[]): void {
  if (node == null || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const child of node) collectTypes(child, out);
    return;
  }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type !== undefined) out.push(el.type);
  if (el.props?.children !== undefined) collectTypes(el.props.children, out);
}

describe("SettingsPage admin gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    billingRead = { data: { subscription_status: "trial" }, error: null };
  });

  it("redirects an unauthenticated visitor to /login (defense in depth)", async () => {
    getCurrentUser.mockResolvedValue(null);
    const SettingsPage = await importPage();

    await expect(SettingsPage({ params: params("acme") })).rejects.toBeInstanceOf(
      RedirectError,
    );
    expect(redirect).toHaveBeenCalledWith("/login?auth=required");
    expect(requireAdmin).not.toHaveBeenCalled();
  });

  it("bounces a Member / non-member (guard 403) to /{slug}", async () => {
    requireAdmin.mockRejectedValue(new AppError(403, "forbidden"));
    const SettingsPage = await importPage();

    await expect(SettingsPage({ params: params("acme") })).rejects.toBeInstanceOf(
      RedirectError,
    );
    expect(redirect).toHaveBeenCalledWith("/acme");
  });

  it("bounces a cross-org Admin (slug mismatch) to /{slug}", async () => {
    requireAdmin.mockResolvedValue({
      orgId: "org-other",
      slug: "other-org",
      role: "admin",
    });
    const SettingsPage = await importPage();

    await expect(SettingsPage({ params: params("acme") })).rejects.toBeInstanceOf(
      RedirectError,
    );
    expect(redirect).toHaveBeenCalledWith("/acme");
  });

  it("renders the InviteForm for a same-org Admin (no redirect)", async () => {
    requireAdmin.mockResolvedValue({
      orgId: "org-1",
      slug: "acme",
      role: "admin",
    });
    const SettingsPage = await importPage();

    const tree = await SettingsPage({ params: params("acme") });

    expect(redirect).not.toHaveBeenCalled();
    const types: unknown[] = [];
    collectTypes(tree, types);
    expect(types).toContain(InviteFormStub);
    expect(types).toContain(BusinessProfileFormStub);
  });

  it("re-throws a non-AppError from the guard (no silent redirect)", async () => {
    const boom = new Error("db boom");
    requireAdmin.mockRejectedValue(boom);
    const SettingsPage = await importPage();

    await expect(SettingsPage({ params: params("acme") })).rejects.toBe(boom);
    expect(redirect).not.toHaveBeenCalled();
  });

  // --- Story 7.3 Billing surface branch -----------------------------------

  async function renderForStatus(status: string): Promise<unknown[]> {
    requireAdmin.mockResolvedValue({ orgId: "org-1", slug: "acme", role: "admin" });
    billingRead = { data: { subscription_status: status }, error: null };
    const SettingsPage = await importPage();
    const tree = await SettingsPage({ params: params("acme") });
    const types: unknown[] = [];
    collectTypes(tree, types);
    return types;
  }

  it("renders BillingManage for an active org", async () => {
    const types = await renderForStatus("active");
    expect(types).toContain(BillingManageStub);
    expect(types).not.toContain(BillingStartStub);
  });

  it("renders BillingManage for a past_due org", async () => {
    const types = await renderForStatus("past_due");
    expect(types).toContain(BillingManageStub);
    expect(types).not.toContain(BillingStartStub);
  });

  it("renders BillingStart for a trial org", async () => {
    const types = await renderForStatus("trial");
    expect(types).toContain(BillingStartStub);
    expect(types).not.toContain(BillingManageStub);
  });

  it("renders BillingStart for a read_only (canceled) org", async () => {
    const types = await renderForStatus("read_only");
    expect(types).toContain(BillingStartStub);
    expect(types).not.toContain(BillingManageStub);
  });

  it("throws (does not default to trial) when the subscription_status read errors", async () => {
    requireAdmin.mockResolvedValue({ orgId: "org-1", slug: "acme", role: "admin" });
    billingRead = { data: null, error: { message: "read boom" } };
    const SettingsPage = await importPage();
    await expect(SettingsPage({ params: params("acme") })).rejects.toBeInstanceOf(
      AppError,
    );
    expect(redirect).not.toHaveBeenCalled();
  });
});
