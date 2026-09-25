import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { mutate, type MutateIdentity } from "@/lib/data/mutate";
import type { SchemaDefinition } from "@/types/db";

/**
 * Walking-skeleton seed (Story 1.2).
 *
 * Provisions a fixed demo org, its hardcoded logical schema, and a handful of
 * Ontario-localized rows so the /demo route can prove the pipeline end-to-end.
 * Rows are written through `mutate.ts` under the bootstrap admin client with a
 * system actor and stable idempotency keys — a single guarded write path, safe
 * to re-run. NO LLM: the schema below is hardcoded (Stories 1.4+ generate it).
 */

/** Stable identity of the demo org so the /demo read can find it. */
export const DEMO_ORG_ID = "00000000-0000-0000-0000-0000000000d0";
export const DEMO_ORG_SLUG = "scheza-demo";
export const DEMO_TABLE_KEY = "clients";

/** System actor for bootstrap writes (not a real auth user). */
const SYSTEM_ACTOR_ID = "00000000-0000-0000-0000-0000000000a0";

/** Hardcoded demo schema — one "Clients" logical table. */
const DEMO_SCHEMA: SchemaDefinition = {
  tables: [
    {
      key: DEMO_TABLE_KEY,
      label: "Clients",
      reason:
        "The people you serve — the core list every field-service business tracks.",
      fields: [
        {
          key: "name",
          label: "Client",
          type: "text",
          reason: "Who the job is for.",
        },
        {
          key: "city",
          label: "City",
          type: "text",
          reason: "Where the work happens — routing and scheduling.",
        },
        {
          key: "service",
          label: "Service",
          type: "text",
          reason: "What you did or will do for them.",
        },
        {
          key: "quoted",
          label: "Quoted",
          type: "currency",
          reason: "The agreed price — the number that becomes revenue.",
        },
        {
          key: "status",
          label: "Status",
          type: "text",
          reason: "Where the job stands so nothing falls through.",
        },
      ],
    },
  ],
};

/** 6 Ontario-localized demo rows for the Clients table. */
const DEMO_ROWS: Array<Record<string, unknown>> = [
  { name: "Maple Ridge Dental", city: "Ottawa", service: "Rooftop HVAC install", quoted: 8400, status: "Scheduled" },
  { name: "Bytown Bakery", city: "Ottawa", service: "Walk-in cooler repair", quoted: 1250, status: "In progress" },
  { name: "Rideau Auto Body", city: "Kanata", service: "Furnace replacement", quoted: 5600, status: "Quoted" },
  { name: "Glebe Family Clinic", city: "Ottawa", service: "Ductwork cleaning", quoted: 980, status: "Complete" },
  { name: "Carleton Property Mgmt", city: "Nepean", service: "Boiler annual service", quoted: 2100, status: "Scheduled" },
  { name: "Westboro Yoga Studio", city: "Ottawa", service: "AC unit install", quoted: 4300, status: "Quoted" },
];

/** Upsert the fixed demo org so the seed is idempotent across runs. */
async function upsertDemoOrg(admin: SupabaseClient): Promise<void> {
  const { error } = await admin.from("organizations").upsert(
    {
      id: DEMO_ORG_ID,
      name: "Scheza Demo Co.",
      slug: DEMO_ORG_SLUG,
    },
    { onConflict: "id" },
  );
  if (error) {
    throw new Error(`Failed to upsert demo org: ${error.message}`);
  }
}

/** Upsert the hardcoded logical schema for the demo org. */
async function upsertDemoSchema(admin: SupabaseClient): Promise<void> {
  const { error } = await admin.from("org_schemas").upsert(
    {
      organization_id: DEMO_ORG_ID,
      definition: DEMO_SCHEMA,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "organization_id" },
  );
  if (error) {
    throw new Error(`Failed to upsert demo schema: ${error.message}`);
  }
}

/**
 * Run the full walking-skeleton seed. Idempotent: the org/schema upsert and the
 * per-row stable idempotency keys mean re-running produces no duplicates.
 */
export async function seedDemo(
  admin: SupabaseClient = createAdminClient(),
): Promise<void> {
  await upsertDemoOrg(admin);
  await upsertDemoSchema(admin);

  const identity: MutateIdentity = {
    client: admin,
    actorId: SYSTEM_ACTOR_ID,
    orgId: DEMO_ORG_ID,
  };

  for (let i = 0; i < DEMO_ROWS.length; i += 1) {
    const result = await mutate(identity, "insert", DEMO_TABLE_KEY, DEMO_ROWS[i], {
      idempotencyKey: `demo-seed-${DEMO_TABLE_KEY}-${i}`,
    });
    if (result.error) {
      throw new Error(`Failed to seed demo row ${i}: ${result.error}`);
    }
  }
}
