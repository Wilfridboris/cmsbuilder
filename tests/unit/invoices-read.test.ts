import { beforeEach, describe, expect, it, vi } from "vitest";

import type { SupabaseClient } from "@supabase/supabase-js";

import { getInvoiceWithLineItems } from "@/lib/data/invoices";

/**
 * Read-layer coverage for Story 12.2's `getInvoiceWithLineItems` — specifically
 * the frozen matrix's "Linked record missing" row, whose behavior lives HERE (the
 * customer display label resolves at read time and degrades to null when the
 * linked record is soft-deleted / missing, so the UI shows the translated
 * "unavailable" note and never crashes — Invariant I6). The route test mocks this
 * whole module, so this is the only place that behavior is exercised. Also asserts
 * the resolved-label happy path and the invoice-not-found (RLS-hidden) case.
 *
 * `getSchema` is mocked; the REAL `resolvedDisplayFieldKey` runs so label
 * resolution is genuinely exercised (schema-agnostic — FR82).
 */

const { getSchema } = vi.hoisted(() => ({ getSchema: vi.fn() }));
vi.mock("@/lib/data/records", () => ({ getSchema }));

const ORG = "org-1";
const INVOICE_ID = "inv-1";
const CUSTOMER_ID = "11111111-1111-4111-8111-111111111111";

const SCHEMA = {
  tables: [
    {
      key: "customers",
      label: "Customers",
      displayField: "name",
      fields: [
        { key: "name", label: "Name", type: "text" as const },
        { key: "city", label: "City", type: "text" as const },
      ],
    },
  ],
};

type Result = { data: unknown; error: unknown };

/**
 * A chainable Supabase-client stub. `select/eq/is/order` return the builder;
 * `maybeSingle` and `order` (both terminal here) resolve to the per-table result.
 */
function makeClient(results: Record<string, Result>): SupabaseClient {
  return {
    from(table: string) {
      const result = results[table] ?? { data: null, error: null };
      const builder: Record<string, unknown> = {
        select: () => builder,
        eq: () => builder,
        is: () => builder,
        order: () => Promise.resolve(result),
        maybeSingle: () => Promise.resolve(result),
      };
      return builder;
    },
  } as unknown as SupabaseClient;
}

const draftRow = (customerRecordId: string | null) => ({
  id: INVOICE_ID,
  organization_id: ORG,
  customer_record_id: customerRecordId,
  place_of_supply_province: "ON",
  language: "en",
  status: "draft",
  version: 1,
  actor_id: "admin-1",
  created_at: "2026-09-28T00:00:00Z",
  updated_at: "2026-09-28T00:00:00Z",
});

beforeEach(() => {
  vi.clearAllMocks();
  getSchema.mockResolvedValue({ data: SCHEMA, error: null });
});

describe("getInvoiceWithLineItems — customer label resolution", () => {
  it("resolves the linked record's display label when the record is live", async () => {
    const client = makeClient({
      invoices: { data: draftRow(CUSTOMER_ID), error: null },
      invoice_line_items: {
        data: [
          {
            id: "li-1",
            invoice_id: INVOICE_ID,
            organization_id: ORG,
            description: "Consulting",
            quantity: 2,
            unit_price: 50,
            amount: 100,
            sort_order: 0,
            created_at: "2026-09-28T00:00:00Z",
            updated_at: "2026-09-28T00:00:00Z",
          },
        ],
        error: null,
      },
      records: {
        data: { table_key: "customers", data: { name: "Acme Corp" } },
        error: null,
      },
    });

    const res = await getInvoiceWithLineItems(client, ORG, INVOICE_ID);
    expect(res.error).toBeNull();
    expect(res.data?.customerLabel).toBe("Acme Corp");
    expect(res.data?.lineItems).toHaveLength(1);
  });

  it("degrades to a null label when the linked record is missing / soft-deleted", async () => {
    // The records read returns no row (soft-deleted → `is('deleted_at', null)`
    // filters it out, or the id is gone). The draft must still load with a null
    // label so the UI shows the translated "unavailable" note (matrix row).
    const client = makeClient({
      invoices: { data: draftRow(CUSTOMER_ID), error: null },
      invoice_line_items: { data: [], error: null },
      records: { data: null, error: null },
    });

    const res = await getInvoiceWithLineItems(client, ORG, INVOICE_ID);
    expect(res.error).toBeNull();
    expect(res.data).not.toBeNull();
    expect(res.data?.customerLabel).toBeNull();
  });

  it("returns a null label for a standalone draft (no linked record)", async () => {
    const client = makeClient({
      invoices: { data: draftRow(null), error: null },
      invoice_line_items: { data: [], error: null },
    });

    const res = await getInvoiceWithLineItems(client, ORG, INVOICE_ID);
    expect(res.data?.customerLabel).toBeNull();
    // A standalone draft never reads records / schema for a label.
    expect(getSchema).not.toHaveBeenCalled();
  });

  it("returns null data when the invoice does not exist under the org (RLS-hidden)", async () => {
    const client = makeClient({
      invoices: { data: null, error: null },
    });

    const res = await getInvoiceWithLineItems(client, ORG, INVOICE_ID);
    expect(res.error).toBeNull();
    expect(res.data).toBeNull();
  });
});
