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
  useTranslations: () => (key: string, vars?: Record<string, unknown>) =>
    vars?.table !== undefined ? `${key}:${String(vars.table)}` : key,
}));
vi.mock("react-swipeable", () => ({ useSwipeable: () => ({}) }));

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
) {
  return renderToStaticMarkup(
    <RecordsView
      tables={tables}
      recordsByTable={recordsByTable}
      cellStrings={cellStrings}
    />,
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
