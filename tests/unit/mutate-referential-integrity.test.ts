import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { mutate, type MutateIdentity } from "@/lib/data/mutate";
import type { SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for the Story 3.8 referential-integrity guard inside `mutate.ts`
 * (AC5): every relation id in an insert/update payload must resolve to a LIVE row
 * under the same org + target table, else the whole write is rejected with the
 * translated `invalidReference` code and NOTHING is persisted.
 *
 * A small in-memory fake stands in for the RLS-scoped client: it serves `getSchema`
 * (org_schemas read), the guard's `.in("id", ids)` verification query (scoped by
 * org + table_key + deleted_at, so a foreign-org / soft-deleted / wrong-table id
 * simply does not come back), and the records insert/update themselves.
 */

const ORG = "org-a";
const ACTOR = "actor-1";

type Rec = {
  id: string;
  organization_id: string;
  table_key: string;
  data: Record<string, unknown>;
  version: number;
  deleted_at: string | null;
};

const SCHEMA: SchemaDefinition = {
  tables: [
    {
      key: "clients",
      label: "Clients",
      fields: [{ key: "name", label: "Name", type: "text" }],
    },
    {
      key: "jobs",
      label: "Jobs",
      fields: [
        { key: "title", label: "Title", type: "text" },
        {
          key: "client",
          label: "Client",
          type: "relation",
          relationConfig: { targetTable: "clients", cardinality: "one" },
        },
        // A SECOND relation field on the same table, targeting the SAME table
        // (clients) — exercises the guard's group-by-target batching (both ids
        // verified in ONE `.in("id", ids)` query).
        {
          key: "lead",
          label: "Lead",
          type: "relation",
          relationConfig: { targetTable: "clients", cardinality: "one" },
        },
      ],
    },
  ],
};

class FakeClient {
  rows: Rec[];
  private seq = 0;
  constructor(initial: Rec[]) {
    this.rows = initial;
  }
  from(table: string) {
    if (table === "org_schemas") return new SchemaQuery();
    if (table === "records") return new RecordsQuery(this);
    throw new Error(`unexpected table: ${table}`);
  }
  nextId() {
    this.seq += 1;
    return `new-${this.seq}`;
  }
}

class SchemaQuery {
  select() {
    return this;
  }
  eq() {
    return this;
  }
  maybeSingle() {
    return Promise.resolve({ data: { definition: SCHEMA }, error: null });
  }
}

type Filter = { col: keyof Rec; val: unknown };

class RecordsQuery {
  private mode: "select" | "insert" | "update" = "select";
  private filters: Filter[] = [];
  private nullCols: Array<keyof Rec> = [];
  private inFilter: { col: keyof Rec; vals: unknown[] } | null = null;
  private insertPayload: Partial<Rec> | null = null;
  private updatePayload: Partial<Rec> | null = null;

  constructor(private readonly client: FakeClient) {}

  select() {
    return this;
  }
  insert(payload: Partial<Rec>) {
    this.mode = "insert";
    this.insertPayload = payload;
    return this;
  }
  update(payload: Partial<Rec>) {
    this.mode = "update";
    this.updatePayload = payload;
    return this;
  }
  eq(col: keyof Rec, val: unknown) {
    this.filters.push({ col, val });
    return this;
  }
  is(col: keyof Rec, _val: null) {
    this.nullCols.push(col);
    return this;
  }
  in(col: keyof Rec, vals: unknown[]) {
    this.inFilter = { col, vals };
    return this;
  }
  order() {
    return this;
  }

  private matches(r: Rec): boolean {
    if (!this.filters.every((f) => r[f.col] === f.val)) return false;
    if (!this.nullCols.every((c) => r[c] === null)) return false;
    if (this.inFilter && !this.inFilter.vals.includes(r[this.inFilter.col])) {
      return false;
    }
    return true;
  }

  single() {
    if (this.mode === "insert") {
      const row = this.commitInsert();
      return Promise.resolve({ data: { id: row.id, version: row.version }, error: null });
    }
    return this.maybeSingle();
  }
  maybeSingle() {
    if (this.mode === "update") {
      const row = this.client.rows.find((r) => this.matches(r));
      if (!row) return Promise.resolve({ data: null, error: null });
      Object.assign(row, this.updatePayload);
      return Promise.resolve({ data: { id: row.id, version: row.version }, error: null });
    }
    const row = this.client.rows.find((r) => this.matches(r)) ?? null;
    return Promise.resolve({
      data: row ? { id: row.id, version: row.version } : null,
      error: null,
    });
  }

  private commitInsert(): Rec {
    const row: Rec = {
      id: this.client.nextId(),
      organization_id: (this.insertPayload!.organization_id as string) ?? "",
      table_key: (this.insertPayload!.table_key as string) ?? "",
      data: (this.insertPayload!.data as Record<string, unknown>) ?? {},
      version: 1,
      deleted_at: null,
    };
    this.client.rows.push(row);
    return row;
  }

  // The guard's verification query terminates by awaiting after `.in`.
  then<T>(resolve: (v: { data: unknown[]; error: null }) => T) {
    const data = this.client.rows
      .filter((r) => this.matches(r))
      .map((r) => ({ id: r.id }));
    return Promise.resolve(resolve({ data, error: null }));
  }
}

function identityFor(client: FakeClient): MutateIdentity {
  return { client: client as unknown as SupabaseClient, actorId: ACTOR, orgId: ORG };
}

function client() {
  return new FakeClient([
    // A live client the picker would offer.
    { id: "c1", organization_id: ORG, table_key: "clients", data: { name: "Alpha" }, version: 1, deleted_at: null },
    // A soft-deleted client.
    { id: "c-del", organization_id: ORG, table_key: "clients", data: { name: "Gone" }, version: 1, deleted_at: "2026-01-01" },
    // A client belonging to another org (RLS would hide it; our fake scopes by org).
    { id: "c-foreign", organization_id: "org-b", table_key: "clients", data: { name: "Foreign" }, version: 1, deleted_at: null },
    // A row in the wrong table with an id a caller might plant.
    { id: "j-wrong", organization_id: ORG, table_key: "jobs", data: { title: "X" }, version: 1, deleted_at: null },
    // A job to update.
    { id: "j1", organization_id: ORG, table_key: "jobs", data: { title: "Job", client: "c1" }, version: 1, deleted_at: null },
  ]);
}

describe("mutate referential integrity — insert", () => {
  it("accepts an insert whose relation id points at a live target", async () => {
    const c = client();
    const res = await mutate(identityFor(c), "insert", "jobs", { title: "New", client: "c1" }, {
      idempotencyKey: "k1",
    });
    expect(res.error).toBeNull();
    expect(res.data).not.toBeNull();
    expect(c.rows.some((r) => r.table_key === "jobs" && r.data.title === "New")).toBe(true);
  });

  it("rejects a dangling relation id with invalidReference and writes nothing", async () => {
    const c = client();
    const before = c.rows.length;
    const res = await mutate(identityFor(c), "insert", "jobs", { title: "Bad", client: "nope" }, {
      idempotencyKey: "k2",
    });
    expect(res.data).toBeNull();
    expect(res.error).toBe("invalidReference");
    expect(c.rows.length).toBe(before);
  });

  it("rejects a soft-deleted target id", async () => {
    const c = client();
    const res = await mutate(identityFor(c), "insert", "jobs", { title: "Bad", client: "c-del" }, {
      idempotencyKey: "k3",
    });
    expect(res.error).toBe("invalidReference");
  });

  it("rejects a foreign-org target id", async () => {
    const c = client();
    const res = await mutate(identityFor(c), "insert", "jobs", { title: "Bad", client: "c-foreign" }, {
      idempotencyKey: "k4",
    });
    expect(res.error).toBe("invalidReference");
  });

  it("rejects a wrong-table target id (a jobs id used where a clients id is required)", async () => {
    const c = client();
    const res = await mutate(identityFor(c), "insert", "jobs", { title: "Bad", client: "j-wrong" }, {
      idempotencyKey: "k5",
    });
    expect(res.error).toBe("invalidReference");
  });

  it("accepts an insert with an empty/omitted relation value (nothing to verify)", async () => {
    const c = client();
    const res = await mutate(identityFor(c), "insert", "jobs", { title: "No client" }, {
      idempotencyKey: "k6",
    });
    expect(res.error).toBeNull();
  });

  it("accepts an insert with TWO relation fields (same target) both pointing at live rows", async () => {
    const c = client();
    // client + lead both target `clients` and both point at the same live row —
    // the guard batches them into one `.in(["c1"])` verification.
    const res = await mutate(
      identityFor(c),
      "insert",
      "jobs",
      { title: "Two links", client: "c1", lead: "c1" },
      { idempotencyKey: "k7" },
    );
    expect(res.error).toBeNull();
    expect(res.data).not.toBeNull();
    expect(
      c.rows.some((r) => r.table_key === "jobs" && r.data.title === "Two links"),
    ).toBe(true);
  });

  it("rejects the WHOLE write when one of two relation fields is dangling", async () => {
    const c = client();
    const before = c.rows.length;
    // client is valid, lead is dangling — the batched target check finds only 1 of
    // 2 ids, so the entire write is rejected and nothing is persisted.
    const res = await mutate(
      identityFor(c),
      "insert",
      "jobs",
      { title: "Half bad", client: "c1", lead: "nope" },
      { idempotencyKey: "k8" },
    );
    expect(res.data).toBeNull();
    expect(res.error).toBe("invalidReference");
    expect(c.rows.length).toBe(before);
  });
});

describe("mutate referential integrity — update", () => {
  it("accepts an update whose relation id points at a live target", async () => {
    const c = client();
    const res = await mutate(identityFor(c), "update", "jobs", { title: "Job", client: "c1" }, {
      recordId: "j1",
      expectedVersion: 1,
    });
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ id: "j1", version: 2 });
  });

  it("rejects an update planting a dangling relation id and leaves the row unchanged", async () => {
    const c = client();
    const res = await mutate(identityFor(c), "update", "jobs", { title: "Job", client: "nope" }, {
      recordId: "j1",
      expectedVersion: 1,
    });
    expect(res.error).toBe("invalidReference");
    const j1 = c.rows.find((r) => r.id === "j1")!;
    expect(j1.version).toBe(1);
    expect(j1.data.client).toBe("c1");
  });
});
