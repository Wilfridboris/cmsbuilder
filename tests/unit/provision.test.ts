import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { provisionGeneration } from "@/lib/generation/provision";
import type { SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for anonymous-generation provisioning (Story 1.4) WITHOUT a real
 * DB — covers the I/O-matrix "Valid prompt → provisioned" and "malformed seedRows
 * → schema persisted, bad rows skipped" rows at the provisioning layer. A fake
 * Supabase client stands in for the admin client: it records `organizations` /
 * `org_schemas` upserts and delegates `records` writes to the same guarded
 * `mutate.ts` path the app uses (select-then-insert). No network, no DB.
 */

// Provisioning routes rejection logging through the observability seam; stub it.
vi.mock("@/lib/observability/report", () => ({
  reportError: vi.fn(),
  reportRejection: vi.fn(),
}));

type RecordRow = {
  id: string;
  organization_id: string;
  table_key: string;
  data: Record<string, unknown>;
  idempotency_key: string | null;
  version: number;
  deleted_at: string | null;
};

/**
 * Fake admin client supporting exactly what `provisionGeneration` + `mutate`
 * touch: `organizations`/`org_schemas` upserts, and the `records` select/insert
 * path used by the guarded insert.
 */
class FakeAdmin {
  orgUpserts: Array<Record<string, unknown>> = [];
  schemaUpserts: Array<Record<string, unknown>> = [];
  records: RecordRow[] = [];
  private seq = 0;

  from(table: string) {
    if (table === "organizations") {
      return new UpsertQuery((payload) => this.orgUpserts.push(payload));
    }
    if (table === "org_schemas") {
      return new UpsertQuery((payload) => this.schemaUpserts.push(payload));
    }
    if (table === "records") {
      return new RecordsQuery(this);
    }
    throw new Error(`unexpected table: ${table}`);
  }

  nextId(): string {
    this.seq += 1;
    return `rec-${this.seq}`;
  }
}

class UpsertQuery {
  constructor(private readonly record: (payload: Record<string, unknown>) => void) {}
  upsert(payload: Record<string, unknown>) {
    this.record(payload);
    return Promise.resolve({ error: null });
  }
}

type Filter = { col: keyof RecordRow; val: unknown };

class RecordsQuery {
  private mode: "select" | "insert" = "select";
  private filters: Filter[] = [];
  private insertPayload: Partial<RecordRow> | null = null;

  constructor(private readonly admin: FakeAdmin) {}

  select() {
    return this;
  }
  insert(payload: Partial<RecordRow>) {
    this.mode = "insert";
    this.insertPayload = payload;
    return this;
  }
  eq(col: keyof RecordRow, val: unknown) {
    this.filters.push({ col, val });
    return this;
  }
  is() {
    return this;
  }
  order() {
    return this;
  }

  private matches(row: RecordRow): boolean {
    return this.filters.every((f) => row[f.col] === f.val);
  }

  single() {
    if (this.mode === "insert") {
      const now = new Date().toISOString();
      const row: RecordRow = {
        id: this.admin.nextId(),
        organization_id: (this.insertPayload!.organization_id as string) ?? "",
        table_key: (this.insertPayload!.table_key as string) ?? "",
        data: (this.insertPayload!.data as Record<string, unknown>) ?? {},
        idempotency_key: (this.insertPayload!.idempotency_key as string | null) ?? null,
        version: 1,
        deleted_at: null,
      };
      this.admin.records.push(row);
      return Promise.resolve({ data: { id: row.id, version: row.version }, error: null });
    }
    return this.maybeSingle();
  }

  maybeSingle() {
    const row = this.admin.records.find((r) => this.matches(r)) ?? null;
    return Promise.resolve({
      data: row ? { id: row.id, version: row.version } : null,
      error: null,
    });
  }
}

const SCHEMA: SchemaDefinition = {
  tables: [
    {
      key: "clients",
      label: "Clients",
      reason: "Who you serve.",
      fields: [
        { key: "name", label: "Name", type: "text" },
        { key: "quoted", label: "Quoted", type: "currency" },
      ],
    },
  ],
};

function asClient(admin: FakeAdmin): SupabaseClient {
  return admin as unknown as SupabaseClient;
}

describe("provisionGeneration — happy path", () => {
  it("mints an org, upserts the schema, and seeds well-formed rows", async () => {
    const admin = new FakeAdmin();
    const seedRows = {
      clients: [
        { name: "Maple Ridge HVAC", quoted: 8400 },
        { name: "Bytown Mechanical", quoted: 1250 },
      ],
    };

    const result = await provisionGeneration(
      { schema: SCHEMA, seedRows },
      asClient(admin),
    );

    // A fresh org id was minted (UUID, not empty).
    expect(result.orgId).toMatch(/[0-9a-f-]{36}/i);
    expect(admin.orgUpserts).toHaveLength(1);
    // Schema persisted with the definition.
    expect(admin.schemaUpserts).toHaveLength(1);
    expect(admin.schemaUpserts[0].definition).toEqual(SCHEMA);
    // Both seed rows written under the minted org.
    expect(admin.records).toHaveLength(2);
    expect(admin.records.every((r) => r.organization_id === result.orgId)).toBe(true);
    expect(admin.records.map((r) => r.data)).toEqual([
      { name: "Maple Ridge HVAC", quoted: 8400 },
      { name: "Bytown Mechanical", quoted: 1250 },
    ]);
    // Stable idempotency keys make re-provisioning safe.
    expect(admin.records.map((r) => r.idempotency_key)).toEqual([
      "gen-seed-clients-0",
      "gen-seed-clients-1",
    ]);
  });

  it("reuses the provided session org id (idempotent per session)", async () => {
    const admin = new FakeAdmin();
    const existing = "11111111-1111-1111-1111-111111111111";

    const result = await provisionGeneration(
      { orgId: existing, schema: SCHEMA, seedRows: { clients: [{ name: "A" }] } },
      asClient(admin),
    );

    expect(result.orgId).toBe(existing);
    expect(admin.orgUpserts[0].id).toBe(existing);
    expect(admin.records[0].organization_id).toBe(existing);
  });
});

describe("provisionGeneration — malformed seedRows never sink the schema", () => {
  it("persists the schema and skips bad rows", async () => {
    const admin = new FakeAdmin();
    const seedRows = {
      clients: [
        { name: "Keep me", quoted: 500 },
        "not an object",
        null,
        { unknown: "dropped" }, // no recognized field keys → dropped
      ],
    };

    const result = await provisionGeneration(
      { schema: SCHEMA, seedRows },
      asClient(admin),
    );

    // Schema still persisted.
    expect(admin.schemaUpserts).toHaveLength(1);
    // Only the one well-formed row survived.
    expect(admin.records).toHaveLength(1);
    expect(admin.records[0].data).toEqual({ name: "Keep me", quoted: 500 });
    expect(result.schema).toEqual(SCHEMA);
  });

  it("persists the schema even when seedRows is entirely absent/invalid", async () => {
    const admin = new FakeAdmin();
    const result = await provisionGeneration(
      { schema: SCHEMA, seedRows: undefined },
      asClient(admin),
    );
    expect(admin.schemaUpserts).toHaveLength(1);
    expect(admin.records).toHaveLength(0);
    expect(result.orgId).toBeTruthy();
  });
});
