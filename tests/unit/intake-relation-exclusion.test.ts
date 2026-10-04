import { beforeEach, describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

import type { FieldDefinition, TableDefinition } from "@/types/db";
import { intakeFields } from "@/lib/intake/target";

/**
 * Story 6.5 / FR78 guard: relationship (lookup) fields are excluded from the public
 * intake surface. The invariant is already enforced in two independent layers built
 * during 6.1/6.2 — the render-path field derivation (`intakeFields`) and the
 * submission allowlist (`POST /api/intake/[slug]`, which writes ONLY `target.fields`).
 * This file is the single regression that pins BOTH layers together: it feeds the REAL
 * `intakeFields` output in as the resolved target's `fields`, so the derivation and the
 * allowlist are exercised against the same relation-bearing table.
 *
 *   AC1  no relation field survives derivation, regardless of cardinality (one | many);
 *   AC2  a relation is simply never collected, so a scalar-only submission still
 *        succeeds with the relation left unset (to be linked later from the dashboard);
 *   AC3  neither the relation's target-table name nor an injected target-record id
 *        reaches the rendered field set or the written payload.
 *
 * Deliberately NOT covered here (covered elsewhere or not leakable by construction):
 *   - production's `resolvePublicFormTarget` wiring `intakeFields` into `target.fields`
 *     — proven against the real derivation in `forms-public.test.ts`;
 *   - the `IntakeForm` React component's JSX — it has no relation branch by design and
 *     relies on this upstream filter (no jsdom in this test env, see `filter-sort`);
 *   - target-RECORD labels / counts — the public path never fetches related records, so
 *     there is nothing of that kind to leak (no relation branch, no related-table query).
 */

const RELATION_TARGET_ONE = "clients";
const RELATION_TARGET_MANY = "crew";
const INJECTED_CLIENT_ID = "client-record-id-should-never-write";
const INJECTED_CREW_IDS = ["crew-a", "crew-b"];

// A table whose schema CONTAINS relation fields (both cardinalities) plus a hidden
// scalar. Everything public must behave as if the relations, their target tables, and
// any target-record id do not exist — while the hidden scalar is dropped too.
const JOBS_TABLE: TableDefinition = {
  key: "jobs",
  label: "Jobs",
  fields: [
    { key: "title", label: "Title", type: "text" },
    {
      key: "client",
      label: "Client",
      type: "relation",
      relationConfig: { targetTable: RELATION_TARGET_ONE, cardinality: "one" },
    },
    { key: "internal_note", label: "Internal Note", type: "text", hidden: true },
    {
      key: "crew",
      label: "Assigned Crew",
      type: "relation",
      relationConfig: { targetTable: RELATION_TARGET_MANY, cardinality: "many" },
    },
    { key: "due", label: "Due Date", type: "date" },
  ],
};

describe("Story 6.5 / FR78 — render path never emits a relation field", () => {
  it("drops every relation (one AND many) and the hidden scalar, keeping scalars in order (AC1, AC3)", () => {
    const fields = intakeFields(JOBS_TABLE);

    // Only the visible scalar fields survive, in definition order.
    expect(fields.map((f) => f.key)).toEqual(["title", "due"]);
    // No field is a relation and none carries a relationConfig, regardless of cardinality.
    expect(fields.some((f) => f.type === "relation")).toBe(false);
    expect(fields.some((f) => "relationConfig" in f && f.relationConfig)).toBe(
      false,
    );
    // The hidden scalar is excluded alongside the relations (both exclusion rules apply).
    expect(fields.some((f) => f.key === "internal_note")).toBe(false);
    // Neither relation's target-table name — the thing that could leak a client/crew
    // list to an anonymous submitter — appears anywhere in what the form renders.
    const serialized = JSON.stringify(fields);
    expect(serialized).not.toContain(RELATION_TARGET_ONE);
    expect(serialized).not.toContain(RELATION_TARGET_MANY);
  });
});

// --- Payload path: the same derivation output feeds the server-side allowlist. ---

const resolvePublicFormTarget = vi.fn();
const mutate = vi.fn();
const createAdminClient = vi.fn(() => ({ __admin: true }));
const INTAKE_ACTOR_ID = "00000000-0000-0000-0000-0000000000b0";
const resolveAdminEmails = vi.fn();
const resolveOrgLanguage = vi.fn();
const sendIntakeSubmissionEmail = vi.fn();
const reportError = vi.fn();

vi.mock("@/lib/data/forms-public", () => ({ resolvePublicFormTarget }));
vi.mock("@/lib/data/mutate", () => ({ mutate, INTAKE_ACTOR_ID }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));
vi.mock("@/lib/orgs/org-recipients", () => ({
  resolveAdminEmails,
  resolveOrgLanguage,
}));
vi.mock("@/lib/resend/intake-notification", () => ({ sendIntakeSubmissionEmail }));
vi.mock("@/lib/observability/report", () => ({ reportError }));

function postReq(body: unknown): NextRequest {
  return {
    json: async () => body,
    nextUrl: { origin: "https://app.example.com" },
  } as unknown as NextRequest;
}

function paramsFor(slug: string) {
  return { params: Promise.resolve({ slug }) };
}

// The target the route resolves server-side: its allowlist IS the real `intakeFields`
// output for the relation-bearing table — so `client`/`crew` are absent from `fields`
// while `table` still carries them, exactly like production.
const INTAKE_FIELDS: FieldDefinition[] = intakeFields(JOBS_TABLE);
const TARGET = {
  orgId: "org-1",
  orgSlug: "acme",
  orgName: "Acme Plumbing",
  table: JOBS_TABLE,
  fields: INTAKE_FIELDS,
};

beforeEach(() => {
  vi.clearAllMocks();
  resolvePublicFormTarget.mockResolvedValue(TARGET);
  mutate.mockResolvedValue({ data: { id: "rec-1", version: 1 }, error: null });
  resolveAdminEmails.mockResolvedValue([]);
  resolveOrgLanguage.mockResolvedValue("en");
  sendIntakeSubmissionEmail.mockResolvedValue(undefined);
});

describe("Story 6.5 / FR78 — submission payload drops any relation key", () => {
  it("writes only scalar fields and never an injected relation value, leaving the relation unset (AC2, AC3)", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");

    const res = await POST(
      postReq({
        values: {
          title: "Burst pipe in basement",
          due: "2026-12-01",
          // Relation-shaped keys a hostile client injects into the raw body.
          client: INJECTED_CLIENT_ID,
          crew: INJECTED_CREW_IDS,
        },
        idempotencyKey: "k",
      }),
      paramsFor("acme"),
    );

    // The scalar submission succeeds even though the table has relation fields that
    // were never collected — they are simply left unset for the Admin to link later.
    // (Fields carry no "required" flag, so AC2's "required relation" is satisfied by
    // construction: a relation is never on the public form to begin with.)
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual({ ok: true });

    const written = mutate.mock.calls[0]![3] as Record<string, unknown>;
    // Only allowlisted scalars reached the record; both relation keys are absent (unset).
    expect(written).toEqual({ title: "Burst pipe in basement", due: "2026-12-01" });
    expect(written).not.toHaveProperty("client");
    expect(written).not.toHaveProperty("crew");
    // Belt-and-suspenders: no injected relation id appears ANYWHERE in the mutate call —
    // not as a value, not smuggled under another key (AC3).
    const serializedCall = JSON.stringify(mutate.mock.calls[0]);
    expect(serializedCall).not.toContain(INJECTED_CLIENT_ID);
    expect(serializedCall).not.toContain(INJECTED_CREW_IDS[0]);
  });

  it("drops the relation keys even when they are the ONLY submitted values (empty write rejected)", async () => {
    const { POST } = await import("@/app/api/intake/[slug]/route");

    const res = await POST(
      postReq({
        values: { client: INJECTED_CLIENT_ID, crew: INJECTED_CREW_IDS },
        idempotencyKey: "k",
      }),
      paramsFor("acme"),
    );

    // With every allowlisted scalar blank, the write is a fully-empty submission and is
    // rejected — the relation values are dropped before they can stand in as content.
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("genericError");
    expect(mutate).not.toHaveBeenCalled();
  });
});
