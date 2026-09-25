import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  createPendingClaim,
  finalizeClaim,
  ClaimError,
  PENDING_CLAIM_TTL_MS,
} from "@/lib/claim/claim";
import { deriveSlug, ensureUniqueSlug } from "@/lib/claim/slug";
import type { SchemaDefinition } from "@/types/db";

/**
 * Unit coverage for the claim bootstrap (Story 2.1) WITHOUT a real DB. Locks the
 * frozen I/O-matrix guardrails at the logic layer:
 *   - createPendingClaim persists the overridden schema + inserts a token row;
 *   - finalizeClaim inserts an admin membership, sets a unique slug, and clears
 *     the synthetic records;
 *   - re-finalize with a consumed token is an idempotent no-op;
 *   - an expired / unknown token surfaces a ClaimError (re-request path);
 *   - slug derivation + collision suffixing.
 *
 * The consent-false / invalid-email / missing-session rejections are enforced at
 * the route's Zod + cookie layer (see the route); this suite covers the bootstrap
 * that runs only AFTER those gates pass, plus the pure slug logic.
 */

type OrgRow = { id: string; name: string; slug: string };
type MemberRow = {
  organization_id: string;
  user_id: string;
  principal_type: string;
  role: string;
};
type ClaimRow = {
  id: string;
  token: string;
  email: string;
  session_org_id: string;
  consent_accepted_at: string;
  policy_version: string;
  slug_base: string;
  expires_at: string;
  consumed_at: string | null;
};
type RecRow = {
  id: string;
  organization_id: string;
  deleted_at: string | null;
};

/**
 * Minimal fake Supabase admin client covering exactly the query shapes claim.ts
 * + slug.ts issue: upsert (org_schemas), insert (pending_claims, org_members),
 * select/maybeSingle (pending_claims, organizations), update (organizations,
 * records, pending_claims).
 */
class FakeAdmin {
  orgs: OrgRow[] = [];
  members: MemberRow[] = [];
  claims: ClaimRow[] = [];
  records: RecRow[] = [];
  schemaUpserts: Array<Record<string, unknown>> = [];

  from(table: string) {
    switch (table) {
      case "org_schemas":
        return new SchemaQuery(this);
      case "pending_claims":
        return new PendingClaimsQuery(this);
      case "org_members":
        return new MembersQuery(this);
      case "organizations":
        return new OrgsQuery(this);
      case "records":
        return new RecordsQuery(this);
      default:
        throw new Error(`unexpected table: ${table}`);
    }
  }
}

class SchemaQuery {
  constructor(private readonly db: FakeAdmin) {}
  upsert(payload: Record<string, unknown>) {
    this.db.schemaUpserts.push(payload);
    return Promise.resolve({ error: null });
  }
}

class PendingClaimsQuery {
  private filters: Array<{ col: keyof ClaimRow; val: unknown }> = [];
  private updatePayload: Partial<ClaimRow> | null = null;
  constructor(private readonly db: FakeAdmin) {}

  insert(payload: ClaimRow) {
    this.db.claims.push({ ...payload, consumed_at: payload.consumed_at ?? null });
    return Promise.resolve({ error: null });
  }
  select() {
    return this;
  }
  eq(col: keyof ClaimRow, val: unknown) {
    this.filters.push({ col, val });
    if (this.updatePayload) return this.applyUpdate();
    return this;
  }
  update(payload: Partial<ClaimRow>) {
    this.updatePayload = payload;
    return this;
  }
  private applyUpdate() {
    for (const row of this.db.claims) {
      if (this.filters.every((f) => row[f.col] === f.val)) {
        Object.assign(row, this.updatePayload);
      }
    }
    return Promise.resolve({ error: null });
  }
  maybeSingle() {
    const row =
      this.db.claims.find((r) =>
        this.filters.every((f) => r[f.col] === f.val),
      ) ?? null;
    return Promise.resolve({ data: row, error: null });
  }
}

class MembersQuery {
  constructor(private readonly db: FakeAdmin) {}
  insert(payload: MemberRow) {
    const dup = this.db.members.some(
      (m) =>
        m.organization_id === payload.organization_id &&
        m.user_id === payload.user_id,
    );
    if (dup) {
      return Promise.resolve({ error: { code: "23505", message: "duplicate" } });
    }
    this.db.members.push(payload);
    return Promise.resolve({ error: null });
  }
}

class OrgsQuery {
  private filters: Array<{ col: keyof OrgRow; val: unknown }> = [];
  private neqFilters: Array<{ col: keyof OrgRow; val: unknown }> = [];
  private mode: "select" | "update" = "select";
  private updatePayload: Partial<OrgRow> | null = null;
  constructor(private readonly db: FakeAdmin) {}

  select() {
    this.mode = "select";
    return this;
  }
  update(payload: Partial<OrgRow>) {
    this.mode = "update";
    this.updatePayload = payload;
    return this;
  }
  eq(col: keyof OrgRow, val: unknown) {
    this.filters.push({ col, val });
    if (this.mode === "update") return this.applyUpdate();
    return this;
  }
  neq(col: keyof OrgRow, val: unknown) {
    this.neqFilters.push({ col, val });
    return this;
  }
  limit() {
    return this;
  }
  private matches(row: OrgRow): boolean {
    return (
      this.filters.every((f) => row[f.col] === f.val) &&
      this.neqFilters.every((f) => row[f.col] !== f.val)
    );
  }
  private applyUpdate() {
    for (const row of this.db.orgs) {
      if (this.matches(row)) Object.assign(row, this.updatePayload);
    }
    return Promise.resolve({ error: null });
  }
  maybeSingle() {
    const row = this.db.orgs.find((r) => this.matches(r)) ?? null;
    return Promise.resolve({ data: row, error: null });
  }
}

class RecordsQuery {
  private filters: Array<{ col: keyof RecRow; val: unknown }> = [];
  private isNullCol: keyof RecRow | null = null;
  private updatePayload: Partial<RecRow> | null = null;
  constructor(private readonly db: FakeAdmin) {}

  update(payload: Partial<RecRow>) {
    this.updatePayload = payload;
    return this;
  }
  eq(col: keyof RecRow, val: unknown) {
    this.filters.push({ col, val });
    return this;
  }
  is(col: keyof RecRow, _val: null) {
    this.isNullCol = col;
    // is(...) is the terminal call in claim.ts's clear step.
    for (const row of this.db.records) {
      const matchesEq = this.filters.every((f) => row[f.col] === f.val);
      const matchesNull = this.isNullCol ? row[this.isNullCol] === null : true;
      if (matchesEq && matchesNull) Object.assign(row, this.updatePayload);
    }
    return Promise.resolve({ error: null });
  }
}

function asClient(db: FakeAdmin): SupabaseClient {
  return db as unknown as SupabaseClient;
}

const SCHEMA: SchemaDefinition = {
  tables: [
    {
      key: "clients",
      label: "Clients",
      fields: [{ key: "name", label: "Name", type: "text" }],
    },
  ],
};

const ORG_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";

function seedOrg(db: FakeAdmin) {
  db.orgs.push({ id: ORG_ID, name: "Session", slug: `session-${ORG_ID.slice(0, 8)}` });
}

// --- deriveSlug / ensureUniqueSlug -----------------------------------------

describe("deriveSlug", () => {
  it("kebab-cases trade + city", () => {
    expect(deriveSlug({ tradeType: "plumbing", city: "Laval" })).toBe(
      "plumbing-laval",
    );
  });
  it("strips accents and collapses separators", () => {
    expect(deriveSlug({ tradeType: "electrical", city: "Montréal Est" })).toBe(
      "electrical-montreal-est",
    );
  });
  it("falls back to a safe base when nothing usable", () => {
    expect(deriveSlug({ tradeType: "", city: "" })).toBe("app");
  });
});

describe("ensureUniqueSlug", () => {
  it("returns the base when free", async () => {
    const db = new FakeAdmin();
    expect(await ensureUniqueSlug(asClient(db), "plumbing-laval")).toBe(
      "plumbing-laval",
    );
  });
  it("suffixes -2, -3 on collision", async () => {
    const db = new FakeAdmin();
    db.orgs.push({ id: "a", name: "A", slug: "plumbing-laval" });
    db.orgs.push({ id: "b", name: "B", slug: "plumbing-laval-2" });
    expect(await ensureUniqueSlug(asClient(db), "plumbing-laval")).toBe(
      "plumbing-laval-3",
    );
  });
  it("ignores the claiming org's own row", async () => {
    const db = new FakeAdmin();
    db.orgs.push({ id: ORG_ID, name: "self", slug: "plumbing-laval" });
    expect(
      await ensureUniqueSlug(asClient(db), "plumbing-laval", ORG_ID),
    ).toBe("plumbing-laval");
  });
});

// --- createPendingClaim -----------------------------------------------------

describe("createPendingClaim", () => {
  it("persists the overridden schema and inserts a token row", async () => {
    const db = new FakeAdmin();
    seedOrg(db);
    const { token } = await createPendingClaim(
      {
        sessionOrgId: ORG_ID,
        email: "owner@example.ca",
        schema: SCHEMA,
        consentAt: new Date("2026-09-24T12:00:00Z"),
        policyVersion: "2026-09-24",
        slugBase: "plumbing-laval",
      },
      asClient(db),
    );

    expect(token).toBeTruthy();
    // Overridden schema written to org_schemas.
    expect(db.schemaUpserts).toHaveLength(1);
    expect(db.schemaUpserts[0].definition).toEqual(SCHEMA);
    // Token row carries email, consent timestamp, slug base, and an expiry.
    expect(db.claims).toHaveLength(1);
    const row = db.claims[0];
    expect(row.token).toBe(token);
    expect(row.email).toBe("owner@example.ca");
    expect(row.consent_accepted_at).toBe("2026-09-24T12:00:00.000Z");
    expect(row.slug_base).toBe("plumbing-laval");
    expect(row.consumed_at).toBeNull();
    expect(new Date(row.expires_at).getTime()).toBeGreaterThan(Date.now());
  });
});

// --- finalizeClaim ----------------------------------------------------------

function seedClaim(db: FakeAdmin, overrides: Partial<ClaimRow> = {}): string {
  const token = overrides.token ?? "tok-abc";
  db.claims.push({
    id: "claim-1",
    token,
    email: "owner@example.ca",
    session_org_id: ORG_ID,
    consent_accepted_at: new Date().toISOString(),
    policy_version: "2026-09-24",
    slug_base: "plumbing-laval",
    expires_at: new Date(Date.now() + PENDING_CLAIM_TTL_MS).toISOString(),
    consumed_at: null,
    ...overrides,
  });
  return token;
}

describe("finalizeClaim", () => {
  it("inserts admin membership, sets a unique slug, clears synthetic records", async () => {
    const db = new FakeAdmin();
    seedOrg(db);
    const token = seedClaim(db);
    db.records.push({ id: "r1", organization_id: ORG_ID, deleted_at: null });
    db.records.push({ id: "r2", organization_id: ORG_ID, deleted_at: null });

    const { slug } = await finalizeClaim({
      token,
      userId: USER_ID,
      adminClient: asClient(db),
    });

    expect(slug).toBe("plumbing-laval");
    // Admin membership (human) created.
    expect(db.members).toHaveLength(1);
    expect(db.members[0]).toMatchObject({
      organization_id: ORG_ID,
      user_id: USER_ID,
      principal_type: "human",
      role: "admin",
    });
    // Slug set on the org.
    expect(db.orgs[0].slug).toBe("plumbing-laval");
    // All synthetic records soft-deleted.
    expect(db.records.every((r) => r.deleted_at !== null)).toBe(true);
    // Token consumed.
    expect(db.claims[0].consumed_at).not.toBeNull();
  });

  it("suffixes the slug on collision", async () => {
    const db = new FakeAdmin();
    seedOrg(db);
    db.orgs.push({ id: "other", name: "Other", slug: "plumbing-laval" });
    const token = seedClaim(db);

    const { slug } = await finalizeClaim({
      token,
      userId: USER_ID,
      adminClient: asClient(db),
    });
    expect(slug).toBe("plumbing-laval-2");
  });

  it("is an idempotent no-op when the token is already consumed", async () => {
    const db = new FakeAdmin();
    seedOrg(db);
    db.orgs[0].slug = "plumbing-laval"; // slug already provisioned by first run
    const token = seedClaim(db, { consumed_at: new Date().toISOString() });

    const { slug } = await finalizeClaim({
      token,
      userId: USER_ID,
      adminClient: asClient(db),
    });
    // Returns the existing slug; no second membership inserted.
    expect(slug).toBe("plumbing-laval");
    expect(db.members).toHaveLength(0);
  });

  it("does not double-insert membership when re-run before consume (unique guard)", async () => {
    const db = new FakeAdmin();
    seedOrg(db);
    const token = seedClaim(db);
    db.members.push({
      organization_id: ORG_ID,
      user_id: USER_ID,
      principal_type: "human",
      role: "admin",
    });

    // Membership already present → the 23505 path is a no-op, finalize still ok.
    const { slug } = await finalizeClaim({
      token,
      userId: USER_ID,
      adminClient: asClient(db),
    });
    expect(slug).toBe("plumbing-laval");
    expect(db.members).toHaveLength(1);
  });

  it("raises not-found for an unknown token", async () => {
    const db = new FakeAdmin();
    seedOrg(db);
    await expect(
      finalizeClaim({
        token: "does-not-exist",
        userId: USER_ID,
        adminClient: asClient(db),
      }),
    ).rejects.toMatchObject({ kind: "not-found" });
  });

  it("raises expired for a past-expiry token (no partial bootstrap)", async () => {
    const db = new FakeAdmin();
    seedOrg(db);
    const token = seedClaim(db, {
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });

    await expect(
      finalizeClaim({ token, userId: USER_ID, adminClient: asClient(db) }),
    ).rejects.toBeInstanceOf(ClaimError);
    // Nothing bootstrapped.
    expect(db.members).toHaveLength(0);
    expect(db.claims[0].consumed_at).toBeNull();
  });
});
