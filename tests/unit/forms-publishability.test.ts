import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import type { FormRow, SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for the Forms publish gate (Epic 14, Story 14.3) — the single source of
 * truth shared by the `publishForm` mutation and the editor loader. Mocks ONLY the schema
 * read (`getSchema`); the pure `visibleTables` / `intakeFields` helpers run for real so
 * the test locks the SAME predicate the 14.2 public resolver requires to render.
 *
 * Covers the frozen matrix's publish-blocked rows: null target, a target naming a
 * hidden/deleted table, a target whose only fields are hidden/relation, and a schema READ
 * error (fail closed) — plus the publishable happy path.
 */

const { getSchema } = vi.hoisted(() => ({ getSchema: vi.fn() }));

vi.mock("@/lib/data/records", () => ({ getSchema }));

import { evaluateFormPublishability } from "@/lib/forms/publishability";

const CLIENT = {} as unknown as SupabaseClient;
const ORG = "org-1";

function form(partial: Partial<FormRow>): FormRow {
  return {
    id: "f1",
    organization_id: ORG,
    title: "Job Request",
    slug: "job-request",
    target_table_key: "leads",
    published: false,
    intro_text: null,
    field_config: [],
    actor_id: null,
    created_at: "2026-10-04T00:00:00Z",
    updated_at: "2026-10-04T00:00:00Z",
    ...partial,
  };
}

function okSchema(definition: SchemaDefinition) {
  getSchema.mockResolvedValue({ data: definition, error: null });
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("evaluateFormPublishability", () => {
  it("is publishable when the target names a visible table with an eligible field", async () => {
    okSchema({
      tables: [
        {
          key: "leads",
          label: "Leads",
          fields: [{ key: "name", label: "Name", type: "text" }],
        },
      ],
    });

    const result = await evaluateFormPublishability(
      CLIENT,
      ORG,
      form({ target_table_key: "leads" }),
    );
    expect(result).toEqual({ publishable: true, reason: "ok" });
    // The schema read uses the caller's client + org.
    expect(getSchema).toHaveBeenCalledWith(CLIENT, ORG);
  });

  it("blocks with no-target when target_table_key is null (no schema read needed)", async () => {
    const result = await evaluateFormPublishability(
      CLIENT,
      ORG,
      form({ target_table_key: null }),
    );
    expect(result).toEqual({ publishable: false, reason: "no-target" });
    expect(getSchema).not.toHaveBeenCalled();
  });

  it("blocks with invalid-target when the target table is hidden", async () => {
    okSchema({
      tables: [
        {
          key: "leads",
          label: "Leads",
          hidden: true,
          fields: [{ key: "name", label: "Name", type: "text" }],
        },
      ],
    });

    const result = await evaluateFormPublishability(
      CLIENT,
      ORG,
      form({ target_table_key: "leads" }),
    );
    expect(result).toEqual({ publishable: false, reason: "invalid-target" });
  });

  it("blocks with invalid-target when the target table no longer exists", async () => {
    okSchema({
      tables: [
        {
          key: "widgets",
          label: "Widgets",
          fields: [{ key: "name", label: "Name", type: "text" }],
        },
      ],
    });

    const result = await evaluateFormPublishability(
      CLIENT,
      ORG,
      form({ target_table_key: "leads" }),
    );
    expect(result).toEqual({ publishable: false, reason: "invalid-target" });
  });

  it("blocks with invalid-target when the table's only fields are hidden/relation", async () => {
    okSchema({
      tables: [
        {
          key: "leads",
          label: "Leads",
          fields: [
            { key: "secret", label: "Secret", type: "text", hidden: true },
            { key: "owner", label: "Owner", type: "relation" },
          ],
        },
      ],
    });

    const result = await evaluateFormPublishability(
      CLIENT,
      ORG,
      form({ target_table_key: "leads" }),
    );
    expect(result).toEqual({ publishable: false, reason: "invalid-target" });
  });

  it("fails closed (invalid-target) on a schema read error", async () => {
    getSchema.mockResolvedValue({ data: null, error: "Failed to load schema." });

    const result = await evaluateFormPublishability(
      CLIENT,
      ORG,
      form({ target_table_key: "leads" }),
    );
    expect(result).toEqual({ publishable: false, reason: "invalid-target" });
  });
});
