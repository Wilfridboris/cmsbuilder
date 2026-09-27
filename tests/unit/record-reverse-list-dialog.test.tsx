import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { CellStrings } from "@/lib/format";
import type { RecordData, TableDefinition } from "@/types/db";

/**
 * Static-render coverage for the Story 3.9 `RecordReverseListDialog`.
 *
 * The real Radix `Dialog` portals its body (invisible to `renderToStaticMarkup` in
 * the node env), so the UI `Dialog`/`DialogContent` primitives are mocked to render
 * their children inline. `RelatedRecordsList` is mocked to a marker so we can count
 * ONE section per inbound `(table, field)` pair without driving its queries;
 * `useRelationLabels` is stubbed (the own-fields summary calls it). `next-intl`
 * echoes keys with `{table}`/`{field}` interpolation so headings/fallbacks assert.
 */

vi.mock("next-intl", () => ({
  useTranslations: () => (key: string, vars?: Record<string, unknown>) => {
    if (vars?.table !== undefined && vars?.field !== undefined) {
      return `${key}:${String(vars.table)}:${String(vars.field)}`;
    }
    if (vars?.table !== undefined) return `${key}:${String(vars.table)}`;
    if (vars?.field !== undefined) return `${key}:${String(vars.field)}`;
    return key;
  },
}));

// Render the dialog body inline (Radix would portal it out of SSR markup).
vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-slot="dialog">{children}</div> : null,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div data-slot="dialog-content">{children}</div>
  ),
  DialogHeader: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: React.ReactNode }) => <h2>{children}</h2>,
  DialogDescription: ({ children }: { children: React.ReactNode }) => <p>{children}</p>,
}));

// A marker per rendered reverse-list section, echoing its heading so we can count
// sections and check heading disambiguation without the full list machinery.
vi.mock("@/components/dashboard/RelatedRecordsList", () => ({
  RelatedRecordsList: ({ heading }: { heading: string }) => (
    <div data-testid="reverse-section">{heading}</div>
  ),
}));

// The own-fields summary resolver — stub to a no-op resolver.
vi.mock("@/components/dashboard/useRelationLabels", () => ({
  useRelationLabels: () => () => null,
}));

const { RecordReverseListDialog } = await import(
  "@/components/dashboard/RecordReverseListDialog"
);

const cellStrings: CellStrings = { empty: "EMPTY", yes: "Yes", no: "No" };

const clients: TableDefinition = {
  key: "clients",
  label: "Clients",
  displayField: "name",
  fields: [{ key: "name", label: "Name", type: "text" }],
};
const jobs: TableDefinition = {
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
  ],
};
const invoices: TableDefinition = {
  key: "invoices",
  label: "Invoices",
  fields: [
    {
      key: "client",
      label: "Client",
      type: "relation",
      relationConfig: { targetTable: "clients", cardinality: "one" },
    },
  ],
};

function render(
  table: TableDefinition,
  record: RecordData | null,
  tables: TableDefinition[],
) {
  return renderToStaticMarkup(
    <RecordReverseListDialog
      open={record !== null}
      table={table}
      record={record}
      tables={tables}
      slug="test-org"
      cellStrings={cellStrings}
      onClose={() => {}}
    />,
  );
}

describe("RecordReverseListDialog (Story 3.9)", () => {
  it("shows the no-inbound empty state when nothing references the record", () => {
    // `jobs` is referenced by nothing in this single-table schema.
    const record: RecordData = { id: "j1", version: 1, data: { title: "Fix sink" } };
    const html = render(jobs, record, [jobs]);

    expect(html).toContain("reverseListEmpty");
    expect(html).not.toContain('data-testid="reverse-section"');
  });

  it("renders ONE section per inbound (table, field) pair", () => {
    // A client is referenced by jobs.client AND invoices.client → two sections.
    const record: RecordData = { id: "c1", version: 1, data: { name: "Acme" } };
    const html = render(clients, record, [clients, jobs, invoices]);

    const sections = html.match(/data-testid="reverse-section"/g) ?? [];
    expect(sections).toHaveLength(2);
    // Distinct tables → heading by table label, no field disambiguation.
    expect(html).toContain("reverseSectionHeading:Jobs");
    expect(html).toContain("reverseSectionHeading:Invoices");
  });

  it("disambiguates the heading by field when a table references via >1 field", () => {
    const meetings: TableDefinition = {
      key: "meetings",
      label: "Meetings",
      fields: [
        {
          key: "organizer",
          label: "Organizer",
          type: "relation",
          relationConfig: { targetTable: "clients", cardinality: "one" },
        },
        {
          key: "attendee",
          label: "Attendee",
          type: "relation",
          relationConfig: { targetTable: "clients", cardinality: "one" },
        },
      ],
    };
    const record: RecordData = { id: "c1", version: 1, data: { name: "Acme" } };
    const html = render(clients, record, [clients, meetings]);

    const sections = html.match(/data-testid="reverse-section"/g) ?? [];
    expect(sections).toHaveLength(2);
    expect(html).toContain("reverseSectionHeadingField:Meetings:Organizer");
    expect(html).toContain("reverseSectionHeadingField:Meetings:Attendee");
  });

  it("uses the resolved display label as the title", () => {
    const record: RecordData = { id: "c1", version: 1, data: { name: "Acme Inc" } };
    const html = render(clients, record, [clients, jobs]);
    expect(html).toContain("Acme Inc");
  });

  it("falls back to a translated generic label when the display value is blank", () => {
    const record: RecordData = { id: "c1", version: 1, data: { name: "   " } };
    const html = render(clients, record, [clients, jobs]);
    expect(html).toContain("recordLabelFallback");
  });
});
