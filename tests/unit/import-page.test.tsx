import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Page-boundary coverage for the `/{slug}/import` schema→FieldCatalog projection
 * (Story 4.3). The import page reads the org schema under the RLS-scoped client and
 * projects it to a client-safe catalog for the mapping picker: non-hidden tables and
 * non-hidden fields only, each as `{key, label, type}`. On a schema read error/empty
 * or a `resolveOrgIdentity` failure it degrades to `[]` (the picker offers only
 * "skip") rather than crashing — the frozen matrix "empty / unreadable schema" row.
 *
 * `ImportPage` is an async Server Component; we invoke it directly (node env) and
 * walk the returned tree to read the `fieldCatalog` prop handed to `ImportView`.
 * Data-layer + Supabase deps are mocked; `ImportView` is stubbed to a marker.
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
const resolveOrgIdentity = vi.fn();
const getSchema = vi.fn();

const ImportViewStub = () => null;

vi.mock("next/navigation", () => ({ redirect }));
vi.mock("next-intl/server", () => ({
  getTranslations: async () => (key: string) => key,
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
vi.mock("@/lib/api/route-helpers", () => ({ resolveOrgIdentity }));
vi.mock("@/lib/data/records", () => ({ getSchema }));
vi.mock("@/components/import/ImportView", () => ({ ImportView: ImportViewStub }));

async function importPage() {
  const mod = await import("@/app/[slug]/import/page");
  return mod.default;
}

const params = (slug: string) => Promise.resolve({ slug });

/** Find the first element in the rendered tree whose `type` matches. */
function findByType(node: unknown, type: unknown): { props?: Record<string, unknown> } | null {
  if (node == null || typeof node !== "object") return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = findByType(child, type);
      if (found) return found;
    }
    return null;
  }
  const el = node as { type?: unknown; props?: { children?: unknown } };
  if (el.type === type) return el as { props?: Record<string, unknown> };
  if (el.props?.children !== undefined) return findByType(el.props.children, type);
  return null;
}

/** The `fieldCatalog` prop handed to the stubbed ImportView, or undefined. */
async function renderCatalog(slug = "acme"): Promise<unknown> {
  const Page = await importPage();
  const tree = await Page({ params: params(slug) });
  const el = findByType(tree, ImportViewStub);
  expect(el).toBeTruthy();
  return el?.props?.fieldCatalog;
}

describe("ImportPage FieldCatalog projection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCurrentUser.mockResolvedValue({ id: "user-1" });
    requireAdmin.mockResolvedValue({ slug: "acme", orgId: "org-1", role: "admin" });
    resolveOrgIdentity.mockResolvedValue({ client: {}, orgId: "org-1" });
  });

  it("excludes hidden tables and hidden fields and maps fields to {key,label,type}", async () => {
    getSchema.mockResolvedValue({
      data: {
        tables: [
          {
            key: "clients",
            label: "Clients",
            fields: [
              { key: "name", label: "Customer Name", type: "text" },
              { key: "secret", label: "Secret", type: "text", hidden: true },
            ],
          },
          {
            key: "archived",
            label: "Archived",
            hidden: true,
            fields: [{ key: "x", label: "X", type: "text" }],
          },
        ],
      },
      error: null,
    });

    const catalog = await renderCatalog();

    expect(catalog).toEqual([
      {
        tableKey: "clients",
        tableLabel: "Clients",
        fields: [{ key: "name", label: "Customer Name", type: "text" }],
      },
    ]);
  });

  it("degrades to an empty catalog when getSchema returns an error", async () => {
    getSchema.mockResolvedValue({ data: null, error: "boom" });
    expect(await renderCatalog()).toEqual([]);
  });

  it("yields an empty catalog when the schema has no tables", async () => {
    getSchema.mockResolvedValue({ data: { tables: [] }, error: null });
    expect(await renderCatalog()).toEqual([]);
  });

  it("degrades to an empty catalog when resolveOrgIdentity throws", async () => {
    resolveOrgIdentity.mockRejectedValue(new Error("no membership"));
    expect(await renderCatalog()).toEqual([]);
  });
});
