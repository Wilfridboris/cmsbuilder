import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { mutate, type MutateIdentity } from "@/lib/data/mutate";
import { listRecords } from "@/lib/data/records";

/**
 * Unit coverage for the I/O-matrix mechanics that don't need a real DB
 * (Story 1.2). A fake Supabase query builder stands in for the client so we can
 * assert the guarded-layer logic: optimistic-concurrency rejection, idempotency
 * de-dupe, and soft-delete exclusion from reads. The RLS *isolation* behaviour
 * is proven separately by `tests/integration/rls-isolation.test.ts`.
 */

type Row = {
  id: string;
  organization_id: string;
  table_key: string;
  data: Record<string, unknown>;
  actor_id: string | null;
  idempotency_key: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

/**
 * Minimal in-memory fake of the subset of the Supabase JS builder that
 * `mutate.ts` / `records.ts` use. Supports `.from().select()/.insert()/
 * .update()` chained with `.eq()/.is()/.order()` and terminated by
 * `.single()/.maybeSingle()` or awaiting the thenable (list read).
 */
class FakeClient {
  rows: Row[];
  private seq = 0;

  constructor(initial: Row[] = []) {
    this.rows = initial;
  }

  from(table: string) {
    if (table !== "records") {
      throw new Error(`unexpected table: ${table}`);
    }
    return new FakeQuery(this);
  }

  nextId(): string {
    this.seq += 1;
    return `row-${this.seq}`;
  }
}

type Filter = { col: keyof Row; val: unknown };

class FakeQuery {
  private mode: "select" | "insert" | "update" = "select";
  private filters: Filter[] = [];
  private nullFilters: Array<keyof Row> = [];
  private insertPayload: Partial<Row> | null = null;
  private updatePayload: Partial<Row> | null = null;

  constructor(private readonly client: FakeClient) {}

  select() {
    return this;
  }

  insert(payload: Partial<Row>) {
    this.mode = "insert";
    this.insertPayload = payload;
    return this;
  }

  update(payload: Partial<Row>) {
    this.mode = "update";
    this.updatePayload = payload;
    return this;
  }

  eq(col: keyof Row, val: unknown) {
    this.filters.push({ col, val });
    return this;
  }

  is(col: keyof Row, val: null) {
    if (val === null) this.nullFilters.push(col);
    return this;
  }

  order() {
    return this;
  }

  private matches(row: Row): boolean {
    return (
      this.filters.every((f) => row[f.col] === f.val) &&
      this.nullFilters.every((c) => row[c] === null)
    );
  }

  private commitInsert(): Row {
    const now = new Date().toISOString();
    const row: Row = {
      id: this.client.nextId(),
      organization_id: (this.insertPayload!.organization_id as string) ?? "",
      table_key: (this.insertPayload!.table_key as string) ?? "",
      data: (this.insertPayload!.data as Record<string, unknown>) ?? {},
      actor_id: (this.insertPayload!.actor_id as string | null) ?? null,
      idempotency_key: (this.insertPayload!.idempotency_key as string | null) ?? null,
      version: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    };
    this.client.rows.push(row);
    return row;
  }

  private commitUpdate(): Row | null {
    const target = this.client.rows.find((r) => this.matches(r));
    if (!target) return null;
    Object.assign(target, this.updatePayload);
    return target;
  }

  single() {
    if (this.mode === "insert") {
      const row = this.commitInsert();
      return Promise.resolve({ data: { id: row.id, version: row.version }, error: null });
    }
    return this.maybeSingle();
  }

  maybeSingle() {
    if (this.mode === "insert") {
      const row = this.commitInsert();
      return Promise.resolve({ data: { id: row.id, version: row.version }, error: null });
    }
    if (this.mode === "update") {
      const row = this.commitUpdate();
      return Promise.resolve({
        data: row ? { id: row.id, version: row.version } : null,
        error: null,
      });
    }
    const row = this.client.rows.find((r) => this.matches(r)) ?? null;
    return Promise.resolve({
      data: row ? { id: row.id, version: row.version } : null,
      error: null,
    });
  }

  // Awaiting the query (list read) resolves the filtered rows.
  then<T>(resolve: (value: { data: unknown[]; error: null }) => T) {
    const data = this.client.rows
      .filter((r) => this.matches(r))
      .map((r) => ({ id: r.id, version: r.version, data: r.data }));
    return Promise.resolve(resolve({ data, error: null }));
  }
}

const ORG = "org-a";
const ACTOR = "actor-1";

function identityFor(client: FakeClient): MutateIdentity {
  return { client: client as unknown as SupabaseClient, actorId: ACTOR, orgId: ORG };
}

describe("mutate — optimistic concurrency", () => {
  it("rejects a stale expectedVersion with a 409-style concurrency error", async () => {
    const client = new FakeClient([
      makeRow({ id: "r1", version: 3 }),
    ]);
    const res = await mutate(identityFor(client), "update", "clients", { name: "x" }, {
      recordId: "r1",
      expectedVersion: 2, // stale — row is at v3
    });
    expect(res.data).toBeNull();
    expect(res.error).toMatch(/refresh/i);
  });

  it("succeeds and bumps version when expectedVersion matches", async () => {
    const client = new FakeClient([makeRow({ id: "r1", version: 1 })]);
    const res = await mutate(identityFor(client), "update", "clients", { name: "x" }, {
      recordId: "r1",
      expectedVersion: 1,
    });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ id: "r1", version: 2 });
  });
});

describe("mutate — idempotency", () => {
  it("de-dupes an insert re-sent with the same idempotencyKey", async () => {
    const client = new FakeClient();
    const opts = { idempotencyKey: "k-1" };

    const first = await mutate(identityFor(client), "insert", "clients", { name: "a" }, opts);
    const second = await mutate(identityFor(client), "insert", "clients", { name: "a" }, opts);

    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    expect(second.data).toEqual(first.data);
    // Only one physical row written.
    expect(client.rows.length).toBe(1);
  });

  it("writes distinct rows for distinct keys", async () => {
    const client = new FakeClient();
    await mutate(identityFor(client), "insert", "clients", { name: "a" }, { idempotencyKey: "k-1" });
    await mutate(identityFor(client), "insert", "clients", { name: "b" }, { idempotencyKey: "k-2" });
    expect(client.rows.length).toBe(2);
  });
});

describe("mutate — soft delete", () => {
  it("sets deleted_at and excludes the row from reads", async () => {
    const client = new FakeClient([makeRow({ id: "r1", version: 1 })]);

    const del = await mutate(identityFor(client), "delete", "clients", {}, {
      recordId: "r1",
      expectedVersion: 1,
    });
    expect(del.error).toBeNull();
    expect(client.rows[0].deleted_at).not.toBeNull();

    const read = await listRecords(client as unknown as SupabaseClient, ORG, "clients");
    expect(read.error).toBeNull();
    expect(read.data).toEqual([]);
  });

  it("rejects a stale expectedVersion on delete without soft-deleting", async () => {
    const client = new FakeClient([makeRow({ id: "r1", version: 3 })]);

    const del = await mutate(identityFor(client), "delete", "clients", {}, {
      recordId: "r1",
      expectedVersion: 2, // stale — row is at v3
    });
    expect(del.data).toBeNull();
    expect(del.error).toMatch(/refresh/i);
    // A stale delete must NOT soft-delete the row.
    expect(client.rows[0].deleted_at).toBeNull();
  });
});

function makeRow(overrides: Partial<Row>): Row {
  const now = new Date().toISOString();
  return {
    id: "r1",
    organization_id: ORG,
    table_key: "clients",
    data: { name: "seed" },
    actor_id: ACTOR,
    idempotency_key: null,
    version: 1,
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...overrides,
  };
}
