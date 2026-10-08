import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Page-boundary coverage for the auth-aware landing route `src/app/page.tsx`
 * (Story 15.1), closing the frozen I/O-matrix rows that live on the page itself:
 *   - "Auth-aware home (signed-in)": a valid session with a resolved org renders
 *     the "go to my dashboard" card (links `/{slug}`) + the SignOutButton, and
 *     NEVER the empty claim form (PromptBuilder / HomeClaimView);
 *   - "Auth-aware home (signed-out)": no session renders the claim UI
 *     (HomeClaimView, with its "log in" entry) and NOT the dashboard card;
 *   - "Public locale toggle" (home surface): the EN/FR LocaleToggle is present on
 *     BOTH the signed-in and signed-out branches.
 *
 * `Home()` is an async Server Component, so — matching `settings-page.test.tsx`
 * and `slug-dashboard-page.test.tsx` — we invoke it directly (node env, no DOM)
 * and walk the returned React element tree. The auth/org resolvers, the admin
 * client (the org-name read), and `next-intl/server` are mocked; the client
 * children (`HomeClaimView`, `SignOutButton`, `LocaleToggle`) are stubbed to
 * recognizable markers so the node test never pulls their client deps and their
 * presence/absence is observable by element `type`.
 */

const getCurrentUser = vi.fn();
const resolveUserPrimaryOrgSlug = vi.fn();

// Org-name read: `admin.from("organizations").select("name").eq("slug", …).maybeSingle()`.
let orgNameRead: { data: unknown; error: unknown } = {
  data: { name: "Joe's Plumbing" },
  error: null,
};
function makeAdminClient() {
  return {
    from() {
      return {
        select: () => ({
          eq: () => ({ maybeSingle: async () => orgNameRead }),
        }),
      };
    },
  };
}

// Recognizable client-child markers (stubbed so the node test never pulls their
// client deps; their element `type` identifies the branch that rendered).
const HomeClaimViewStub = () => null;
const SignOutButtonStub = () => null;
const LocaleToggleStub = () => null;

vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/auth/org", () => ({ resolveUserPrimaryOrgSlug }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => makeAdminClient(),
}));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string, values?: Record<string, unknown>) =>
    values ? `${key}:${Object.values(values).join(",")}` : key,
}));
vi.mock("@/components/home/HomeClaimView", () => ({
  HomeClaimView: HomeClaimViewStub,
}));
vi.mock("@/components/auth/SignOutButton", () => ({
  SignOutButton: SignOutButtonStub,
}));
vi.mock("@/components/i18n/LocaleToggle", () => ({
  LocaleToggle: LocaleToggleStub,
}));

/** Collect every element `type` and `href` in a rendered React element tree. */
function collect(node: unknown, types: unknown[], hrefs: string[]): void {
  if (node == null || typeof node === "boolean") return;
  if (Array.isArray(node)) {
    for (const child of node) collect(child, types, hrefs);
    return;
  }
  if (typeof node !== "object") return;
  const el = node as { type?: unknown; props?: Record<string, unknown> };
  if (el.type !== undefined) types.push(el.type);
  const props = el.props;
  if (props) {
    if (typeof props.href === "string") hrefs.push(props.href);
    collect(props.children, types, hrefs);
  }
}

async function renderHome() {
  const { default: Home } = await import("@/app/page");
  const element = await Home();
  const types: unknown[] = [];
  const hrefs: string[] = [];
  collect(element, types, hrefs);
  return { types, hrefs };
}

beforeEach(() => {
  vi.clearAllMocks();
  orgNameRead = { data: { name: "Joe's Plumbing" }, error: null };
});

describe("Home() — auth-aware landing (Story 15.1)", () => {
  it("signed-in: renders the 'go to my dashboard' card linking /{slug} + SignOutButton, NOT the claim form", async () => {
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    resolveUserPrimaryOrgSlug.mockResolvedValue({ slug: "joes-plumbing" });

    const { types, hrefs } = await renderHome();

    // The dashboard CTA links the resolved slug and the sign-out affordance is present.
    expect(hrefs).toContain("/joes-plumbing");
    expect(types).toContain(SignOutButtonStub);
    // Never the empty claim form on the signed-in branch.
    expect(types).not.toContain(HomeClaimViewStub);
    // The resolver was given the user id + admin client (same resolver /auth/confirm uses).
    expect(resolveUserPrimaryOrgSlug).toHaveBeenCalledWith(
      "user-1",
      expect.anything(),
    );
  });

  it("signed-out: renders the claim UI (HomeClaimView), NOT the dashboard card", async () => {
    getCurrentUser.mockResolvedValue(null);

    const { types, hrefs } = await renderHome();

    expect(types).toContain(HomeClaimViewStub);
    // No dashboard card / sign-out on the signed-out branch.
    expect(types).not.toContain(SignOutButtonStub);
    expect(hrefs).not.toContain("/joes-plumbing");
    // A signed-out visitor is never org-resolved.
    expect(resolveUserPrimaryOrgSlug).not.toHaveBeenCalled();
  });

  it("public locale toggle: LocaleToggle is present on BOTH the signed-in and signed-out branches", async () => {
    // Signed-in branch.
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    resolveUserPrimaryOrgSlug.mockResolvedValue({ slug: "joes-plumbing" });
    const signedIn = await renderHome();
    expect(signedIn.types).toContain(LocaleToggleStub);

    // Signed-out branch.
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue(null);
    const signedOut = await renderHome();
    expect(signedOut.types).toContain(LocaleToggleStub);
  });
});
