import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CellStrings } from "@/lib/format";
import type { RecordData, TableDefinition } from "@/types/db";

/**
 * Coverage for the Story 3.1 responsive records surface (`RecordsView`), closing
 * the frozen I/O & Edge-Case matrix.
 *
 * The repo test env is `node` (no jsdom), so the component — which uses hooks
 * (`useState`, `useTranslations`, `useSwipeable`) — is exercised through React's
 * server renderer (`renderToStaticMarkup`) rather than a DOM. Both the desktop
 * table and the mobile card list are present in that markup (the responsive
 * split is CSS-only), so a single render asserts both presentations. Swipe/clamp
 * navigation is interaction, not markup, so it is pinned via the pure exported
 * `clampTableIndex` helper. `next-intl` is mocked to echo keys (with `{table}`
 * interpolation) and `react-swipeable` to a no-op so render stays deterministic.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars?.table !== undefined) return `${key}:${String(vars.table)}`;
    // Inline-edit trigger names interpolate `{field}` (Story 3.3).
    if (vars?.field !== undefined) return `${key}:${String(vars.field)}`;
    return key;
  },
}));
vi.mock("react-swipeable", () => ({ useSwipeable: () => ({}) }));
// `RecordsView` calls `useRouter()` unconditionally (Story 3.5 wires
// `router.refresh()` for the admin column toggle). Under the node SSR renderer
// there is no Next router context, so mock it to a no-op.
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));
// Story 3.6: the realtime subscription hook opens a Supabase socket via the
// browser client (needs env + a WebSocket). It is a pure side effect with no
// markup, so stub it to a no-op — its pure seams are covered in realtime.test.ts.
vi.mock("@/components/dashboard/useRealtimeRecords", () => ({
  useRealtimeRecords: () => {},
}));

// Story 3.2 layers TanStack Query + framer-motion onto the surface. Under the
// node SSR renderer the query reads its seeded `initialData` (no fetch), so we
// wrap renders in a real `QueryClientProvider`.
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

// Imported AFTER the mocks so the component picks them up.
const { RecordsView, clampTableIndex } = await import(
  "@/components/dashboard/RecordsView"
);

const cellStrings: CellStrings = { empty: "EMPTY", yes: "Yes", no: "No" };

const jobs: TableDefinition = {
  key: "jobs",
  label: "Jobs",
  fields: [
    { key: "address", label: "Address", type: "text" },
    { key: "status", label: "Status", type: "text" },
    { key: "price", label: "Price", type: "currency" },
    { key: "secret", label: "Secret", type: "text", hidden: true },
  ],
};
const customers: TableDefinition = {
  key: "customers",
  label: "Customers",
  fields: [{ key: "name", label: "Name", type: "text" }],
};

const jobRows: RecordData[] = [
  { id: "r1", version: 1, data: { address: "123 Main St", status: "Open", price: 250 } },
  // Second row is missing `price` → the null/empty-cell path.
  { id: "r2", version: 1, data: { address: "88 King St", status: "Closed" } },
];

function render(
  tables: TableDefinition[],
  recordsByTable: Record<string, RecordData[]>,
  role: "admin" | "member" = "member",
) {
  const queryClient = new QueryClient();
  return renderToStaticMarkup(
    <QueryClientProvider client={queryClient}>
      <RecordsView
        slug="test-org"
        orgId="org-1"
        role={role}
        tables={tables}
        recordsByTable={recordsByTable}
        cellStrings={cellStrings}
      />
    </QueryClientProvider>,
  );
}

describe("RecordsView rendering (I/O matrix)", () => {
  it("lists every table in an accessible switcher when there is more than one", () => {
    const html = render([jobs, customers], { jobs: jobRows, customers: [] });

    expect(html).toContain('role="tablist"');
    const tabs = html.match(/role="tab"/g) ?? [];
    expect(tabs).toHaveLength(2);
    expect(html).toContain("Jobs");
    expect(html).toContain("Customers");
  });

  it("hides the Admin-only Columns control from a Member (Story 3.5 RBAC gate)", () => {
    const memberHtml = render([jobs], { jobs: jobRows }, "member");
    // next-intl is mocked to echo keys, so the control surfaces as its key.
    expect(memberHtml).not.toContain("columnsManager");
  });

  it("renders the Admin-only Columns control for an Admin (Story 3.5)", () => {
    const adminHtml = render([jobs], { jobs: jobRows }, "admin");
    expect(adminHtml).toContain("columnsManager");
  });

  it("renders the active table as a desktop table with a caption and visible-field columns", () => {
    const html = render([jobs], { jobs: jobRows });

    expect(html).toContain("<table");
    expect(html).toContain("<caption");
    // Caption interpolates the table label via the translation key.
    expect(html).toContain("tableCaption:Jobs");
    // Visible field labels become column headers...
    expect(html).toContain("Address");
    expect(html).toContain("Status");
    expect(html).toContain("Price");
    // ...and the hidden field never appears.
    expect(html).not.toContain("Secret");
    // Currency value formatted via formatCell.
    expect(html).toContain("$250.00");
  });

  it("renders a mobile card list showing each record's fields", () => {
    const html = render([jobs], { jobs: jobRows });

    // Card list is labelled and present alongside the desktop table.
    expect(html).toContain("cardListLabel:Jobs");
    expect(html).toContain("123 Main St");
    expect(html).toContain("88 King St");
  });

  it("shows the translated empty-cell placeholder for a missing value", () => {
    const html = render([jobs], { jobs: jobRows });

    // Row r2 has no `price`; formatCell renders the empty placeholder.
    expect(html).toContain("EMPTY");
  });

  it("omits the switcher entirely for a single visible table", () => {
    const html = render([jobs], { jobs: jobRows });

    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
  });

  it("shows the translated empty-table message (not an error) when a table has no rows", () => {
    const html = render([customers], { customers: [] });

    expect(html).toContain("emptyTable");
    expect(html).not.toContain("<table");
  });
});

describe("RecordsView inline-edit affordances (Story 3.3)", () => {
  // A table mixing an editable scalar with a read-only relation field, so we can
  // assert the `editable = ... && field.type !== "relation"` gate from markup.
  const tickets: TableDefinition = {
    key: "tickets",
    label: "Tickets",
    fields: [
      { key: "title", label: "Title", type: "text" },
      {
        key: "client",
        label: "Client",
        type: "relation",
        relationConfig: { targetTable: "customers", cardinality: "one" },
      },
    ],
  };
  const ticketRows: RecordData[] = [
    { id: "t1", version: 1, data: { title: "Fix sink", client: "cust-1" } },
  ];

  it("renders an edit trigger for an editable field's read cell", () => {
    const html = render([tickets], { tickets: ticketRows });

    // The editValueLabel aria-label marks the click-to-edit trigger (present in
    // both the desktop table cell and the mobile card value).
    expect(html).toContain('aria-label="editValueLabel:Title"');
  });

  it("renders the open-record (reverse-list) trigger for a settled row (Story 3.9)", () => {
    const html = render([tickets], { tickets: ticketRows });

    // The Eye button opens the record's reverse-list "account"; it is present in
    // both the desktop actions column and the mobile card for a settled row.
    expect(html).toContain('aria-label="openRecord"');
  });

  it("renders relation fields with an edit trigger and never the raw id (Story 3.7)", () => {
    const html = render([tickets], { tickets: ticketRows });

    // Story 3.7 makes relation cells editable (the searchable record picker opens
    // from the read trigger) and resolves the label at read time — so the trigger
    // is present and the raw target id is NEVER rendered (labels come from the
    // batched `/api/records/labels` query, which shows a skeleton until resolved).
    expect(html).toContain('aria-label="editValueLabel:Client"');
    expect(html).not.toContain("cust-1");
  });

  it("gives an un-settled optimistic row no edit trigger", () => {
    const optimisticRows: RecordData[] = [
      { id: "optimistic-abc", version: 1, data: { title: "Pending", client: "cust-2" } },
    ];
    const html = render([tickets], { tickets: optimisticRows });

    // Neither field is editable while the add is un-settled (temp id)...
    expect(html).not.toContain('aria-label="editValueLabel:Title"');
    // ...and the open-record trigger is likewise suppressed (Story 3.9): opening a
    // temp-id row would key reverse lists on a non-existent record.
    expect(html).not.toContain('aria-label="openRecord"');
    expect(html).toContain("Pending");
  });
});

describe("clampTableIndex (swipe / switcher navigation)", () => {
  it("advances and retreats within range", () => {
    expect(clampTableIndex(1, 3)).toBe(1);
    expect(clampTableIndex(2, 3)).toBe(2);
    expect(clampTableIndex(0, 3)).toBe(0);
  });

  it("clamps at both ends (no wraparound)", () => {
    expect(clampTableIndex(3, 3)).toBe(2); // past the end → last
    expect(clampTableIndex(-1, 3)).toBe(0); // before the start → first
  });

  it("is a no-op for a single table", () => {
    expect(clampTableIndex(1, 1)).toBe(0);
    expect(clampTableIndex(-1, 1)).toBe(0);
  });
});
