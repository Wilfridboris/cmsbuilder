import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import { mutate, type MutateIdentity } from "@/lib/data/mutate";
import type { SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for the Epic 13 retro (A1) select-option membership guard inside
 * `mutate.ts`: a `select` value in an insert/update payload must be a known option
 * `value` token (active OR archived). An off-list token rejects the whole write
 * with the translated `invalidSelectValue` code and NOTHING is persisted. Archived
 * tokens are allowed because an update replaces `records.data` wholesale, so an
 * existing row legitimately carries one. This closes the authed, API-direct hole;
 * the untrusted intake/import surfaces validate against ACTIVE options upstream.
 *
 * The in-memory fake mirrors `mutate-referential-integrity.test.ts`: it serves
 * `getSchema` (org_schemas read) and the records insert/update.
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
      key: "tasks",
      label: "Tasks",
      fields: [
        { key: "title", label: "Title", type: "text" },
        {
          key: "status",
          label: "Status",
          type: "select",
          options: [
            { value: "open", label: "Open" },
            { value: "done", label: "Done" },
            // An archived option: still a KNOWN token (existing rows keep it) but
            // not selectable for new records on the untrusted surfaces.
            { value: "on_hold", label: "On hold", archived: true },
          ],
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
  order() {
    return this;
  }

  private matches(r: Rec): boolean {
    if (!this.filters.every((f) => r[f.col] === f.val)) return false;
    if (!this.nullCols.every((c) => r[c] === null)) return false;
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
}

function identityFor(client: FakeClient): MutateIdentity {
  return { client: client as unknown as SupabaseClient, actorId: ACTOR, orgId: ORG };
}

function client() {
  return new FakeClient([
    {
      id: "t1",
      organization_id: ORG,
      table_key: "tasks",
      data: { title: "Task", status: "on_hold" },
      version: 1,
      deleted_at: null,
    },
  ]);
}

describe("mutate select-option membership — insert", () => {
  it("accepts an insert whose select value is an active option token", async () => {
    const c = client();
    const res = await mutate(identityFor(c), "insert", "tasks", { title: "New", status: "open" }, {
      idempotencyKey: "k1",
    });
    expect(res.error).toBeNull();
    expect(res.data).not.toBeNull();
    expect(c.rows.some((r) => r.data.title === "New" && r.data.status === "open")).toBe(true);
  });

  it("rejects an off-list select token with invalidSelectValue and writes nothing", async () => {
    const c = client();
    const before = c.rows.length;
    const res = await mutate(identityFor(c), "insert", "tasks", { title: "Bad", status: "nope" }, {
      idempotencyKey: "k2",
    });
    expect(res.data).toBeNull();
    expect(res.error).toBe("invalidSelectValue");
    expect(c.rows.length).toBe(before);
  });

  it("accepts a blank select value (omitted — nothing to verify)", async () => {
    const c = client();
    const res = await mutate(identityFor(c), "insert", "tasks", { title: "Blank", status: "" }, {
      idempotencyKey: "k3",
    });
    expect(res.error).toBeNull();
  });

  it("accepts an archived option token on insert (a known token)", async () => {
    const c = client();
    const res = await mutate(identityFor(c), "insert", "tasks", { title: "Hold", status: "on_hold" }, {
      idempotencyKey: "k4",
    });
    expect(res.error).toBeNull();
  });
});

describe("mutate select-option membership — update", () => {
  it("accepts an update that carries an existing archived token while changing another field", async () => {
    const c = client();
    // Wholesale update: the row already holds the archived `on_hold` token; editing
    // the title must not be rejected just because that token is archived.
    const res = await mutate(
      identityFor(c),
      "update",
      "tasks",
      { title: "Renamed", status: "on_hold" },
      { recordId: "t1", expectedVersion: 1 },
    );
    expect(res.error).toBeNull();
    expect(res.data).toEqual({ id: "t1", version: 2 });
  });

  it("rejects an update planting an off-list token and leaves the row unchanged", async () => {
    const c = client();
    const res = await mutate(
      identityFor(c),
      "update",
      "tasks",
      { title: "Task", status: "nope" },
      { recordId: "t1", expectedVersion: 1 },
    );
    expect(res.error).toBe("invalidSelectValue");
    const t1 = c.rows.find((r) => r.id === "t1")!;
    expect(t1.version).toBe(1);
    expect(t1.data.status).toBe("on_hold");
  });
});
