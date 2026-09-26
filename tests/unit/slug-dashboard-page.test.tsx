import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Page-boundary coverage for the `/{slug}` dashboard render wiring (Story 3.1),
 * closing the two frozen I/O matrix rows that live on the page rather than in
 * `RecordsView`: the empty-dashboard state (no visible tables) and the hand-off
 * to `RecordsView` when tables are present.
 *
 * `SlugDashboardPage` is an async Server Component; we invoke it directly (node
 * env, no DOM) and walk the returned tree. Data-layer + Supabase deps are mocked;
 * `visibleTables` is the real implementation (it decides the empty vs populated
 * branch). `RecordsView` is stubbed to a marker so the node test never pulls its
 * client deps and we can assert the wiring.
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
const getSchema = vi.fn();
const listRecords = vi.fn();

const RecordsViewStub = () => null;

vi.mock("next/headers", () => ({ cookies: async () => ({}) }));
vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/server", () => ({
  createServerSupabaseClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data: { id: "org-1", name: "Acme" },
            error: null,
          }),
        }),
      }),
    }),
  }),
}));
vi.mock("@/lib/data/records", () => ({ getSchema, listRecords }));
vi.mock("@/components/dashboard/RecordsView", () => ({
  RecordsView: RecordsViewStub,
}));

async function importPage() {
  const mod = await import("@/app/[slug]/page");
  return mod.default;
}

const params = (slug: string) => Promise.resolve({ slug });

/** Collect every element `type` and string child in a rendered tree. */
function collect(node: unknown, types: unknown[], texts: string[]): void {
  if (node == null || typeof node === "boolean") return;
  if (typeof node === "string" || typeof node === "number") {
    texts.push(String(node));
    return;
  }
  if (Array.isArray(node)) {
    for (const child of node) collect(child, types, texts);
    return;
  }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type !== undefined) types.push(el.type);
  if (el.props?.children !== undefined) collect(el.props.children, types, texts);
}

describe("SlugDashboardPage render wiring (I/O matrix)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    listRecords.mockResolvedValue({ data: [], error: null });
  });

  it("shows the translated empty-dashboard message when there are no visible tables", async () => {
    getSchema.mockResolvedValue({ data: { tables: [] }, error: null });
    const Page = await importPage();

    const tree = await Page({ params: params("acme") });

    const types: unknown[] = [];
    const texts: string[] = [];
    collect(tree, types, texts);
    expect(texts).toContain("emptyDashboard");
    expect(types).not.toContain(RecordsViewStub);
    expect(redirect).not.toHaveBeenCalled();
  });

  it("renders RecordsView (not the empty state) when the org has visible tables", async () => {
    getSchema.mockResolvedValue({
      data: {
        tables: [
          { key: "jobs", label: "Jobs", fields: [{ key: "a", label: "A", type: "text" }] },
        ],
      },
      error: null,
    });
    const Page = await importPage();

    const tree = await Page({ params: params("acme") });

    const types: unknown[] = [];
    const texts: string[] = [];
    collect(tree, types, texts);
    expect(types).toContain(RecordsViewStub);
    expect(texts).not.toContain("emptyDashboard");
  });
});
