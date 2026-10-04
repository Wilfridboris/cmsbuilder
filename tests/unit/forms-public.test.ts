import { beforeEach, describe, expect, it, vi } from "vitest";

import type { FormRow, SchemaDefinition, TableDefinition } from "@/types/db";

/**
 * Unit coverage for `resolvePublicFormTarget` (Epic 14, Story 14.2) WITHOUT a live DB
 * or auth provider — the single public-form authority shared by the per-form page, the
 * legacy bare-org page, and both submission handlers. It locks the frozen I/O &
 * Edge-Case Matrix rows that live in the resolver:
 *   - unknown org slug / unknown form slug          → null (no schema read, no report);
 *   - form exists but unpublished                   → null (the readers gate it);
 *   - no published form (bare-org, pre-14.3)        → null, NO heuristic fallback;
 *   - `target_table_key` null                       → null;
 *   - `target_table_key` names a deleted/hidden table → null (not in `visibleTables`);
 *   - target table's only fields hidden/relation    → null;
 *   - primary = the OLDEST published form            → the bare-org route resolves it;
 *   - keyed happy path + relation exclusion          → relation fields never survive.
 *
 * The service-role admin client, `getSchema`, and the published-gated `forms` readers
 * are mocked; the REAL `intakeFields` + `visibleTables` run so derivation + the
 * visible-table gate are exercised end-to-end. The resolver's contract is "never throw,
 * never leak": every unavailable case collapses to `null`; an unexpected provider error
 * is reported (not surfaced).
 */

const createAdminClient = vi.fn();
const getSchema = vi.fn();
const getPublishedFormBySlug = vi.fn();
const getPrimaryPublishedForm = vi.fn();
const reportError = vi.fn();

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/data/records", () => ({ getSchema }));
vi.mock("@/lib/data/forms", () => ({
  getPublishedFormBySlug,
  getPrimaryPublishedForm,
}));
vi.mock("@/lib/observability/report", () => ({ reportError }));

const { resolvePublicFormTarget } = await import("@/lib/data/forms-public");

type OrgResult = { data: unknown; error: unknown };

/** A scriptable admin stub for the single org query shape the resolver issues:
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

/** A minimal published `FormRow` whose stored target is `target`. */
function formRow(overrides: Partial<FormRow> = {}): FormRow {
  return {
    id: "form-1",
    organization_id: "org-1",
    title: "Contact",
    slug: "contact",
    target_table_key: "leads",
    published: true,
    intro_text: null,
    field_config: [],
    actor_id: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const LEADS_TABLE: TableDefinition = {
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
};

beforeEach(() => {
  vi.clearAllMocks();
  createAdminClient.mockReturnValue(
    adminReturning({ data: { id: "org-1", name: "Acme Plumbing" }, error: null }),
  );
  getSchema.mockResolvedValue({ data: schemaWith([LEADS_TABLE]), error: null });
});

describe("resolvePublicFormTarget — unavailable cases collapse to null", () => {
  it("returns null for an empty org slug without touching the admin client", async () => {
    expect(await resolvePublicFormTarget({ orgSlug: "" })).toBeNull();
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("returns null for a keyed route with an empty form slug (not a bare-org fallback)", async () => {
    expect(
      await resolvePublicFormTarget({ orgSlug: "acme", formSlug: "" }),
    ).toBeNull();
    // An empty form slug short-circuits before any query — it is NOT the primary form.
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(getPrimaryPublishedForm).not.toHaveBeenCalled();
    expect(getPublishedFormBySlug).not.toHaveBeenCalled();
  });

  it("returns null for an unknown org slug (no form read, no report)", async () => {
    createAdminClient.mockReturnValue(adminReturning({ data: null, error: null }));
    expect(
      await resolvePublicFormTarget({ orgSlug: "ghost", formSlug: "contact" }),
    ).toBeNull();
    expect(getPublishedFormBySlug).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("returns null when the org lookup errors (no leak, no throw, no report)", async () => {
    createAdminClient.mockReturnValue(
      adminReturning({ data: null, error: { message: "boom" } }),
    );
    expect(await resolvePublicFormTarget({ orgSlug: "acme" })).toBeNull();
    expect(getPrimaryPublishedForm).not.toHaveBeenCalled();
    expect(reportError).not.toHaveBeenCalled();
  });

  it("returns null for an unknown/unpublished keyed form (reader gates it to null)", async () => {
    getPublishedFormBySlug.mockResolvedValue(null);
    expect(
      await resolvePublicFormTarget({ orgSlug: "acme", formSlug: "nope" }),
    ).toBeNull();
    expect(getPublishedFormBySlug).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      "nope",
    );
    // No published form means no schema read is needed.
    expect(getSchema).not.toHaveBeenCalled();
  });

  it("returns null for the bare-org route when the org has NO published form (no fallback)", async () => {
    getPrimaryPublishedForm.mockResolvedValue(null);
    expect(await resolvePublicFormTarget({ orgSlug: "acme" })).toBeNull();
    expect(getPrimaryPublishedForm).toHaveBeenCalledWith(expect.anything(), "org-1");
    // Strict: no heuristic fallback — getSchema is never consulted to guess a table.
    expect(getSchema).not.toHaveBeenCalled();
  });

  it("returns null when the published form's target_table_key is null", async () => {
    getPublishedFormBySlug.mockResolvedValue(
      formRow({ target_table_key: null }),
    );
    expect(
      await resolvePublicFormTarget({ orgSlug: "acme", formSlug: "contact" }),
    ).toBeNull();
    // A null target short-circuits before the schema read.
    expect(getSchema).not.toHaveBeenCalled();
  });

  it("returns null when target_table_key names a table not in the schema (deleted)", async () => {
    getPublishedFormBySlug.mockResolvedValue(
      formRow({ target_table_key: "archived_leads" }),
    );
    getSchema.mockResolvedValue({ data: schemaWith([LEADS_TABLE]), error: null });
    expect(
      await resolvePublicFormTarget({ orgSlug: "acme", formSlug: "contact" }),
    ).toBeNull();
  });

  it("returns null when target_table_key names a now-HIDDEN table (stale)", async () => {
    getPublishedFormBySlug.mockResolvedValue(
      formRow({ target_table_key: "leads" }),
    );
    getSchema.mockResolvedValue({
      data: schemaWith([{ ...LEADS_TABLE, hidden: true }]),
      error: null,
    });
    expect(
      await resolvePublicFormTarget({ orgSlug: "acme", formSlug: "contact" }),
    ).toBeNull();
  });

  it("returns null when the target table's only fields are hidden/relation", async () => {
    getPublishedFormBySlug.mockResolvedValue(formRow());
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
    expect(
      await resolvePublicFormTarget({ orgSlug: "acme", formSlug: "contact" }),
    ).toBeNull();
  });

  it("returns null when getSchema errors", async () => {
    getPublishedFormBySlug.mockResolvedValue(formRow());
    getSchema.mockResolvedValue({ data: null, error: "unreadable" });
    expect(
      await resolvePublicFormTarget({ orgSlug: "acme", formSlug: "contact" }),
    ).toBeNull();
  });

  it("reports and returns null when the admin client throws (never surfaces the error)", async () => {
    createAdminClient.mockImplementation(() => {
      throw new Error("service role unavailable");
    });
    await expect(
      resolvePublicFormTarget({ orgSlug: "acme", formSlug: "contact" }),
    ).resolves.toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
  });

  it("reports and returns null when a reader throws", async () => {
    getPublishedFormBySlug.mockRejectedValue(new Error("forms query failed"));
    await expect(
      resolvePublicFormTarget({ orgSlug: "acme", formSlug: "contact" }),
    ).resolves.toBeNull();
    expect(reportError).toHaveBeenCalledTimes(1);
  });
});

describe("resolvePublicFormTarget — keyed happy path", () => {
  it("resolves the keyed form's target table, excluding relation fields, preserving order", async () => {
    getPublishedFormBySlug.mockResolvedValue(formRow());

    const target = await resolvePublicFormTarget({
      orgSlug: "acme",
      formSlug: "contact",
    });

    expect(target).not.toBeNull();
    expect(target?.orgId).toBe("org-1");
    expect(target?.orgSlug).toBe("acme");
    expect(target?.orgName).toBe("Acme Plumbing");
    expect(target?.table.key).toBe("leads");
    // Relation `client` is dropped; scalar order preserved.
    expect(target?.fields.map((f) => f.key)).toEqual(["name", "email"]);
    expect(target?.fields.some((f) => f.type === "relation")).toBe(false);
    // The resolved schema is handed back for mutate's referential-integrity guard.
    expect(target?.schema).toEqual(schemaWith([LEADS_TABLE]));
    // The keyed reader was used (never the primary one).
    expect(getPublishedFormBySlug).toHaveBeenCalledWith(
      expect.anything(),
      "org-1",
      "contact",
    );
    expect(getPrimaryPublishedForm).not.toHaveBeenCalled();
  });
});

describe("resolvePublicFormTarget — bare-org route picks the primary published form", () => {
  it("resolves the org's primary (oldest published) form via getPrimaryPublishedForm", async () => {
    // The reader is the authority on "oldest published by created_at"; the resolver
    // simply trusts whatever row it returns. We assert the resolver routes the
    // bare-org request to the PRIMARY reader (not the keyed one) and resolves its target.
    getPrimaryPublishedForm.mockResolvedValue(
      formRow({ id: "oldest", slug: "primary", target_table_key: "leads" }),
    );

    const target = await resolvePublicFormTarget({ orgSlug: "acme" });

    expect(target).not.toBeNull();
    expect(target?.table.key).toBe("leads");
    expect(target?.fields.map((f) => f.key)).toEqual(["name", "email"]);
    expect(getPrimaryPublishedForm).toHaveBeenCalledWith(expect.anything(), "org-1");
    expect(getPublishedFormBySlug).not.toHaveBeenCalled();
  });

  it("falls back to an empty orgName when the org row has no name", async () => {
    createAdminClient.mockReturnValue(
      adminReturning({ data: { id: "org-1", name: null }, error: null }),
    );
    getPrimaryPublishedForm.mockResolvedValue(formRow());

    const target = await resolvePublicFormTarget({ orgSlug: "acme" });
    expect(target?.orgName).toBe("");
  });
});

/**
 * A richer admin stub that distinguishes the two table queries the resolver issues:
 *   organizations:      .select("id, name").eq("slug", …).maybeSingle()
 *   business_profiles:  .select("operating_name, logo_path").eq("organization_id", …).maybeSingle()
 * Returns `org` for the organizations table and `profile` for business_profiles.
 */
function adminWithProfile(org: OrgResult, profile: OrgResult) {
  return {
    from: vi.fn((table: string) => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () =>
            table === "business_profiles" ? profile : org,
          ),
        })),
      })),
    })),
  };
}

describe("resolvePublicFormTarget — branding (Story 14.6)", () => {
  it("populates operatingName, logoUrl (org-keyed), and introText when the profile has them", async () => {
    createAdminClient.mockReturnValue(
      adminWithProfile(
        { data: { id: "org-1", name: "Acme Plumbing" }, error: null },
        {
          data: { operating_name: "Acme Co.", logo_path: "org-1/logo.png" },
          error: null,
        },
      ),
    );
    getPublishedFormBySlug.mockResolvedValue(
      formRow({ intro_text: "Welcome! Tell us about your job." }),
    );

    const target = await resolvePublicFormTarget({
      orgSlug: "acme",
      formSlug: "contact",
    });

    expect(target).not.toBeNull();
    expect(target?.operatingName).toBe("Acme Co.");
    // The logo URL is the stable org-keyed proxy route — never the storage key.
    expect(target?.logoUrl).toBe("/api/forms/logo/acme");
    expect(target?.introText).toBe("Welcome! Tell us about your job.");
  });

  it("leaves logoUrl null when logo_path is null (operatingName + intro still resolved)", async () => {
    createAdminClient.mockReturnValue(
      adminWithProfile(
        { data: { id: "org-1", name: "Acme Plumbing" }, error: null },
        { data: { operating_name: "Acme Co.", logo_path: null }, error: null },
      ),
    );
    getPublishedFormBySlug.mockResolvedValue(formRow({ intro_text: "Hi there" }));

    const target = await resolvePublicFormTarget({
      orgSlug: "acme",
      formSlug: "contact",
    });

    expect(target?.operatingName).toBe("Acme Co.");
    expect(target?.logoUrl).toBeNull();
    expect(target?.introText).toBe("Hi there");
  });

  it("degrades to null branding (name falls back) when there is no business profile row", async () => {
    createAdminClient.mockReturnValue(
      adminWithProfile(
        { data: { id: "org-1", name: "Acme Plumbing" }, error: null },
        { data: null, error: null },
      ),
    );
    getPublishedFormBySlug.mockResolvedValue(formRow({ intro_text: null }));

    const target = await resolvePublicFormTarget({
      orgSlug: "acme",
      formSlug: "contact",
    });

    expect(target).not.toBeNull();
    // No profile row -> operatingName + logoUrl null; the form still renders. The header
    // falls back to orgName (asserted here as the resolved name).
    expect(target?.operatingName).toBeNull();
    expect(target?.logoUrl).toBeNull();
    expect(target?.introText).toBeNull();
    expect(target?.orgName).toBe("Acme Plumbing");
    // A best-effort profile miss never reports an error.
    expect(reportError).not.toHaveBeenCalled();
  });

  it("degrades to null branding when the profile read errors (best-effort)", async () => {
    createAdminClient.mockReturnValue(
      adminWithProfile(
        { data: { id: "org-1", name: "Acme Plumbing" }, error: null },
        { data: null, error: { message: "boom" } },
      ),
    );
    getPublishedFormBySlug.mockResolvedValue(formRow());

    const target = await resolvePublicFormTarget({
      orgSlug: "acme",
      formSlug: "contact",
    });

    expect(target).not.toBeNull();
    expect(target?.operatingName).toBeNull();
    expect(target?.logoUrl).toBeNull();
    expect(reportError).not.toHaveBeenCalled();
  });
});

describe("resolvePublicFormTarget — per-field config is applied (Story 14.5)", () => {
  it("applies the form's field_config: excludes a field, overrides a label, attaches helpText, reorders", async () => {
    // Hide `email`, relabel `name` + add help text, and put `name` after... well,
    // only `name` survives here, but exercise order + label + help through the resolver.
    getPublishedFormBySlug.mockResolvedValue(
      formRow({
        field_config: [
          {
            key: "email",
            included: false,
            order: 0,
          },
          {
            key: "name",
            included: true,
            label: "Your full name",
            helpText: "First and last",
            order: 1,
          },
        ],
      }),
    );

    const target = await resolvePublicFormTarget({
      orgSlug: "acme",
      formSlug: "contact",
    });

    expect(target).not.toBeNull();
    // `email` excluded; relation `client` never a candidate; only `name` renders.
    expect(target?.fields.map((f) => f.key)).toEqual(["name"]);
    const name = target?.fields.find((f) => f.key === "name");
    expect(name?.label).toBe("Your full name");
    expect(name?.helpText).toBe("First and last");
  });

  it("reorders included fields by the config `order`", async () => {
    getPublishedFormBySlug.mockResolvedValue(
      formRow({
        field_config: [
          { key: "name", included: true, order: 1 },
          { key: "email", included: true, order: 0 },
        ],
      }),
    );

    const target = await resolvePublicFormTarget({
      orgSlug: "acme",
      formSlug: "contact",
    });

    // `email` (order 0) before `name` (order 1); relation `client` still excluded.
    expect(target?.fields.map((f) => f.key)).toEqual(["email", "name"]);
  });

  it("returns null when the config excludes every field (same as zero-eligible)", async () => {
    getPublishedFormBySlug.mockResolvedValue(
      formRow({
        field_config: [
          { key: "name", included: false },
          { key: "email", included: false },
        ],
      }),
    );

    expect(
      await resolvePublicFormTarget({ orgSlug: "acme", formSlug: "contact" }),
    ).toBeNull();
  });
});
