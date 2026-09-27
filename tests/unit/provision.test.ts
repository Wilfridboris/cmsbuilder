import { describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { provisionGeneration } from "@/lib/generation/provision";
import {
  FALLBACK_SEED_ROWS,
  UNIVERSAL_FIELD_SERVICE_TEMPLATE,
} from "@/lib/generation/fallback";
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
      // Story 3.8: the guarded insert reads back the org schema (referential
      // integrity guard), so `org_schemas` must support upsert AND the
      // `.select().eq().maybeSingle()` read that `getSchema` issues, returning
      // the most recently upserted definition.
      return new SchemaQuery((payload) => this.schemaUpserts.push(payload), () =>
        this.schemaUpserts.length > 0
          ? (this.schemaUpserts[this.schemaUpserts.length - 1].definition ?? null)
          : null,
      );
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

/** `org_schemas`: records upserts AND serves `getSchema`'s read (Story 3.8). */
class SchemaQuery {
  constructor(
    private readonly record: (payload: Record<string, unknown>) => void,
    private readonly readDefinition: () => unknown,
  ) {}
  upsert(payload: Record<string, unknown>) {
    this.record(payload);
    return Promise.resolve({ error: null });
  }
  select() {
    return this;
  }
  eq() {
    return this;
  }
  maybeSingle() {
    return Promise.resolve({
      data: { definition: this.readDefinition() },
      error: null,
    });
  }
}

type Filter = { col: keyof RecordRow; val: unknown };

class RecordsQuery {
  private mode: "select" | "insert" = "select";
  private filters: Filter[] = [];
  private insertPayload: Partial<RecordRow> | null = null;
  private inFilter: { col: keyof RecordRow; vals: unknown[] } | null = null;

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
  in(col: keyof RecordRow, vals: unknown[]) {
    this.inFilter = { col, vals };
    return this;
  }
  order() {
    return this;
  }

  private matches(row: RecordRow): boolean {
    if (!this.filters.every((f) => row[f.col] === f.val)) return false;
    if (this.inFilter && !this.inFilter.vals.includes(row[this.inFilter.col])) {
      return false;
    }
    return true;
  }

  // The Story 3.8 referential-integrity guard terminates its verification query
  // by awaiting after `.in("id", ids)`. Resolve the matching rows' ids.
  then<T>(resolve: (value: { data: unknown[]; error: null }) => T) {
    const data = this.admin.records
      .filter((r) => this.matches(r))
      .map((r) => ({ id: r.id }));
    return Promise.resolve(resolve({ data, error: null }));
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

/**
 * Story 1.8: provisioning defaults each table's `displayField` (first non-hidden
 * text field, else first non-hidden field). `SCHEMA` above omits it, so the
 * persisted definition + returned schema gain `displayField: "name"`.
 */
const SCHEMA_WITH_DISPLAY: SchemaDefinition = {
  tables: [{ ...SCHEMA.tables[0], displayField: "name" }],
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
    // Schema persisted with the definition (displayField defaulted, Story 1.8).
    expect(admin.schemaUpserts).toHaveLength(1);
    expect(admin.schemaUpserts[0].definition).toEqual(SCHEMA_WITH_DISPLAY);
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

  it("uses a custom idempotency-key prefix when provided (Story 1.5 fallback)", async () => {
    const admin = new FakeAdmin();

    await provisionGeneration(
      {
        schema: SCHEMA,
        seedRows: { clients: [{ name: "A" }, { name: "B" }] },
        idempotencyPrefix: "fallback",
      },
      asClient(admin),
    );

    // Fallback rows key on `fallback-*`, never `gen-seed-*` — so they can't
    // collide with a prior real generation's rows in a reused session org.
    expect(admin.records.map((r) => r.idempotency_key)).toEqual([
      "fallback-clients-0",
      "fallback-clients-1",
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
    expect(result.schema).toEqual(SCHEMA_WITH_DISPLAY);
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

describe("provisionGeneration — Story 1.8: relations resolve to target ids", () => {
  const LINKED_SCHEMA: SchemaDefinition = {
    tables: [
      // Declared referencing-first to prove insert-order handling.
      {
        key: "jobs",
        label: "Jobs",
        displayField: "service",
        fields: [
          { key: "service", label: "Service", type: "text" },
          {
            key: "client",
            label: "Client",
            type: "relation",
            relationConfig: { targetTable: "clients", cardinality: "one" },
          },
        ],
      },
      {
        key: "clients",
        label: "Clients",
        displayField: "name",
        fields: [{ key: "name", label: "Name", type: "text" }],
      },
    ],
  };

  it("inserts referenced tables first and rewrites relation values to inserted ids", async () => {
    const admin = new FakeAdmin();
    const seedRows = {
      clients: [{ name: "Maple Ridge" }, { name: "Bytown" }],
      jobs: [
        { service: "HVAC", client: "Maple Ridge" },
        { service: "Cooler repair", client: "Bytown" },
        { service: "Orphan", client: "Unknown Co" }, // unresolved → value dropped
      ],
    };

    await provisionGeneration(
      { schema: LINKED_SCHEMA, seedRows },
      asClient(admin),
    );

    // Clients seeded before jobs (referenced-first).
    const clientRows = admin.records.filter((r) => r.table_key === "clients");
    const jobRows = admin.records.filter((r) => r.table_key === "jobs");
    expect(clientRows).toHaveLength(2);
    expect(jobRows).toHaveLength(3);
    expect(admin.records.slice(0, 2).every((r) => r.table_key === "clients")).toBe(
      true,
    );

    // The jobs' `client` now holds the target client's inserted id, not the name.
    const mapleId = clientRows.find((r) => r.data.name === "Maple Ridge")!.id;
    const bytownId = clientRows.find((r) => r.data.name === "Bytown")!.id;
    expect(jobRows[0].data.client).toBe(mapleId);
    expect(jobRows[1].data.client).toBe(bytownId);
    // The unresolved reference was dropped; the row still wrote.
    expect(jobRows[2].data.client).toBeUndefined();
    expect(jobRows[2].data.service).toBe("Orphan");
  });

  it("resolves every relation in the real fallback template end-to-end (no dropped refs)", async () => {
    const admin = new FakeAdmin();

    await provisionGeneration(
      {
        schema: UNIVERSAL_FIELD_SERVICE_TEMPLATE,
        seedRows: FALLBACK_SEED_ROWS,
      },
      asClient(admin),
    );

    const clientRows = admin.records.filter((r) => r.table_key === "clients");
    const jobRows = admin.records.filter((r) => r.table_key === "jobs");
    const invoiceRows = admin.records.filter((r) => r.table_key === "invoices");

    // Every fallback seed row was written (nothing sunk).
    expect(clientRows.length).toBe(FALLBACK_SEED_ROWS.clients.length);
    expect(jobRows.length).toBe(FALLBACK_SEED_ROWS.jobs.length);
    expect(invoiceRows.length).toBe(FALLBACK_SEED_ROWS.invoices.length);

    const clientIds = new Set(clientRows.map((r) => r.id));
    const jobIds = new Set(jobRows.map((r) => r.id));

    // Every jobs.client resolved to a real client id — not a leftover name, not dropped.
    for (const job of jobRows) {
      expect(typeof job.data.client).toBe("string");
      expect(clientIds.has(job.data.client as string)).toBe(true);
    }
    // Every invoices.job resolved to a real job id — Invoice->Job links intact.
    for (const invoice of invoiceRows) {
      expect(typeof invoice.data.job).toBe("string");
      expect(jobIds.has(invoice.data.job as string)).toBe(true);
    }
  });
});
