import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SchemaDefinition, TableDefinition } from "@/types/db";

/**
 * Unit coverage for `getPublicIntakeForm` (Story 6.1) WITHOUT a live DB or auth
 * provider, closing the frozen I/O & Edge-Case matrix rows that live in the data
 * layer: unknown/absent slug, no renderable fields, relation exclusion, and the
 * happy path. The service-role admin client and `getSchema` are mocked; the real
 * `selectIntakeTable`/`intakeFields` (and their `overrides`/`filter-sort` deps) run
 * so selection + derivation are exercised end-to-end. `server-only` is globally
 * stubbed by the vitest alias, so the module imports in the node env.
 *
 * The function's contract is "never throw, never leak": every unavailable case
 * collapses to `null`, and an unexpected provider error is reported (not surfaced).
 */

const createAdminClient = vi.fn();
const getSchema = vi.fn();
const reportError = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/data/records", () => ({ getSchema }));
vi.mock("@/lib/observability/report", () => ({ reportError }));

const { getPublicIntakeForm } = await import("@/lib/data/intake");

type OrgResult = { data: unknown; error: unknown };

/** A scriptable admin stub for the single query shape this module issues:
 * `admin.from("organizations").select("id, name").eq("slug", slug).maybeSingle()`. */
function adminReturning(org: OrgResult) {
  return {
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => org),
        })),
      })),
    })),
  };
}

function schemaWith(tables: TableDefinition[]): SchemaDefinition {
  return { tables };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getPublicIntakeForm — unavailable cases collapse to null", () => {
  it("returns null for an empty slug without touching the admin client", async () => {
    expect(await getPublicIntakeForm("")).toBeNull();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(getSchema).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("returns null for an unknown slug (org lookup empty), no schema read, no report", async () => {
    createAdminClient.mockReturnValue(adminReturning({ data: null, error: null }));
    expect(await getPublicIntakeForm("ghost")).toBeNull();
    expect(getSchema).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("returns null when the org lookup errors (no leak, no throw, no report)", async () => {
    createAdminClient.mockReturnValue(
      adminReturning({ data: null, error: { message: "boom" } }),
    );
    expect(await getPublicIntakeForm("acme")).toBeNull();
    expect(getSchema).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("reports and returns null when the admin client throws (never surfaces the error)", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("service role unavailable");
    });
    await expect(getPublicIntakeForm("acme")).resolves.toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("returns null when getSchema errors", async () => {
    createAdminClient.mockReturnValue(
      adminReturning({ data: { id: "org-1", name: "Acme" }, error: null }),
    );
    getSchema.mockResolvedValue({ data: null, error: "unreadable" });
    expect(await getPublicIntakeForm("acme")).toBeNull();
  });

  it("returns null when the schema has no visible tables", async () => {
    createAdminClient.mockReturnValue(
      adminReturning({ data: { id: "org-1", name: "Acme" }, error: null }),
    );
    getSchema.mockResolvedValue({ data: schemaWith([]), error: null });
    expect(await getPublicIntakeForm("acme")).toBeNull();
  });

  it("returns null when the intake table's only fields are hidden/relation", async () => {
    createAdminClient.mockReturnValue(
      adminReturning({ data: { id: "org-1", name: "Acme" }, error: null }),
    );
    getSchema.mockResolvedValue({
      data: schemaWith([
        {
          key: "leads",
          label: "Leads",
          fields: [
            { key: "note", label: "Note", type: "text", hidden: true },
            {
              key: "client",
              label: "Client",
              type: "relation",
              relationConfig: { targetTable: "clients", cardinality: "one" },
            },
          ],
        },
      ]),
      error: null,
    });
    expect(await getPublicIntakeForm("acme")).toBeNull();
  });
});

describe("getPublicIntakeForm — happy path", () => {
  it("returns orgName/tableLabel/fields with relation fields excluded and order preserved", async () => {
    createAdminClient.mockReturnValue(
      adminReturning({ data: { id: "org-1", name: "Acme Plumbing" }, error: null }),
    );
    getSchema.mockResolvedValue({
      data: schemaWith([
        {
          key: "leads",
          label: "New Leads",
          fields: [
            { key: "name", label: "Full Name", type: "text" },
            {
              key: "client",
              label: "Client",
              type: "relation",
              relationConfig: { targetTable: "clients", cardinality: "one" },
            },
            { key: "email", label: "Email", type: "email" },
          ],
        },
      ]),
      error: null,
    });

    const form = await getPublicIntakeForm("acme");

    expect(form).not.toBeNull();
    expect(form?.orgName).toBe("Acme Plumbing");
    expect(form?.tableLabel).toBe("New Leads");
    expect(form?.fields.map((f) => f.key)).toEqual(["name", "email"]);
    expect(form?.fields.map((f) => f.key)).not.toContain("client");
    expect(getSchema).toHaveBeenCalledWith(expect.anything(), "org-1");
  });

  it("falls back to an empty orgName when the org row has no name", async () => {
    createAdminClient.mockReturnValue(
      adminReturning({ data: { id: "org-1", name: null }, error: null }),
    );
    getSchema.mockResolvedValue({
      data: schemaWith([
        {
          key: "jobs",
          label: "Jobs",
          fields: [{ key: "title", label: "Title", type: "text" }],
        },
      ]),
      error: null,
    });

    const form = await getPublicIntakeForm("acme");
    expect(form?.orgName).toBe("");
    expect(form?.fields.map((f) => f.key)).toEqual(["title"]);
  });
});
