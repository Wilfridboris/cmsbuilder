import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FormRow, SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for `loadFormForEditor`'s target-table list assembly (Epic 14, Story
 * 14.4). The editor's target picker renders exactly the `tables` this loader returns, so
 * a regression in the mapping (or the degrade-to-empty fallback) would silently make the
 * whole picker vanish with no other test going red. The REAL `visibleTables` runs (so the
 * hidden-table filter is genuine); only the auth/identity/form/schema/publishability seams
 * are mocked. `evaluateFormPublishability` is mocked to a fixed verdict so this test is
 * about the tables list, not the (separately-tested) publish gate.
 */

const { getCurrentUser } = vi.hoisted(() => ({ getCurrentUser: vi.fn() }));
const { requireAdmin } = vi.hoisted(() => ({ requireAdmin: vi.fn() }));
const { resolveOrgIdentity } = vi.hoisted(() => ({ resolveOrgIdentity: vi.fn() }));
const { getFormById } = vi.hoisted(() => ({ getFormById: vi.fn() }));
const { getSchema } = vi.hoisted(() => ({ getSchema: vi.fn() }));
const { evaluateFormPublishability } = vi.hoisted(() => ({
  evaluateFormPublishability: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`unexpected redirect: ${url}`);
  },
}));
vi.mock("@/lib/auth/session", () => ({ getCurrentUser }));
vi.mock("@/lib/auth/rbac", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({}) }));
vi.mock("@/lib/api/route-helpers", () => ({ resolveOrgIdentity }));
vi.mock("@/lib/data/forms", () => ({ getFormById }));
vi.mock("@/lib/data/records", () => ({ getSchema }));
vi.mock("@/lib/forms/publishability", () => ({ evaluateFormPublishability }));

import { loadFormForEditor } from "@/app/[slug]/forms/_shared";

const SLUG = "acme";

function form(): FormRow {
  return {
    id: "f1",
    organization_id: "org-1",
    title: "Job Request",
    slug: "job-request",
    target_table_key: "leads",
    published: false,
    intro_text: null,
    field_config: [],
    actor_id: null,
    created_at: "2026-10-04T00:00:00Z",
    updated_at: "2026-10-04T00:00:00Z",
  };
}

/**
 * Two visible tables + one hidden, to prove the visibility filter runs for real. The
 * `leads` (form target) table carries a scalar, a hidden field, and a relation so the
 * editor-field assembly (`eligibleFields` + `isRelation`) is exercised end-to-end.
 */
function schema(): SchemaDefinition {
  return {
    tables: [
      {
        key: "leads",
        label: "Leads",
        fields: [
          { key: "name", label: "Name", type: "text" },
          { key: "secret", label: "Secret", type: "text", hidden: true },
          {
            key: "client",
            label: "Client",
            type: "relation",
            relationConfig: { targetTable: "clients", cardinality: "one" },
          },
        ],
      },
      { key: "clients", label: "Clients", fields: [{ key: "co", label: "Company", type: "text" }] },
      { key: "archive", label: "Archive", hidden: true, fields: [{ key: "note", label: "Note", type: "text" }] },
    ],
  } as SchemaDefinition;
}

beforeEach(() => {
  vi.clearAllMocks();
  getCurrentUser.mockResolvedValue({ id: "user-1" });
  requireAdmin.mockResolvedValue({ slug: SLUG });
  resolveOrgIdentity.mockResolvedValue({ client: {} as SupabaseClient, actorId: "user-1", orgId: "org-1" });
  getFormById.mockResolvedValue(form());
  evaluateFormPublishability.mockResolvedValue({ publishable: true, reason: "ok" });
});

describe("loadFormForEditor — target-table list", () => {
  it("returns one {key,label} per VISIBLE table (hidden tables excluded)", async () => {
    getSchema.mockResolvedValue({ data: schema(), error: null });

    const result = await loadFormForEditor(SLUG, "f1");

    expect(result).not.toBeNull();
    expect(result?.tables).toEqual([
      { key: "leads", label: "Leads" },
      { key: "clients", label: "Clients" },
    ]);
    // The form + publish verdict still flow through unchanged.
    expect(result?.form.id).toBe("f1");
    expect(result?.publishable).toBe(true);
    expect(result?.reason).toBe("ok");
  });

  it("returns the target table's non-hidden fields as editorFields, flagging relations (Story 14.5)", async () => {
    getSchema.mockResolvedValue({ data: schema(), error: null });

    const result = await loadFormForEditor(SLUG, "f1");

    // Hidden `secret` is excluded; `name` is a non-relation field, `client` is flagged.
    expect(result?.editorFields).toEqual([
      { key: "name", label: "Name", type: "text", isRelation: false },
      { key: "client", label: "Client", type: "relation", isRelation: true },
    ]);
  });

  it("degrades editorFields to [] when the stored target is not a visible table", async () => {
    getSchema.mockResolvedValue({ data: schema(), error: null });
    getFormById.mockResolvedValue({ ...form(), target_table_key: "archive" });

    const result = await loadFormForEditor(SLUG, "f1");

    // `archive` is hidden -> not a visible table -> no editor fields.
    expect(result?.editorFields).toEqual([]);
  });

  it("degrades the tables list to [] when the schema cannot be read (no crash)", async () => {
    getSchema.mockResolvedValue({ data: null, error: "boom" });

    const result = await loadFormForEditor(SLUG, "f1");

    expect(result).not.toBeNull();
    expect(result?.tables).toEqual([]);
    expect(result?.form.id).toBe("f1");
  });

  it("returns null for an unknown / cross-org form id (RLS-hidden)", async () => {
    getFormById.mockResolvedValue(null);

    const result = await loadFormForEditor(SLUG, "nope");

    expect(result).toBeNull();
  });
});
